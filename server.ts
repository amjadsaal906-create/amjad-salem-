import http from "http";
import express from "express";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import JSZip from "jszip";
import { WebSocketServer, WebSocket } from "ws";
import { Type, type GoogleGenAI } from "@google/genai";
import { createServer as createViteServer } from "vite";
import {
  CHAT_MODEL,
  STT_MODEL,
  TTS_MODEL,
  VEO_MODEL,
  callGeminiStructured,
  formatGeminiError,
  getGeminiClient,
} from "./server-gemini.ts";
import {
  seedLessonsIfEmpty,
  listAllLessons,
  getLessonById,
  upsertLesson,
  deleteLessonById,
  listArtifactsForLesson,
  saveArtifact,
  saveQuizReport,
  listQuizReports,
  getDailyFact,
  saveDailyFact,
  listPrepTemplates,
  getPrepTemplateById,
  upsertPrepTemplate,
  deletePrepTemplateById,
  listAllBooks,
  getBookById,
  upsertBook,
  deleteBookById,
} from "./server-db.ts";
import { INITIAL_LESSONS } from "./src/data/lessons.ts";
import {
  buildServerPptxBuffer,
  formatTemplateStructuredDeck,
  PPTX_MIME_TYPE,
} from "./server-pptx.ts";
import {
  attachRadarWebSocket,
  registerRadarRoutes,
} from "./server-radar.ts";
import type { BookRecord, BookUnit, PreparationTemplate, PresentationDeckData } from "./src/types.ts";

dotenv.config();

const PORT = Number(process.env.PORT || 3000);

// Seed SQLite with default 5-subject lessons if empty
seedLessonsIfEmpty(INITIAL_LESSONS as unknown as Array<Record<string, unknown>>);

function buildSourcesText(sources: unknown): string {
  const activeSources = Array.isArray(sources)
    ? sources.filter((s: { enabled?: boolean }) => s.enabled !== false)
    : [];
  if (activeSources.length === 0) {
    return "لا توجد مصادر مفعّلة حالياً في قاعدة معرفة الدرس.";
  }
  return activeSources
    .map(
      (s: { title?: string; category?: string; content?: string }, idx: number) =>
        `[مصدر ${idx + 1}: ${s.title || "مصدر"} (${s.category || ""})]\n${s.content || ""}`
    )
    .join("\n\n");
}

function buildPrepTemplateContext(rawTpl: unknown, prepTemplateId?: string): {
  template: Record<string, unknown> | null;
  promptBlock: string;
} {
  let tpl =
    rawTpl && typeof rawTpl === "object"
      ? (rawTpl as Record<string, unknown>)
      : null;
  if (!tpl && prepTemplateId) {
    tpl = getPrepTemplateById(String(prepTemplateId));
  }
  if (!tpl) {
    return { template: null, promptBlock: "" };
  }
  const sections = Array.isArray(tpl.requiredSections)
    ? (tpl.requiredSections as string[]).join(" | ")
    : "";
  const promptBlock = `
=== فورمة / قالب التحضير المعتمد من المعلم (${String(tpl.templateName || "")}) ===
الجهة/المدرسة: ${String(tpl.institutionOrSchool || "غير محددة")}
الحقول والأقسام المطلوبة في الفورمة بالترتيب: ${sections}
الهيكل الكامل المستخرج من الفورمة:
${String(tpl.rawStructureText || "").slice(0, 4500)}
إرشادات بناء البوربوينت من الفورمة: ${String(tpl.presentationMappingGuidelines || "")}
ملاحظات المعلم الإضافية: ${String(tpl.customInstructions || "")}
=========================================================================
`;
  return { template: tpl, promptBlock };
}

function formatVttTimestamp(sec: number): string {
  const safe = Math.max(0, sec);
  const hours = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const ms = Math.round((safe - Math.floor(safe)) * 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(hours)}:${pad(mins)}:${pad(secs)}.${pad(ms, 3)}`;
}

function buildVtt(timedCaptions: Array<{ startSec: number; endSec: number; text: string }>): string {
  const lines = ["WEBVTT", ""];
  timedCaptions.forEach((cap, idx) => {
    lines.push(String(idx + 1));
    lines.push(`${formatVttTimestamp(cap.startSec)} --> ${formatVttTimestamp(cap.endSec)}`);
    lines.push(cap.text);
    lines.push("");
  });
  return lines.join("\n");
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function extractTextFromOfficeZip(buffer: Buffer, kind: "docx" | "pptx"): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  if (kind === "docx") {
    const docXml = await zip.file("word/document.xml")?.async("string");
    if (!docXml) return "";
    const paragraphs = docXml.split(/<\/w:p>/g);
    return paragraphs
      .map((p) => {
        const runs = Array.from(p.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)).map((m) =>
          decodeXmlEntities(m[1])
        );
        return runs.join("");
      })
      .filter((line) => line.trim().length > 0)
      .join("\n");
  } else {
    const slideFiles = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => {
        const na = Number(a.match(/\d+/)?.[0] || 0);
        const nb = Number(b.match(/\d+/)?.[0] || 0);
        return na - nb;
      });
    const slideTexts: string[] = [];
    for (const file of slideFiles) {
      const xml = await zip.file(file)?.async("string");
      if (!xml) continue;
      const texts = Array.from(xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)).map((m) =>
        decodeXmlEntities(m[1])
      );
      if (texts.length > 0) {
        slideTexts.push(`[${path.basename(file, ".xml")}]\n${texts.join(" ")}`);
      }
    }
    return slideTexts.join("\n\n");
  }
}

const QUIZ_CARTOON_AVATARS = [
  "robo_sprout",
  "kitty_chemist",
  "bunny_star",
  "panda_genius",
  "fox_explorer",
  "owl_professor",
  "bear_honey",
  "astro_duck",
];

// Live Kahoot-style Quiz Room Manager (Server-Authoritative WebSocket State)
interface LiveParticipant {
  id: string;
  name: string;
  avatarId: string;
  score: number;
  correctCount: number;
  answeredCount: number;
  answeredCurrent: boolean;
  ws: WebSocket;
}

interface LiveQuestion {
  id: string;
  questionType: string;
  question: string;
  options: string[];
  correctIndex: number;
  timeLimitSec: number;
  points: number;
  explanation: string;
}

interface LiveRoom {
  roomCode: string;
  lessonId: string;
  quizTitle: string;
  questions: LiveQuestion[];
  status: "lobby" | "question" | "reveal" | "finished";
  currentQuestionIndex: number;
  questionStartedAt: number;
  timerHandle: ReturnType<typeof setTimeout> | null;
  hostWs: WebSocket | null;
  participants: Map<string, LiveParticipant>;
  questionStats: Array<{ correct: number; total: number }>;
  buzzerMode?: boolean;
  buzzerWinner?: { participantId: string; name: string; avatarId: string; buzzedAt: number } | null;
}

const liveRooms = new Map<string, LiveRoom>();

function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return liveRooms.has(code) ? generateRoomCode() : code;
}

function broadcastRoomState(room: LiveRoom): void {
  const leaderboard = Array.from(room.participants.values())
    .map((p) => ({
      id: p.id,
      name: p.name,
      avatarId: p.avatarId,
      score: p.score,
      correctCount: p.correctCount,
      answeredCount: p.answeredCount,
      answeredCurrent: p.answeredCurrent,
    }))
    .sort((a, b) => b.score - a.score);

  const q = room.questions[room.currentQuestionIndex];
  const publicQuestion = q
    ? {
        id: q.id,
        questionType: q.questionType,
        question: q.question,
        options: q.options,
        timeLimitSec: q.timeLimitSec,
        points: q.points,
        ...(room.status === "reveal" || room.status === "finished"
          ? { correctIndex: q.correctIndex, explanation: q.explanation }
          : {}),
      }
    : null;

  const payload = JSON.stringify({
    type: "room:state",
    roomCode: room.roomCode,
    quizTitle: room.quizTitle,
    status: room.status,
    currentQuestionIndex: room.currentQuestionIndex,
    totalQuestions: room.questions.length,
    questionStartedAt: room.questionStartedAt,
    question: publicQuestion,
    leaderboard,
    buzzerMode: Boolean(room.buzzerMode),
    buzzerWinner: room.buzzerWinner || null,
  });

  if (room.hostWs && room.hostWs.readyState === WebSocket.OPEN) {
    room.hostWs.send(payload);
  }
  for (const p of room.participants.values()) {
    if (p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(payload);
    }
  }
}

function finishRoom(room: LiveRoom): void {
  if (room.timerHandle) {
    clearTimeout(room.timerHandle);
    room.timerHandle = null;
  }
  room.status = "finished";

  const participants = Array.from(room.participants.values())
    .map((p) => ({
      id: p.id,
      name: p.name,
      avatarId: p.avatarId,
      score: p.score,
      correctCount: p.correctCount,
      answeredCount: p.answeredCount,
    }))
    .sort((a, b) => b.score - a.score);

  const report = {
    roomCode: room.roomCode,
    quizTitle: room.quizTitle,
    lessonId: room.lessonId,
    totalQuestions: room.questions.length,
    participants,
    questionAccuracy: room.questions.map((q, idx) => {
      const stat = room.questionStats[idx] || { correct: 0, total: 0 };
      return {
        question: q.question,
        correctRate: stat.total > 0 ? Math.round((stat.correct / stat.total) * 100) : 0,
        totalAnswered: stat.total,
      };
    }),
    finishedAt: new Date().toISOString(),
  };

  saveQuizReport(room.roomCode, room.lessonId, room.quizTitle, report);
  broadcastRoomState(room);
}

function startQuestionOnRoom(room: LiveRoom, index: number): void {
  if (room.timerHandle) {
    clearTimeout(room.timerHandle);
    room.timerHandle = null;
  }
  if (index >= room.questions.length) {
    finishRoom(room);
    return;
  }
  room.currentQuestionIndex = index;
  room.status = "question";
  room.questionStartedAt = Date.now();
  room.buzzerWinner = null;
  for (const p of room.participants.values()) {
    p.answeredCurrent = false;
  }
  broadcastRoomState(room);

  const limitMs = Math.max(5, room.questions[index].timeLimitSec || 20) * 1000;
  room.timerHandle = setTimeout(() => {
    if (room.status === "question" && room.currentQuestionIndex === index) {
      room.status = "reveal";
      broadcastRoomState(room);
    }
  }, limitMs);
}

const BOOKS_DIR = path.join(process.cwd(), "data", "books");
fs.mkdirSync(BOOKS_DIR, { recursive: true });

const TMP_UPLOADS_DIR = path.join(process.cwd(), "data", "tmp_uploads");
fs.mkdirSync(TMP_UPLOADS_DIR, { recursive: true });

function safeTempUploadPath(uploadId: string): string | null {
  const clean = String(uploadId || "").trim();
  if (!/^[a-zA-Z0-9_-]{6,80}$/.test(clean)) return null;
  const resolved = path.resolve(TMP_UPLOADS_DIR, `${clean}.part`);
  if (!resolved.startsWith(path.resolve(TMP_UPLOADS_DIR) + path.sep)) {
    return null;
  }
  return resolved;
}

function cleanupTempUpload(uploadId?: string | null): void {
  if (!uploadId) return;
  const p = safeTempUploadPath(uploadId);
  if (p && fs.existsSync(p)) {
    try {
      fs.unlinkSync(p);
    } catch {
      // Ignore cleanup error
    }
  }
}

function normalizeUploadMimeType(fileName: string, rawMime?: string): string {
  const mime = String(rawMime || "").trim();
  if (mime && mime !== "application/octet-stream") {
    return mime;
  }
  const lower = String(fileName || "").toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".pptx")) {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }
  if (lower.endsWith(".txt") || lower.endsWith(".md") || lower.endsWith(".csv")) {
    return "text/plain";
  }
  return mime || "application/pdf";
}

async function waitForUploadedFileActive(
  ai: GoogleGenAI,
  uploaded: { name?: string; uri?: string; state?: string }
): Promise<{ name?: string; uri?: string; state?: string }> {
  let current = uploaded;
  const fileName = current?.name;
  if (!fileName) return current;
  for (let attempt = 0; attempt < 45; attempt++) {
    if (!current.state || current.state === "ACTIVE") {
      return current;
    }
    if (current.state === "FAILED") {
      throw new Error("فشلت معالجة الملف المرفوع داخل خادم Gemini Files.");
    }
    await new Promise((r) => setTimeout(r, 1500));
    const fetched = await ai.files.get({ name: fileName });
    current = {
      name: fetched.name,
      uri: fetched.uri,
      state: fetched.state ? String(fetched.state) : undefined,
    };
  }
  if (current.state === "PROCESSING") {
    throw new Error("استغرقت معالجة الملف المرفوع وقتاً أطول من المتوقع؛ يرجى المحاولة مرة أخرى.");
  }
  return current;
}

function safeDiskBookPath(storagePath: string): string | null {
  if (!storagePath) return null;
  const resolved = path.resolve(storagePath);
  if (!resolved.startsWith(path.resolve(BOOKS_DIR) + path.sep)) {
    return null;
  }
  return resolved;
}

async function prepareBookModelParts(
  ai: GoogleGenAI,
  book: BookRecord,
  instruction: string
): Promise<Array<Record<string, unknown>>> {
  const safePath = safeDiskBookPath(book.storagePath);
  if (!safePath || !fs.existsSync(safePath)) {
    throw new Error("ملف الكتاب المحفوظ غير موجود على القرص.");
  }

  const lowerName = book.fileName.toLowerCase();
  const mime = normalizeUploadMimeType(book.fileName, book.mimeType);
  const buffer = fs.readFileSync(safePath);

  if (lowerName.endsWith(".docx") || mime.includes("wordprocessingml")) {
    const zip = await JSZip.loadAsync(buffer);
    const xmlFiles = Object.keys(zip.files)
      .filter((name) => name.startsWith("word/document") && name.endsWith(".xml"))
      .sort();
    const parts: string[] = [];
    for (const file of xmlFiles) {
      const xml = await zip.files[file].async("string");
      const plain = xml
        .replace(/<w:p[^>]*>/g, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (plain) parts.push(plain);
    }
    const text = parts.join("\n").slice(0, 60000);
    return [{ text: `${instruction}\n\nBook text content:\n${text}` }];
  }

  if (lowerName.endsWith(".pptx") || mime.includes("presentationml")) {
    const zip = await JSZip.loadAsync(buffer);
    const xmlFiles = Object.keys(zip.files)
      .filter((name) => name.startsWith("ppt/slides/slide") && name.endsWith(".xml"))
      .sort();
    const parts: string[] = [];
    for (const file of xmlFiles) {
      const xml = await zip.files[file].async("string");
      const plain = xml
        .replace(/<a:p[^>]*>/g, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (plain) parts.push(`[${file}]\n${plain}`);
    }
    const text = parts.join("\n").slice(0, 60000);
    return [{ text: `${instruction}\n\nBook slides content:\n${text}` }];
  }

  if (
    mime.startsWith("text/") ||
    lowerName.endsWith(".txt") ||
    lowerName.endsWith(".md") ||
    lowerName.endsWith(".csv")
  ) {
    const text = buffer.toString("utf-8").slice(0, 60000);
    return [{ text: `${instruction}\n\nBook text content:\n${text}` }];
  }

  // Binary PDF or Image: use Gemini Files API for large books (>8MB), inlineData for smaller files
  if (buffer.length > 8 * 1024 * 1024) {
    const uploaded = await ai.files.upload({
      file: safePath,
      config: { mimeType: mime },
    });
    const activeFile = await waitForUploadedFileActive(ai, uploaded);
    return [
      { fileData: { fileUri: activeFile.uri, mimeType: mime } },
      { text: instruction },
    ];
  }

  return [
    { inlineData: { mimeType: mime, data: buffer.toString("base64") } },
    { text: instruction },
  ];
}

/**
 * Triggers a Gemini API analysis on an uploaded book stored in the platform
 * to extract its units, chapters, lesson titles, page spans, objectives, and key concepts,
 * building and persisting a structured index in SQLite.
 */
async function analyzeBookWithGemini(
  bookId: string,
  language: "ar" | "en" = "ar"
): Promise<BookRecord> {
  const existing = getBookById(bookId) as BookRecord | null;
  if (!existing) {
    throw new Error("BOOK_NOT_FOUND");
  }

  const ai = getGeminiClient();
  if (!ai) {
    throw new Error("GEMINI_NOT_CONFIGURED");
  }

  upsertBook({ ...existing, analysisStatus: "analyzing", analysisError: undefined });

  const langHint =
    language === "en"
      ? "Provide titles, summaries, objectives, and excerpts in the book's primary language (defaulting to English if ambiguous)."
      : "اكتب جميع العناوين والملخصات والأهداف والمحتوى المستخرج بلغة الكتاب نفسها (العربية إن كان الكتاب عربياً).";

  const instruction = `Analyze this complete school textbook ("${existing.title}", subject: ${existing.subjectName}, grade: ${existing.gradeLevel}).
Read its Table of Contents and textbook pages carefully to produce an accurate hierarchical index:
1) bookTitle: faithful title of the book
2) bookSummary: concise academic overview of what this book covers (3-4 sentences)
3) totalPagesEstimated: estimated total page count as an integer
4) units: ordered list of every Unit (الوحدة) in the book. If the book uses Chapters directly without Units, create 1 or logical Units grouping those Chapters.
   For each unit:
   - unitNumber (e.g. "1")
   - unitTitle
   - startPage (integer)
   - endPage (integer)
   - chapters: ordered list of Chapters (الفصل/القسم) inside the unit (if lessons belong directly under a unit, create a chapter matching the unit).
     For each chapter:
     - chapterNumber (e.g. "1.1" or "1")
     - chapterTitle
     - startPage (integer)
     - endPage (integer)
     - lessons: every individual Lesson (الدرس) in that chapter:
       - lessonNumber (e.g. "1")
       - title (exact lesson title from textbook)
       - startPage (integer)
       - endPage (integer)
       - summary (clear 2-3 sentence educational summary grounded in those pages)
       - objectives (2-4 specific learning objectives)
       - keyConcepts (3-6 scientific concepts/terms covered)
       - contentExcerpt (rich structured explanation & formulas/facts from those pages so teachers can immediately build lesson plans, slides, and quizzes from it)
${langHint}`;

  try {
    const parts = await prepareBookModelParts(ai, existing, instruction);

    const parsed = await callGeminiStructured<{
      bookTitle?: string;
      bookSummary?: string;
      totalPagesEstimated?: number;
      units?: Array<Record<string, unknown>>;
    }>(
      ai,
      {
        contents: { parts },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              bookTitle: { type: Type.STRING },
              bookSummary: { type: Type.STRING },
              totalPagesEstimated: { type: Type.INTEGER },
              units: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    unitNumber: { type: Type.STRING },
                    unitTitle: { type: Type.STRING },
                    startPage: { type: Type.INTEGER },
                    endPage: { type: Type.INTEGER },
                    chapters: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          chapterNumber: { type: Type.STRING },
                          chapterTitle: { type: Type.STRING },
                          startPage: { type: Type.INTEGER },
                          endPage: { type: Type.INTEGER },
                          lessons: {
                            type: Type.ARRAY,
                            items: {
                              type: Type.OBJECT,
                              properties: {
                                lessonNumber: { type: Type.STRING },
                                title: { type: Type.STRING },
                                startPage: { type: Type.INTEGER },
                                endPage: { type: Type.INTEGER },
                                summary: { type: Type.STRING },
                                objectives: { type: Type.ARRAY, items: { type: Type.STRING } },
                                keyConcepts: { type: Type.ARRAY, items: { type: Type.STRING } },
                                contentExcerpt: { type: Type.STRING },
                              },
                              required: [
                                "lessonNumber",
                                "title",
                                "startPage",
                                "endPage",
                                "summary",
                                "objectives",
                                "keyConcepts",
                                "contentExcerpt",
                              ],
                            },
                          },
                        },
                        required: ["chapterNumber", "chapterTitle", "startPage", "endPage", "lessons"],
                      },
                    },
                  },
                  required: ["unitNumber", "unitTitle", "startPage", "endPage", "chapters"],
                },
              },
            },
            required: ["bookTitle", "bookSummary", "totalPagesEstimated", "units"],
          },
        },
      },
      { label: "Analyze Book" }
    );
    const rawUnits = Array.isArray(parsed.units) ? parsed.units : [];

    const normalizedUnits: BookUnit[] = rawUnits.map((u: Record<string, unknown>, uIdx: number) => {
      const rawChapters = Array.isArray(u.chapters) ? u.chapters : [];
      return {
        id: `${bookId}-u${uIdx + 1}`,
        unitNumber: String(u.unitNumber || uIdx + 1),
        unitTitle: String(u.unitTitle || `الوحدة ${uIdx + 1}`),
        startPage: Number(u.startPage || 1),
        endPage: Number(u.endPage || 1),
        chapters: rawChapters.map((c: Record<string, unknown>, cIdx: number) => {
          const rawLessons = Array.isArray(c.lessons) ? c.lessons : [];
          return {
            id: `${bookId}-u${uIdx + 1}-c${cIdx + 1}`,
            chapterNumber: String(c.chapterNumber || cIdx + 1),
            chapterTitle: String(c.chapterTitle || `الفصل ${cIdx + 1}`),
            startPage: Number(c.startPage || 1),
            endPage: Number(c.endPage || 1),
            lessons: rawLessons.map((l: Record<string, unknown>, lIdx: number) => ({
              id: `${bookId}-u${uIdx + 1}-c${cIdx + 1}-l${lIdx + 1}`,
              lessonNumber: String(l.lessonNumber || lIdx + 1),
              title: String(l.title || `الدرس ${lIdx + 1}`),
              startPage: Number(l.startPage || 1),
              endPage: Number(l.endPage || 1),
              summary: String(l.summary || ""),
              objectives: Array.isArray(l.objectives) ? l.objectives.map(String) : [],
              keyConcepts: Array.isArray(l.keyConcepts) ? l.keyConcepts.map(String) : [],
              contentExcerpt: String(l.contentExcerpt || l.summary || ""),
            })),
          };
        }),
      };
    });

    const updated = upsertBook({
      ...existing,
      title: existing.title || String(parsed.bookTitle || existing.fileName),
      bookSummary: String(parsed.bookSummary || ""),
      totalPagesEstimated: Number(parsed.totalPagesEstimated || 0),
      analysisStatus: "indexed",
      analysisError: undefined,
      units: normalizedUnits,
    }) as BookRecord;

    return updated;
  } catch (err) {
    const formatted = formatGeminiError(err);
    upsertBook({
      ...existing,
      analysisStatus: "error",
      analysisError: formatted.message,
    });
    throw err;
  }
}

async function startServer() {
  const app = express();
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Requested-With"
    );
    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }
    return next();
  });
  app.use(express.json({ limit: "60mb" }));

  // 0. Chunked Binary Upload Endpoints (for large PDFs / textbooks bypassing HTTP body limits)
  app.post("/api/uploads/init", (req, res) => {
    const { fileSize = 0 } = req.body ?? {};
    if (Number(fileSize) > 75 * 1024 * 1024) {
      return res.status(413).json({
        message: "حجم الملف يتجاوز الحد الأقصى المدعوم حالياً (75 ميجابايت).",
      });
    }
    const uploadId = `upl-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const tmpPath = safeTempUploadPath(uploadId);
    if (!tmpPath) {
      return res.status(500).json({ message: "تعذر تهيئة مسار الرفع المؤقت." });
    }
    fs.writeFileSync(tmpPath, Buffer.alloc(0));
    return res.json({ uploadId });
  });

  app.post(
    "/api/uploads/:id/chunk",
    express.raw({ type: "application/octet-stream", limit: "8mb" }),
    (req, res) => {
      const tmpPath = safeTempUploadPath(req.params.id);
      if (!tmpPath || !fs.existsSync(tmpPath)) {
        return res.status(404).json({ message: "جلسة الرفع غير موجودة أو انتهت صلاحيتها." });
      }
      const chunk = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (chunk.length === 0) {
        return res.status(400).json({ message: "الجزء المرسل فارغ." });
      }
      const currentSize = fs.statSync(tmpPath).size;
      if (currentSize + chunk.length > 75 * 1024 * 1024) {
        cleanupTempUpload(req.params.id);
        return res.status(413).json({ message: "تجاوز الملف الحد الأقصى للحجم (75 ميجابايت)." });
      }
      fs.appendFileSync(tmpPath, chunk);
      return res.json({ ok: true, receivedBytes: currentSize + chunk.length });
    }
  );

  app.delete("/api/uploads/:id", (req, res) => {
    cleanupTempUpload(req.params.id);
    return res.json({ ok: true });
  });

  // 1. Capabilities endpoint
  app.get("/api/capabilities", (_req, res) => {
    const ai = getGeminiClient();
    const signUrl = process.env.SIGN_LANGUAGE_API_URL?.trim();
    const signKey = process.env.SIGN_LANGUAGE_API_KEY?.trim();
    const signConfigured = Boolean(signUrl && signKey);

    res.json({
      geminiConfigured: Boolean(ai),
      databaseEngine: "SQLite (node:sqlite)",
      realtimeEngine: "WebSocket (/ws/quiz)",
      models: {
        chatAndVision: CHAT_MODEL,
        tts: TTS_MODEL,
        stt: STT_MODEL,
        veoVideo: VEO_MODEL,
      },
      signLanguageExternalService: {
        configured: signConfigured,
        providerName: signConfigured ? process.env.SIGN_LANGUAGE_PROVIDER_NAME || "External Sign API" : null,
        statusMessage: signConfigured
          ? "تم ربط خدمة الترجمة الآلية للغة الإشارة."
          : "لا توجد خدمة خارجية مهيأة حالياً لتوليد فيديو/أفاتار لغة الإشارة الآلي. يتوفر قاموس لغة الإشارة العلمي المحلي مع التهجئة الإشارية، ويمكن ربط الخدمة الخارجية بمجرد توفير رابط API ومفتاح التشغيل.",
        requiredEnvVars: ["SIGN_LANGUAGE_API_URL", "SIGN_LANGUAGE_API_KEY"],
      },
    });
  });

  // 2. Lesson Library CRUD (SQLite)
  app.get("/api/lessons", (_req, res) => {
    res.json({ lessons: listAllLessons() });
  });

  app.post("/api/lessons", (req, res) => {
    const saved = upsertLesson(req.body || {});
    res.json({ lesson: saved });
  });

  app.put("/api/lessons/:id", (req, res) => {
    const saved = upsertLesson({ ...(req.body || {}), id: req.params.id });
    res.json({ lesson: saved });
  });

  app.delete("/api/lessons/:id", (req, res) => {
    const deleted = deleteLessonById(req.params.id);
    if (!deleted) {
      return res.status(400).json({ message: "لا يمكن حذف الدروس الأساسية الافتراضية أو الدرس غير موجود." });
    }
    res.json({ ok: true });
  });

  // 3. Connected Lesson Artifacts CRUD (SQLite)
  app.get("/api/artifacts", (req, res) => {
    const lessonId = String(req.query.lessonId || "");
    if (!lessonId) return res.json({ artifacts: [] });
    res.json({ artifacts: listArtifactsForLesson(lessonId) });
  });

  app.post("/api/artifacts", (req, res) => {
    const { lessonId, artifactType, title, data } = req.body ?? {};
    if (!lessonId || !artifactType || !data) {
      return res.status(400).json({ message: "بيانات النتاج التعليمي غير مكتملة." });
    }
    const saved = saveArtifact(String(lessonId), String(artifactType), String(title || artifactType), data);
    res.json({ artifact: saved });
  });

  // 4. Quiz Reports History
  app.get("/api/quiz-reports", (_req, res) => {
    res.json({ reports: listQuizReports() });
  });

  // 5. Smart Educational Chatbot (Bilingual AR/EN, Student/Teacher, Level-adaptive, Remedial)
  app.post("/api/chat", async (req, res) => {
    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({
        error: "GEMINI_NOT_CONFIGURED",
        message: "مفتاح GEMINI_API_KEY غير مهيأ على الخادم. يرجى إضافته في Settings > Secrets لتشغيل المساعد الذكي.",
      });
    }

    try {
      const body = req.body ?? {};
      const {
        role = "student",
        messages = [],
        message = "",
        lesson = null,
        lessonTitle = lesson?.title || "",
        lessonSummary = lesson?.summary || "",
        sources = lesson?.sources || [],
        sourcePolicy = "lesson_only",
        actionMode = "explain",
        studentLevel = "intermediate",
        language = body.chatLanguage || "auto",
        weakSpots = [],
        accommodations = [],
        simplifiedMode = false,
      } = body;

      const resolvedMessages =
        Array.isArray(messages) && messages.length > 0
          ? messages
          : String(message || "").trim()
            ? [{ sender: "user", text: String(message).trim() }]
            : [];

      if (resolvedMessages.length === 0) {
        return res.status(400).json({
          error: "EMPTY_MESSAGE",
          message: "يرجى كتابة سؤال أو رسالة قبل الإرسال.",
        });
      }

      const sourcesBlock = buildSourcesText(sources);

      const policyRule =
        sourcePolicy === "lesson_only"
          ? `سياسة المصادر (صارمة — التزام كامل بمصادر الدرس فقط):
يجب أن تعتمد إجابتك حصرياً على النصوص الواردة في "مصادر الدرس المعتمدة" أدناه.
إذا كان سؤال المستخدم خارج نطاق هذه المصادر أو يتطلب معلومة غير موجودة فيها:
- لا تخترع معلومة من خارج المصادر.
- وضّح بلطف في الحقل outOfScopeNotice وفي الرد أن المعلومة غير مشمولة في مصادر الدرس المعتمدة التي حددها المعلم.`
          : sourcePolicy === "lesson_plus_curriculum"
          ? `سياسة المصادر (مصادر الدرس + المبادئ المنهجية المعتمدة):
اعتمد أولاً على مصادر الدرس أدناه واستشهد بها، ويمكنك إضافة توضيح علمي منهجي مساند مرتبط بالدرس.`
          : `سياسة المصادر (موسّعة): اربط إجابتك بقاعدة معرفة الدرس أدناه مع السماح بأمثلة إثرائية مناسبة.`;

      const levelRule =
        studentLevel === "beginner"
          ? "مستوى الطالب (مبتدئ): لغة شديدة البساطة وتشبيهات يومية واضحة."
          : studentLevel === "advanced"
          ? "مستوى الطالب (متقدم): تفسير علمي عميق ومصطلحات دقيقة."
          : "مستوى الطالب (متوسط): توازن بين الوضوح والمصطلح العلمي.";

      const languageRule =
        language === "en"
          ? "Respond strictly in clear English."
          : language === "ar"
          ? "أجب باللغة العربية الفصحى السلسة."
          : "Respond in the exact same language as the user's latest message (Arabic or English).";

      const roleRule =
        role === "teacher"
          ? "المستخدم هو المعلم: قدّم إجابات تربوية منظمة ومقترحات أنشطة شاملة."
          : `المستخدم هو الطالب: خاطبه بأسلوب تعليمي مشجع. ${simplifiedMode ? "استخدم خطوات قصيرة وجمل مبسطة." : ""} ${
              accommodations.length > 0 ? `تسهيلات الطالب: ${accommodations.join("، ")}.` : ""
            }`;

      const systemInstruction = `أنت "المساعد العلمي الذكي" (Smart Science AI Tutor).
الدرس الحالي: ${lessonTitle}
ملخص الدرس: ${lessonSummary}
مواطن الضعف المرصودة سابقاً: ${
        Array.isArray(weakSpots) && weakSpots.length > 0
          ? weakSpots.map((w: { concept?: string }) => w.concept).join("، ")
          : "لا توجد بعد"
      }

${languageRule}
${levelRule}
${roleRule}
${policyRule}
المطلوب (${actionMode}): اشرح المفهوم أو أعطِ مثالاً/تمريناً/تشخيصاً. وإذا تضمنت رسالة الطالب أي خطأ فهم، سجله في detectedWeakSpots مع شرح بديل في alternativeExplanation وسؤال علاجي في remedialQuestions.

مصادر الدرس المعتمدة:
${sourcesBlock}`;

      const conversationContents = resolvedMessages
        .slice(-10)
        .map((m: { sender?: string; text?: string }) => ({
          role: m.sender === "assistant" ? "model" : "user",
          parts: [{ text: String(m.text || "") }],
        }));

      const exerciseSchema = {
        type: Type.OBJECT,
        properties: {
          question: { type: Type.STRING },
          options: { type: Type.ARRAY, items: { type: Type.STRING } },
          correctIndex: { type: Type.INTEGER },
          hint: { type: Type.STRING },
          explanation: { type: Type.STRING },
        },
      };

      const parsed = await callGeminiStructured<Record<string, unknown>>(
        ai,
        {
          contents: conversationContents,
          config: {
            systemInstruction,
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                reply: { type: Type.STRING },
                outOfScopeNotice: { type: Type.STRING },
                alternativeExplanation: { type: Type.STRING },
                citations: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      sourceTitle: { type: Type.STRING },
                      excerptUsed: { type: Type.STRING },
                      withinApprovedSources: { type: Type.BOOLEAN },
                    },
                  },
                },
                detectedWeakSpots: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      concept: { type: Type.STRING },
                      observation: { type: Type.STRING },
                      suggestedRemediation: { type: Type.STRING },
                    },
                  },
                },
                quickExercise: exerciseSchema,
                remedialQuestions: { type: Type.ARRAY, items: exerciseSchema },
                followUpSuggestions: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              required: ["reply", "citations", "detectedWeakSpots", "followUpSuggestions"],
            },
          },
        },
        {
          label: "Chat",
          validate: (obj) => typeof obj.reply === "string" && obj.reply.trim().length > 0,
        }
      );

      return res.json(parsed);
    } catch (err) {
      const formatted = formatGeminiError(err);
      return res.status(formatted.status).json({ error: formatted.code, message: formatted.message });
    }
  });

  // 6. TTS via gemini-3.8-flash-lite-tts
  app.post("/api/tts", async (req, res) => {
    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({
        error: "GEMINI_NOT_CONFIGURED",
        message: "مفتاح GEMINI_API_KEY غير مهيأ. يمكنك استخدام القارئ الصوتي المدمج في المتصفح مؤقتاً.",
      });
    }

    try {
      const { text = "", voiceName = "Kore", style = "Clear, warm Arabic educational narrator" } = req.body ?? {};
      const cleanText = String(text).trim().slice(0, 2500);
      if (!cleanText) return res.status(400).json({ message: "النص المطلوب قراءته فارغ." });

      const response = await ai.models.generateContent({
        model: TTS_MODEL,
        contents: [{ role: "user", parts: [{ text: cleanText, speechMetadata: { style } }] }],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
        },
      });

      const audioBase64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!audioBase64) return res.status(502).json({ message: "لم يتم استلام بيانات صوتية." });
      return res.json({ audioBase64, mimeType: "audio/wav" });
    } catch (err) {
      const formatted = formatGeminiError(err);
      return res.status(formatted.status).json({ error: formatted.code, message: formatted.message });
    }
  });

  // 7. STT & Timed WebVTT Captions
  app.post("/api/stt", async (req, res) => {
    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({
        error: "GEMINI_NOT_CONFIGURED",
        message: "مفتاح GEMINI_API_KEY غير مهيأ لتحويل الصوت/الفيديو إلى نص.",
      });
    }

    try {
      const { audioBase64, mimeType = "audio/webm", mode = "transcribe", language = "auto" } = req.body ?? {};
      if (!audioBase64) return res.status(400).json({ message: "لا يوجد ملف صوتي أو فيديو مرسل." });

      const isVideo = String(mimeType).startsWith("video/");
      const langHint = language === "en" ? "English" : language === "ar" ? "Arabic" : "Arabic or English";

      if (isVideo || mode === "video_captions") {
        const parsed = await callGeminiStructured<{
          transcript?: string;
          timedCaptions?: Array<{ startSec: number; endSec: number; text: string }>;
        }>(
          ai,
          {
            contents: {
              parts: [
                { inlineData: { mimeType, data: audioBase64 } },
                {
                  text: `Transcribe the spoken narration in this media in ${langHint} and segment it into accurate timed subtitle cues.`,
                },
              ],
            },
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  transcript: { type: Type.STRING },
                  timedCaptions: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        startSec: { type: Type.NUMBER },
                        endSec: { type: Type.NUMBER },
                        text: { type: Type.STRING },
                      },
                      required: ["startSec", "endSec", "text"],
                    },
                  },
                },
                required: ["transcript", "timedCaptions"],
              },
            },
          },
          { label: "STT Video Captions" }
        );
        const timedCaptions = Array.isArray(parsed.timedCaptions) ? parsed.timedCaptions : [];
        return res.json({
          transcript: parsed.transcript || "",
          captions: timedCaptions.map((c) => c.text),
          timedCaptions,
          vtt: buildVtt(timedCaptions),
        });
      }

      const response = await ai.models.generateContent({
        model: STT_MODEL,
        contents: {
          parts: [
            { inlineData: { mimeType, data: audioBase64 } },
            { text: `Transcribe this ${langHint} scientific audio accurately.` },
          ],
        },
      });

      const transcript = (response.text ?? "").trim();
      const sentences = transcript.split(/(?<=[.!؟\n])\s+/).map((s) => s.trim()).filter(Boolean);
      const timedCaptions = (sentences.length > 0 ? sentences : transcript ? [transcript] : []).map((text, idx) => ({
        startSec: idx * 4,
        endSec: (idx + 1) * 4,
        text,
      }));
      return res.json({
        transcript,
        captions: timedCaptions.map((c) => c.text),
        timedCaptions,
        vtt: buildVtt(timedCaptions),
      });
    } catch (err) {
      const formatted = formatGeminiError(err);
      return res.status(formatted.status).json({ error: formatted.code, message: formatted.message });
    }
  });

  // 8. Multimodal Diagram Vision Description
  app.post("/api/describe-image", async (req, res) => {
    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({ error: "GEMINI_NOT_CONFIGURED", message: "مفتاح GEMINI_API_KEY غير مهيأ." });
    }
    try {
      const { imageUrl, imageBase64, mimeType = "image/jpeg", lessonTitle = "" } = req.body ?? {};
      let base64Data = imageBase64;
      let resolvedMime = mimeType;

      if (!base64Data && typeof imageUrl === "string" && imageUrl.startsWith("/src/assets/images/")) {
        const safeFilename = path.basename(imageUrl);
        const foundPath = [
          path.resolve(process.cwd(), "src/assets/images", safeFilename),
          path.resolve(process.cwd(), "dist/src/assets/images", safeFilename),
        ].find((p) => fs.existsSync(p));
        if (foundPath) {
          base64Data = fs.readFileSync(foundPath).toString("base64");
          resolvedMime = safeFilename.endsWith(".png") ? "image/png" : "image/jpeg";
        }
      }
      if (!base64Data) return res.status(400).json({ message: "تعذر العثور على الصورة." });

      const parsed = await callGeminiStructured<Record<string, unknown>>(
        ai,
        {
          contents: {
            parts: [
              { inlineData: { mimeType: resolvedMime, data: base64Data } },
              {
                text: `صف هذه الصورة العلمية المرتبطة بدرس "${lessonTitle}" باللغة العربية وصفاً مكانياً دقيقاً للمكفوفين وضعاف البصر.`,
              },
            ],
          },
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                shortAlt: { type: Type.STRING },
                detailedSpatialDescription: { type: Type.STRING },
                scientificComponents: { type: Type.ARRAY, items: { type: Type.STRING } },
                keyTakeaway: { type: Type.STRING },
              },
              required: ["shortAlt", "detailedSpatialDescription", "scientificComponents", "keyTakeaway"],
            },
          },
        },
        { label: "Describe Image" }
      );
      return res.json(parsed);
    } catch (err) {
      const formatted = formatGeminiError(err);
      return res.status(formatted.status).json({ error: formatted.code, message: formatted.message });
    }
  });

  // 8b. Discover the World Around You (Camera / Photo Scientific Explorer)
  app.post("/api/discover-object", async (req, res) => {
    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({
        error: "GEMINI_NOT_CONFIGURED",
        message: "مفتاح GEMINI_API_KEY غير مهيأ على الخادم.",
      });
    }
    try {
      const {
        imageBase64 = "",
        mimeType = "image/jpeg",
        question = "",
        language = "ar",
        studentLevel = "intermediate",
      } = req.body ?? {};

      const rawImageStr = String(imageBase64 || "").trim();
      const dataUrlMatch = rawImageStr.match(/^data:([^;]+);base64,(.*)$/s);
      const cleanBase64 = (dataUrlMatch ? dataUrlMatch[2] : rawImageStr).replace(/\s+/g, "").trim();
      const detectedMime = dataUrlMatch ? dataUrlMatch[1] : String(mimeType || "image/jpeg").trim();
      const allowedMimes = new Set([
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/webp",
        "image/gif",
        "image/heic",
        "image/heif",
      ]);
      const normalizedMime = detectedMime === "image/jpg" ? "image/jpeg" : detectedMime.toLowerCase();
      const safeMimeType = allowedMimes.has(normalizedMime) ? normalizedMime : "image/jpeg";

      if (!cleanBase64) {
        return res.status(400).json({ message: "يرجى التقاط صورة أو رفع صورة للتحليل." });
      }

      const isEn = language === "en";
      const customQuestionPart = String(question || "").trim()
        ? isEn
          ? `\nStudent's specific question about this photo: "${String(question).trim()}". Make sure to answer it directly inside summary/scientificExplanation.`
          : `\nسؤال الطالب المحدد حول الصورة: «${String(question).trim()}». احرص على الإجابة عليه بوضوح داخل الشرح العلمي.`
        : "";

      const levelHint =
        studentLevel === "beginner"
          ? isEn
            ? "Use very simple, friendly everyday wording suitable for younger students."
            : "استخدم لغة شديدة البساطة وتشبيهات يومية ممتعة تناسب الطلبة الصغار."
          : studentLevel === "advanced"
            ? isEn
              ? "Provide deeper scientific mechanisms, physics/chemistry/biology laws, and accurate terminology."
              : "قدّم تفسيراً علمياً معمقاً يشمل القوانين الفيزيائية أو الكيميائية أو الحيوية بدقة."
            : isEn
              ? "Balance scientific accuracy with clear, engaging educational explanations."
              : "وازن بين الدقة العلمية والوضوح المشوق للطلبة.";

      const prompt = isEn
        ? `You are the "Discover the World Around You" Science Lens inside Smart Science AI.
Carefully examine every visual detail in this photo—whether it is an everyday food or snack (like potato chips, fruit, drinks), packaged commercial product (read visible labels/text), plant, rock, household object, electronic device, tool, liquid, or living organism.
Identify the exact item shown in the image (do not refuse everyday packaged foods or household products), then explain the real science behind it (materials, chemistry, physics, biology, nutrition, or engineering) in clear English.
${levelHint}${customQuestionPart}
If parts of the image are blurry, still identify the most likely object based on visible shape, colors, packaging, or texture and explain the science connected to it.`
        : `أنت عدسة «اكتشف العالم من حولك» في منصة العلوم الذكية (Smart Science AI).
افحص الصورة بدقة شديدة وتعرّف على العنصر الرئيسي الظاهر فيها أياً كان نوعه: سواء كان طعاماً أو وجبة خفيفة أو منتجاً مغلفاً (مثل كيس شيبس / رقائق البطاطس، عصير، بسكويت، فاكهة، علبة مشروب — اقرأ أي نصوص أو علامات واضحة على العبوة لتحديد النوع بدقة)، أو نباتاً، أو صخراً، أو أداة منزلية، أو جهازاً إلكترونياً، أو سائلاً، أو كائناً حياً.
سمِّ الشيء باسمه الحقيقي الواضح ولا ترفض تحليل المنتجات اليومية أو الأطعمة؛ بل اشرح العلوم الحقيقية المرتبطة به باللغة العربية الفصحى الواضحة والممتعة (مثلاً للشيبس: مكونات النشا والكربوهيدرات في البطاطس، تفاعلات القلي والتحميص، وغاز النيتروجين الخامل داخل الكيس لحمايته من الأكسدة والتكسر، والقيمة الحرارية).
${levelHint}${customQuestionPart}
حتى لو كانت الزاوية قريبة أو الإضاءة متوسطة، حدّد العنصر الأقرب بناءً على الشكل والألوان والعبوة وقدّم المعلومة العلمية المرتبطة به.`;

      const parsed = await callGeminiStructured<{ objectName?: string } & Record<string, unknown>>(
        ai,
        {
          contents: [
            {
              role: "user",
              parts: [
                { inlineData: { mimeType: safeMimeType, data: cleanBase64 } },
                { text: prompt },
              ],
            },
          ],
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                objectName: { type: Type.STRING },
                discipline: { type: Type.STRING },
                summary: { type: Type.STRING },
                scientificExplanation: { type: Type.STRING },
                keyFacts: { type: Type.ARRAY, items: { type: Type.STRING } },
                relatedConcepts: { type: Type.ARRAY, items: { type: Type.STRING } },
                experimentIdea: { type: Type.STRING },
                funQuestion: { type: Type.STRING },
                funAnswer: { type: Type.STRING },
              },
              required: [
                "objectName",
                "discipline",
                "summary",
                "scientificExplanation",
                "keyFacts",
                "relatedConcepts",
                "experimentIdea",
                "funQuestion",
                "funAnswer",
              ],
            },
          },
        },
        { label: "Discover Object" }
      );

      if (!parsed.objectName || !String(parsed.objectName).trim()) {
        return res.status(502).json({
          error: "EMPTY_VISION_RESULT",
          message: isEn
            ? "Could not extract an object name from the photo. Please try a clearer angle or brighter lighting."
            : "لم يتمكن التحليل من تحديد اسم واضح للعنصر في الصورة. جرّب زاوية أو إضاءة أوضح.",
        });
      }

      return res.json(parsed);
    } catch (err) {
      const formatted = formatGeminiError(err);
      console.error("[/api/discover-object error]", formatted.code, err instanceof Error ? err.message : err);
      return res.status(formatted.status).json({ error: formatted.code, message: formatted.message });
    }
  });

  // 9. Content Simplification
  app.post("/api/simplify", async (req, res) => {
    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({ error: "GEMINI_NOT_CONFIGURED", message: "مفتاح GEMINI_API_KEY غير مهيأ." });
    }
    try {
      const { text = "", lessonTitle = "", studentLevel = "beginner", language = "ar" } = req.body ?? {};
      if (!String(text).trim()) return res.status(400).json({ message: "يرجى إدخال نص لتبسيطه." });
      const targetLang = language === "en" ? "English" : "Arabic";

      const parsed = await callGeminiStructured<{ steps?: unknown[] }>(
        ai,
        {
          contents: `Simplify the following scientific text for a ${studentLevel} learner in "${lessonTitle}" into 4-5 short numbered steps in ${targetLang}:\n\n${text}`,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                steps: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      stepNumber: { type: Type.INTEGER },
                      title: { type: Type.STRING },
                      simpleSentence: { type: Type.STRING },
                      visualCue: { type: Type.STRING },
                      checkQuestion: { type: Type.STRING },
                    },
                    required: ["stepNumber", "title", "simpleSentence", "visualCue", "checkQuestion"],
                  },
                },
              },
              required: ["steps"],
            },
          },
        },
        {
          label: "Simplify",
          validate: (obj) => Array.isArray(obj.steps) && obj.steps.length > 0,
        }
      );
      return res.json(parsed);
    } catch (err) {
      const formatted = formatGeminiError(err);
      return res.status(formatted.status).json({ error: formatted.code, message: formatted.message });
    }
  });

  // 10. Adaptive Quiz Generator
  app.post("/api/adaptive-quiz", async (req, res) => {
    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({ error: "GEMINI_NOT_CONFIGURED", message: "مفتاح GEMINI_API_KEY غير مهيأ." });
    }
    try {
      const {
        lessonTitle = "",
        sources = [],
        weakConcepts = [],
        accommodations = [],
        difficulty = "easy",
        studentLevel = "intermediate",
        studentStats = null,
        language = "ar",
      } = req.body ?? {};

      const sourceText = Array.isArray(sources)
        ? sources.map((s: { content?: string }) => s.content || "").join("\n").trim()
        : "";

      if (!String(lessonTitle).trim() && !sourceText) {
        return res.status(400).json({
          error: "MISSING_ADAPTIVE_CONTEXT",
          message: "يرجى تحديد عنوان الدرس أو مصادره لتوليد سؤال تكيفي.",
        });
      }

      const statsLine =
        studentStats && typeof studentStats === "object"
          ? `أداء الطالب الحالي: أجاب عن ${Number((studentStats as { answered?: number }).answered || 0)} سؤالاً بمعدل صحة ${Number((studentStats as { correct?: number }).correct || 0)}.`
          : "";
      const langLine = language === "en" ? "Write in clear English." : "اكتب السؤال والخيارات والتلميح والشرح بالعربية الواضحة.";

      const parsed = await callGeminiStructured<Record<string, unknown>>(
        ai,
        {
          contents: `صمّم سؤالاً علمياً تكيفياً مرناً لدرس "${lessonTitle}" من المصادر:\n${sourceText}\nالتركيز على المفاهيم التي تحتاج دعماً: ${
            weakConcepts.join("، ") || "الفهم الأساسي"
          }\nمستوى الطالب: ${studentLevel} · مستوى الصعوبة المطلوب: ${difficulty}\n${statsLine}\nالتسهيلات: ${
            accommodations.join("، ") || "قياسي"
          }\n${langLine}`,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                concept: { type: Type.STRING },
                difficulty: { type: Type.STRING },
                prompt: { type: Type.STRING },
                simplifiedPrompt: { type: Type.STRING },
                options: { type: Type.ARRAY, items: { type: Type.STRING } },
                correctIndex: { type: Type.INTEGER },
                hint: { type: Type.STRING },
                explanation: { type: Type.STRING },
                visualCue: { type: Type.STRING },
              },
              required: ["concept", "difficulty", "prompt", "simplifiedPrompt", "options", "correctIndex", "hint", "explanation", "visualCue"],
            },
          },
        },
        {
          label: "Adaptive Quiz",
          validate: (obj) => typeof obj.prompt === "string" && Array.isArray(obj.options) && obj.options.length >= 2,
        }
      );
      return res.json({ id: `adaptive-${Date.now()}`, ...parsed });
    } catch (err) {
      const formatted = formatGeminiError(err);
      return res.status(formatted.status).json({ error: formatted.code, message: formatted.message });
    }
  });

  // 10b. Textbook Books Library (مكتبة الكتب الدراسية الدائمة وتحليل الفهرس)
  app.get("/api/books", (_req, res) => {
    return res.json({ books: listAllBooks() });
  });

  app.post("/api/books", async (req, res) => {
    let incomingUploadId = "";
    try {
      const {
        subjectId = "chemistry",
        subjectName = "الكيمياء",
        stage = "high",
        gradeLevel = "الصف العاشر",
        title = "",
        fileName = "textbook.pdf",
        mimeType = "application/pdf",
        fileBase64 = "",
        uploadId = "",
        autoAnalyze = true,
        language = "ar",
      } = req.body ?? {};

      incomingUploadId = String(uploadId || "");
      const tmpPath = incomingUploadId ? safeTempUploadPath(incomingUploadId) : null;
      const hasTempFile = Boolean(tmpPath && fs.existsSync(tmpPath));

      if (!fileBase64 && !hasTempFile) {
        return res.status(400).json({ message: "يرجى إرفاق ملف الكتاب أولاً." });
      }

      const bookId = `book-${Date.now()}`;
      const safeFile = String(fileName)
        .replace(/[^a-zA-Z0-9._-\u0600-\u06FF]/g, "_")
        .slice(0, 80);
      const storagePath = path.join(BOOKS_DIR, `${bookId}_${safeFile || "book.pdf"}`);

      let fileSizeBytes = 0;
      if (hasTempFile && tmpPath) {
        fs.copyFileSync(tmpPath, storagePath);
        fileSizeBytes = fs.statSync(storagePath).size;
        cleanupTempUpload(incomingUploadId);
      } else {
        const buffer = Buffer.from(fileBase64, "base64");
        fs.writeFileSync(storagePath, buffer);
        fileSizeBytes = buffer.length;
      }

      const normalizedMime = normalizeUploadMimeType(String(fileName), String(mimeType));

      const saved = upsertBook({
        id: bookId,
        subjectId,
        subjectName,
        stage,
        gradeLevel,
        title: String(title || "").trim() || String(fileName).replace(/\.[^.]+$/, ""),
        fileName,
        mimeType: normalizedMime,
        fileSizeBytes,
        storagePath,
        totalPagesEstimated: 0,
        bookSummary: "",
        analysisStatus: autoAnalyze ? "analyzing" : "pending",
        units: [],
      }) as BookRecord;

      if (!autoAnalyze) {
        return res.json({ book: saved });
      }

      try {
        const indexedBook = await analyzeBookWithGemini(
          bookId,
          language === "en" ? "en" : "ar"
        );
        return res.json({ book: indexedBook });
      } catch (err) {
        const formatted = formatGeminiError(err);
        const latest = getBookById(bookId) || saved;
        return res.status(201).json({
          book: latest,
          analysisWarning: formatted.message,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save uploaded textbook.";
      return res.status(500).json({ message: msg });
    }
  });

  app.post("/api/books/:id/analyze", async (req, res) => {
    try {
      const { language = "ar" } = req.body ?? {};
      const indexed = await analyzeBookWithGemini(
        req.params.id,
        language === "en" ? "en" : "ar"
      );
      return res.json({ book: indexed });
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : "";
      if (rawMsg === "BOOK_NOT_FOUND") {
        return res.status(404).json({ message: "الكتاب المطلوب غير موجود في مكتبة المنصة." });
      }
      if (rawMsg === "GEMINI_NOT_CONFIGURED") {
        return res.status(503).json({
          error: "GEMINI_NOT_CONFIGURED",
          message: "مفتاح GEMINI_API_KEY غير مهيأ لتحليل فهرس الكتاب.",
        });
      }
      const formatted = formatGeminiError(err);
      return res.status(formatted.status).json({ error: formatted.code, message: formatted.message });
    }
  });

  app.post("/api/books/:id/extract-lesson", async (req, res) => {
    const book = getBookById(req.params.id) as BookRecord | null;
    if (!book) {
      return res.status(404).json({ message: "الكتاب غير موجود في المنصة." });
    }
    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({ error: "GEMINI_NOT_CONFIGURED", message: "مفتاح GEMINI_API_KEY غير مهيأ." });
    }

    try {
      const {
        unitId = "",
        chapterId = "",
        lessonEntryId = "",
        lessonTitle = "",
        startPage = 1,
        endPage = 1,
        language = "ar",
      } = req.body ?? {};

      const langRule =
        language === "en"
          ? "Respond in English matching the scientific level."
          : "اكتب المحتوى والملخص والأهداف بلغة الكتاب العربية العلمية الدقيقة.";

      const instruction = `From this stored textbook ("${book.title}"), focus strictly on the lesson "${lessonTitle}" located across pages ${startPage} to ${endPage}.
Extract rich classroom-ready content directly from those pages:
1) summary: accurate academic summary of the lesson (3-5 sentences)
2) simplifiedSummary: clear step-by-step simplified version for inclusive learners
3) objectives: 3-5 measurable learning objectives from this lesson
4) keyConcepts: 4-8 scientific terms/concepts
5) tablesAndFiguresSummary: descriptions of any diagrams, chemical equations, or tables on pages ${startPage}-${endPage}
6) keyFormulasOrRules: important equations, laws, or formulas
7) fullLessonText: comprehensive extracted lesson text and examples from pages ${startPage}-${endPage} so Lesson Plans, PowerPoint decks, and Quizzes can rely directly on it.
${langRule}`;

      const parts = await prepareBookModelParts(ai, book, instruction);
      const extracted = await callGeminiStructured<{
        summary?: string;
        simplifiedSummary?: string;
        objectives?: string[];
        keyConcepts?: string[];
        tablesAndFiguresSummary?: string[];
        keyFormulasOrRules?: string[];
        fullLessonText?: string;
      }>(
        ai,
        {
          contents: { parts },
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                summary: { type: Type.STRING },
                simplifiedSummary: { type: Type.STRING },
                objectives: { type: Type.ARRAY, items: { type: Type.STRING } },
                keyConcepts: { type: Type.ARRAY, items: { type: Type.STRING } },
                tablesAndFiguresSummary: { type: Type.ARRAY, items: { type: Type.STRING } },
                keyFormulasOrRules: { type: Type.ARRAY, items: { type: Type.STRING } },
                fullLessonText: { type: Type.STRING },
              },
              required: [
                "summary",
                "simplifiedSummary",
                "objectives",
                "keyConcepts",
                "tablesAndFiguresSummary",
                "keyFormulasOrRules",
                "fullLessonText",
              ],
            },
          },
        },
        { label: "Extract Book Lesson" }
      );

      // Persist enriched lesson excerpt back into SQLite book index
      if (unitId && chapterId && lessonEntryId && Array.isArray(book.units)) {
        const updatedUnits = book.units.map((u) => {
          if (u.id !== unitId) return u;
          return {
            ...u,
            chapters: u.chapters.map((c) => {
              if (c.id !== chapterId) return c;
              return {
                ...c,
                lessons: c.lessons.map((l) => {
                  if (l.id !== lessonEntryId) return l;
                  return {
                    ...l,
                    summary: extracted.summary || l.summary,
                    objectives: Array.isArray(extracted.objectives) ? extracted.objectives : l.objectives,
                    keyConcepts: Array.isArray(extracted.keyConcepts) ? extracted.keyConcepts : l.keyConcepts,
                    contentExcerpt: extracted.fullLessonText || l.contentExcerpt,
                  };
                }),
              };
            }),
          };
        });
        upsertBook({ ...book, units: updatedUnits });
      }

      return res.json({ extracted });
    } catch (err) {
      const formatted = formatGeminiError(err);
      return res.status(formatted.status).json({ error: formatted.code, message: formatted.message });
    }
  });

  app.get("/api/books/:id/file", (req, res) => {
    const book = getBookById(req.params.id) as BookRecord | null;
    if (!book) return res.status(404).json({ message: "الكتاب غير موجود." });
    const safePath = safeDiskBookPath(book.storagePath);
    if (!safePath || !fs.existsSync(safePath)) {
      return res.status(404).json({ message: "ملف الكتاب غير موجود على الخادم." });
    }
    res.setHeader("Content-Type", book.mimeType || "application/pdf");
    const encoded = encodeURIComponent(book.fileName || `${book.title}.pdf`);
    res.setHeader("Content-Disposition", `inline; filename="book.pdf"; filename*=UTF-8''${encoded}`);
    return res.sendFile(safePath);
  });

  app.delete("/api/books/:id", (req, res) => {
    const book = getBookById(req.params.id) as BookRecord | null;
    if (!book) return res.status(404).json({ message: "الكتاب غير موجود." });
    const safePath = safeDiskBookPath(book.storagePath);
    if (safePath && fs.existsSync(safePath)) {
      try {
        fs.unlinkSync(safePath);
      } catch {
        // Ignore file unlink failure if already missing
      }
    }
    deleteBookById(req.params.id);
    return res.json({ ok: true });
  });

  // 10c. Preparation Form Templates (فورمة التحضير المعتمدة للمواد العلمية)
  app.get("/api/prep-templates", (_req, res) => {
    return res.json({ templates: listPrepTemplates() });
  });

  app.post("/api/prep-templates/extract", async (req, res) => {
    const ai = getGeminiClient();
    const {
      fileName = "prep_form",
      mimeType = "application/octet-stream",
      fileBase64 = "",
      subjectScope = "all",
      templateName = "",
      customInstructions = "",
    } = req.body ?? {};

    if (!fileBase64) {
      return res.status(400).json({ message: "لم يتم إرفاق ملف أو صورة فورمة التحضير." });
    }

    try {
      const lowerName = String(fileName).toLowerCase();
      const buffer = Buffer.from(fileBase64, "base64");
      let extractedRawText = "";
      let usedMultimodalFile = false;

      if (lowerName.endsWith(".docx") || mimeType.includes("wordprocessingml")) {
        extractedRawText = await extractTextFromOfficeZip(buffer, "docx");
      } else if (lowerName.endsWith(".pptx") || mimeType.includes("presentationml")) {
        extractedRawText = await extractTextFromOfficeZip(buffer, "pptx");
      } else if (
        mimeType.startsWith("text/") ||
        lowerName.endsWith(".txt") ||
        lowerName.endsWith(".md") ||
        lowerName.endsWith(".csv")
      ) {
        extractedRawText = buffer.toString("utf-8").trim();
      } else {
        usedMultimodalFile = true;
      }

      if (!ai) {
        if (!usedMultimodalFile && extractedRawText) {
          const lines = extractedRawText
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l.length > 2 && l.length < 80)
            .slice(0, 12);
          const saved = upsertPrepTemplate({
            subjectScope,
            templateName: templateName.trim() || fileName.replace(/\.[^.]+$/, ""),
            sourceFileName: fileName,
            institutionOrSchool: "",
            requiredSections:
              lines.length > 0
                ? lines
                : ["بيانات الدرس", "الأهداف", "التمهيد", "الاستراتيجيات", "الأنشطة", "التقويم", "الواجب"],
            rawStructureText: extractedRawText.slice(0, 8000),
            presentationMappingGuidelines:
              "تنظيم شرائح البوربوينت وفق تسلسل عناصر فورمة التحضير من التمهيد والأهداف حتى التقويم والغلق.",
            customInstructions,
          });
          return res.json({ template: saved });
        }
        return res.status(503).json({
          error: "GEMINI_NOT_CONFIGURED",
          message: "مفتاح GEMINI_API_KEY غير مهيأ لتحليل صورة أو ملف PDF لفورمة التحضير.",
        });
      }

      const instruction = `Analyze this uploaded/photographed teacher Lesson Preparation Form ("فورمة التحضير") named "${fileName}".
Carefully read every table column, heading, checkbox, pedagogical field, assessment box, and layout section.
Extract:
1) templateName: clean descriptive title in the form's language (use "${templateName}" if provided)
2) institutionOrSchool: school/ministry/department name if visible (or "")
3) requiredSections: exact ordered list of section/field names present in this preparation form
4) rawStructureText: full faithful transcription of all form fields, prompts, and instructions
5) presentationMappingGuidelines: clear instructions explaining how a PowerPoint presentation should be built step-by-step following this preparation form.`;

      const parts = usedMultimodalFile
        ? [{ inlineData: { mimeType, data: fileBase64 } }, { text: instruction }]
        : [{ text: `${instruction}\n\nForm text:\n${extractedRawText.slice(0, 14000)}` }];

      const timeoutMs = usedMultimodalFile ? 35000 : 12000;
      const parsed = await callGeminiStructured<{
        templateName?: string;
        institutionOrSchool?: string;
        requiredSections?: string[];
        rawStructureText?: string;
        presentationMappingGuidelines?: string;
      }>(
        ai,
        {
          contents: { parts },
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                templateName: { type: Type.STRING },
                institutionOrSchool: { type: Type.STRING },
                requiredSections: { type: Type.ARRAY, items: { type: Type.STRING } },
                rawStructureText: { type: Type.STRING },
                presentationMappingGuidelines: { type: Type.STRING },
              },
              required: [
                "templateName",
                "institutionOrSchool",
                "requiredSections",
                "rawStructureText",
                "presentationMappingGuidelines",
              ],
            },
          },
        },
        { label: "Prep Template Extract", timeoutMs }
      );
      const saved = upsertPrepTemplate({
        subjectScope,
        templateName: templateName.trim() || parsed.templateName || fileName.replace(/\.[^.]+$/, ""),
        sourceFileName: fileName,
        institutionOrSchool: parsed.institutionOrSchool || "",
        requiredSections: Array.isArray(parsed.requiredSections) ? parsed.requiredSections : [],
        rawStructureText: parsed.rawStructureText || extractedRawText || "",
        presentationMappingGuidelines: parsed.presentationMappingGuidelines || "",
        customInstructions,
      });

      return res.json({ template: saved });
    } catch (err) {
      const formatted = formatGeminiError(err);
      const isTimeout = err instanceof Error && err.message.includes("GEMINI_TIMEOUT");
      if (formatted.status === 503 || formatted.status === 429 || isTimeout) {
        try {
          const lowerName = String(fileName).toLowerCase();
          const buffer = Buffer.from(fileBase64, "base64");
          let rawFallback = "";
          if (lowerName.endsWith(".docx") || mimeType.includes("wordprocessingml")) {
            rawFallback = await extractTextFromOfficeZip(buffer, "docx");
          } else if (lowerName.endsWith(".pptx") || mimeType.includes("presentationml")) {
            rawFallback = await extractTextFromOfficeZip(buffer, "pptx");
          } else if (
            mimeType.startsWith("text/") ||
            lowerName.endsWith(".txt") ||
            lowerName.endsWith(".md") ||
            lowerName.endsWith(".csv")
          ) {
            rawFallback = buffer.toString("utf-8").trim();
          }
          if (rawFallback) {
            const lines = rawFallback
              .split(/\r?\n/)
              .map((l) => l.trim())
              .filter((l) => l.length > 2 && l.length < 80)
              .slice(0, 12);
            const saved = upsertPrepTemplate({
              subjectScope,
              templateName: templateName.trim() || fileName.replace(/\.[^.]+$/, ""),
              sourceFileName: fileName,
              institutionOrSchool: "",
              requiredSections: lines,
              rawStructureText: rawFallback.slice(0, 8000),
              presentationMappingGuidelines:
                "بناء شرائح البوربوينت وفق تسلسل عناصر فورمة التحضير المرفقة.",
              customInstructions,
            });
            return res.json({ template: saved });
          }
        } catch {
          // Fall through
        }
      }
      return res.status(formatted.status).json({ error: formatted.code, message: formatted.message });
    }
  });

  app.put("/api/prep-templates/:id", (req, res) => {
    const existing = getPrepTemplateById(req.params.id);
    if (!existing) {
      return res.status(404).json({ message: "فورمة التحضير غير موجودة." });
    }
    const updated = upsertPrepTemplate({
      ...existing,
      ...(req.body ?? {}),
      id: req.params.id,
    });
    return res.json({ template: updated });
  });

  app.delete("/api/prep-templates/:id", (req, res) => {
    const deleted = deletePrepTemplateById(req.params.id);
    if (!deleted) return res.status(404).json({ message: "تعذر العثور على الفورمة." });
    return res.json({ ok: true });
  });

  // 11. Smart Lesson Upload & Deep Analysis (PDF, Word .docx, PowerPoint .pptx, Images, TXT)
  app.post("/api/extract-lesson", async (req, res) => {
    const ai = getGeminiClient();
    const {
      fileName = "lesson",
      mimeType = "text/plain",
      fileBase64 = "",
      uploadId = "",
      subjectName = "العلوم",
      gradeLevel = "",
      prepTemplateId = "",
      prepTemplate = null,
    } = req.body ?? {};

    const incomingUploadId = String(uploadId || "");
    const uploadedDiskPath = incomingUploadId ? safeTempUploadPath(incomingUploadId) : null;
    const hasTempUpload = Boolean(uploadedDiskPath && fs.existsSync(uploadedDiskPath));

    if (!fileBase64 && !hasTempUpload) {
      return res.status(400).json({ message: "لم يتم إرفاق ملف الدرس." });
    }

    const normalizedMime = normalizeUploadMimeType(String(fileName), String(mimeType));
    let adHocTempFile: string | null = null;

    const readFileBuffer = (): Buffer => {
      if (hasTempUpload && uploadedDiskPath) {
        return fs.readFileSync(uploadedDiskPath);
      }
      return Buffer.from(fileBase64, "base64");
    };

    try {
      const { promptBlock } = buildPrepTemplateContext(prepTemplate, prepTemplateId);
      const lowerName = String(fileName).toLowerCase();
      let extractedRawText = "";
      let usedMultimodalFile = false;

      if (lowerName.endsWith(".docx") || normalizedMime.includes("wordprocessingml")) {
        extractedRawText = await extractTextFromOfficeZip(readFileBuffer(), "docx");
      } else if (lowerName.endsWith(".pptx") || normalizedMime.includes("presentationml")) {
        extractedRawText = await extractTextFromOfficeZip(readFileBuffer(), "pptx");
      } else if (
        normalizedMime.startsWith("text/") ||
        lowerName.endsWith(".txt") ||
        lowerName.endsWith(".md") ||
        lowerName.endsWith(".csv") ||
        lowerName.endsWith(".json")
      ) {
        extractedRawText = readFileBuffer().toString("utf-8").trim();
      } else {
        usedMultimodalFile = true;
      }

      if (!ai) {
        if (!usedMultimodalFile && extractedRawText) {
          return res.json({
            title: fileName.replace(/\.[^.]+$/, ""),
            category: `ملف مرفوع (${fileName})`,
            summary: extractedRawText.slice(0, 320),
            simplifiedSummary: extractedRawText.slice(0, 220),
            content: extractedRawText.slice(0, 14000),
            extractedAnalysis: {
              concepts: [subjectName],
              objectives: ["فهم محتوى الدرس المرفوع"],
              tablesAndFiguresSummary: [],
              keyFormulasOrRules: [],
            },
          });
        }
        return res.status(503).json({
          error: "GEMINI_NOT_CONFIGURED",
          message: "مفتاح GEMINI_API_KEY غير مهيأ لتحليل ملفات PDF والصور بالذكاء الاصطناعي.",
        });
      }

      const templateAlignmentInstruction = promptBlock
        ? `\nAlign the extracted objectives, concepts, and structured content so this lesson is immediately ready to build a Lesson Plan and PowerPoint using the attached Preparation Form below:\n${promptBlock}`
        : "";

      let parts: Array<Record<string, unknown>>;

      if (usedMultimodalFile) {
        const diskSize =
          hasTempUpload && uploadedDiskPath
            ? fs.statSync(uploadedDiskPath).size
            : Buffer.byteLength(fileBase64, "base64");

        let filePart: Record<string, unknown>;
        if (diskSize > 8 * 1024 * 1024) {
          // Use Gemini Files API for large PDFs / textbooks (> 8 MB)
          let uploadSourcePath = uploadedDiskPath;
          if (!uploadSourcePath || !fs.existsSync(uploadSourcePath)) {
            const safeExt = path.extname(String(fileName)) || ".pdf";
            adHocTempFile = path.join(TMP_UPLOADS_DIR, `inline-${Date.now()}${safeExt}`);
            fs.writeFileSync(adHocTempFile, Buffer.from(fileBase64, "base64"));
            uploadSourcePath = adHocTempFile;
          }
          const uploaded = await ai.files.upload({
            file: uploadSourcePath,
            config: { mimeType: normalizedMime },
          });
          const activeFile = await waitForUploadedFileActive(ai, uploaded);
          filePart = {
            fileData: {
              fileUri: activeFile.uri,
              mimeType: normalizedMime,
            },
          };
        } else {
          const base64Data = fileBase64 || readFileBuffer().toString("base64");
          filePart = {
            inlineData: { mimeType: normalizedMime, data: base64Data },
          };
        }

        const isLargeBookHint =
          diskSize > 5 * 1024 * 1024
            ? " Note: If this PDF contains multiple units/chapters or is a full textbook, synthesize a clear, well-structured classroom lesson covering the primary unit/opening chapter and overarching concepts concisely so the JSON response remains focused and complete."
            : "";

        parts = [
          filePart,
          {
            text: `Analyze this uploaded/photographed ${subjectName} (${gradeLevel}) lesson file "${fileName}". Read all text, textbook pages, scientific tables, diagrams, chemical equations, and charts carefully. Extract grounded lesson content, concise summary, simplified summary, concepts, learning objectives, tables/figures descriptions, and key formulas/rules in the file's primary language.${isLargeBookHint}${templateAlignmentInstruction}`,
          },
        ];
      } else {
        parts = [
          {
            text: `Analyze this uploaded ${subjectName} (${gradeLevel}) lesson content from "${fileName}":\n\n${extractedRawText.slice(0, 14000)}\n\nReturn structured summary, simplified summary, clean full content, concepts, learning objectives, tables/figures descriptions, and key formulas/rules in the content's primary language.${templateAlignmentInstruction}`,
          },
        ];
      }

      const parsed = await callGeminiStructured<{
        title?: string;
        summary?: string;
        simplifiedSummary?: string;
        content?: string;
        extractedAnalysis?: Record<string, unknown>;
      }>(
        ai,
        {
          contents: { parts },
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                summary: { type: Type.STRING },
                simplifiedSummary: { type: Type.STRING },
                content: { type: Type.STRING },
                extractedAnalysis: {
                  type: Type.OBJECT,
                  properties: {
                    concepts: { type: Type.ARRAY, items: { type: Type.STRING } },
                    objectives: { type: Type.ARRAY, items: { type: Type.STRING } },
                    tablesAndFiguresSummary: { type: Type.ARRAY, items: { type: Type.STRING } },
                    keyFormulasOrRules: { type: Type.ARRAY, items: { type: Type.STRING } },
                  },
                  required: ["concepts", "objectives", "tablesAndFiguresSummary", "keyFormulasOrRules"],
                },
              },
              required: ["title", "summary", "simplifiedSummary", "content", "extractedAnalysis"],
            },
          },
        },
        { label: "Extract Lesson" }
      );
      return res.json({
        title: parsed.title || fileName.replace(/\.[^.]+$/, ""),
        category: `ملف مرفوع (${fileName})`,
        summary: parsed.summary || "",
        simplifiedSummary: parsed.simplifiedSummary || "",
        content: parsed.content || extractedRawText || "",
        extractedAnalysis: parsed.extractedAnalysis,
      });
    } catch (err) {
      console.error("[/api/extract-lesson error]", err);
      const formatted = formatGeminiError(err);
      if (formatted.status === 503 || formatted.status === 429) {
        try {
          const lowerName = String(fileName).toLowerCase();
          const buffer = readFileBuffer();
          let rawFallback = "";
          if (lowerName.endsWith(".docx") || normalizedMime.includes("wordprocessingml")) {
            rawFallback = await extractTextFromOfficeZip(buffer, "docx");
          } else if (lowerName.endsWith(".pptx") || normalizedMime.includes("presentationml")) {
            rawFallback = await extractTextFromOfficeZip(buffer, "pptx");
          } else if (
            normalizedMime.startsWith("text/") ||
            lowerName.endsWith(".txt") ||
            lowerName.endsWith(".md") ||
            lowerName.endsWith(".csv")
          ) {
            rawFallback = buffer.toString("utf-8").trim();
          }
          if (rawFallback) {
            return res.json({
              title: fileName.replace(/\.[^.]+$/, ""),
              category: `ملف مرفوع (${fileName})`,
              summary: rawFallback.slice(0, 320),
              simplifiedSummary: rawFallback.slice(0, 220),
              content: rawFallback.slice(0, 14000),
              extractedAnalysis: {
                concepts: [subjectName],
                objectives: ["مراجعة محتوى الدرس المرفوع"],
                tablesAndFiguresSummary: [],
                keyFormulasOrRules: [],
              },
            });
          }
        } catch {
          // Fall through to error response
        }
      }
      return res.status(formatted.status).json({ error: formatted.code, message: formatted.message });
    } finally {
      cleanupTempUpload(incomingUploadId);
      if (adHocTempFile && fs.existsSync(adHocTempFile)) {
        try {
          fs.unlinkSync(adHocTempFile);
        } catch {
          // Ignore cleanup error
        }
      }
    }
  });

  // 12. Generate Lesson Plan (التحضير الذكي وفق الفورمة والمصادر والملفات المرفقة)
  app.post("/api/generate/lesson-plan", async (req, res) => {
    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({
        error: "GEMINI_NOT_CONFIGURED",
        message:
          "مفتاح GEMINI_API_KEY غير مهيأ على الخادم. يرجى التحقق من إعدادات الخادم أو ربط Cloudflare Worker (smart-science-ai-server).",
      });
    }

    const tempUploadIdsToClean: string[] = [];
    const tempAdHocFilesToClean: string[] = [];

    try {
      const {
        lesson,
        language = "ar",
        sourcePolicy = "lesson_only",
        prepTemplateId = "",
        prepTemplate = null,
        teacherInputs = null,
        attachedFiles = [],
        attachedNotes = "",
      } = req.body ?? {};

      if (!lesson || !String(lesson?.title || "").trim()) {
        return res.status(400).json({
          error: "MISSING_LESSON",
          message: "يرجى اختيار درس أو إدخال عنوان الدرس قبل التوليد.",
        });
      }

      const sourcesText = buildSourcesText(lesson?.sources);
      const { template: resolvedTpl, promptBlock } = buildPrepTemplateContext(
        prepTemplate,
        prepTemplateId || lesson?.prepTemplateId
      );
      const langRule =
        language === "en"
          ? "Write the entire lesson plan in clear, academic English."
          : "اكتب تحضير الدرس كاملاً باللغة العربية الفصحى العلمية الواضحة.";

      // Gather rich baseline lesson metadata & extracted analysis when present
      const analysis = lesson?.extractedAnalysis;
      const lessonContextLines = [
        lesson?.summary ? `ملخص الدرس: ${String(lesson.summary)}` : "",
        lesson?.simplifiedSummary ? `التلخيص الميسر: ${String(lesson.simplifiedSummary)}` : "",
        Array.isArray(analysis?.concepts) && analysis.concepts.length > 0
          ? `المفاهيم الرئيسية: ${analysis.concepts.join("، ")}`
          : "",
        Array.isArray(analysis?.objectives) && analysis.objectives.length > 0
          ? `الأهداف المستخرجة من الدرس: ${analysis.objectives.join(" | ")}`
          : "",
        Array.isArray(analysis?.keyFormulasOrRules) && analysis.keyFormulasOrRules.length > 0
          ? `القوانين والمعادلات الأساسية: ${analysis.keyFormulasOrRules.join(" | ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");

      const tInputs =
        teacherInputs && typeof teacherInputs === "object"
          ? (teacherInputs as {
              customTopic?: string;
              focusObjectives?: string;
              targetGroup?: string;
              durationMinutes?: number;
              extraInstructions?: string;
            })
          : null;

      const resolvedDuration =
        Number(tInputs?.durationMinutes) > 0
          ? Number(tInputs?.durationMinutes)
          : Number(lesson?.estimatedMinutes) || 45;

      const teacherInputsBlock = tInputs
        ? [
            tInputs.customTopic ? `محور أو عنوان مخصص من المعلم: ${tInputs.customTopic}` : "",
            tInputs.focusObjectives ? `أهداف ومخرجات يركز عليها المعلم: ${tInputs.focusObjectives}` : "",
            tInputs.targetGroup ? `الفئة المستهدفة / مستوى الشعبة: ${tInputs.targetGroup}` : "",
            tInputs.durationMinutes ? `مدة الحصة المطلوبة: ${tInputs.durationMinutes} دقيقة` : "",
            tInputs.extraInstructions ? `ملاحظات وإرشادات إضافية من المعلم: ${tInputs.extraInstructions}` : "",
          ]
            .filter(Boolean)
            .join("\n")
        : "";

      const attachedNotesBlock = String(attachedNotes || "").trim()
        ? `\nمحتوى إضافي / نص مصدر مرفق من المعلم:\n${String(attachedNotes).trim().slice(0, 12000)}`
        : "";

      // Process any files attached specifically inside the Lesson Plan tool
      const multimodalParts: Array<Record<string, unknown>> = [];
      const extractedAttachmentTexts: string[] = [];

      if (Array.isArray(attachedFiles)) {
        for (const item of attachedFiles.slice(0, 4)) {
          if (!item || typeof item !== "object") continue;
          const fileName = String((item as { fileName?: string }).fileName || "attachment");
          const rawMime = String((item as { mimeType?: string }).mimeType || "");
          const uploadId = String((item as { uploadId?: string }).uploadId || "");
          const fileBase64 = String((item as { fileBase64?: string }).fileBase64 || "");
          const textContent = String((item as { textContent?: string }).textContent || "");

          if (uploadId) tempUploadIdsToClean.push(uploadId);

          if (textContent.trim()) {
            extractedAttachmentTexts.push(`[مرفق: ${fileName}]\n${textContent.trim().slice(0, 10000)}`);
            continue;
          }

          const diskPath = uploadId ? safeTempUploadPath(uploadId) : null;
          const hasDisk = Boolean(diskPath && fs.existsSync(diskPath));
          if (!hasDisk && !fileBase64) continue;

          const normalizedMime = normalizeUploadMimeType(fileName, rawMime);
          const lowerName = fileName.toLowerCase();

          const readBuf = () =>
            hasDisk && diskPath ? fs.readFileSync(diskPath) : Buffer.from(fileBase64, "base64");

          if (lowerName.endsWith(".docx") || normalizedMime.includes("wordprocessingml")) {
            const docText = await extractTextFromOfficeZip(readBuf(), "docx");
            if (docText) extractedAttachmentTexts.push(`[ملف Word مرفق: ${fileName}]\n${docText.slice(0, 10000)}`);
          } else if (lowerName.endsWith(".pptx") || normalizedMime.includes("presentationml")) {
            const pptText = await extractTextFromOfficeZip(readBuf(), "pptx");
            if (pptText) extractedAttachmentTexts.push(`[عرض مرفق: ${fileName}]\n${pptText.slice(0, 10000)}`);
          } else if (
            normalizedMime.startsWith("text/") ||
            lowerName.endsWith(".txt") ||
            lowerName.endsWith(".md") ||
            lowerName.endsWith(".csv")
          ) {
            const txt = readBuf().toString("utf-8").trim();
            if (txt) extractedAttachmentTexts.push(`[ملف نصي مرفق: ${fileName}]\n${txt.slice(0, 10000)}`);
          } else {
            // PDF or image attachment
            const byteLen =
              hasDisk && diskPath ? fs.statSync(diskPath).size : Buffer.byteLength(fileBase64, "base64");
            if (byteLen > 8 * 1024 * 1024) {
              let sourcePath = diskPath;
              if (!sourcePath || !fs.existsSync(sourcePath)) {
                const ext = path.extname(fileName) || ".pdf";
                const adHoc = path.join(TMP_UPLOADS_DIR, `lp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}${ext}`);
                fs.writeFileSync(adHoc, Buffer.from(fileBase64, "base64"));
                tempAdHocFilesToClean.push(adHoc);
                sourcePath = adHoc;
              }
              const uploaded = await ai.files.upload({
                file: sourcePath,
                config: { mimeType: normalizedMime },
              });
              const activeFile = await waitForUploadedFileActive(ai, uploaded);
              multimodalParts.push({
                fileData: { fileUri: activeFile.uri, mimeType: normalizedMime },
              });
            } else {
              const b64 = fileBase64 || readBuf().toString("base64");
              multimodalParts.push({
                inlineData: { mimeType: normalizedMime, data: b64 },
              });
            }
          }
        }
      }

      const templateRule = resolvedTpl
        ? `\nالالتزام التام ببناء التحضير وفق فورمة التحضير المرفقة أدناه، مع تعبئة المصفوفة customFormFields لكل بند من بنود الفورمة (${
            Array.isArray(resolvedTpl.requiredSections)
              ? (resolvedTpl.requiredSections as string[]).join("، ")
              : ""
          }) بمحتوى علمي دقيق ومفصل مستند إلى الدرس:\n${promptBlock}`
        : "";

      const attachmentTextsBlock =
        extractedAttachmentTexts.length > 0
          ? `\n=== نصوص الملفات المرفقة من المعلم ===\n${extractedAttachmentTexts.join("\n\n")}`
          : "";

      const promptText = `أعد تحضير درس احترافي متكامل ومفصل واقعياً لمادة "${lesson?.subject || "العلوم"}"، المرحلة "${lesson?.stage || "high"}"، الصف "${lesson?.gradeLevel || ""}"، عنوان الدرس "${lesson?.title}"، بمدة مقترحة ${resolvedDuration} دقيقة.
سياسة المصادر: ${sourcePolicy}.
${lessonContextLines ? `\nسياق الدرس:\n${lessonContextLines}` : ""}
${teacherInputsBlock ? `\nمدخلات المعلم المباشرة:\n${teacherInputsBlock}` : ""}

مصادر الدرس المعتمدة:
${sourcesText}
${attachedNotesBlock}
${attachmentTextsBlock}
${templateRule}
${langRule}`;

      const contentsPayload =
        multimodalParts.length > 0
          ? { parts: [...multimodalParts, { text: promptText }] }
          : promptText;

      const parsed = await callGeminiStructured<Record<string, unknown>>(
        ai,
        {
          contents: contentsPayload,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                lessonTitle: { type: Type.STRING },
                subject: { type: Type.STRING },
                stage: { type: Type.STRING },
                gradeLevel: { type: Type.STRING },
                durationMinutes: { type: Type.INTEGER },
                templateNameUsed: { type: Type.STRING },
                objectives: { type: Type.ARRAY, items: { type: Type.STRING } },
                warmUp: { type: Type.STRING },
                teachingStrategies: { type: Type.ARRAY, items: { type: Type.STRING } },
                learningActivities: { type: Type.ARRAY, items: { type: Type.STRING } },
                resourcesAndMedia: { type: Type.ARRAY, items: { type: Type.STRING } },
                assessment: { type: Type.STRING },
                homework: { type: Type.STRING },
                differentiationAndInclusion: { type: Type.STRING },
                customFormFields: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      sectionName: { type: Type.STRING },
                      content: { type: Type.STRING },
                    },
                    required: ["sectionName", "content"],
                  },
                },
              },
              required: [
                "lessonTitle",
                "subject",
                "stage",
                "gradeLevel",
                "durationMinutes",
                "objectives",
                "warmUp",
                "teachingStrategies",
                "learningActivities",
                "resourcesAndMedia",
                "assessment",
                "homework",
                "differentiationAndInclusion",
                "customFormFields",
              ],
            },
          },
        },
        {
          label: "Lesson Plan",
          validate: (obj) =>
            Array.isArray(obj.objectives) &&
            obj.objectives.length > 0 &&
            typeof obj.warmUp === "string",
        }
      );
      const plan = {
        lessonTitle: String(parsed.lessonTitle || lesson.title || ""),
        subject: String(parsed.subject || lesson.subject || ""),
        stage: String(parsed.stage || lesson.stage || ""),
        gradeLevel: String(parsed.gradeLevel || lesson.gradeLevel || ""),
        durationMinutes: Number(parsed.durationMinutes || resolvedDuration) || 45,
        templateNameUsed:
          String(parsed.templateNameUsed || "") ||
          (resolvedTpl ? String(resolvedTpl.templateName || "") : undefined),
        objectives: Array.isArray(parsed.objectives) ? parsed.objectives.map(String).filter(Boolean) : [],
        warmUp: String(parsed.warmUp || ""),
        teachingStrategies: Array.isArray(parsed.teachingStrategies)
          ? parsed.teachingStrategies.map(String).filter(Boolean)
          : [],
        learningActivities: Array.isArray(parsed.learningActivities)
          ? parsed.learningActivities.map(String).filter(Boolean)
          : [],
        resourcesAndMedia: Array.isArray(parsed.resourcesAndMedia)
          ? parsed.resourcesAndMedia.map(String).filter(Boolean)
          : [],
        assessment: String(parsed.assessment || ""),
        homework: String(parsed.homework || ""),
        differentiationAndInclusion: String(parsed.differentiationAndInclusion || ""),
        customFormFields: Array.isArray(parsed.customFormFields)
          ? parsed.customFormFields.map((f: { sectionName?: unknown; content?: unknown }) => ({
              sectionName: String(f?.sectionName || ""),
              content: String(f?.content || ""),
            }))
          : [],
      };

      return res.json({ lessonPlan: plan, source: "gemini-ai" });
    } catch (err) {
      const formatted = formatGeminiError(err);
      return res.status(formatted.status).json({ error: formatted.code, message: formatted.message });
    } finally {
      for (const uid of tempUploadIdsToClean) cleanupTempUpload(uid);
      for (const fp of tempAdHocFilesToClean) {
        if (fs.existsSync(fp)) {
          try {
            fs.unlinkSync(fp);
          } catch {
            // Ignore
          }
        }
      }
    }
  });

  // 13. Generate Editable PowerPoint Deck JSON (PPTX مبني على الدرس وفورمة التحضير)
  const handleGeneratePresentation = async (req: express.Request, res: express.Response) => {
    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({ error: "GEMINI_NOT_CONFIGURED", message: "مفتاح GEMINI_API_KEY غير مهيأ." });
    }
    try {
      const {
        lesson,
        slideCount = 8,
        language = "ar",
        prepTemplateId = "",
        prepTemplate = null,
        lessonPlan = null,
      } = req.body ?? {};
      if (!lesson || !String(lesson?.title || "").trim()) {
        return res.status(400).json({
          error: "MISSING_LESSON",
          message: "يرجى اختيار درس أو إدخال عنوان الدرس قبل توليد العرض التقديمي.",
        });
      }
      const safeSlideCount = Math.max(6, Math.min(14, Number(slideCount) || 8));
      const sourcesText = buildSourcesText(lesson?.sources);
      const { template: resolvedTpl, promptBlock } = buildPrepTemplateContext(
        prepTemplate,
        prepTemplateId || lesson?.prepTemplateId
      );
      const langRule =
        language === "en"
          ? "Write all slide content in clear, natural English."
          : "اكتب جميع الشرائح وملاحظات المعلم والأسئلة باللغة العربية الفصحى العلمية السليمة.";

      const templateAlignment = resolvedTpl
        ? `\nابنِ تسلسل الشرائح ومحتوى كل شريحة وملاحظات المعلم بحيث تتطابق مع فورمة التحضير المعتمدة:\n${promptBlock}`
        : "";
      const planAlignment = lessonPlan
        ? `\nواعتمد أيضاً على تحضير الدرس المبني مسبقاً:\n${JSON.stringify(lessonPlan).slice(0, 3500)}`
        : "";

      const rawDeck = await callGeminiStructured<Partial<PresentationDeckData>>(
        ai,
        {
          contents: `صمّم عرضاً تقديمياً تعليمياً احترافياً من ${safeSlideCount} شرائح لدرس "${lesson?.title}" (${lesson?.subject || "العلوم"} - ${lesson?.gradeLevel || ""}) استناداً للمصادر:
${sourcesText}
${templateAlignment}
${planAlignment}
يجب أن يغطي العرض المكونات التربوية التالية حسب طبيعة الدرس وبنقاط موجزة مناسبة للشرائح (لا تزيد كل شريحة عن 4-5 نقاط واضحة):
1) شريحة العنوان (slideType: "title")
2) المقدمة والتمهيد المثير للتفكير (slideType: "concept")
3) الأهداف التعليمية (slideType: "objectives")
4) شرح المحتوى العلمي الأساسي + شريحة رسم توضيحي (slideType: "concept" و "diagram")
5) الأنشطة والتطبيقات العملية (slideType: "example")
6) التقويم والأسئلة التفاعلية (slideType: "interactive_quiz" مع quizQuestion وquizOptions وquizAnswerIndex)
7) الخاتمة والملخص الختامي (slideType: "summary")
${langRule}`,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                deckTitle: { type: Type.STRING },
                subject: { type: Type.STRING },
                gradeLevel: { type: Type.STRING },
                themeAccent: { type: Type.STRING },
                templateNameUsed: { type: Type.STRING },
                slides: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      slideNumber: { type: Type.INTEGER },
                      slideType: { type: Type.STRING },
                      title: { type: Type.STRING },
                      subtitle: { type: Type.STRING },
                      bullets: { type: Type.ARRAY, items: { type: Type.STRING } },
                      speakerNotes: { type: Type.STRING },
                      visualNote: { type: Type.STRING },
                      quizQuestion: { type: Type.STRING },
                      quizOptions: { type: Type.ARRAY, items: { type: Type.STRING } },
                      quizAnswerIndex: { type: Type.INTEGER },
                    },
                    required: ["slideNumber", "slideType", "title", "bullets", "speakerNotes"],
                  },
                },
              },
              required: ["deckTitle", "subject", "gradeLevel", "themeAccent", "slides"],
            },
          },
        },
        {
          label: "Generate Presentation",
          validate: (obj) => Array.isArray(obj.slides) && obj.slides.length > 0,
        }
      );
      const deck = formatTemplateStructuredDeck({
        rawDeck,
        lesson,
        prepTemplate: resolvedTpl as PreparationTemplate | null,
        lessonPlan,
        language: language === "en" ? "en" : "ar",
      });
      return res.json({ deck });
    } catch (err) {
      const formatted = formatGeminiError(err);
      return res.status(formatted.status).json({ error: formatted.code, message: formatted.message });
    }
  };
  app.post("/api/generate/presentation", handleGeneratePresentation);
  app.post("/api/generate/powerpoint", handleGeneratePresentation);

  // 13b. Auto-Generate Template-Aligned Slides + Server-Side .pptx File & Save to Platform
  app.post("/api/presentation/auto-pptx", async (req, res) => {
    const ai = getGeminiClient();
    const {
      lesson,
      slideCount = 8,
      language = "ar",
      prepTemplateId = "",
      prepTemplate = null,
      lessonPlan = null,
    } = req.body ?? {};

    if (!lesson || !String(lesson?.title || "").trim()) {
      return res.status(400).json({
        error: "MISSING_LESSON",
        message: "بيانات الدرس مطلوبة لإنشاء العرض التقديمي.",
      });
    }

    const lang = language === "en" ? "en" : "ar";
    const { template: resolvedTpl, promptBlock } = buildPrepTemplateContext(
      prepTemplate,
      prepTemplateId || lesson?.prepTemplateId
    );
    const typedTpl = resolvedTpl as PreparationTemplate | null;

    if (!ai) {
      return res.status(503).json({
        error: "GEMINI_NOT_CONFIGURED",
        message: "مفتاح GEMINI_API_KEY غير مهيأ.",
      });
    }

    try {
      const sourcesText = buildSourcesText(lesson?.sources);
      const langRule =
        lang === "en"
          ? "Write all slide titles, bullets, quiz items, and speaker notes in clear English."
          : "اكتب جميع عناوين الشرائح ونقاط المحتوى والأسئلة وملاحظات المعلم باللغة العربية الفصحى العلمية السليمة.";

      const sectionCountHint =
        typedTpl && Array.isArray(typedTpl.requiredSections) && typedTpl.requiredSections.length > 0
          ? Math.max(Number(slideCount) || 8, Math.min(14, typedTpl.requiredSections.length + 4))
          : Math.max(7, Math.min(14, Number(slideCount) || 8));

      const templateAlignment = resolvedTpl
        ? `\nيجب بناء تسلسل الشرائح ومحتوى كل شريحة وملاحظات المعلم بحيث تتطابق مع أقسام وترتيب قالب/فورمة التحضير التالية:\n${promptBlock}`
        : "";
      const planAlignment = lessonPlan
        ? `\nاعتمد كذلك على محتوى تحضير الدرس التالي لتفصيل كل قسم:\n${JSON.stringify(lessonPlan).slice(0, 4000)}`
        : "";

      const rawDeck = await callGeminiStructured<Partial<PresentationDeckData>>(
        ai,
        {
          contents: `صمّم عرضاً تقديمياً تعليمياً احترافياً من ${sectionCountHint} شرائح لدرس "${lesson?.title}" (${lesson?.subject || "العلوم"} - ${lesson?.gradeLevel || ""}) استناداً لمصادر الدرس:
${sourcesText}
${templateAlignment}
${planAlignment}
تأكد من تغطية البنية الكاملة للعرض:
1) شريحة العنوان (title)
2) المقدمة والتمهيد (concept)
3) الأهداف التعليمية (objectives)
4) شرح المحتوى العلمي والمفاهيم الأساسية + شريحة رسم علمي توضيحي (concept / diagram)
5) الأنشطة والتطبيقات العملية (example)
6) التقويم والأسئلة التفاعلية (interactive_quiz)
7) الخاتمة والملخص الختامي (summary)
${langRule}`,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                deckTitle: { type: Type.STRING },
                subject: { type: Type.STRING },
                gradeLevel: { type: Type.STRING },
                themeAccent: { type: Type.STRING },
                templateNameUsed: { type: Type.STRING },
                slides: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      slideNumber: { type: Type.INTEGER },
                      slideType: { type: Type.STRING },
                      title: { type: Type.STRING },
                      subtitle: { type: Type.STRING },
                      bullets: { type: Type.ARRAY, items: { type: Type.STRING } },
                      speakerNotes: { type: Type.STRING },
                      visualNote: { type: Type.STRING },
                      quizQuestion: { type: Type.STRING },
                      quizOptions: { type: Type.ARRAY, items: { type: Type.STRING } },
                      quizAnswerIndex: { type: Type.INTEGER },
                    },
                    required: ["slideNumber", "slideType", "title", "bullets", "speakerNotes"],
                  },
                },
              },
              required: ["deckTitle", "subject", "gradeLevel", "themeAccent", "slides"],
            },
          },
        },
        {
          label: "Auto PPTX",
          validate: (obj) => Array.isArray(obj.slides) && obj.slides.length > 0,
        }
      );

      const formattedDeck = formatTemplateStructuredDeck({
        rawDeck,
        lesson,
        prepTemplate: typedTpl,
        lessonPlan,
        language: lang,
      });

      if (lesson?.id) {
        saveArtifact(
          String(lesson.id),
          "presentation",
          formattedDeck.deckTitle,
          formattedDeck
        );
      }

      const { buffer, fileName, mimeType } = await buildServerPptxBuffer({
        deck: formattedDeck,
        diagramUrl: lesson?.diagramUrl,
        language: lang,
      });

      return res.json({
        deck: formattedDeck,
        fileName,
        mimeType,
        pptxBase64: buffer.toString("base64"),
      });
    } catch (err) {
      const formatted = formatGeminiError(err);
      return res
        .status(formatted.status)
        .json({ error: formatted.code, message: formatted.message });
    }
  });

  // 13c. Format & Stream Downloadable .pptx Binary via Server-Side Utility (no AI call required)
  app.post("/api/presentation/export-pptx", async (req, res) => {
    try {
      const {
        deck: rawDeck = null,
        lesson = null,
        prepTemplateId = "",
        prepTemplate = null,
        lessonPlan = null,
        diagramUrl = "",
        language = "ar",
      } = req.body ?? {};

      const { template: resolvedTpl } = buildPrepTemplateContext(
        prepTemplate,
        prepTemplateId || lesson?.prepTemplateId
      );

      const formattedDeck = formatTemplateStructuredDeck({
        rawDeck,
        lesson,
        prepTemplate: resolvedTpl as PreparationTemplate | null,
        lessonPlan,
        language: language === "en" ? "en" : "ar",
      });

      if (!formattedDeck.slides.length) {
        return res.status(400).json({
          message: "لا توجد شرائح أو تحضير متاح لتصدير ملف PowerPoint.",
        });
      }

      const { buffer, fileName } = await buildServerPptxBuffer({
        deck: formattedDeck,
        diagramUrl: diagramUrl || lesson?.diagramUrl,
        language: language === "en" ? "en" : "ar",
      });

      const encodedName = encodeURIComponent(fileName);
      res.setHeader("Content-Type", PPTX_MIME_TYPE);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="presentation.pptx"; filename*=UTF-8''${encodedName}`
      );
      res.setHeader("X-File-Name", encodedName);
      return res.send(buffer);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to build .pptx file on server.";
      return res.status(500).json({ message: msg });
    }
  });

  // 14. Generate Educational Video Script & Scenes
  app.post("/api/generate/video-script", async (req, res) => {
    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({ error: "GEMINI_NOT_CONFIGURED", message: "مفتاح GEMINI_API_KEY غير مهيأ." });
    }
    try {
      const {
        lesson,
        style = "educational_explainer",
        presenterPersona = "science_mentor",
        language = "ar",
      } = req.body ?? {};
      if (!lesson || !String(lesson?.title || "").trim()) {
        return res.status(400).json({
          error: "MISSING_LESSON",
          message: "يرجى اختيار درس أو إدخال عنوان الدرس قبل كتابة سيناريو الفيديو.",
        });
      }
      const sourcesText = buildSourcesText(lesson?.sources);
      const langRule = language === "en" ? "Write narration and subtitles in English." : "اكتب التعليق الصوتي والترجمة النصية بالعربية.";

      const parsed = await callGeminiStructured<Record<string, unknown>>(
        ai,
        {
          contents: `اكتب سيناريو فيديو تعليمياً مقسماً إلى 5 مشاهد قصيرة مترابطة لدرس "${lesson?.title}" (${lesson?.subject || "العلوم"}).
الأسلوب: ${style}، الشخصية المقدمة: ${presenterPersona}.
اعتمد على مصادر الدرس:
${sourcesText}
${langRule}`,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                videoTitle: { type: Type.STRING },
                fullScript: { type: Type.STRING },
                scenes: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      sceneNumber: { type: Type.INTEGER },
                      title: { type: Type.STRING },
                      narration: { type: Type.STRING },
                      subtitleText: { type: Type.STRING },
                      visualCue: { type: Type.STRING },
                      durationSec: { type: Type.INTEGER },
                    },
                    required: ["sceneNumber", "title", "narration", "subtitleText", "visualCue", "durationSec"],
                  },
                },
              },
              required: ["videoTitle", "fullScript", "scenes"],
            },
          },
        },
        { label: "Video Script" }
      );
      return res.json({
        project: {
          ...parsed,
          style,
          presenterPersona,
          language,
        },
      });
    } catch (err) {
      const formatted = formatGeminiError(err);
      return res.status(formatted.status).json({ error: formatted.code, message: formatted.message });
    }
  });

  // 15. Optional Veo Video Generation via Interactions API (requires paid billing key)
  app.post("/api/generate/veo-video", async (req, res) => {
    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({ error: "GEMINI_NOT_CONFIGURED", message: "مفتاح GEMINI_API_KEY غير مهيأ." });
    }
    try {
      const { prompt = "" } = req.body ?? {};
      if (!String(prompt).trim()) return res.status(400).json({ message: "وصف الفيديو فارغ." });

      const interaction = await ai.interactions.create({
        model: VEO_MODEL,
        input: String(prompt),
        response_modalities: ["video"],
      });

      const videoOutput = interaction.output_video;
      if (!videoOutput?.data && !videoOutput?.uri) {
        return res.status(502).json({
          message: "لم تُرجع خدمة Veo مقطع فيديو. استخدم مسار التجميع البديل (المشاهد + الصوت + الشرائح).",
        });
      }
      return res.json({
        videoBase64: videoOutput.data || null,
        videoUri: videoOutput.uri || null,
        mimeType: videoOutput.mime_type || "video/mp4",
      });
    } catch (err) {
      const formatted = formatGeminiError(err);
      return res.status(formatted.status).json({
        error: formatted.code,
        message: `خدمة Veo (${VEO_MODEL}) تتطلب مفتاح Gemini مدفوع الصلاحيات (Paid API Key). ${formatted.message}`,
      });
    }
  });

  // 16. Generate Competitive or Adaptive Quiz (aliases: /api/generate/quiz & /api/generate/kahoot-quiz)
  const handleGenerateQuiz = async (req: express.Request, res: express.Response) => {
    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({ error: "GEMINI_NOT_CONFIGURED", message: "مفتاح GEMINI_API_KEY غير مهيأ." });
    }
    try {
      const {
        lesson,
        questionCount = 6,
        language = "ar",
        mode = "competitive",
        studentLevel = "intermediate",
        weakConcepts = [],
      } = req.body ?? {};
      if (!lesson || !String(lesson?.title || "").trim()) {
        return res.status(400).json({
          error: "MISSING_LESSON",
          message: "يرجى اختيار درس أو إدخال عنوان الدرس قبل توليد الاختبار.",
        });
      }
      const sourcesText = buildSourcesText(lesson?.sources);
      const langRule = language === "en" ? "Write questions and options in English." : "اكتب الأسئلة والخيارات بالعربية.";
      const adaptiveHint =
        mode === "adaptive" || (Array.isArray(weakConcepts) && weakConcepts.length > 0)
          ? `\nتكييف الصعوبة وفق مستوى الطالب (${studentLevel}) والتركيز على المفاهيم التالية: ${
              Array.isArray(weakConcepts) && weakConcepts.length > 0 ? weakConcepts.join("، ") : "أساسيات الدرس"
            }.`
          : "";

      const quiz = await callGeminiStructured<Record<string, unknown>>(
        ai,
        {
          contents: `أنشئ اختباراً تعليمياً من ${Math.min(15, Math.max(2, Number(questionCount) || 6))} أسئلة متنوعة (اختيار من متعدد mcq، صح وخطأ true_false، وأسئلة تفكير عليا higher_order) مرتبطة مباشرة بدرس "${lesson?.title}" من المصادر:
${sourcesText}${adaptiveHint}
${langRule}`,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                quizTitle: { type: Type.STRING },
                lessonTitle: { type: Type.STRING },
                questions: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      questionType: { type: Type.STRING },
                      question: { type: Type.STRING },
                      options: { type: Type.ARRAY, items: { type: Type.STRING } },
                      correctIndex: { type: Type.INTEGER },
                      timeLimitSec: { type: Type.INTEGER },
                      points: { type: Type.INTEGER },
                      explanation: { type: Type.STRING },
                    },
                    required: ["id", "questionType", "question", "options", "correctIndex", "timeLimitSec", "points", "explanation"],
                  },
                },
              },
              required: ["quizTitle", "lessonTitle", "questions"],
            },
          },
        },
        {
          label: "Generate Quiz",
          validate: (obj) => Array.isArray(obj.questions) && obj.questions.length > 0,
        }
      );
      return res.json({ quiz });
    } catch (err) {
      const formatted = formatGeminiError(err);
      return res.status(formatted.status).json({ error: formatted.code, message: formatted.message });
    }
  };
  app.post("/api/generate/kahoot-quiz", handleGenerateQuiz);
  app.post("/api/generate/quiz", handleGenerateQuiz);

  // 17. Generate Multi-Section Worksheet (Student + Teacher Answer Key)
  app.post("/api/generate/worksheet", async (req, res) => {
    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({ error: "GEMINI_NOT_CONFIGURED", message: "مفتاح GEMINI_API_KEY غير مهيأ." });
    }
    try {
      const { lesson, language = "ar" } = req.body ?? {};
      if (!lesson || !String(lesson?.title || "").trim()) {
        return res.status(400).json({
          error: "MISSING_LESSON",
          message: "يرجى اختيار درس أو إدخال عنوان الدرس قبل توليد ورقة العمل.",
        });
      }
      const sourcesText = buildSourcesText(lesson?.sources);
      const langRule = language === "en" ? "Write the worksheet in English." : "اكتب ورقة العمل بالعربية.";

      const worksheet = await callGeminiStructured<Record<string, unknown>>(
        ai,
        {
          contents: `أعد ورقة عمل شاملة لدرس "${lesson?.title}" (${lesson?.subject || "العلوم"} - ${lesson?.gradeLevel || ""}) من المصادر:
${sourcesText}
يجب أن تضم: أسئلة متنوعة، نشاط تطبيقي، أكمل الفراغات، مطابقة، تصنيف، حل مسائل/تدريبات، وأسئلة تفكير عليا مع إجابات المعلم.
${langRule}`,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                worksheetTitle: { type: Type.STRING },
                subject: { type: Type.STRING },
                gradeLevel: { type: Type.STRING },
                studentInstructions: { type: Type.STRING },
                variedQuestions: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: { question: { type: Type.STRING }, answer: { type: Type.STRING } },
                    required: ["question", "answer"],
                  },
                },
                practicalActivity: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    steps: { type: Type.ARRAY, items: { type: Type.STRING } },
                    expectedOutcome: { type: Type.STRING },
                  },
                  required: ["title", "steps", "expectedOutcome"],
                },
                fillInBlanks: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: { sentence: { type: Type.STRING }, missingWord: { type: Type.STRING } },
                    required: ["sentence", "missingWord"],
                  },
                },
                matchingPairs: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: { leftItem: { type: Type.STRING }, rightMatch: { type: Type.STRING } },
                    required: ["leftItem", "rightMatch"],
                  },
                },
                classificationTask: {
                  type: Type.OBJECT,
                  properties: {
                    prompt: { type: Type.STRING },
                    categories: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          categoryName: { type: Type.STRING },
                          items: { type: Type.ARRAY, items: { type: Type.STRING } },
                        },
                        required: ["categoryName", "items"],
                      },
                    },
                  },
                  required: ["prompt", "categories"],
                },
                problemSolving: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      problem: { type: Type.STRING },
                      solutionSteps: { type: Type.STRING },
                      finalAnswer: { type: Type.STRING },
                    },
                    required: ["problem", "solutionSteps", "finalAnswer"],
                  },
                },
                higherOrderThinking: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: { question: { type: Type.STRING }, modelAnswer: { type: Type.STRING } },
                    required: ["question", "modelAnswer"],
                  },
                },
              },
              required: [
                "worksheetTitle",
                "subject",
                "gradeLevel",
                "studentInstructions",
                "variedQuestions",
                "practicalActivity",
                "fillInBlanks",
                "matchingPairs",
                "classificationTask",
                "problemSolving",
                "higherOrderThinking",
              ],
            },
          },
        },
        { label: "Worksheet" }
      );
      return res.json({ worksheet });
    } catch (err) {
      const formatted = formatGeminiError(err);
      return res.status(formatted.status).json({ error: formatted.code, message: formatted.message });
    }
  });

  // Daily Science Fact powered by Gemini API & persisted per day in SQLite
  app.get("/api/daily-fact", async (req, res) => {
    const lang = String(req.query.lang || "ar") === "en" ? "en" : "ar";
    const forceRefresh = String(req.query.refresh || "") === "true";
    const rawDate = String(req.query.date || "").trim();
    const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
      ? rawDate
      : new Date().toISOString().slice(0, 10);

    try {
      if (!forceRefresh) {
        const cached = getDailyFact(dateKey, lang);
        if (cached) {
          return res.json({ fact: { ...cached, cached: true } });
        }
      }

      const ai = getGeminiClient();
      if (!ai) {
        return res.status(503).json({
          error: "GEMINI_API_NOT_CONFIGURED",
          message:
            lang === "en"
              ? "GEMINI_API_KEY is not configured in Settings > Secrets."
              : "مفتاح GEMINI_API_KEY غير مُعدّ حالياً في لوحة Settings > Secrets.",
        });
      }

      const disciplines =
        lang === "en"
          ? ["Chemistry", "Physics", "Biology", "Geology", "Mathematics"]
          : ["الكيمياء", "الفيزياء", "الأحياء", "الجيولوجيا", "الرياضيات"];
      const dayNum = Number(dateKey.replace(/-/g, "")) || 1;
      const focusDiscipline = disciplines[(dayNum + (forceRefresh ? Date.now() : 0)) % disciplines.length];

      const prompt =
        lang === "en"
          ? `Generate one surprising, scientifically accurate Daily Science Fact for date ${dateKey} with primary focus on ${focusDiscipline} (or an inspiring connection across science). Keep it clear, memorable, and motivating for school students and teachers logging in today.`
          : `ولّد حقيقة علمية يومية مدهشة ودقيقة علمياً لتاريخ ${dateKey} مع تركيز أساسي على مجال ${focusDiscipline} (أو ربط ملهم بالعلوم والرياضيات). اجعل الصياغة عربية فصيحة سلسة، مشوقة ومفهومة للطلاب والمعلمين عند تسجيل دخولهم اليومي.`;

      const parsed = await callGeminiStructured<{
        discipline?: string;
        headline?: string;
        fact?: string;
        whyItMatters?: string;
        quickPrompt?: string;
      }>(
        ai,
        {
          contents: prompt,
          config: {
            systemInstruction:
              lang === "en"
                ? "You are a distinguished science communicator for Smart Science AI. Provide verified, fascinating, student-friendly daily science facts in JSON."
                : "أنت خبير تبسيط علمي في منصة Smart Science AI. قدّم حقائق علمية يومية موثقة ومشوقة بلغة عربية واضحة بصيغة JSON.",
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                discipline: {
                  type: Type.STRING,
                  description: "Science subject area such as Chemistry, Physics, Biology, Geology, or Mathematics.",
                },
                headline: {
                  type: Type.STRING,
                  description: "Short engaging headline (under 10 words).",
                },
                fact: {
                  type: Type.STRING,
                  description: "Clear, accurate 2-3 sentence scientific fact.",
                },
                whyItMatters: {
                  type: Type.STRING,
                  description: "1 concise sentence connecting the fact to everyday life or science discovery.",
                },
                quickPrompt: {
                  type: Type.STRING,
                  description: "A curious follow-up question a student can ask the AI robot about this fact.",
                },
              },
              required: ["discipline", "headline", "fact", "whyItMatters", "quickPrompt"],
            },
          },
        },
        { label: "Daily Fact", maxTransientRetries: 3 }
      );
      const factPayload = {
        date: dateKey,
        lang,
        discipline: String(parsed.discipline || focusDiscipline),
        headline: String(parsed.headline || ""),
        fact: String(parsed.fact || ""),
        whyItMatters: String(parsed.whyItMatters || ""),
        quickPrompt: String(parsed.quickPrompt || ""),
      };

      if (!factPayload.headline || !factPayload.fact) {
        throw new Error("Incomplete daily science fact generated.");
      }

      saveDailyFact(dateKey, lang, factPayload);
      return res.json({ fact: { ...factPayload, cached: false } });
    } catch (err) {
      const formatted = formatGeminiError(err);
      let localizedMessage = formatted.message;
      if (lang === "en") {
        if (formatted.status === 503) {
          localizedMessage =
            "Gemini AI service is temporarily experiencing high demand (503). Please click Retry in a moment.";
        } else if (formatted.status === 429) {
          localizedMessage =
            "Gemini API quota limit reached or a billing-enabled API key is required in Settings > Secrets.";
        } else if (formatted.status === 403) {
          localizedMessage =
            "Unable to verify GEMINI_API_KEY permissions. Please check Settings > Secrets.";
        }
      }
      return res.status(formatted.status).json({ error: formatted.code, message: localizedMessage });
    }
  });

  // Register AI Understanding Radar REST Routes
  registerRadarRoutes(app, getGeminiClient, formatGeminiError, extractTextFromOfficeZip);

  // Vite middleware in dev, static dist in production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Create HTTP server + dispatch WebSocket upgrades cleanly to /ws/quiz and /ws/radar
  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  const radarWss = new WebSocketServer({ noServer: true });
  attachRadarWebSocket(radarWss);

  server.on("upgrade", (request, socket, head) => {
    const pathname = new URL(
      request.url || "/",
      `http://${request.headers.host || "localhost"}`
    ).pathname;
    if (pathname === "/ws/quiz") {
      wss.handleUpgrade(request, socket, head, (clientWs) => {
        wss.emit("connection", clientWs, request);
      });
    } else if (pathname === "/ws/radar") {
      radarWss.handleUpgrade(request, socket, head, (clientWs) => {
        radarWss.emit("connection", clientWs, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on("connection", (ws) => {
    let attachedRoomCode: string | null = null;
    let participantId: string | null = null;
    let isHost = false;

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw));

        if (msg.type === "host:create") {
          const roomCode = generateRoomCode();
          const questions: LiveQuestion[] = Array.isArray(msg.questions) ? msg.questions : [];
          const room: LiveRoom = {
            roomCode,
            lessonId: String(msg.lessonId || ""),
            quizTitle: String(msg.quizTitle || "مسابقة تعليمية"),
            questions,
            status: "lobby",
            currentQuestionIndex: 0,
            questionStartedAt: 0,
            timerHandle: null,
            hostWs: ws,
            participants: new Map(),
            questionStats: questions.map(() => ({ correct: 0, total: 0 })),
            buzzerMode: Boolean(msg.buzzerMode),
            buzzerWinner: null,
          };
          liveRooms.set(roomCode, room);
          attachedRoomCode = roomCode;
          isHost = true;
          broadcastRoomState(room);
          return;
        }

        if (msg.type === "student:join") {
          const code = String(msg.roomCode || "").trim().toUpperCase();
          const name = String(msg.name || "").trim().slice(0, 40);
          const room = liveRooms.get(code);
          if (!room) {
            ws.send(JSON.stringify({ type: "room:error", message: "رمز الغرفة غير صحيح أو انتهت المسابقة." }));
            return;
          }
          if (!name) {
            ws.send(JSON.stringify({ type: "room:error", message: "يرجى إدخال اسم الطالب." }));
            return;
          }
          const pid = `stu-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
          const requestedAvatar = typeof msg.avatarId === "string" ? msg.avatarId.trim() : "";
          const usedAvatars = new Set(Array.from(room.participants.values()).map((p) => p.avatarId));
          const unusedAvatar = QUIZ_CARTOON_AVATARS.find((id) => !usedAvatars.has(id));
          const assignedAvatar = QUIZ_CARTOON_AVATARS.includes(requestedAvatar)
            ? requestedAvatar
            : unusedAvatar || QUIZ_CARTOON_AVATARS[room.participants.size % QUIZ_CARTOON_AVATARS.length];
          room.participants.set(pid, {
            id: pid,
            name,
            avatarId: assignedAvatar,
            score: 0,
            correctCount: 0,
            answeredCount: 0,
            answeredCurrent: false,
            ws,
          });
          attachedRoomCode = code;
          participantId = pid;
          ws.send(
            JSON.stringify({
              type: "student:joined",
              participantId: pid,
              roomCode: code,
              avatarId: assignedAvatar,
            })
          );
          broadcastRoomState(room);
          return;
        }

        if (!attachedRoomCode) return;
        const room = liveRooms.get(attachedRoomCode);
        if (!room) return;

        if (msg.type === "host:start" && isHost) {
          startQuestionOnRoom(room, 0);
        } else if (msg.type === "host:jump_stage" && isHost) {
          const targetIdx = Math.max(0, Math.min(Number(msg.index) || 0, Math.max(0, room.questions.length - 1)));
          startQuestionOnRoom(room, targetIdx);
        } else if (msg.type === "host:clear_buzz" && isHost) {
          room.buzzerWinner = null;
          broadcastRoomState(room);
        } else if (msg.type === "host:reveal" && isHost) {
          if (room.timerHandle) clearTimeout(room.timerHandle);
          room.status = "reveal";
          broadcastRoomState(room);
        } else if (msg.type === "host:next" && isHost) {
          startQuestionOnRoom(room, room.currentQuestionIndex + 1);
        } else if (msg.type === "host:finish" && isHost) {
          finishRoom(room);
        } else if (msg.type === "student:buzz" && participantId) {
          const participant = room.participants.get(participantId);
          if (!participant || room.status !== "question" || room.buzzerWinner) return;
          room.buzzerWinner = {
            participantId: participant.id,
            name: participant.name,
            avatarId: participant.avatarId,
            buzzedAt: Date.now(),
          };
          broadcastRoomState(room);
        } else if (msg.type === "student:answer" && participantId) {
          const participant = room.participants.get(participantId);
          const q = room.questions[room.currentQuestionIndex];
          if (!participant || !q || room.status !== "question" || participant.answeredCurrent) return;

          participant.answeredCurrent = true;
          participant.answeredCount += 1;
          const chosen = Number(msg.optionIndex);
          const isCorrect = chosen === q.correctIndex;
          const stat = room.questionStats[room.currentQuestionIndex];
          if (stat) {
            stat.total += 1;
            if (isCorrect) stat.correct += 1;
          }

          if (isCorrect) {
            const elapsedSec = Math.max(0, (Date.now() - room.questionStartedAt) / 1000);
            const limit = Math.max(5, q.timeLimitSec || 20);
            const speedBonus = Math.max(0.5, 1 - elapsedSec / (limit * 2));
            const earned = Math.round((q.points || 1000) * speedBonus);
            participant.score += earned;
            participant.correctCount += 1;
            ws.send(JSON.stringify({ type: "student:feedback", correct: true, earned }));
          } else {
            ws.send(JSON.stringify({ type: "student:feedback", correct: false, earned: 0 }));
          }
          broadcastRoomState(room);
        }
      } catch {
        // Ignore malformed socket frames
      }
    });

    ws.on("close", () => {
      if (!attachedRoomCode) return;
      const room = liveRooms.get(attachedRoomCode);
      if (!room) return;
      if (isHost && room.hostWs === ws) {
        room.hostWs = null;
      } else if (participantId) {
        room.participants.delete(participantId);
        broadcastRoomState(room);
      }
    });
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Smart Science AI server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();

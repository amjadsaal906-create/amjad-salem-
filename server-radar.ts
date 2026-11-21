import type { Express, Request, Response } from "express";
import { WebSocketServer, WebSocket } from "ws";
import { GoogleGenAI, Type } from "@google/genai";
import {
  saveRadarSession,
  listRadarSessions,
  deleteRadarSessionById,
} from "./server-db.ts";
import type {
  RadarConceptStat,
  RadarInterventionImpact,
  RadarInterventionRecord,
  RadarInterventionStrategy,
  RadarQuestion,
  RadarQuestionStat,
  RadarQuestionType,
  RadarSessionSnapshot,
  RadarStudentAnswerRecord,
  RadarStudentProfile,
} from "./src/types.ts";

const CHAT_MODEL = "gemini-4-hydrogen";
const FALLBACK_CHAT_MODEL = "gemini-3.1-flash-lite";

async function generateRadarWithFallback(
  ai: GoogleGenAI,
  params: Omit<Parameters<GoogleGenAI["models"]["generateContent"]>[0], "model">
) {
  const modelsToTry = [CHAT_MODEL, FALLBACK_CHAT_MODEL];
  let lastErr: unknown = null;
  for (let i = 0; i < modelsToTry.length; i++) {
    const model = modelsToTry[i];
    try {
      return await ai.models.generateContent({ ...params, model });
    } catch (err) {
      lastErr = err;
      const raw = err instanceof Error ? err.message : String(err);
      const lower = raw.toLowerCase();
      console.error(`[Radar Gemini ${model}]`, raw.slice(0, 300));
      const isTransientOrQuota =
        lower.includes("429") ||
        lower.includes("resource_exhausted") ||
        lower.includes("503") ||
        lower.includes("unavailable") ||
        lower.includes("not_found") ||
        lower.includes("404");
      if (!isTransientOrQuota || i === modelsToTry.length - 1) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 350));
    }
  }
  throw lastErr;
}

type GetGeminiClientFn = () => GoogleGenAI | null;
type FormatGeminiErrorFn = (err: unknown) => { status: number; message: string; code: string };
type ExtractOfficeFn = (buffer: Buffer, kind: "docx" | "pptx") => Promise<string>;

interface InternalRadarParticipant {
  id: string;
  name: string;
  joinedAt: string;
  connected: boolean;
  answeredCurrent: boolean;
  answers: RadarStudentAnswerRecord[];
  ws: WebSocket | null;
}

interface InternalRadarRoom {
  roomCode: string;
  savedSessionId?: string;
  subjectId: string;
  subjectName: string;
  gradeLevel: string;
  lessonTopic: string;
  lessonId?: string;
  interventionThresholdPct: number;
  questions: RadarQuestion[];
  status: "lobby" | "question" | "reveal" | "intervention" | "finished";
  currentQuestionIndex: number;
  questionStartedAt: number;
  timerHandle: ReturnType<typeof setTimeout> | null;
  hostWs: WebSocket | null;
  participants: Map<string, InternalRadarParticipant>;
  questionStatsMap: Map<
    string,
    {
      totalAnswered: number;
      correctCount: number;
      wrongCount: number;
      optionCounts: number[];
      wrongTextAnswers: string[];
    }
  >;
  activeInterventionBanner: RadarSessionSnapshot["activeInterventionBanner"];
  interventionHistory: RadarInterventionRecord[];
  createdAt: string;
  finishedAt?: string;
}

const radarRooms = new Map<string, InternalRadarRoom>();

function generateRadarRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return radarRooms.has(code) ? generateRadarRoomCode() : code;
}

function normalizeArabicOrEnglishText(raw: string): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s.+\-=%/]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function evaluateShortAnswer(q: RadarQuestion, rawAnswer: string): boolean {
  const normalizedUser = normalizeArabicOrEnglishText(rawAnswer);
  if (!normalizedUser || normalizedUser.length < 2) return false;

  const acceptedList = Array.isArray(q.acceptableAnswers) ? q.acceptableAnswers : [];
  for (const acc of acceptedList) {
    const normAcc = normalizeArabicOrEnglishText(acc);
    if (!normAcc) continue;
    if (normalizedUser === normAcc) return true;
    if (normAcc.length >= 4 && normalizedUser.includes(normAcc)) return true;
    if (normalizedUser.length >= 4 && normAcc.includes(normalizedUser)) return true;
  }

  // Fallback token overlap against explanation keywords or expected phrases
  const tokens = acceptedList
    .flatMap((a) => normalizeArabicOrEnglishText(a).split(" "))
    .filter((t) => t.length >= 3);
  if (tokens.length > 0) {
    const hits = tokens.filter((t) => normalizedUser.includes(t));
    if (hits.length >= Math.max(1, Math.ceil(tokens.length * 0.45))) {
      return true;
    }
  }

  return false;
}

function computeImpactForIntervention(
  room: InternalRadarRoom,
  record: RadarInterventionRecord
): RadarInterventionImpact {
  const verQ = record.verificationQuestion;
  const verAnswers: Array<{ participant: InternalRadarParticipant; ans: RadarStudentAnswerRecord }> = [];

  for (const p of room.participants.values()) {
    const found = p.answers.find((a) => a.questionId === verQ.id);
    if (found) {
      verAnswers.push({ participant: p, ans: found });
    }
  }

  // Also check baseline answers on same concept before intervention
  const baselineByStudent = new Map<string, boolean>();
  for (const p of room.participants.values()) {
    const conceptPre = p.answers.filter(
      (a) => a.concept === record.concept && !a.isPostIntervention
    );
    if (conceptPre.length > 0) {
      const preCorrect = conceptPre.filter((a) => a.isCorrect).length;
      baselineByStudent.set(p.id, preCorrect / conceptPre.length >= 0.5);
    }
  }

  const afterSampleSize = verAnswers.length;
  const afterCorrect = verAnswers.filter((x) => x.ans.isCorrect).length;
  const afterPct = afterSampleSize > 0 ? Math.round((afterCorrect / afterSampleSize) * 100) : null;
  const deltaPct = afterPct !== null ? afterPct - record.beforePct : null;

  let overcameCount = 0;
  const stillNeedsSupportNames: string[] = [];

  for (const item of verAnswers) {
    const hadMisconception = baselineByStudent.get(item.participant.id) === false;
    if (item.ans.isCorrect) {
      if (hadMisconception || record.beforePct < room.interventionThresholdPct) {
        overcameCount += 1;
      }
    } else {
      stillNeedsSupportNames.push(item.participant.name);
    }
  }

  const beforeSampleSize = baselineByStudent.size;
  let summaryText = "";
  if (afterPct === null) {
    summaryText = `تم إرسال التدخل العلاجي لمفهوم "${record.concept}" (نسبة الفهم قبل التدخل ${record.beforePct}%). بانتظار إطلاق وإجابات سؤال التحقق.`;
  } else if ((deltaPct ?? 0) > 0) {
    summaryText = `ارتفع فهم الفصل في مفهوم "${record.concept}" من ${record.beforePct}% إلى ${afterPct}% (تحسن +${deltaPct}%) وتجاوز ${overcameCount} طلاب الخطأ المفاهيمي.`;
  } else if ((deltaPct ?? 0) === 0) {
    summaryText = `ثبتت نسبة الفهم لمفهوم "${record.concept}" عند ${afterPct}%؛ يُنصح بدعم فردي لـ ${stillNeedsSupportNames.length} طلاب.`;
  } else {
    summaryText = `سجّل مفهوم "${record.concept}" نسبة ${afterPct}% بعد التحقق مقارنة بـ ${record.beforePct}% سابقاً؛ يوصى بإعادة معالجة المفهوم بنشاط تطبيقي أبسط.`;
  }

  return {
    interventionId: record.id,
    concept: record.concept,
    beforePct: record.beforePct,
    afterPct,
    deltaPct,
    beforeSampleSize,
    afterSampleSize,
    overcameCount,
    stillNeedsSupportCount: stillNeedsSupportNames.length,
    stillNeedsSupportNames,
    summaryText,
  };
}

function buildRadarSnapshot(
  room: InternalRadarRoom,
  includeAnswersKeyForHost: boolean
): RadarSessionSnapshot {
  const questionStats: RadarQuestionStat[] = room.questions.map((q) => {
    const st = room.questionStatsMap.get(q.id) || {
      totalAnswered: 0,
      correctCount: 0,
      wrongCount: 0,
      optionCounts: (q.options || []).map(() => 0),
      wrongTextAnswers: [],
    };
    return {
      questionId: q.id,
      totalAnswered: st.totalAnswered,
      correctCount: st.correctCount,
      wrongCount: st.wrongCount,
      understandingPct:
        st.totalAnswered > 0 ? Math.round((st.correctCount / st.totalAnswered) * 100) : 0,
      optionCounts: st.optionCounts,
      sampleWrongTextAnswers: st.wrongTextAnswers.slice(0, 6),
    };
  });

  // Concept breakdown
  const conceptBucket = new Map<
    string,
    { total: number; correct: number; misconception?: string }
  >();
  for (const q of room.questions) {
    if (!conceptBucket.has(q.concept)) {
      conceptBucket.set(q.concept, {
        total: 0,
        correct: 0,
        misconception: q.misconceptionTarget,
      });
    }
  }
  for (const p of room.participants.values()) {
    for (const ans of p.answers) {
      const prev = conceptBucket.get(ans.concept) || { total: 0, correct: 0 };
      prev.total += 1;
      if (ans.isCorrect) prev.correct += 1;
      conceptBucket.set(ans.concept, prev);
    }
  }

  const conceptStats: RadarConceptStat[] = Array.from(conceptBucket.entries()).map(
    ([concept, info]) => {
      const pct = info.total > 0 ? Math.round((info.correct / info.total) * 100) : 0;
      const status: RadarConceptStat["status"] =
        info.total === 0
          ? "developing"
          : pct >= 75
            ? "mastered"
            : pct >= room.interventionThresholdPct
              ? "developing"
              : "needs_intervention";
      return {
        concept,
        totalAnswers: info.total,
        correctAnswers: info.correct,
        understandingPct: pct,
        status,
        commonMisconception: info.misconception,
      };
    }
  );

  const masteredConcepts = conceptStats
    .filter((c) => c.totalAnswers > 0 && c.status === "mastered")
    .map((c) => c.concept);

  const needsReteachingConcepts = conceptStats
    .filter((c) => c.totalAnswers > 0 && c.status === "needs_intervention")
    .map((c) => c.concept);

  // Student profiles
  const studentProfiles: RadarStudentProfile[] = Array.from(room.participants.values()).map((p) => {
    const answeredCount = p.answers.length;
    const correctCount = p.answers.filter((a) => a.isCorrect).length;
    const understandingPct =
      answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) : 0;

    const perConcept = new Map<string, { preWrong: boolean; latestCorrect: boolean; postCorrect: boolean }>();
    for (const a of p.answers) {
      const cur = perConcept.get(a.concept) || {
        preWrong: false,
        latestCorrect: false,
        postCorrect: false,
      };
      if (!a.isPostIntervention && !a.isCorrect) cur.preWrong = true;
      if (a.isPostIntervention && a.isCorrect) cur.postCorrect = true;
      cur.latestCorrect = a.isCorrect;
      perConcept.set(a.concept, cur);
    }

    const stuMastered: string[] = [];
    const stuNeeds: string[] = [];
    const stuOvercame: string[] = [];
    for (const [c, state] of perConcept.entries()) {
      if (state.latestCorrect) stuMastered.push(c);
      else stuNeeds.push(c);
      if (state.preWrong && state.postCorrect) stuOvercame.push(c);
    }

    return {
      id: p.id,
      name: p.name,
      joinedAt: p.joinedAt,
      connected: p.connected,
      answeredCurrent: p.answeredCurrent,
      answeredCount,
      correctCount,
      understandingPct,
      masteredConcepts: stuMastered,
      needsSupportConcepts: stuNeeds,
      overcameConcepts: stuOvercame,
      answers: p.answers,
    };
  });

  // Misconceptions aggregation (wrong choices & misconceptions)
  const misconceptionMap = new Map<string, { concept: string; label: string; count: number }>();
  for (const p of room.participants.values()) {
    for (const a of p.answers) {
      if (a.isCorrect) continue;
      const q = room.questions.find((qq) => qq.id === a.questionId);
      if (!q) continue;
      const wrongChoiceText =
        typeof a.chosenIndex === "number" && q.options[a.chosenIndex]
          ? q.options[a.chosenIndex]
          : a.textAnswer || q.misconceptionTarget || "إجابة غير دقيقة";
      const label = q.misconceptionTarget
        ? `${q.misconceptionTarget} (${wrongChoiceText})`
        : `اختيار "${wrongChoiceText}"`;
      const key = `${a.concept}::${label}`;
      const prev = misconceptionMap.get(key) || { concept: a.concept, label, count: 0 };
      prev.count += 1;
      misconceptionMap.set(key, prev);
    }
  }

  const totalWrongAll = Array.from(misconceptionMap.values()).reduce((s, m) => s + m.count, 0);
  const topMisconceptions = Array.from(misconceptionMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
    .map((m) => ({
      ...m,
      pct: totalWrongAll > 0 ? Math.round((m.count / totalWrongAll) * 100) : 0,
    }));

  const totalAnswersOverall = questionStats.reduce((s, q) => s + q.totalAnswered, 0);
  const totalCorrectOverall = questionStats.reduce((s, q) => s + q.correctCount, 0);
  const overallUnderstandingPct =
    totalAnswersOverall > 0 ? Math.round((totalCorrectOverall / totalAnswersOverall) * 100) : 0;

  const updatedInterventions = room.interventionHistory.map((rec) => ({
    ...rec,
    impact: computeImpactForIntervention(room, rec),
  }));

  const activeQ = room.questions[room.currentQuestionIndex] || null;
  const sanitizedActiveQ =
    activeQ && !includeAnswersKeyForHost && room.status === "question"
      ? {
          ...activeQ,
          correctIndex: -1,
          acceptableAnswers: undefined,
          explanation: "",
        }
      : activeQ;

  const currentStat = activeQ
    ? questionStats.find((s) => s.questionId === activeQ.id) || null
    : null;

  const studentCount = room.participants.size;
  const answeredCurrentCount = Array.from(room.participants.values()).filter(
    (p) => p.answeredCurrent
  ).length;

  return {
    roomCode: room.roomCode,
    subjectId: room.subjectId,
    subjectName: room.subjectName,
    gradeLevel: room.gradeLevel,
    lessonTopic: room.lessonTopic,
    lessonId: room.lessonId,
    interventionThresholdPct: room.interventionThresholdPct,
    status: room.status,
    currentQuestionIndex: room.currentQuestionIndex,
    totalQuestions: room.questions.length,
    questionStartedAt: room.questionStartedAt,
    currentQuestion: sanitizedActiveQ,
    allQuestions: includeAnswersKeyForHost ? room.questions : [],
    studentCount,
    answeredCurrentCount,
    waitingCurrentCount: Math.max(0, studentCount - answeredCurrentCount),
    overallUnderstandingPct,
    currentQuestionStat: currentStat,
    questionStats,
    conceptStats,
    masteredConcepts,
    needsReteachingConcepts,
    topMisconceptions,
    studentProfiles: includeAnswersKeyForHost ? studentProfiles : [],
    activeInterventionBanner: room.activeInterventionBanner,
    interventionHistory: includeAnswersKeyForHost ? updatedInterventions : [],
    createdAt: room.createdAt,
    finishedAt: room.finishedAt,
  };
}

function broadcastRadarState(room: InternalRadarRoom): void {
  if (room.hostWs && room.hostWs.readyState === WebSocket.OPEN) {
    const hostSnapshot = buildRadarSnapshot(room, true);
    room.hostWs.send(JSON.stringify({ type: "radar:state", snapshot: hostSnapshot }));
  }
  const studentSnapshot = buildRadarSnapshot(room, false);
  const studentPayload = JSON.stringify({ type: "radar:state", snapshot: studentSnapshot });
  for (const p of room.participants.values()) {
    if (p.ws && p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(studentPayload);
    }
  }
}

function startRadarQuestion(room: InternalRadarRoom, index: number): void {
  if (room.timerHandle) {
    clearTimeout(room.timerHandle);
    room.timerHandle = null;
  }
  if (index >= room.questions.length) {
    finishRadarRoom(room);
    return;
  }
  room.currentQuestionIndex = index;
  room.status = "question";
  room.questionStartedAt = Date.now();
  for (const p of room.participants.values()) {
    p.answeredCurrent = false;
  }
  broadcastRadarState(room);

  const q = room.questions[index];
  const limitMs = Math.max(10, q?.timeLimitSec || 45) * 1000;
  room.timerHandle = setTimeout(() => {
    if (room.status === "question" && room.currentQuestionIndex === index) {
      room.status = "reveal";
      broadcastRadarState(room);
    }
  }, limitMs);
}

function finishRadarRoom(room: InternalRadarRoom): void {
  if (room.timerHandle) {
    clearTimeout(room.timerHandle);
    room.timerHandle = null;
  }
  room.status = "finished";
  room.finishedAt = new Date().toISOString();

  const fullSnapshot = buildRadarSnapshot(room, true);
  const saved = saveRadarSession({
    id: room.savedSessionId,
    roomCode: room.roomCode,
    subjectId: room.subjectId,
    subjectName: room.subjectName,
    gradeLevel: room.gradeLevel,
    lessonTopic: room.lessonTopic,
    overallAccuracy: fullSnapshot.overallUnderstandingPct,
    studentCount: fullSnapshot.studentCount,
    interventionCount: fullSnapshot.interventionHistory.length,
    snapshot: fullSnapshot,
    createdAt: room.createdAt,
  });
  room.savedSessionId = saved.id;

  broadcastRadarState(room);
}

export function attachRadarWebSocket(radarWss: WebSocketServer): void {
  radarWss.on("connection", (ws: WebSocket) => {
    let attachedRoomCode: string | null = null;
    let studentId: string | null = null;
    let isHost = false;

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw));

        if (msg.type === "radar:create") {
          const roomCode = generateRadarRoomCode();
          const questions: RadarQuestion[] = (Array.isArray(msg.questions) ? msg.questions : []).map(
            (q: Partial<RadarQuestion>, idx: number) => ({
              id: String(q.id || `rq-${idx + 1}`),
              questionType: (q.questionType || "mcq") as RadarQuestionType,
              cognitiveLevel: q.cognitiveLevel || "understanding",
              difficulty: q.difficulty || "medium",
              concept: String(q.concept || msg.lessonTopic || "مفهوم رئيسي"),
              objective: String(q.objective || "قياس الفهم العميق للمفهوم"),
              misconceptionTarget: q.misconceptionTarget ? String(q.misconceptionTarget) : undefined,
              question: String(q.question || ""),
              options: Array.isArray(q.options) ? q.options.map(String) : [],
              correctIndex: Number.isFinite(q.correctIndex) ? Number(q.correctIndex) : 0,
              acceptableAnswers: Array.isArray(q.acceptableAnswers)
                ? q.acceptableAnswers.map(String)
                : undefined,
              timeLimitSec: Math.max(10, Number(q.timeLimitSec || 45)),
              explanation: String(q.explanation || ""),
              hint: String(q.hint || ""),
              isVerification: Boolean(q.isVerification),
              interventionId: q.interventionId,
            })
          );

          const questionStatsMap = new Map<
            string,
            {
              totalAnswered: number;
              correctCount: number;
              wrongCount: number;
              optionCounts: number[];
              wrongTextAnswers: string[];
            }
          >();
          for (const q of questions) {
            questionStatsMap.set(q.id, {
              totalAnswered: 0,
              correctCount: 0,
              wrongCount: 0,
              optionCounts: (q.options || []).map(() => 0),
              wrongTextAnswers: [],
            });
          }

          const room: InternalRadarRoom = {
            roomCode,
            subjectId: String(msg.subjectId || "chemistry"),
            subjectName: String(msg.subjectName || "العلوم"),
            gradeLevel: String(msg.gradeLevel || ""),
            lessonTopic: String(msg.lessonTopic || "جلسة رادار الفهم"),
            lessonId: msg.lessonId ? String(msg.lessonId) : undefined,
            interventionThresholdPct: Math.min(90, Math.max(30, Number(msg.interventionThresholdPct || 65))),
            questions,
            status: "lobby",
            currentQuestionIndex: 0,
            questionStartedAt: 0,
            timerHandle: null,
            hostWs: ws,
            participants: new Map(),
            questionStatsMap,
            activeInterventionBanner: null,
            interventionHistory: [],
            createdAt: new Date().toISOString(),
          };

          radarRooms.set(roomCode, room);
          attachedRoomCode = roomCode;
          isHost = true;
          ws.send(JSON.stringify({ type: "radar:created", roomCode }));
          broadcastRadarState(room);
          return;
        }

        if (msg.type === "radar:host_reconnect") {
          const code = String(msg.roomCode || "").trim().toUpperCase();
          const room = radarRooms.get(code);
          if (!room) {
            ws.send(JSON.stringify({ type: "radar:error", message: "الجلسة غير نشطة أو انتهت." }));
            return;
          }
          room.hostWs = ws;
          attachedRoomCode = code;
          isHost = true;
          broadcastRadarState(room);
          return;
        }

        if (msg.type === "radar:join") {
          const code = String(msg.roomCode || "").trim().toUpperCase();
          const name = String(msg.name || "").trim().slice(0, 48);
          const room = radarRooms.get(code);
          if (!room) {
            ws.send(
              JSON.stringify({
                type: "radar:error",
                message: "رمز جلسة رادار الفهم غير صحيح أو تم إغلاق الجلسة.",
              })
            );
            return;
          }
          if (!name) {
            ws.send(JSON.stringify({ type: "radar:error", message: "يرجى إدخال اسمك للمشاركة." }));
            return;
          }

          const requestedId = msg.studentId ? String(msg.studentId) : "";
          const existingParticipant = requestedId ? room.participants.get(requestedId) : undefined;
          const sid =
            existingParticipant?.id ||
            `rstud-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`;

          if (existingParticipant) {
            existingParticipant.name = name;
            existingParticipant.connected = true;
            existingParticipant.ws = ws;
          } else {
            room.participants.set(sid, {
              id: sid,
              name,
              joinedAt: new Date().toISOString(),
              connected: true,
              answeredCurrent: false,
              answers: [],
              ws,
            });
          }

          attachedRoomCode = code;
          studentId = sid;
          ws.send(JSON.stringify({ type: "radar:joined", studentId: sid, roomCode: code, name }));
          broadcastRadarState(room);
          return;
        }

        if (!attachedRoomCode) return;
        const room = radarRooms.get(attachedRoomCode);
        if (!room) return;

        if (msg.type === "radar:sync") {
          const snap = buildRadarSnapshot(room, isHost);
          ws.send(JSON.stringify({ type: "radar:state", snapshot: snap }));
          return;
        }

        if (msg.type === "radar:start" && isHost) {
          const startIdx = Number.isFinite(msg.questionIndex) ? Number(msg.questionIndex) : 0;
          startRadarQuestion(room, startIdx);
          return;
        }

        if (msg.type === "radar:reveal" && isHost) {
          if (room.timerHandle) {
            clearTimeout(room.timerHandle);
            room.timerHandle = null;
          }
          room.status = "reveal";
          broadcastRadarState(room);
          return;
        }

        if (msg.type === "radar:next" && isHost) {
          startRadarQuestion(room, room.currentQuestionIndex + 1);
          return;
        }

        if (msg.type === "radar:finish" && isHost) {
          finishRadarRoom(room);
          return;
        }

        if (msg.type === "radar:intervene" && isHost) {
          if (room.timerHandle) {
            clearTimeout(room.timerHandle);
            room.timerHandle = null;
          }
          const concept = String(msg.concept || "المفهوم المستهدف");
          const strategy = msg.strategy as RadarInterventionStrategy;
          const verQ = msg.verificationQuestion as RadarQuestion;
          const interventionId = `int-${Date.now().toString(36)}`;

          const statForConcept = buildRadarSnapshot(room, true).conceptStats.find(
            (c) => c.concept === concept
          );
          const beforePct = statForConcept ? statForConcept.understandingPct : 0;

          const verificationQuestion: RadarQuestion = {
            ...verQ,
            id: String(verQ?.id || `ver-${interventionId}`),
            concept,
            isVerification: true,
            interventionId,
            timeLimitSec: Math.max(15, Number(verQ?.timeLimitSec || 45)),
          };

          const record: RadarInterventionRecord = {
            id: interventionId,
            concept,
            triggeredAt: new Date().toISOString(),
            beforePct,
            selectedStrategy: strategy,
            verificationQuestion,
            verificationLaunched: false,
          };

          room.interventionHistory.push(record);
          room.activeInterventionBanner = {
            id: interventionId,
            concept,
            title: strategy?.title || "توضيح وتبسيط المفهوم",
            explanation: strategy?.studentFacingExplanation || strategy?.teacherScript || "",
            example: strategy?.practicalExample || "",
            sentAt: new Date().toISOString(),
          };
          room.status = "intervention";
          broadcastRadarState(room);
          return;
        }

        if (msg.type === "radar:start_verification" && isHost) {
          const interventionId = String(msg.interventionId || "");
          const rec =
            room.interventionHistory.find((i) => i.id === interventionId) ||
            room.interventionHistory[room.interventionHistory.length - 1];
          if (!rec) return;

          if (!room.questions.some((q) => q.id === rec.verificationQuestion.id)) {
            room.questions.push(rec.verificationQuestion);
            room.questionStatsMap.set(rec.verificationQuestion.id, {
              totalAnswered: 0,
              correctCount: 0,
              wrongCount: 0,
              optionCounts: (rec.verificationQuestion.options || []).map(() => 0),
              wrongTextAnswers: [],
            });
          }
          rec.verificationLaunched = true;
          const qIdx = room.questions.findIndex((q) => q.id === rec.verificationQuestion.id);
          startRadarQuestion(room, qIdx >= 0 ? qIdx : room.questions.length - 1);
          return;
        }

        if (msg.type === "radar:clear_banner" && isHost) {
          room.activeInterventionBanner = null;
          broadcastRadarState(room);
          return;
        }

        if (msg.type === "radar:answer" && studentId) {
          const participant = room.participants.get(studentId);
          const q = room.questions[room.currentQuestionIndex];
          if (!participant || !q || room.status !== "question" || participant.answeredCurrent) {
            return;
          }

          participant.answeredCurrent = true;
          let isCorrect = false;
          let chosenIndex: number | undefined;
          let textAnswer: string | undefined;

          if (q.questionType === "short_answer") {
            textAnswer = String(msg.textAnswer || "").trim().slice(0, 400);
            isCorrect = evaluateShortAnswer(q, textAnswer);
          } else {
            chosenIndex = Number(msg.optionIndex);
            isCorrect = chosenIndex === q.correctIndex;
          }

          const answerRecord: RadarStudentAnswerRecord = {
            questionId: q.id,
            concept: q.concept,
            isCorrect,
            chosenIndex,
            textAnswer,
            answeredAt: new Date().toISOString(),
            isPostIntervention: Boolean(q.isVerification),
          };
          participant.answers.push(answerRecord);

          const st = room.questionStatsMap.get(q.id);
          if (st) {
            st.totalAnswered += 1;
            if (isCorrect) st.correctCount += 1;
            else st.wrongCount += 1;
            if (typeof chosenIndex === "number" && chosenIndex >= 0 && chosenIndex < st.optionCounts.length) {
              st.optionCounts[chosenIndex] += 1;
            }
            if (!isCorrect && textAnswer) {
              st.wrongTextAnswers.push(textAnswer);
            }
          }

          ws.send(
            JSON.stringify({
              type: "radar:feedback",
              questionId: q.id,
              isCorrect,
              correctIndex: q.correctIndex,
              explanation: q.explanation,
              concept: q.concept,
            })
          );
          broadcastRadarState(room);
        }
      } catch {
        // Ignore malformed WebSocket frames
      }
    });

    ws.on("close", () => {
      if (!attachedRoomCode) return;
      const room = radarRooms.get(attachedRoomCode);
      if (!room) return;
      if (isHost && room.hostWs === ws) {
        room.hostWs = null;
      } else if (studentId) {
        const p = room.participants.get(studentId);
        if (p) {
          p.connected = false;
          p.ws = null;
          broadcastRadarState(room);
        }
      }
    });
  });
}

export function registerRadarRoutes(
  app: Express,
  getGeminiClient: GetGeminiClientFn,
  formatGeminiError: FormatGeminiErrorFn,
  extractTextFromOfficeZip: ExtractOfficeFn
): void {
  // 1. Extract content from uploaded file (PDF, DOCX, PPTX, TXT, Image) or pasted text for Radar
  app.post("/api/radar/extract-source", async (req: Request, res: Response) => {
    const ai = getGeminiClient();
    const {
      fileName = "lesson",
      mimeType = "text/plain",
      fileBase64 = "",
      subjectName = "العلوم",
      gradeLevel = "",
    } = req.body ?? {};

    if (!fileBase64) {
      return res.status(400).json({ message: "لم يتم إرفاق ملف لاستخلاص محتواه." });
    }

    try {
      const lowerName = String(fileName).toLowerCase();
      const buffer = Buffer.from(fileBase64, "base64");
      let rawText = "";
      let multimodal = false;

      if (lowerName.endsWith(".docx") || mimeType.includes("wordprocessingml")) {
        rawText = await extractTextFromOfficeZip(buffer, "docx");
      } else if (lowerName.endsWith(".pptx") || mimeType.includes("presentationml")) {
        rawText = await extractTextFromOfficeZip(buffer, "pptx");
      } else if (
        mimeType.startsWith("text/") ||
        lowerName.endsWith(".txt") ||
        lowerName.endsWith(".md") ||
        lowerName.endsWith(".csv")
      ) {
        rawText = buffer.toString("utf-8").trim();
      } else {
        multimodal = true;
      }

      if (!ai) {
        if (!multimodal && rawText) {
          return res.json({
            topicTitle: fileName.replace(/\.[^.]+$/, ""),
            extractedText: rawText.slice(0, 14000),
            keyConcepts: [subjectName],
            objectives: ["فهم المفاهيم الرئيسية الواردة في الملف"],
          });
        }
        return res.status(503).json({
          error: "GEMINI_NOT_CONFIGURED",
          message: "مفتاح GEMINI_API_KEY غير مهيأ لقراءة ملفات PDF والصور.",
        });
      }

      const instruction = `Read this ${subjectName} (${gradeLevel}) lesson file "${fileName}" thoroughly.
Extract:
1) topicTitle: concise Arabic or original-language title of the lesson
2) extractedText: clean structured full lesson content, equations, definitions, and examples suitable for building diagnostic conceptual questions
3) keyConcepts: 3 to 6 core scientific/math concepts tested in this lesson
4) objectives: 2 to 4 measurable learning objectives`;

      const parts = multimodal
        ? [{ inlineData: { mimeType, data: fileBase64 } }, { text: instruction }]
        : [{ text: `${instruction}\n\nFile text:\n${rawText.slice(0, 16000)}` }];

      const response = await generateRadarWithFallback(ai, {
        contents: { parts },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              topicTitle: { type: Type.STRING },
              extractedText: { type: Type.STRING },
              keyConcepts: { type: Type.ARRAY, items: { type: Type.STRING } },
              objectives: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ["topicTitle", "extractedText", "keyConcepts", "objectives"],
          },
        },
      });

      return res.json(JSON.parse((response.text ?? "{}").trim()));
    } catch (err) {
      const formatted = formatGeminiError(err);
      return res.status(formatted.status).json({ error: formatted.code, message: formatted.message });
    }
  });

  // 2. Smart Diagnostic Question Generator (Conceptual, Application, Misconception-Detecting)
  app.post("/api/radar/generate-questions", async (req: Request, res: Response) => {
    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({
        error: "GEMINI_NOT_CONFIGURED",
        message: "مفتاح GEMINI_API_KEY غير مهيأ لتوليد الأسئلة التشخيصية.",
      });
    }

    try {
      const {
        subjectName = "العلوم",
        gradeLevel = "الصف العاشر",
        lessonTopic = "",
        lessonContent = "",
        questionCount = 5,
        questionTypes = ["mcq", "true_false", "applied", "misconception"],
        difficulty = "mixed",
        language = "ar",
      } = req.body ?? {};

      if (!String(lessonTopic).trim() && !String(lessonContent).trim()) {
        return res.status(400).json({ message: "يرجى تحديد موضوع الدرس أو إدخال محتواه أولاً." });
      }

      const safeCount = Math.min(15, Math.max(2, Number(questionCount || 5)));
      const typesList =
        Array.isArray(questionTypes) && questionTypes.length > 0
          ? questionTypes
          : ["mcq", "true_false", "applied", "misconception"];

      const langRule =
        language === "en"
          ? "Write all questions, options, concepts, misconceptionTarget, hints, and explanations in clear academic English."
          : "اكتب جميع الأسئلة والخيارات والمفاهيم والتصورات الخاطئة والتلميحات والشرح بلغة عربية علمية واضحة ودقيقة.";

      const prompt = `You are an expert pedagogical assessment designer for Smart Science AI ("رادار الفهم الذكي").
Design ${safeCount} deep DIAGNOSTIC questions for:
- Subject: ${subjectName}
- Grade Level: ${gradeLevel}
- Lesson Topic: ${lessonTopic}
- Requested Difficulty: ${difficulty}
- Allowed Question Types (distribute across these): ${typesList.join(", ")}

Lesson Content & Objectives:
${String(lessonContent || lessonTopic).slice(0, 14000)}

CRITICAL PEDAGOGICAL RULES:
1) Do NOT write superficial rote memorization trivia. Every question MUST diagnose real conceptual understanding, application in new scenarios, analytical reasoning, or a specific common student misconception.
2) For each question:
   - "concept": concise concept name (e.g. "الروابط الأيونية", "قانون أوم", "التحلل المائي")
   - "objective": the learning objective being diagnosed
   - "misconceptionTarget": specific student misconception this question detects if answered wrongly
   - "questionType": one of [${typesList.join(", ")}]
   - "cognitiveLevel": one of ["understanding", "application", "analysis", "misconception_check"]
   - "difficulty": one of ["easy", "medium", "hard"]
   - If questionType === "true_false", options MUST be exactly 2 options: ["صحيح", "خطأ"] (or ["True", "False"] in English) and correctIndex 0 or 1.
   - If questionType === "short_answer", options MUST be [], correctIndex = 0, and acceptableAnswers MUST contain 2-5 exact or key-phrase acceptable short answers in the same language.
   - If questionType is "mcq", "applied", or "misconception", options MUST have 4 plausible, carefully crafted choices where distractors represent realistic misconceptions, and correctIndex is 0..3.
   - "timeLimitSec": recommended seconds (30-90)
   - "hint": constructive scaffolded hint that guides without giving away the answer
   - "explanation": clear diagnostic explanation why the right answer works and why distractors reflect a misconception.
${langRule}`;

      const response = await generateRadarWithFallback(ai, {
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              questions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    questionType: { type: Type.STRING },
                    cognitiveLevel: { type: Type.STRING },
                    difficulty: { type: Type.STRING },
                    concept: { type: Type.STRING },
                    objective: { type: Type.STRING },
                    misconceptionTarget: { type: Type.STRING },
                    question: { type: Type.STRING },
                    options: { type: Type.ARRAY, items: { type: Type.STRING } },
                    correctIndex: { type: Type.INTEGER },
                    acceptableAnswers: { type: Type.ARRAY, items: { type: Type.STRING } },
                    timeLimitSec: { type: Type.INTEGER },
                    explanation: { type: Type.STRING },
                    hint: { type: Type.STRING },
                  },
                  required: [
                    "questionType",
                    "cognitiveLevel",
                    "difficulty",
                    "concept",
                    "objective",
                    "misconceptionTarget",
                    "question",
                    "options",
                    "correctIndex",
                    "timeLimitSec",
                    "explanation",
                    "hint",
                  ],
                },
              },
            },
            required: ["questions"],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? "{}").trim());
      const questions: RadarQuestion[] = (Array.isArray(parsed.questions) ? parsed.questions : []).map(
        (q: Partial<RadarQuestion>, idx: number) => ({
          id: `rq-${Date.now().toString(36)}-${idx + 1}`,
          questionType: (typesList.includes(String(q.questionType))
            ? q.questionType
            : typesList[0]) as RadarQuestionType,
          cognitiveLevel: (q.cognitiveLevel || "understanding") as RadarQuestion["cognitiveLevel"],
          difficulty: (q.difficulty || "medium") as RadarQuestion["difficulty"],
          concept: String(q.concept || lessonTopic || "مفهوم أساسي"),
          objective: String(q.objective || ""),
          misconceptionTarget: String(q.misconceptionTarget || ""),
          question: String(q.question || ""),
          options:
            q.questionType === "short_answer"
              ? []
              : Array.isArray(q.options) && q.options.length > 0
                ? q.options.map(String)
                : ["خيار أ", "خيار ب", "خيار ج", "خيار د"],
          correctIndex: Math.max(0, Number(q.correctIndex || 0)),
          acceptableAnswers: Array.isArray(q.acceptableAnswers)
            ? q.acceptableAnswers.map(String)
            : undefined,
          timeLimitSec: Math.min(120, Math.max(20, Number(q.timeLimitSec || 45))),
          explanation: String(q.explanation || ""),
          hint: String(q.hint || ""),
        })
      );

      return res.json({ questions });
    } catch (err) {
      const formatted = formatGeminiError(err);
      return res.status(formatted.status).json({ error: formatted.code, message: formatted.message });
    }
  });

  // 3. AI Instructional Intervention Engine (Analyzes live class errors & builds verification Q)
  app.post("/api/radar/intervene", async (req: Request, res: Response) => {
    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({
        error: "GEMINI_NOT_CONFIGURED",
        message: "مفتاح GEMINI_API_KEY غير مهيأ لتوليد التدخلات العلاجية.",
      });
    }

    try {
      const {
        subjectName = "العلوم",
        gradeLevel = "",
        lessonTopic = "",
        concept = "",
        currentAccuracyPct = 0,
        misconceptions = [],
        questionContext = null,
        wrongShortAnswers = [],
        language = "ar",
      } = req.body ?? {};

      const langRule =
        language === "en"
          ? "Respond strictly in clear pedagogical English."
          : "اكتب جميع التوصيات والأمثلة وسؤال التحقق باللغة العربية التربوية الواضحة.";

      const prompt = `You are an AI Instructional Coach inside "Smart Science AI Understanding Radar".
During a live class in ${subjectName} (${gradeLevel}), lesson "${lessonTopic}", the class struggled with the concept:
Concept: "${concept}"
Current Understanding Rate: ${currentAccuracyPct}%
Observed Misconceptions / Wrong Selections: ${JSON.stringify(misconceptions).slice(0, 2000)}
Wrong Short Answers Sample: ${JSON.stringify(wrongShortAnswers).slice(0, 1000)}
Previous Question Context: ${JSON.stringify(questionContext).slice(0, 1500)}

Provide:
1) diagnosisSummary: concise explanation of WHY students made this error and the exact root misconception.
2) strategies: 4 distinct, immediately usable teacher intervention options covering:
   - strategyType: "re_explain" (إعادة شرح المفهوم من زاوية واضحة)
   - strategyType: "simplified_example" (مثال مبسط خطوة بخطوة)
   - strategyType: "analogy" (تشبيه حياتي أو استراتيجية تدريس بديلة)
   - strategyType: "mini_activity" (نشاط صفي سريع خلال دقيقتين)
   Each strategy needs: id, strategyType, title, teacherScript (what teacher says aloud), studentFacingExplanation (shown directly on student phones), practicalExample, estimatedMinutes (1-3).
3) verificationQuestion: 1 brand-new MCQ question (4 options) testing the EXACT SAME concept "${concept}" from a DIFFERENT angle so it checks genuine transfer rather than repeating the old wording. Include concept, question, options (4), correctIndex, timeLimitSec (45), hint, explanation, misconceptionTarget.
${langRule}`;

      const response = await generateRadarWithFallback(ai, {
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              diagnosisSummary: { type: Type.STRING },
              strategies: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    strategyType: { type: Type.STRING },
                    title: { type: Type.STRING },
                    teacherScript: { type: Type.STRING },
                    studentFacingExplanation: { type: Type.STRING },
                    practicalExample: { type: Type.STRING },
                    estimatedMinutes: { type: Type.INTEGER },
                  },
                  required: [
                    "id",
                    "strategyType",
                    "title",
                    "teacherScript",
                    "studentFacingExplanation",
                    "practicalExample",
                    "estimatedMinutes",
                  ],
                },
              },
              verificationQuestion: {
                type: Type.OBJECT,
                properties: {
                  concept: { type: Type.STRING },
                  question: { type: Type.STRING },
                  options: { type: Type.ARRAY, items: { type: Type.STRING } },
                  correctIndex: { type: Type.INTEGER },
                  timeLimitSec: { type: Type.INTEGER },
                  explanation: { type: Type.STRING },
                  hint: { type: Type.STRING },
                  misconceptionTarget: { type: Type.STRING },
                },
                required: [
                  "concept",
                  "question",
                  "options",
                  "correctIndex",
                  "timeLimitSec",
                  "explanation",
                  "hint",
                  "misconceptionTarget",
                ],
              },
            },
            required: ["diagnosisSummary", "strategies", "verificationQuestion"],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? "{}").trim());
      const vq = parsed.verificationQuestion || {};
      return res.json({
        diagnosisSummary: String(parsed.diagnosisSummary || ""),
        strategies: Array.isArray(parsed.strategies) ? parsed.strategies : [],
        verificationQuestion: {
          id: `ver-${Date.now().toString(36)}`,
          questionType: "mcq",
          cognitiveLevel: "application",
          difficulty: "medium",
          concept: String(vq.concept || concept),
          objective: `التحقق من تحسن الفهم في ${concept}`,
          misconceptionTarget: String(vq.misconceptionTarget || ""),
          question: String(vq.question || ""),
          options: Array.isArray(vq.options) ? vq.options.map(String) : [],
          correctIndex: Math.max(0, Number(vq.correctIndex || 0)),
          timeLimitSec: Math.max(25, Number(vq.timeLimitSec || 45)),
          explanation: String(vq.explanation || ""),
          hint: String(vq.hint || ""),
          isVerification: true,
        } satisfies RadarQuestion,
      });
    } catch (err) {
      const formatted = formatGeminiError(err);
      return res.status(formatted.status).json({ error: formatted.code, message: formatted.message });
    }
  });

  // 4. Interactive Talking AI Tutor Inside Understanding Radar
  app.post("/api/radar/tutor", async (req: Request, res: Response) => {
    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({
        error: "GEMINI_NOT_CONFIGURED",
        message: "مفتاح GEMINI_API_KEY غير مهيأ لتشغيل المساعد الصوتي التفاعلي.",
      });
    }

    try {
      const {
        userRole = "student",
        subjectName = "العلوم",
        gradeLevel = "",
        lessonTopic = "",
        lessonContent = "",
        activeQuestion = null,
        sessionStatus = "lobby",
        mode = "ask",
        userMessage = "",
        history = [],
        language = "ar",
      } = req.body ?? {};

      const isQuestionLive = sessionStatus === "question" && userRole === "student";
      const spoilerGuard = isQuestionLive
        ? `CRITICAL EXAM INTEGRITY RULE: The live diagnostic question is currently ACTIVE for students. NEVER state or reveal the final answer letter/option directly! Instead, give a scaffolded conceptual hint, break down the scientific principle step-by-step, or clarify definitions so the student discovers the answer themselves.`
        : `Explain clearly why correct answers are scientifically accurate and why wrong options represent misconceptions.`;

      const modeInstruction =
        mode === "hint"
          ? "Give a progressive 2-step hint guiding thinking without giving away the answer."
          : mode === "simplify"
            ? "Explain the concept in ultra-simple everyday language with a tangible daily-life analogy suited to the student's grade level."
            : mode === "explain_error"
              ? "Clarify the likely conceptual misunderstanding gently and contrast it with the true scientific rule."
              : "Respond interactively to the user's question while staying strictly bounded to the subject, grade level, and lesson topic.";

      const langRule =
        language === "en"
          ? "Respond in warm, concise English."
          : "أجب باللغة العربية الفصيحة الواضحة والمشجعة.";

      const systemInstruction = `You are the "Smart Science AI Understanding Radar Tutor" (المعلم المساعد المتحدث داخل رادار الفهم).
Subject: ${subjectName} | Grade: ${gradeLevel} | Lesson Topic: ${lessonTopic}
User Role: ${userRole}
${spoilerGuard}
${modeInstruction}
${langRule}
Stay faithful to the lesson scope below:
${String(lessonContent || lessonTopic).slice(0, 7000)}
${activeQuestion ? `\nCurrent Question Context (concept: ${activeQuestion.concept}): ${activeQuestion.question}` : ""}`;

      const contents = [
        ...(Array.isArray(history)
          ? history.slice(-6).map((h: { sender?: string; text?: string }) => ({
              role: h.sender === "assistant" ? "model" : "user",
              parts: [{ text: String(h.text || "") }],
            }))
          : []),
        {
          role: "user",
          parts: [{ text: String(userMessage || "اشرح لي هذا المفهوم بطريقة مبسطة.") }],
        },
      ];

      const response = await generateRadarWithFallback(ai, {
        contents,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              reply: { type: Type.STRING },
              simplifiedAnalogy: { type: Type.STRING },
              scaffoldedHint: { type: Type.STRING },
              followUpPrompts: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ["reply", "simplifiedAnalogy", "scaffoldedHint", "followUpPrompts"],
          },
        },
      });

      return res.json(JSON.parse((response.text ?? "{}").trim()));
    } catch (err) {
      const formatted = formatGeminiError(err);
      return res.status(formatted.status).json({ error: formatted.code, message: formatted.message });
    }
  });

  // 5. Persistent Radar Sessions History & Comparison CRUD
  app.get("/api/radar/sessions", (_req: Request, res: Response) => {
    res.json({ sessions: listRadarSessions() });
  });

  app.post("/api/radar/sessions", (req: Request, res: Response) => {
    const saved = saveRadarSession(req.body || {});
    res.json({ session: saved });
  });

  app.delete("/api/radar/sessions/:id", (req: Request, res: Response) => {
    const deleted = deleteRadarSessionById(req.params.id);
    if (!deleted) {
      return res.status(404).json({ message: "تعذر العثور على جلسة رادار الفهم المطلوبة." });
    }
    res.json({ ok: true });
  });
}

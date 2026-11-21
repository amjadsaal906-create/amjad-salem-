import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";

const DATA_DIR = path.resolve(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, "smart_science.db");
const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS lessons (
    id TEXT PRIMARY KEY,
    subjectId TEXT NOT NULL,
    title TEXT NOT NULL,
    subject TEXT NOT NULL,
    stage TEXT NOT NULL,
    gradeLevel TEXT NOT NULL,
    estimatedMinutes INTEGER NOT NULL DEFAULT 15,
    summary TEXT NOT NULL,
    simplifiedSummary TEXT NOT NULL,
    diagramUrl TEXT NOT NULL,
    diagramTitle TEXT NOT NULL,
    diagramBaselineAlt TEXT NOT NULL,
    audioLessonScript TEXT NOT NULL,
    keySignTermsJson TEXT NOT NULL,
    sourcesJson TEXT NOT NULL,
    extractedAnalysisJson TEXT,
    simulationControlsJson TEXT NOT NULL,
    quizQuestionsJson TEXT NOT NULL,
    isCustom INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS lesson_artifacts (
    id TEXT PRIMARY KEY,
    lessonId TEXT NOT NULL,
    artifactType TEXT NOT NULL,
    title TEXT NOT NULL,
    dataJson TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS quiz_sessions (
    roomCode TEXT PRIMARY KEY,
    lessonId TEXT NOT NULL,
    quizTitle TEXT NOT NULL,
    status TEXT NOT NULL,
    reportJson TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS daily_facts (
    cacheKey TEXT PRIMARY KEY,
    dateKey TEXT NOT NULL,
    lang TEXT NOT NULL,
    dataJson TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS prep_templates (
    id TEXT PRIMARY KEY,
    subjectScope TEXT NOT NULL,
    templateName TEXT NOT NULL,
    sourceFileName TEXT NOT NULL,
    dataJson TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY,
    subjectId TEXT NOT NULL,
    stage TEXT NOT NULL,
    gradeLevel TEXT NOT NULL,
    title TEXT NOT NULL,
    fileName TEXT NOT NULL,
    mimeType TEXT NOT NULL,
    fileSizeBytes INTEGER NOT NULL,
    storagePath TEXT NOT NULL,
    analysisStatus TEXT NOT NULL,
    dataJson TEXT NOT NULL,
    uploadedAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS radar_sessions (
    id TEXT PRIMARY KEY,
    roomCode TEXT NOT NULL,
    subjectId TEXT NOT NULL,
    subjectName TEXT NOT NULL,
    gradeLevel TEXT NOT NULL,
    lessonTopic TEXT NOT NULL,
    overallAccuracy INTEGER NOT NULL DEFAULT 0,
    studentCount INTEGER NOT NULL DEFAULT 0,
    interventionCount INTEGER NOT NULL DEFAULT 0,
    dataJson TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
`);

export interface StoredLessonRow {
  id: string;
  subjectId: string;
  title: string;
  subject: string;
  stage: string;
  gradeLevel: string;
  estimatedMinutes: number;
  summary: string;
  simplifiedSummary: string;
  diagramUrl: string;
  diagramTitle: string;
  diagramBaselineAlt: string;
  audioLessonScript: string;
  keySignTermsJson: string;
  sourcesJson: string;
  extractedAnalysisJson: string | null;
  simulationControlsJson: string;
  quizQuestionsJson: string;
  isCustom: number;
  createdAt: string;
  updatedAt: string;
}

export function rowToLesson(row: StoredLessonRow) {
  return {
    id: row.id,
    subjectId: row.subjectId,
    title: row.title,
    subject: row.subject,
    stage: row.stage,
    gradeLevel: row.gradeLevel,
    estimatedMinutes: row.estimatedMinutes,
    summary: row.summary,
    simplifiedSummary: row.simplifiedSummary,
    diagramUrl: row.diagramUrl,
    diagramTitle: row.diagramTitle,
    diagramBaselineAlt: row.diagramBaselineAlt,
    audioLessonScript: row.audioLessonScript,
    keySignTerms: JSON.parse(row.keySignTermsJson || "[]"),
    sources: JSON.parse(row.sourcesJson || "[]"),
    extractedAnalysis: row.extractedAnalysisJson ? JSON.parse(row.extractedAnalysisJson) : undefined,
    simulationControls: JSON.parse(row.simulationControlsJson || "[]"),
    quizQuestions: JSON.parse(row.quizQuestionsJson || "[]"),
    isCustom: Boolean(row.isCustom),
    updatedAt: row.updatedAt,
  };
}

export function seedLessonsIfEmpty(initialLessons: Array<Record<string, unknown>>): void {
  const countRow = db.prepare("SELECT COUNT(*) as cnt FROM lessons").get() as { cnt: number };
  if (countRow.cnt > 0) return;

  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO lessons (
      id, subjectId, title, subject, stage, gradeLevel, estimatedMinutes,
      summary, simplifiedSummary, diagramUrl, diagramTitle, diagramBaselineAlt,
      audioLessonScript, keySignTermsJson, sourcesJson, extractedAnalysisJson,
      simulationControlsJson, quizQuestionsJson, isCustom, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const lesson of initialLessons) {
    insert.run(
      String(lesson.id),
      String(lesson.subjectId),
      String(lesson.title),
      String(lesson.subject),
      String(lesson.stage || "middle"),
      String(lesson.gradeLevel),
      Number(lesson.estimatedMinutes || 15),
      String(lesson.summary),
      String(lesson.simplifiedSummary),
      String(lesson.diagramUrl),
      String(lesson.diagramTitle),
      String(lesson.diagramBaselineAlt),
      String(lesson.audioLessonScript),
      JSON.stringify(lesson.keySignTerms || []),
      JSON.stringify(lesson.sources || []),
      lesson.extractedAnalysis ? JSON.stringify(lesson.extractedAnalysis) : null,
      JSON.stringify(lesson.simulationControls || []),
      JSON.stringify(lesson.quizQuestions || []),
      0,
      now,
      now
    );
  }
}

export function listAllLessons() {
  const rows = db
    .prepare("SELECT * FROM lessons ORDER BY isCustom DESC, createdAt ASC")
    .all() as unknown as StoredLessonRow[];
  return rows.map(rowToLesson);
}

export function getLessonById(id: string) {
  const row = db
    .prepare("SELECT * FROM lessons WHERE id = ?")
    .get(id) as unknown as StoredLessonRow | undefined;
  return row ? rowToLesson(row) : null;
}

export function upsertLesson(lesson: Record<string, unknown>) {
  const now = new Date().toISOString();
  const id = String(lesson.id || `lesson-${Date.now()}`);
  const existing = getLessonById(id);

  if (existing) {
    db.prepare(`
      UPDATE lessons SET
        subjectId = ?, title = ?, subject = ?, stage = ?, gradeLevel = ?,
        estimatedMinutes = ?, summary = ?, simplifiedSummary = ?,
        diagramUrl = ?, diagramTitle = ?, diagramBaselineAlt = ?,
        audioLessonScript = ?, keySignTermsJson = ?, sourcesJson = ?,
        extractedAnalysisJson = ?, simulationControlsJson = ?, quizQuestionsJson = ?,
        updatedAt = ?
      WHERE id = ?
    `).run(
      String(lesson.subjectId || existing.subjectId),
      String(lesson.title || existing.title),
      String(lesson.subject || existing.subject),
      String(lesson.stage || existing.stage),
      String(lesson.gradeLevel || existing.gradeLevel),
      Number(lesson.estimatedMinutes ?? existing.estimatedMinutes),
      String(lesson.summary || existing.summary),
      String(lesson.simplifiedSummary || existing.simplifiedSummary),
      String(lesson.diagramUrl || existing.diagramUrl),
      String(lesson.diagramTitle || existing.diagramTitle),
      String(lesson.diagramBaselineAlt || existing.diagramBaselineAlt),
      String(lesson.audioLessonScript || existing.audioLessonScript),
      JSON.stringify(lesson.keySignTerms ?? existing.keySignTerms),
      JSON.stringify(lesson.sources ?? existing.sources),
      lesson.extractedAnalysis
        ? JSON.stringify(lesson.extractedAnalysis)
        : existing.extractedAnalysis
        ? JSON.stringify(existing.extractedAnalysis)
        : null,
      JSON.stringify(lesson.simulationControls ?? existing.simulationControls),
      JSON.stringify(lesson.quizQuestions ?? existing.quizQuestions),
      now,
      id
    );
  } else {
    db.prepare(`
      INSERT INTO lessons (
        id, subjectId, title, subject, stage, gradeLevel, estimatedMinutes,
        summary, simplifiedSummary, diagramUrl, diagramTitle, diagramBaselineAlt,
        audioLessonScript, keySignTermsJson, sourcesJson, extractedAnalysisJson,
        simulationControlsJson, quizQuestionsJson, isCustom, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      String(lesson.subjectId || "chemistry"),
      String(lesson.title || "درس جديد"),
      String(lesson.subject || "العلوم"),
      String(lesson.stage || "middle"),
      String(lesson.gradeLevel || "الصف الثالث المتوسط"),
      Number(lesson.estimatedMinutes || 15),
      String(lesson.summary || ""),
      String(lesson.simplifiedSummary || lesson.summary || ""),
      String(lesson.diagramUrl || "/src/assets/images/diagram_chemical_bonding_1794937892597.jpg"),
      String(lesson.diagramTitle || lesson.title || "مخطط الدرس"),
      String(lesson.diagramBaselineAlt || lesson.summary || ""),
      String(lesson.audioLessonScript || lesson.summary || ""),
      JSON.stringify(lesson.keySignTerms || ["طاقة"]),
      JSON.stringify(lesson.sources || []),
      lesson.extractedAnalysis ? JSON.stringify(lesson.extractedAnalysis) : null,
      JSON.stringify(lesson.simulationControls || []),
      JSON.stringify(lesson.quizQuestions || []),
      lesson.isCustom === false ? 0 : 1,
      now,
      now
    );
  }
  return getLessonById(id);
}

export function deleteLessonById(id: string): boolean {
  const res = db.prepare("DELETE FROM lessons WHERE id = ? AND isCustom = 1").run(id);
  db.prepare("DELETE FROM lesson_artifacts WHERE lessonId = ?").run(id);
  return res.changes > 0;
}

export function listArtifactsForLesson(lessonId: string) {
  const rows = db
    .prepare("SELECT * FROM lesson_artifacts WHERE lessonId = ? ORDER BY updatedAt DESC")
    .all(lessonId) as unknown as Array<{
    id: string;
    lessonId: string;
    artifactType: string;
    title: string;
    dataJson: string;
    updatedAt: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    lessonId: r.lessonId,
    artifactType: r.artifactType,
    title: r.title,
    data: JSON.parse(r.dataJson),
    updatedAt: r.updatedAt,
  }));
}

export function saveArtifact(lessonId: string, artifactType: string, title: string, data: unknown) {
  const id = `${lessonId}__${artifactType}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO lesson_artifacts (id, lessonId, artifactType, title, dataJson, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      dataJson = excluded.dataJson,
      updatedAt = excluded.updatedAt
  `).run(id, lessonId, artifactType, title, JSON.stringify(data), now);

  return { id, lessonId, artifactType, title, data, updatedAt: now };
}

export function saveQuizReport(roomCode: string, lessonId: string, quizTitle: string, report: unknown) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO quiz_sessions (roomCode, lessonId, quizTitle, status, reportJson, createdAt)
    VALUES (?, ?, ?, 'finished', ?, ?)
    ON CONFLICT(roomCode) DO UPDATE SET
      reportJson = excluded.reportJson,
      status = 'finished'
  `).run(roomCode, lessonId, quizTitle, JSON.stringify(report), now);
}

export function listQuizReports() {
  const rows = db
    .prepare("SELECT * FROM quiz_sessions ORDER BY createdAt DESC LIMIT 25")
    .all() as unknown as Array<{
    roomCode: string;
    lessonId: string;
    quizTitle: string;
    reportJson: string;
    createdAt: string;
  }>;
  return rows.map((r) => JSON.parse(r.reportJson));
}

export function getDailyFact(dateKey: string, lang: string) {
  const cacheKey = `${dateKey}__${lang}`;
  const row = db
    .prepare("SELECT dataJson FROM daily_facts WHERE cacheKey = ?")
    .get(cacheKey) as unknown as { dataJson: string } | undefined;
  return row ? JSON.parse(row.dataJson) : null;
}

export function saveDailyFact(dateKey: string, lang: string, data: unknown) {
  const cacheKey = `${dateKey}__${lang}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO daily_facts (cacheKey, dateKey, lang, dataJson, createdAt)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(cacheKey) DO UPDATE SET
      dataJson = excluded.dataJson,
      createdAt = excluded.createdAt
  `).run(cacheKey, dateKey, lang, JSON.stringify(data), now);
}

export function listPrepTemplates() {
  const rows = db
    .prepare("SELECT dataJson FROM prep_templates ORDER BY updatedAt DESC")
    .all() as unknown as Array<{ dataJson: string }>;
  return rows.map((r) => JSON.parse(r.dataJson));
}

export function getPrepTemplateById(id: string) {
  const row = db
    .prepare("SELECT dataJson FROM prep_templates WHERE id = ?")
    .get(id) as unknown as { dataJson: string } | undefined;
  return row ? JSON.parse(row.dataJson) : null;
}

export function upsertPrepTemplate(tpl: Record<string, unknown>) {
  const now = new Date().toISOString();
  const id = String(tpl.id || `prep-${Date.now()}`);
  const payload = {
    ...tpl,
    id,
    subjectScope: String(tpl.subjectScope || "all"),
    templateName: String(tpl.templateName || "فورمة التحضير المعتمدة"),
    sourceFileName: String(tpl.sourceFileName || "template"),
    institutionOrSchool: String(tpl.institutionOrSchool || ""),
    requiredSections: Array.isArray(tpl.requiredSections) ? tpl.requiredSections : [],
    rawStructureText: String(tpl.rawStructureText || ""),
    presentationMappingGuidelines: String(tpl.presentationMappingGuidelines || ""),
    customInstructions: String(tpl.customInstructions || ""),
    updatedAt: now,
  };

  db.prepare(`
    INSERT INTO prep_templates (id, subjectScope, templateName, sourceFileName, dataJson, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      subjectScope = excluded.subjectScope,
      templateName = excluded.templateName,
      sourceFileName = excluded.sourceFileName,
      dataJson = excluded.dataJson,
      updatedAt = excluded.updatedAt
  `).run(
    id,
    payload.subjectScope,
    payload.templateName,
    payload.sourceFileName,
    JSON.stringify(payload),
    now
  );

  return payload;
}

export function deletePrepTemplateById(id: string): boolean {
  const res = db.prepare("DELETE FROM prep_templates WHERE id = ?").run(id);
  return res.changes > 0;
}

export function listAllBooks() {
  const rows = db
    .prepare("SELECT dataJson FROM books ORDER BY updatedAt DESC")
    .all() as unknown as Array<{ dataJson: string }>;
  return rows.map((r) => JSON.parse(r.dataJson));
}

export function getBookById(id: string) {
  const row = db
    .prepare("SELECT dataJson FROM books WHERE id = ?")
    .get(id) as unknown as { dataJson: string } | undefined;
  return row ? JSON.parse(row.dataJson) : null;
}

export function upsertBook(book: Record<string, unknown>) {
  const now = new Date().toISOString();
  const id = String(book.id || `book-${Date.now()}`);
  const existing = getBookById(id) as Record<string, unknown> | null;

  const payload = {
    ...(existing || {}),
    ...book,
    id,
    subjectId: String(book.subjectId || existing?.subjectId || "chemistry"),
    subjectName: String(book.subjectName || existing?.subjectName || "الكيمياء"),
    stage: String(book.stage || existing?.stage || "high"),
    gradeLevel: String(book.gradeLevel || existing?.gradeLevel || "الصف العاشر"),
    title: String(book.title || existing?.title || "كتاب مدرسي"),
    fileName: String(book.fileName || existing?.fileName || "book.pdf"),
    mimeType: String(book.mimeType || existing?.mimeType || "application/pdf"),
    fileSizeBytes: Number(book.fileSizeBytes ?? existing?.fileSizeBytes ?? 0),
    storagePath: String(book.storagePath || existing?.storagePath || ""),
    totalPagesEstimated: Number(book.totalPagesEstimated ?? existing?.totalPagesEstimated ?? 0),
    bookSummary: String(book.bookSummary ?? existing?.bookSummary ?? ""),
    analysisStatus: String(book.analysisStatus || existing?.analysisStatus || "pending"),
    analysisError: book.analysisError !== undefined ? book.analysisError : existing?.analysisError,
    units: Array.isArray(book.units)
      ? book.units
      : Array.isArray(existing?.units)
        ? existing.units
        : [],
    uploadedAt: String(existing?.uploadedAt || book.uploadedAt || now),
    updatedAt: now,
  };

  db.prepare(`
    INSERT INTO books (
      id, subjectId, stage, gradeLevel, title, fileName, mimeType,
      fileSizeBytes, storagePath, analysisStatus, dataJson, uploadedAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      subjectId = excluded.subjectId,
      stage = excluded.stage,
      gradeLevel = excluded.gradeLevel,
      title = excluded.title,
      fileName = excluded.fileName,
      mimeType = excluded.mimeType,
      fileSizeBytes = excluded.fileSizeBytes,
      storagePath = excluded.storagePath,
      analysisStatus = excluded.analysisStatus,
      dataJson = excluded.dataJson,
      updatedAt = excluded.updatedAt
  `).run(
    id,
    payload.subjectId,
    payload.stage,
    payload.gradeLevel,
    payload.title,
    payload.fileName,
    payload.mimeType,
    payload.fileSizeBytes,
    payload.storagePath,
    payload.analysisStatus,
    JSON.stringify(payload),
    payload.uploadedAt,
    now
  );

  return payload;
}

export function deleteBookById(id: string): boolean {
  const res = db.prepare("DELETE FROM books WHERE id = ?").run(id);
  return res.changes > 0;
}

export function saveRadarSession(report: Record<string, unknown>) {
  const now = new Date().toISOString();
  const roomCode = String(report.roomCode || `RAD-${Date.now()}`);
  const id = String(report.id || `radar-${roomCode}-${Date.now().toString(36)}`);
  const snapshot = (report.snapshot || report) as Record<string, unknown>;
  const payload = {
    id,
    roomCode,
    subjectId: String(report.subjectId || snapshot.subjectId || "chemistry"),
    subjectName: String(report.subjectName || snapshot.subjectName || "العلوم"),
    gradeLevel: String(report.gradeLevel || snapshot.gradeLevel || ""),
    lessonTopic: String(report.lessonTopic || snapshot.lessonTopic || "درس تشخيصي"),
    overallAccuracy: Number(report.overallAccuracy ?? snapshot.overallUnderstandingPct ?? 0),
    studentCount: Number(report.studentCount ?? snapshot.studentCount ?? 0),
    interventionCount: Number(
      report.interventionCount ??
        (Array.isArray(snapshot.interventionHistory) ? snapshot.interventionHistory.length : 0)
    ),
    snapshot,
    createdAt: String(report.createdAt || snapshot.createdAt || now),
    updatedAt: now,
  };

  db.prepare(`
    INSERT INTO radar_sessions (
      id, roomCode, subjectId, subjectName, gradeLevel, lessonTopic,
      overallAccuracy, studentCount, interventionCount, dataJson, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      overallAccuracy = excluded.overallAccuracy,
      studentCount = excluded.studentCount,
      interventionCount = excluded.interventionCount,
      dataJson = excluded.dataJson,
      updatedAt = excluded.updatedAt
  `).run(
    payload.id,
    payload.roomCode,
    payload.subjectId,
    payload.subjectName,
    payload.gradeLevel,
    payload.lessonTopic,
    payload.overallAccuracy,
    payload.studentCount,
    payload.interventionCount,
    JSON.stringify(payload),
    payload.createdAt,
    payload.updatedAt
  );

  return payload;
}

export function listRadarSessions() {
  const rows = db
    .prepare("SELECT dataJson FROM radar_sessions ORDER BY updatedAt DESC LIMIT 50")
    .all() as unknown as Array<{ dataJson: string }>;
  return rows.map((r) => JSON.parse(r.dataJson));
}

export function getRadarSessionById(id: string) {
  const row = db
    .prepare("SELECT dataJson FROM radar_sessions WHERE id = ?")
    .get(id) as unknown as { dataJson: string } | undefined;
  return row ? JSON.parse(row.dataJson) : null;
}

export function deleteRadarSessionById(id: string): boolean {
  const res = db.prepare("DELETE FROM radar_sessions WHERE id = ?").run(id);
  return res.changes > 0;
}

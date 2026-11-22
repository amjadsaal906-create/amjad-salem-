import type {
  BookRecord,
  ChatActionMode,
  ChatMessage,
  DailyScienceFact,
  ImageDescriptionResult,
  KahootQuizData,
  LessonData,
  LessonPlanData,
  PlatformCapabilities,
  PreparationTemplate,
  PresentationDeckData,
  QuizQuestion,
  QuizSessionReport,
  RadarDifficulty,
  RadarInterventionStrategy,
  RadarQuestion,
  RadarQuestionType,
  RadarSavedReport,
  SourcePolicy,
  StudentLevel,
  UILanguage,
  UserRole,
  VideoProjectData,
  WorksheetData,
} from "../types.ts";
import {
  ApiResponseError,
  fetchAssetAsBase64,
  onApiBaseUrlChange,
  safeFetchBlob,
  safeFetchJson,
  stripJsonFences,
  type AiRequestPhase,
} from "./apiClient.ts";
import type { WorldDiscoveryResult } from "./demoSamples.ts";

export interface AiCallControl {
  onPhaseChange?: (phase: AiRequestPhase) => void;
  timeoutMs?: number;
}

type WorkerProtocol = "api_router" | "raw_gemini_proxy";

let detectedProtocol: WorkerProtocol | null = null;

onApiBaseUrlChange(() => {
  detectedProtocol = null;
});

function postJson<T>(
  path: string,
  body: unknown,
  control?: AiCallControl
): Promise<{ status: number; ok: boolean; data: T }> {
  return safeFetchJson<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    timeoutMs: control?.timeoutMs ?? 45000,
    onPhaseChange: control?.onPhaseChange,
  });
}

function assertNonEmpty<T>(
  condition: unknown,
  message: string,
  control?: AiCallControl
): asserts condition is NonNullable<T> {
  if (!condition) {
    control?.onPhaseChange?.("empty_response");
    throw new ApiResponseError(message, {
      status: 502,
      code: "EMPTY_AI_RESPONSE",
    });
  }
}

async function resolveWorkerProtocol(control?: AiCallControl): Promise<WorkerProtocol> {
  if (detectedProtocol) return detectedProtocol;
  try {
    await fetchCapabilities(control);
  } catch {
    // Default cleanly to api_router if capabilities probe fails completely
  }
  return detectedProtocol || "api_router";
}

async function postRawGeminiJson<T = Record<string, unknown>>(
  params: {
    parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }>;
    systemInstruction?: string;
    temperature?: number;
  },
  control?: AiCallControl
): Promise<T> {
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: params.parts }],
    generationConfig: {
      responseMimeType: "application/json",
      ...(typeof params.temperature === "number" ? { temperature: params.temperature } : {}),
    },
  };
  if (params.systemInstruction) {
    body.systemInstruction = { parts: [{ text: params.systemInstruction }] };
  }

  const { data } = await safeFetchJson<{
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    reply?: string;
    message?: string;
  }>("/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    timeoutMs: control?.timeoutMs ?? 60000,
    onPhaseChange: control?.onPhaseChange,
  });

  const text = (data.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text || "")
    .join("")
    .trim();

  if (!text) {
    control?.onPhaseChange?.("empty_response");
    throw new ApiResponseError("لم يُرجع نموذج Gemini أي محتوى (عدم وجود رد).", {
      status: 502,
      code: "EMPTY_AI_RESPONSE",
    });
  }

  try {
    return JSON.parse(stripJsonFences(text) || "{}") as T;
  } catch {
    control?.onPhaseChange?.("api_error");
    throw new ApiResponseError("أعاد نموذج Gemini استجابة غير متوافقة مع بنية JSON المتوقعة.", {
      status: 502,
      code: "INVALID_AI_JSON",
    });
  }
}

function buildLessonSourcesSummary(sources?: LessonData["sources"]): string {
  const active = Array.isArray(sources) ? sources.filter((s) => s.enabled !== false) : [];
  if (active.length === 0) return "";
  return active
    .map((s) => `• ${s.title} (${s.category}): ${s.content}`)
    .join("\n")
    .slice(0, 12000);
}

// ============================================================================
// Core Unified AI Endpoints
// ============================================================================

export async function fetchCapabilities(control?: AiCallControl): Promise<PlatformCapabilities> {
  try {
    const { data } = await safeFetchJson<PlatformCapabilities>("/api/capabilities", {
      timeoutMs: control?.timeoutMs ?? 20000,
      onPhaseChange: control?.onPhaseChange,
    });
    detectedProtocol = "api_router";
    return data;
  } catch (err) {
    if (
      err instanceof ApiResponseError &&
      err.code === "INVALID_JSON" &&
      err.rawText &&
      /worker\s+is\s+ready|smart\s+science\s+ai/i.test(err.rawText)
    ) {
      detectedProtocol = "raw_gemini_proxy";
      return {
        geminiConfigured: true,
        databaseEngine: "LocalStorage (Worker Raw Proxy)",
        realtimeEngine: "Cloudflare Worker (POST / Gemini Proxy)",
        models: {
          chatAndVision: "Cloudflare Worker Default",
          tts: "Web Speech API",
          stt: "Web Speech API",
          veoVideo: "Browser WebM Canvas",
        },
        signLanguageExternalService: {
          configured: false,
          providerName: null,
          statusMessage:
            "يتصل التطبيق عبر بوابة Cloudflare Worker الأساسية، والقاموس الإشاري المحلي فعّال.",
          requiredEnvVars: ["SIGN_LANGUAGE_API_URL", "SIGN_LANGUAGE_API_KEY"],
        },
      };
    }
    throw err;
  }
}

export interface ChatRequestPayload {
  role: UserRole;
  messages: Array<{ sender: "user" | "assistant"; text: string }>;
  lessonTitle?: string;
  lessonSummary?: string;
  sources?: LessonData["sources"];
  sourcePolicy?: SourcePolicy;
  actionMode?: ChatActionMode;
  studentLevel?: StudentLevel;
  language?: string;
  weakSpots?: Array<{ concept: string; observation?: string }>;
  accommodations?: string[];
  simplifiedMode?: boolean;
}

export interface ChatResponsePayload {
  reply?: string;
  citations?: ChatMessage["citations"];
  alternativeExplanation?: string;
  detectedWeakSpots?: Array<{ concept: string; observation: string; suggestedRemediation: string }>;
  quickExercise?: ChatMessage["quickExercise"];
  remedialQuestions?: ChatMessage["remedialQuestions"];
  followUpSuggestions?: string[];
  outOfScopeNotice?: string;
  message?: string;
}

export async function sendChatRequest(
  payload: ChatRequestPayload,
  control?: AiCallControl
): Promise<ChatResponsePayload> {
  const protocol = await resolveWorkerProtocol(control);

  if (protocol === "raw_gemini_proxy") {
    const historyText = (payload.messages || [])
      .slice(-8)
      .map((m) => `${m.sender === "user" ? "User" : "Assistant"}: ${m.text}`)
      .join("\n");
    const sourcesText = buildLessonSourcesSummary(payload.sources);
    const data = await postRawGeminiJson<ChatResponsePayload>(
      {
        systemInstruction:
          "You are Smart Science AI Tutor. Always reply with a valid JSON object matching: { reply: string, citations: [{ sourceTitle: string, excerpt: string }], alternativeExplanation?: string, detectedWeakSpots?: [{ concept: string, observation: string, suggestedRemediation: string }], quickExercise?: { question: string, options: string[], correctIndex: number, explanation: string }, followUpSuggestions: string[], outOfScopeNotice?: string }.",
        parts: [
          {
            text: `Role: ${payload.role} | Action: ${payload.actionMode || "explain"} | Language: ${
              payload.language || "ar"
            } | Level: ${payload.studentLevel || "intermediate"} | Simplified: ${Boolean(
              payload.simplifiedMode
            )}\nLesson: ${payload.lessonTitle || "General Science"}\nSummary: ${
              payload.lessonSummary || ""
            }\nSources:\n${sourcesText || "Standard curriculum"}\n\nConversation:\n${historyText}`,
          },
        ],
      },
      control
    );
    assertNonEmpty(data?.reply?.trim(), "لم يرد نص جواب من المساعد الذكي.", control);
    return data;
  }

  const { data } = await postJson<ChatResponsePayload>("/api/chat", payload, control);
  assertNonEmpty(data?.reply?.trim(), data?.message || "لم يرد نص جواب من المساعد الذكي.", control);
  return data;
}

export interface DiscoverObjectPayload {
  imageBase64: string;
  mimeType: string;
  question?: string;
  language?: UILanguage;
  studentLevel?: StudentLevel;
}

export async function discoverWorldObject(
  payload: DiscoverObjectPayload,
  control?: AiCallControl
): Promise<WorldDiscoveryResult> {
  const protocol = await resolveWorkerProtocol(control);

  if (protocol === "raw_gemini_proxy") {
    const isAr = payload.language !== "en";
    const data = await postRawGeminiJson<WorldDiscoveryResult & { message?: string }>(
      {
        parts: [
          { inlineData: { mimeType: payload.mimeType || "image/jpeg", data: payload.imageBase64 } },
          {
            text: `${
              isAr ? "تحدث باللغة العربية الفصحى الواضحة." : "Respond in clear English."
            } Identify accurately whatever object, food item, plant, device, chemical, or natural thing appears in the image. Question: "${
              payload.question || "What is this and what is its scientific explanation?"
            }" Level: ${payload.studentLevel || "intermediate"}.
Return strictly JSON: { "objectName": string, "discipline": string, "summary": string, "scientificExplanation": string, "keyFacts": string[], "relatedConcepts": string[], "experimentIdea": string, "funQuestion": string, "funAnswer": string }.`,
          },
        ],
      },
      control
    );
    assertNonEmpty(
      data?.objectName?.trim(),
      data?.message || "لم يُرجع الخادم نتيجة التعرف على العنصر.",
      control
    );
    return data;
  }

  const { data } = await postJson<WorldDiscoveryResult & { message?: string }>(
    "/api/discover-object",
    payload,
    control
  );
  assertNonEmpty(
    data?.objectName?.trim(),
    data?.message || "لم يُرجع الخادم نتيجة التعرف على العنصر.",
    control
  );
  return data;
}

export interface GenerateLessonPlanPayload {
  lesson: LessonData;
  language: UILanguage;
  sourcePolicy?: SourcePolicy;
  prepTemplateId?: string;
  prepTemplate?: PreparationTemplate | null;
  teacherInputs?: {
    customTopic?: string;
    durationMinutes?: number;
    targetGroup?: string;
    focusObjectives?: string;
    extraInstructions?: string;
  };
  attachedNotes?: string;
  attachedFiles?: Array<{
    fileName: string;
    mimeType: string;
    fileBase64?: string;
    uploadId?: string;
  }>;
}

export async function generateLessonPlan(
  payload: GenerateLessonPlanPayload,
  control?: AiCallControl
): Promise<{ lessonPlan?: LessonPlanData; source?: string; message?: string }> {
  const protocol = await resolveWorkerProtocol(control);

  if (protocol === "raw_gemini_proxy") {
    const { lesson, language, teacherInputs, attachedNotes, prepTemplate } = payload;
    const isAr = language === "ar";
    const parsed = await postRawGeminiJson<LessonPlanData>(
      {
        parts: [
          {
            text: `${
              isAr ? "اكتب التحضير كاملاً باللغة العربية التربوية." : "Write in clear educational English."
            }
Create a complete, practical lesson plan for "${teacherInputs?.customTopic || lesson.title}" (${
              lesson.subject
            }, ${lesson.stage}, ${lesson.gradeLevel}).
Duration: ${teacherInputs?.durationMinutes || lesson.estimatedMinutes || 45} min.
Target Group: ${teacherInputs?.targetGroup || "General"}.
Focus Objectives: ${teacherInputs?.focusObjectives || "Standard"}.
Extra Instructions: ${teacherInputs?.extraInstructions || "None"}.
Preparation Template: ${prepTemplate?.templateName || "Standard"} (Sections: ${
              prepTemplate?.requiredSections?.join("، ") || "Default"
            }).
Sources:\n${buildLessonSourcesSummary(lesson.sources)}\nAttached Notes:\n${attachedNotes || "None"}

Return strictly JSON: { "lessonTitle": string, "subject": string, "stage": string, "gradeLevel": string, "durationMinutes": number, "objectives": string[], "warmUp": string, "teachingStrategies": string[], "learningActivities": string[], "resourcesAndMedia": string[], "assessment": string, "homework": string, "differentiationAndInclusion": string, "templateNameUsed": string, "customFormFields": [{ "sectionName": string, "content": string }] }.`,
          },
        ],
      },
      { ...control, timeoutMs: control?.timeoutMs ?? 75000 }
    );
    assertNonEmpty(parsed?.lessonTitle || parsed?.objectives?.length, "لم يُرجع الذكاء الاصطناعي بيانات التحضير.", control);
    return { lessonPlan: parsed, source: "cloudflare_worker" };
  }

  const { data } = await postJson<{
    lessonPlan?: LessonPlanData;
    source?: string;
    message?: string;
  }>("/api/generate/lesson-plan", payload, { ...control, timeoutMs: control?.timeoutMs ?? 75000 });
  assertNonEmpty(
    data?.lessonPlan,
    data?.message || "لم يُرجع الخادم بيانات تحضير صالحة.",
    control
  );
  return data;
}

export interface GeneratePowerPointPayload {
  lesson: LessonData;
  slideCount?: number;
  language?: UILanguage;
  prepTemplateId?: string;
  prepTemplate?: PreparationTemplate | null;
  lessonPlan?: LessonPlanData | null;
}

export async function generatePowerPointDeck(
  payload: GeneratePowerPointPayload,
  control?: AiCallControl
): Promise<{ deck?: PresentationDeckData; message?: string }> {
  const protocol = await resolveWorkerProtocol(control);

  if (protocol === "raw_gemini_proxy") {
    const isAr = payload.language !== "en";
    const parsed = await postRawGeminiJson<PresentationDeckData>(
      {
        parts: [
          {
            text: `${
              isAr ? "اكتب جميع الشرائح باللغة العربية الدقيقة علمياً." : "Write all slides in clear English."
            }
Build a ${payload.slideCount || 7}-slide PowerPoint deck for "${payload.lesson.title}" (${
              payload.lesson.subject
            }, ${payload.lesson.gradeLevel}) including ALL sections: title, intro/warm-up, objectives, scientific concepts, activities, interactive_quiz, and summary/conclusion.
Sources:\n${buildLessonSourcesSummary(payload.lesson.sources)}
${payload.lessonPlan ? `Lesson Plan Reference:\n${JSON.stringify(payload.lessonPlan).slice(0, 6000)}` : ""}
Return strictly JSON: { "deckTitle": string, "subject": string, "gradeLevel": string, "themeAccent": string, "templateNameUsed": string, "slides": [{ "slideNumber": number, "slideType": "title"|"intro"|"objectives"|"concept"|"diagram"|"activity"|"example"|"interactive_quiz"|"summary", "title": string, "subtitle": string, "bullets": string[], "speakerNotes": string, "quizQuestion"?: string, "quizOptions"?: string[], "quizAnswerIndex"?: number }] }.`,
          },
        ],
      },
      { ...control, timeoutMs: control?.timeoutMs ?? 65000 }
    );
    assertNonEmpty(parsed?.slides?.length, "لم يُرجع الذكاء الاصطناعي شرائح صالحة.", control);
    return { deck: parsed };
  }

  const { data } = await postJson<{ deck?: PresentationDeckData; message?: string }>(
    "/api/generate/powerpoint",
    payload,
    { ...control, timeoutMs: control?.timeoutMs ?? 65000 }
  );
  assertNonEmpty(
    data?.deck?.slides?.length,
    data?.message || "لم يُرجع الخادم شرائح PowerPoint صالحة.",
    control
  );
  return data;
}

export async function generateAutoPowerPointFile(
  payload: GeneratePowerPointPayload,
  control?: AiCallControl
): Promise<{
  deck?: PresentationDeckData;
  fileName?: string;
  mimeType?: string;
  pptxBase64?: string;
  useClientPptx?: boolean;
  message?: string;
}> {
  const protocol = await resolveWorkerProtocol(control);
  if (protocol === "raw_gemini_proxy") {
    const deckRes = await generatePowerPointDeck(payload, control);
    return { deck: deckRes.deck, useClientPptx: true };
  }

  const { data } = await postJson<{
    deck?: PresentationDeckData;
    fileName?: string;
    mimeType?: string;
    pptxBase64?: string;
    useClientPptx?: boolean;
    message?: string;
  }>("/api/presentation/auto-pptx", payload, { ...control, timeoutMs: control?.timeoutMs ?? 70000 });
  assertNonEmpty(
    data?.pptxBase64 || (data?.deck?.slides && data.deck.slides.length > 0),
    data?.message || "لم يُرجع الخادم شرائح أو ملف PowerPoint.",
    control
  );
  return data;
}

export async function exportPowerPointFile(
  payload: {
    deck?: PresentationDeckData | null;
    lesson?: LessonData | null;
    prepTemplateId?: string;
    prepTemplate?: PreparationTemplate | null;
    lessonPlan?: LessonPlanData | null;
    diagramUrl?: string;
    language?: UILanguage;
  },
  control?: AiCallControl
): Promise<{ blob: Blob; fileNameHeader: string | null }> {
  const protocol = await resolveWorkerProtocol(control);
  if (protocol === "raw_gemini_proxy") {
    throw new ApiResponseError("استخدم المُصدّر المحلي للمتصفح لبناء ملف .pptx.", {
      status: 501,
      code: "ROUTE_NOT_FOUND",
    });
  }

  const { blob, headers } = await safeFetchBlob("/api/presentation/export-pptx", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    timeoutMs: control?.timeoutMs ?? 45000,
    onPhaseChange: control?.onPhaseChange,
  });
  return { blob, fileNameHeader: headers.get("X-File-Name") };
}

export async function generateWorksheet(
  payload: {
    lesson: LessonData;
    language?: UILanguage;
  },
  control?: AiCallControl
): Promise<{ worksheet?: WorksheetData; message?: string }> {
  const protocol = await resolveWorkerProtocol(control);

  if (protocol === "raw_gemini_proxy") {
    const isAr = payload.language !== "en";
    const parsed = await postRawGeminiJson<WorksheetData>(
      {
        parts: [
          {
            text: `${
              isAr ? "اكتب ورقة العمل باللغة العربية العلمية الواضحة." : "Write in English."
            }
Create a rich educational worksheet for "${payload.lesson.title}" (${payload.lesson.subject}, ${
              payload.lesson.gradeLevel
            }).
Sources:\n${buildLessonSourcesSummary(payload.lesson.sources)}
Return strictly JSON: { "worksheetTitle": string, "subject": string, "gradeLevel": string, "studentInstructions": string, "variedQuestions": [{ "type": "mcq"|"true_false"|"short_answer", "question": string, "answer": string }], "practicalActivity": { "title": string, "steps": string[], "expectedOutcome": string }, "fillInBlanks": [{ "sentence": string, "missingWord": string }], "matchingPairs": [{ "leftItem": string, "rightMatch": string }], "classificationTask": { "prompt": string, "categories": [{ "categoryName": string, "items": string[] }] }, "problemSolving": [{ "problem": string, "solutionSteps": string, "finalAnswer": string }], "higherOrderThinking": [{ "question": string, "modelAnswer": string }] }.`,
          },
        ],
      },
      { ...control, timeoutMs: control?.timeoutMs ?? 60000 }
    );
    assertNonEmpty(parsed?.worksheetTitle, "لم يُرجع الذكاء الاصطناعي ورقة عمل صالحة.", control);
    return { worksheet: parsed };
  }

  const { data } = await postJson<{ worksheet?: WorksheetData; message?: string }>(
    "/api/generate/worksheet",
    payload,
    { ...control, timeoutMs: control?.timeoutMs ?? 60000 }
  );
  assertNonEmpty(
    data?.worksheet,
    data?.message || "لم يُرجع الخادم ورقة عمل صالحة.",
    control
  );
  return data;
}

export async function generateQuiz(
  payload: {
    lesson: LessonData;
    questionCount?: number;
    language?: UILanguage;
  },
  control?: AiCallControl
): Promise<{ quiz?: KahootQuizData; message?: string }> {
  const protocol = await resolveWorkerProtocol(control);

  if (protocol === "raw_gemini_proxy") {
    const isAr = payload.language !== "en";
    const count = payload.questionCount || 6;
    const parsed = await postRawGeminiJson<KahootQuizData>(
      {
        parts: [
          {
            text: `${
              isAr ? "اكتب الأسئلة والخيارات والتفسير باللغة العربية." : "Write in English."
            }
Generate ${count} interactive multiple-choice quiz questions (4 options each) for "${payload.lesson.title}" (${
              payload.lesson.subject
            }, ${payload.lesson.gradeLevel}).
Sources:\n${buildLessonSourcesSummary(payload.lesson.sources)}
Return strictly JSON: { "quizTitle": string, "questions": [{ "id": string, "question": string, "options": string[], "correctIndex": number, "timeLimitSec": number, "explanation": string }] }.`,
          },
        ],
      },
      control
    );
    assertNonEmpty(parsed?.questions?.length, "لم يُرجع الذكاء الاصطناعي أسئلة اختبار صالحة.", control);
    return { quiz: parsed };
  }

  const { data } = await postJson<{ quiz?: KahootQuizData; message?: string }>(
    "/api/generate/quiz",
    payload,
    control
  );
  assertNonEmpty(
    data?.quiz?.questions?.length,
    data?.message || "لم يُرجع الخادم أسئلة اختبار صالحة.",
    control
  );
  return data;
}

export async function generateAdaptiveQuizQuestion(
  payload: {
    lessonTitle: string;
    sources: LessonData["sources"];
    weakConcepts: string[];
    accommodations: string[];
    difficulty: string;
    studentLevel?: StudentLevel;
    studentStats?: { answered: number; correct: number };
    language?: UILanguage;
  },
  control?: AiCallControl
): Promise<QuizQuestion> {
  const protocol = await resolveWorkerProtocol(control);

  if (protocol === "raw_gemini_proxy") {
    const isAr = payload.language !== "en";
    const stats = payload.studentStats;
    const acc = stats && stats.answered > 0 ? Math.round((stats.correct / stats.answered) * 100) : 70;
    const parsed = await postRawGeminiJson<QuizQuestion>(
      {
        parts: [
          {
            text: `${isAr ? "اكتب السؤال بالعربية." : "Write in English."}
Generate 1 adaptive science question for lesson "${payload.lessonTitle}" tailored to student level "${
              payload.studentLevel || "intermediate"
            }", difficulty "${payload.difficulty}", accuracy ${acc}%, weak concepts [${
              payload.weakConcepts.join(", ") || "none"
            }], accommodations [${payload.accommodations.join(", ") || "none"}].
Sources:\n${buildLessonSourcesSummary(payload.sources)}
Return strictly JSON: { "id": string, "concept": string, "difficulty": "easy"|"medium"|"hard", "prompt": string, "simplifiedPrompt": string, "visualCue": string, "options": string[], "correctIndex": number, "explanation": string, "hint": string }.`,
          },
        ],
      },
      control
    );
    assertNonEmpty(parsed?.prompt?.trim() && parsed?.options?.length, "لم يُرجع الذكاء الاصطناعي سؤالاً تكيفياً.", control);
    return parsed;
  }

  const { data } = await postJson<QuizQuestion>("/api/adaptive-quiz", payload, control);
  assertNonEmpty(
    data?.prompt?.trim() && Array.isArray(data?.options) && data.options.length > 0,
    "لم يُرجع الخادم سؤالاً تكيفياً صالحاً.",
    control
  );
  return data;
}

export async function generateVideoScript(
  payload: {
    lesson: LessonData;
    style: string;
    presenterPersona: string;
    language: string;
  },
  control?: AiCallControl
): Promise<{ project?: VideoProjectData; message?: string }> {
  const protocol = await resolveWorkerProtocol(control);

  if (protocol === "raw_gemini_proxy") {
    const parsed = await postRawGeminiJson<VideoProjectData>(
      {
        parts: [
          {
            text: `Write a 5-scene educational video script in language "${payload.language}" for "${payload.lesson.title}" using style "${payload.style}" and persona "${payload.presenterPersona}".
Sources:\n${buildLessonSourcesSummary(payload.lesson.sources)}
Return strictly JSON: { "videoTitle": string, "fullScript": string, "scenes": [{ "sceneNumber": number, "title": string, "narration": string, "subtitleText": string, "visualCue": string, "durationSec": number }] }.`,
          },
        ],
      },
      control
    );
    assertNonEmpty(parsed?.scenes?.length, "لم يُرجع الذكاء الاصطناعي مشاهد الفيديو.", control);
    return {
      project: {
        ...parsed,
        style: payload.style as VideoProjectData["style"],
        presenterPersona: payload.presenterPersona as VideoProjectData["presenterPersona"],
        language: payload.language as VideoProjectData["language"],
      },
    };
  }

  const { data } = await postJson<{ project?: VideoProjectData; message?: string }>(
    "/api/generate/video-script",
    payload,
    control
  );
  assertNonEmpty(
    data?.project?.scenes?.length,
    data?.message || "لم يُرجع الخادم سيناريو الفيديو.",
    control
  );
  return data;
}

export async function generateVeoVideo(
  payload: { prompt: string },
  control?: AiCallControl
): Promise<{ videoBase64?: string; mimeType?: string; videoUri?: string; message?: string }> {
  const { data } = await postJson<{
    videoBase64?: string;
    mimeType?: string;
    videoUri?: string;
    message?: string;
  }>("/api/generate/veo-video", payload, control);
  return data;
}

export async function fetchDailyScienceFact(
  params: {
    lang: UILanguage;
    date: string;
    refresh?: boolean;
  },
  control?: AiCallControl
): Promise<DailyScienceFact> {
  const protocol = await resolveWorkerProtocol(control);

  if (protocol === "raw_gemini_proxy") {
    const isAr = params.lang === "ar";
    const fact = await postRawGeminiJson<DailyScienceFact>(
      {
        parts: [
          {
            text: `${isAr ? "اكتب باللغة العربية." : "Write in English."} Provide 1 fascinating authentic daily science fact for date ${
              params.date
            } (variation=${params.refresh ? Date.now() : params.date}).
Return strictly JSON: { "dateKey": "${params.date}", "discipline": string, "headline": string, "fact": string, "whyItMatters": string, "quickPrompt": string }.`,
          },
        ],
      },
      control
    );
    assertNonEmpty(fact?.fact?.trim(), "لم يُرجع الخادم حقيقة علمية صالحة.", control);
    return fact;
  }

  const query = new URLSearchParams({
    lang: params.lang,
    date: params.date,
  });
  if (params.refresh) query.set("refresh", "true");
  const { data } = await safeFetchJson<{ fact?: DailyScienceFact; message?: string }>(
    `/api/daily-fact?${query.toString()}`,
    {
      timeoutMs: control?.timeoutMs ?? 30000,
      onPhaseChange: control?.onPhaseChange,
    }
  );
  assertNonEmpty(
    data?.fact?.fact?.trim(),
    data?.message || "لم يُرجع الخادم حقيقة علمية صالحة.",
    control
  );
  return data.fact;
}

export async function describeScienceImage(
  payload: {
    imageBase64?: string;
    imageUrl?: string;
    mimeType?: string;
    lessonTitle: string;
  },
  control?: AiCallControl
): Promise<ImageDescriptionResult> {
  const protocol = await resolveWorkerProtocol(control);

  if (protocol === "raw_gemini_proxy") {
    let base64 = payload.imageBase64 || "";
    let mimeType = payload.mimeType || "image/png";
    if (!base64 && payload.imageUrl) {
      const loaded = await fetchAssetAsBase64(payload.imageUrl);
      if (loaded) {
        base64 = loaded.base64;
        mimeType = loaded.mimeType;
      }
    }
    assertNonEmpty(base64, "تعذر قراءة الصورة لتحليلها.", control);
    const parsed = await postRawGeminiJson<ImageDescriptionResult>(
      {
        parts: [
          { inlineData: { mimeType, data: base64 } },
          {
            text: `Provide an accessible Arabic educational description of this scientific diagram for lesson "${payload.lessonTitle}". Return strictly JSON: { "shortAlt": string, "detailedSpatialDescription": string, "keyTakeaway": string }.`,
          },
        ],
      },
      control
    );
    assertNonEmpty(parsed?.shortAlt || parsed?.detailedSpatialDescription, "لم يُرجع وصفاً صالحاً للصورة.", control);
    return parsed;
  }

  const { data } = await postJson<ImageDescriptionResult>("/api/describe-image", payload, control);
  assertNonEmpty(
    data?.shortAlt || data?.detailedSpatialDescription,
    "لم يُرجع الخادم وصفاً صالحاً للصورة.",
    control
  );
  return data;
}

export async function simplifyScienceText(
  payload: {
    text: string;
    lessonTitle: string;
    studentLevel?: StudentLevel;
    language?: UILanguage;
  },
  control?: AiCallControl
): Promise<{
  steps: Array<{
    stepNumber: number;
    title: string;
    simpleSentence: string;
    visualCue: string;
    checkQuestion: string;
  }>;
}> {
  const protocol = await resolveWorkerProtocol(control);

  if (protocol === "raw_gemini_proxy") {
    const isAr = payload.language !== "en";
    const parsed = await postRawGeminiJson<{
      steps: Array<{
        stepNumber: number;
        title: string;
        simpleSentence: string;
        visualCue: string;
        checkQuestion: string;
      }>;
    }>(
      {
        parts: [
          {
            text: `${
              isAr ? "اكتب الخطوات بلغة عربية مبسطة وواضحة." : "Write simplified steps in English."
            }
Simplify this lesson text from "${payload.lessonTitle}" into 4 easy steps tailored for student level "${
              payload.studentLevel || "intermediate"
            }":
${payload.text.slice(0, 6000)}
Return strictly JSON: { "steps": [{ "stepNumber": number, "title": string, "simpleSentence": string, "visualCue": string, "checkQuestion": string }] }.`,
          },
        ],
      },
      control
    );
    assertNonEmpty(parsed?.steps?.length, "لم يُرجع الخادم خطوات التبسيط.", control);
    return parsed;
  }

  const { data } = await postJson<{
    steps: Array<{
      stepNumber: number;
      title: string;
      simpleSentence: string;
      visualCue: string;
      checkQuestion: string;
    }>;
  }>("/api/simplify", payload, control);
  assertNonEmpty(
    Array.isArray(data?.steps) && data.steps.length > 0,
    "لم يُرجع الخادم خطوات التبسيط.",
    control
  );
  return data;
}

export async function transcribeMediaAudio(
  payload: {
    audioBase64: string;
    mimeType: string;
    mode: "transcribe" | "captions" | "video_captions";
    language: string;
  },
  control?: AiCallControl
): Promise<{
  transcript?: string;
  captions?: string[];
  timedCaptions?: Array<{ startSec: number; endSec: number; text: string }>;
  vtt?: string;
}> {
  const protocol = await resolveWorkerProtocol(control);

  if (protocol === "raw_gemini_proxy") {
    const parsed = await postRawGeminiJson<{
      transcript?: string;
      captions?: string[];
      timedCaptions?: Array<{ startSec: number; endSec: number; text: string }>;
      vtt?: string;
    }>(
      {
        parts: [
          { inlineData: { mimeType: payload.mimeType || "audio/webm", data: payload.audioBase64 } },
          {
            text: `Transcribe this educational audio accurately (language: ${payload.language}). Return strictly JSON: { "transcript": string, "captions": string[], "timedCaptions": [{ "startSec": number, "endSec": number, "text": string }], "vtt": string }.`,
          },
        ],
      },
      { ...control, timeoutMs: control?.timeoutMs ?? 60000 }
    );
    assertNonEmpty(
      parsed?.transcript?.trim() || parsed?.captions?.length,
      "لم يتم استلام نص تفريغ صوتي.",
      control
    );
    return parsed;
  }

  const { data } = await postJson<{
    transcript?: string;
    captions?: string[];
    timedCaptions?: Array<{ startSec: number; endSec: number; text: string }>;
    vtt?: string;
  }>("/api/stt", payload, { ...control, timeoutMs: control?.timeoutMs ?? 60000 });
  assertNonEmpty(
    data?.transcript?.trim() || (Array.isArray(data?.captions) && data.captions.length > 0),
    "لم يتم استلام نص تفريغ صوتي.",
    control
  );
  return data;
}

export async function extractLessonFromFile(
  payload: {
    fileName: string;
    mimeType: string;
    fileBase64?: string;
    uploadId?: string;
    subjectName: string;
    gradeLevel: string;
    prepTemplateId?: string;
    prepTemplate?: PreparationTemplate | null;
  },
  control?: AiCallControl
): Promise<{
  title?: string;
  summary?: string;
  simplifiedSummary?: string;
  content?: string;
  category?: string;
  extractedAnalysis?: LessonData["extractedAnalysis"];
  message?: string;
}> {
  const protocol = await resolveWorkerProtocol(control);

  if (protocol === "raw_gemini_proxy") {
    assertNonEmpty(payload.fileBase64, "يتطلب استخلاص الملفات بالوضع السحابي إرسال الملف مرفقاً.", control);
    const parsed = await postRawGeminiJson<{
      title?: string;
      summary?: string;
      simplifiedSummary?: string;
      content?: string;
      category?: string;
      extractedAnalysis?: LessonData["extractedAnalysis"];
    }>(
      {
        parts: [
          {
            inlineData: {
              mimeType: payload.mimeType || "application/pdf",
              data: payload.fileBase64,
            },
          },
          {
            text: `Extract and analyze this "${payload.subjectName}" (${payload.gradeLevel}) lesson file "${payload.fileName}".
Return strictly JSON: { "title": string, "summary": string, "simplifiedSummary": string, "content": string, "category": string, "extractedAnalysis": { "lessonTitle": string, "objectives": string[], "keyConcepts": string[], "definitions": string[], "scientificLaws": string[], "examples": string[], "activities": string[], "assessmentQuestions": string[] } }.`,
          },
        ],
      },
      { ...control, timeoutMs: control?.timeoutMs ?? 90000 }
    );
    assertNonEmpty(
      parsed?.title || parsed?.content || parsed?.summary,
      "لم يتم استخراج محتوى درس صالح من الملف.",
      control
    );
    return parsed;
  }

  const { data } = await postJson<{
    title?: string;
    summary?: string;
    simplifiedSummary?: string;
    content?: string;
    category?: string;
    extractedAnalysis?: LessonData["extractedAnalysis"];
    message?: string;
  }>("/api/extract-lesson", payload, { ...control, timeoutMs: control?.timeoutMs ?? 90000 });
  assertNonEmpty(
    data?.title || data?.content || data?.summary,
    data?.message || "لم يتم استخراج محتوى درس صالح من الملف.",
    control
  );
  return data;
}

export async function extractPrepTemplate(
  payload: {
    fileName: string;
    mimeType: string;
    fileBase64: string;
    subjectScope: string;
    templateName: string;
    customInstructions: string;
  },
  control?: AiCallControl
): Promise<{ template?: PreparationTemplate; message?: string }> {
  const protocol = await resolveWorkerProtocol(control);

  if (protocol === "raw_gemini_proxy") {
    const parsed = await postRawGeminiJson<{
      templateName: string;
      detectedFormatSummary: string;
      requiredSections: string[];
      formattingGuidelines: string;
    }>(
      {
        parts: [
          {
            inlineData: {
              mimeType: payload.mimeType || "application/pdf",
              data: payload.fileBase64,
            },
          },
          {
            text: `Extract preparation form structure from "${payload.fileName}" (scope: ${payload.subjectScope}, desired name: ${payload.templateName}, notes: ${payload.customInstructions}).
Return strictly JSON: { "templateName": string, "detectedFormatSummary": string, "requiredSections": string[], "formattingGuidelines": string }.`,
          },
        ],
      },
      { ...control, timeoutMs: control?.timeoutMs ?? 75000 }
    );
    assertNonEmpty(parsed?.requiredSections?.length, "لم يتم استخلاص بنود الفورمة بنجاح.", control);
    return {
      template: {
        id: `tpl-${Date.now().toString(36)}`,
        templateName: payload.templateName || parsed.templateName || payload.fileName,
        subjectScope: (payload.subjectScope as PreparationTemplate["subjectScope"]) || "all",
        sourceFileName: payload.fileName,
        institutionOrSchool: "",
        requiredSections: parsed.requiredSections,
        rawStructureText: parsed.detectedFormatSummary || "",
        presentationMappingGuidelines: parsed.formattingGuidelines || "",
        customInstructions: payload.customInstructions || "",
        updatedAt: new Date().toISOString(),
      },
    };
  }

  const { data } = await postJson<{ template?: PreparationTemplate; message?: string }>(
    "/api/prep-templates/extract",
    payload,
    { ...control, timeoutMs: control?.timeoutMs ?? 75000 }
  );
  assertNonEmpty(
    data?.template,
    data?.message || "لم يُرجع الخادم بنية فورمة التحضير.",
    control
  );
  return data;
}

export async function analyzeBookIndex(
  bookId: string,
  language: UILanguage,
  control?: AiCallControl
): Promise<{ book?: BookRecord; message?: string }> {
  const { data } = await postJson<{ book?: BookRecord; message?: string }>(
    `/api/books/${encodeURIComponent(bookId)}/analyze`,
    { language },
    { ...control, timeoutMs: control?.timeoutMs ?? 90000 }
  );
  assertNonEmpty(data?.book, data?.message || "لم يُرجع الخادم فهرس الكتاب.", control);
  return data;
}

export async function extractBookLesson(
  bookId: string,
  payload: {
    unitId: string;
    chapterId: string;
    lessonEntryId: string;
    lessonTitle: string;
    startPage: number;
    endPage: number;
    language: UILanguage;
  },
  control?: AiCallControl
): Promise<{
  extracted?: {
    summary?: string;
    objectives?: string[];
    keyConcepts?: string[];
    fullLessonText?: string;
  };
  message?: string;
}> {
  const { data } = await postJson<{
    extracted?: {
      summary?: string;
      objectives?: string[];
      keyConcepts?: string[];
      fullLessonText?: string;
    };
    message?: string;
  }>(`/api/books/${encodeURIComponent(bookId)}/extract-lesson`, payload, {
    ...control,
    timeoutMs: control?.timeoutMs ?? 90000,
  });
  assertNonEmpty(
    data?.extracted,
    data?.message || "لم يتم استخلاص محتوى الدرس من الكتاب.",
    control
  );
  return data;
}

// ============================================================================
// Understanding Radar AI Endpoints
// ============================================================================

export async function extractRadarSource(
  payload: {
    fileName: string;
    mimeType: string;
    fileBase64: string;
    subjectName: string;
    gradeLevel: string;
  },
  control?: AiCallControl
): Promise<{
  topicTitle?: string;
  extractedText?: string;
  keyConcepts?: string[];
  objectives?: string[];
}> {
  const protocol = await resolveWorkerProtocol(control);

  if (protocol === "raw_gemini_proxy") {
    const parsed = await postRawGeminiJson<{
      topicTitle?: string;
      extractedText?: string;
      keyConcepts?: string[];
      objectives?: string[];
    }>(
      {
        parts: [
          {
            inlineData: {
              mimeType: payload.mimeType || "application/pdf",
              data: payload.fileBase64,
            },
          },
          {
            text: `Extract lesson content from "${payload.fileName}" (${payload.subjectName}, ${payload.gradeLevel}) for diagnostic Understanding Radar questions.
Return strictly JSON: { "topicTitle": string, "extractedText": string, "keyConcepts": string[], "objectives": string[] }.`,
          },
        ],
      },
      { ...control, timeoutMs: control?.timeoutMs ?? 75000 }
    );
    assertNonEmpty(parsed?.extractedText || parsed?.topicTitle, "لم يُرجع استخلاصاً صالحاً للرادار.", control);
    return parsed;
  }

  const { data } = await postJson<{
    topicTitle?: string;
    extractedText?: string;
    keyConcepts?: string[];
    objectives?: string[];
  }>("/api/radar/extract-source", payload, { ...control, timeoutMs: control?.timeoutMs ?? 75000 });
  assertNonEmpty(
    data?.extractedText || data?.topicTitle,
    "لم يُرجع الخادم نصاً مستخلصاً لرادار الفهم.",
    control
  );
  return data;
}

export async function generateRadarQuestions(
  payload: {
    subjectName: string;
    gradeLevel: string;
    lessonTopic: string;
    lessonContent: string;
    questionCount: number;
    questionTypes: RadarQuestionType[];
    difficulty: RadarDifficulty;
    language: UILanguage;
  },
  control?: AiCallControl
): Promise<{ questions?: RadarQuestion[] }> {
  const protocol = await resolveWorkerProtocol(control);

  if (protocol === "raw_gemini_proxy") {
    const isAr = payload.language === "ar";
    const parsed = await postRawGeminiJson<{ questions?: RadarQuestion[] }>(
      {
        parts: [
          {
            text: `${
              isAr ? "اكتب الأسئلة والمفاهيم والتلميحات باللغة العربية." : "Write in English."
            }
Generate ${payload.questionCount || 4} diagnostic Understanding Radar questions for "${payload.lessonTopic}" (${
              payload.subjectName
            }, ${payload.gradeLevel}), difficulty=${payload.difficulty}, types=${payload.questionTypes.join(",")}.
Content:\n${payload.lessonContent.slice(0, 8000)}
Return strictly JSON: { "questions": [{ "id": string, "questionType": "mcq"|"true_false"|"concept_check"|"short_answer", "cognitiveLevel": "understanding"|"application"|"analysis", "difficulty": "easy"|"medium"|"hard", "concept": string, "objective": string, "misconceptionTarget": string, "question": string, "options": string[], "correctIndex": number, "expectedShortAnswer"?: string, "timeLimitSec": number, "explanation": string, "hint": string }] }.`,
          },
        ],
      },
      { ...control, timeoutMs: control?.timeoutMs ?? 60000 }
    );
    assertNonEmpty(parsed?.questions?.length, "لم يُرجع رادار الفهم أسئلة تشخيصية.", control);
    return parsed;
  }

  const { data } = await postJson<{ questions?: RadarQuestion[] }>(
    "/api/radar/generate-questions",
    payload,
    { ...control, timeoutMs: control?.timeoutMs ?? 60000 }
  );
  assertNonEmpty(
    Array.isArray(data?.questions) && data.questions.length > 0,
    "لم يُرجع الخادم أسئلة تشخيصية لرادار الفهم.",
    control
  );
  return data;
}

export async function requestRadarIntervention(
  payload: {
    subjectName: string;
    gradeLevel: string;
    lessonTopic: string;
    concept: string;
    currentAccuracyPct: number;
    misconceptions: unknown[];
    questionContext: RadarQuestion | null;
    wrongShortAnswers: string[];
    language: UILanguage;
  },
  control?: AiCallControl
): Promise<{
  diagnosisSummary?: string;
  strategies?: RadarInterventionStrategy[];
  verificationQuestion: RadarQuestion;
}> {
  const protocol = await resolveWorkerProtocol(control);

  if (protocol === "raw_gemini_proxy") {
    const parsed = await postRawGeminiJson<{
      diagnosisSummary?: string;
      strategies?: RadarInterventionStrategy[];
      verificationQuestion: RadarQuestion;
    }>(
      {
        parts: [
          {
            text: `Diagnose misunderstanding of "${payload.concept}" (${payload.lessonTopic}, ${
              payload.subjectName
            }), accuracy=${payload.currentAccuracyPct}%, misconceptions=${JSON.stringify(
              payload.misconceptions
            ).slice(0, 2000)} in language "${payload.language}".
Return strictly JSON: { "diagnosisSummary": string, "strategies": [{ "id": string, "strategyType": string, "title": string, "teacherScript": string, "studentFacingExplanation": string, "practicalExample": string, "estimatedMinutes": number }], "verificationQuestion": { "concept": string, "question": string, "options": string[], "correctIndex": number, "timeLimitSec": number, "explanation": string, "hint": string, "misconceptionTarget": string } }.`,
          },
        ],
      },
      control
    );
    assertNonEmpty(
      parsed?.diagnosisSummary && parsed?.strategies?.length,
      "لم يُرجع محرك التدخل العلاجي خطة معالجة صالحة.",
      control
    );
    return parsed;
  }

  const { data } = await postJson<{
    diagnosisSummary?: string;
    strategies?: RadarInterventionStrategy[];
    verificationQuestion: RadarQuestion;
  }>("/api/radar/intervene", payload, control);
  assertNonEmpty(
    data?.diagnosisSummary || (Array.isArray(data?.strategies) && data.strategies.length > 0),
    "لم يُرجع الخادم خطة التدخل العلاجي.",
    control
  );
  return data;
}

export async function askRadarTutor(
  payload: {
    userRole: UserRole;
    subjectName: string;
    gradeLevel: string;
    lessonTopic: string;
    lessonContent: string;
    activeQuestion: RadarQuestion | null;
    sessionStatus: string;
    mode: "ask" | "hint" | "simplify" | "explain_error";
    userMessage: string;
    history: Array<{ sender: "user" | "assistant"; text: string }>;
    language: UILanguage;
  },
  control?: AiCallControl
): Promise<{
  reply?: string;
  simplifiedAnalogy?: string;
  scaffoldedHint?: string;
  followUpPrompts?: string[];
}> {
  const protocol = await resolveWorkerProtocol(control);

  if (protocol === "raw_gemini_proxy") {
    const parsed = await postRawGeminiJson<{
      reply?: string;
      simplifiedAnalogy?: string;
      scaffoldedHint?: string;
      followUpPrompts?: string[];
    }>(
      {
        parts: [
          {
            text: `You are Understanding Radar Tutor (${payload.subjectName}, lesson "${payload.lessonTopic}", role=${payload.userRole}, mode=${payload.mode}, lang=${payload.language}). User message: ${payload.userMessage}
Return strictly JSON: { "reply": string, "simplifiedAnalogy": string, "scaffoldedHint": string, "followUpPrompts": string[] }.`,
          },
        ],
      },
      control
    );
    assertNonEmpty(parsed?.reply?.trim(), "لم يرد معلم الرادار الذكي.", control);
    return parsed;
  }

  const { data } = await postJson<{
    reply?: string;
    simplifiedAnalogy?: string;
    scaffoldedHint?: string;
    followUpPrompts?: string[];
  }>("/api/radar/tutor", payload, control);
  assertNonEmpty(data?.reply?.trim(), "لم يرد معلم الرادار الذكي.", control);
  return data;
}

// ============================================================================
// Platform Data / Persistence Helpers (routed safely through apiClient)
// ============================================================================

export async function fetchLessonArtifacts(
  lessonId: string
): Promise<Array<{ artifactType: string; data: unknown }>> {
  const { data } = await safeFetchJson<{ artifacts?: Array<{ artifactType: string; data: unknown }> }>(
    `/api/artifacts?lessonId=${encodeURIComponent(lessonId)}`
  );
  return Array.isArray(data.artifacts) ? data.artifacts : [];
}

export async function saveLessonArtifact(payload: {
  lessonId: string;
  artifactType: "lesson_plan" | "presentation" | "video_project" | "worksheet" | "kahoot_quiz";
  title: string;
  data: unknown;
}): Promise<void> {
  await postJson("/api/artifacts", payload);
}

export async function fetchQuizReports(): Promise<QuizSessionReport[]> {
  const { data } = await safeFetchJson<{ reports?: QuizSessionReport[] }>("/api/quiz-reports");
  return Array.isArray(data.reports) ? data.reports : [];
}

export async function fetchBooks(): Promise<BookRecord[]> {
  const { data } = await safeFetchJson<{ books?: BookRecord[] }>("/api/books");
  return Array.isArray(data.books) ? data.books : [];
}

export async function saveBook(payload: Record<string, unknown>): Promise<{ book?: BookRecord; message?: string }> {
  const { data } = await postJson<{ book?: BookRecord; message?: string }>("/api/books", payload);
  return data;
}

export async function deleteBook(bookId: string): Promise<void> {
  await safeFetchJson(`/api/books/${encodeURIComponent(bookId)}`, { method: "DELETE" });
}

export async function updatePrepTemplate(
  templateId: string,
  payload: Record<string, unknown>
): Promise<{ template?: PreparationTemplate; message?: string }> {
  const { data } = await safeFetchJson<{ template?: PreparationTemplate; message?: string }>(
    `/api/prep-templates/${encodeURIComponent(templateId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  return data;
}

export async function deletePrepTemplate(templateId: string): Promise<void> {
  await safeFetchJson(`/api/prep-templates/${encodeURIComponent(templateId)}`, {
    method: "DELETE",
  });
}

export async function fetchRadarSessions(): Promise<RadarSavedReport[]> {
  const { data } = await safeFetchJson<{ sessions?: RadarSavedReport[] }>("/api/radar/sessions");
  return Array.isArray(data.sessions) ? data.sessions : [];
}

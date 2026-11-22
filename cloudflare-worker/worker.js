/**
 * Smart Science AI — Cloudflare Worker Unified AI Gateway
 * Deploy to: https://smart-science-ai-server.amjadsaal906.workers.dev
 *
 * Required Secret (via Cloudflare Dashboard or `npx wrangler secret put GEMINI_API_KEY`):
 *   GEMINI_API_KEY = <Your Google AI Studio API Key>
 */

const CHAT_MODELS = ["gemini-4-hydrogen", "gemini-3.1-flash-lite", "gemini-3.8-flash"];
const TTS_MODEL = "gemini-3.8-flash-lite-tts";
const STT_MODEL = "gemini-3.5-transcribe";

const ALLOWED_ORIGINS = [
  "https://smart-science-ai.web.app",
  "https://smart-science-ai.firebaseapp.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
];

function getCorsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : "*";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function jsonResponse(request, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...getCorsHeaders(request),
    },
  });
}

function errorResponse(request, status, error, message) {
  return jsonResponse(request, { error, message }, status);
}

function getApiKey(env) {
  const raw = String(env?.GEMINI_API_KEY || "").trim();
  if (!raw || raw === "MY_GEMINI_API_KEY") return "";
  return raw;
}

function stripJsonFences(raw) {
  const cleaned = String(raw || "{}")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const firstObj = cleaned.indexOf("{");
  const firstArr = cleaned.indexOf("[");
  if (firstArr !== -1 && (firstObj === -1 || firstArr < firstObj)) {
    const lastArr = cleaned.lastIndexOf("]");
    if (lastArr > firstArr) return cleaned.slice(firstArr, lastArr + 1);
  }
  if (firstObj !== -1) {
    const lastObj = cleaned.lastIndexOf("}");
    if (lastObj > firstObj) return cleaned.slice(firstObj, lastObj + 1);
  }
  return cleaned;
}

function translateGeminiHttpError(status, rawBody) {
  const lower = String(rawBody || "").toLowerCase();
  if (
    status === 401 ||
    lower.includes("unauthenticated") ||
    lower.includes("api key not valid") ||
    lower.includes("api_key_invalid")
  ) {
    return {
      status: 401,
      code: "GEMINI_AUTH_ERROR",
      message: "مفتاح GEMINI_API_KEY غير صالح أو غير متوافق مع Gemini API (401).",
    };
  }
  if (status === 403 || lower.includes("permission_denied")) {
    return {
      status: 403,
      code: "GEMINI_AUTH_ERROR",
      message: "تعذر التحقق من صلاحية GEMINI_API_KEY (403).",
    };
  }
  if (status === 429 || lower.includes("resource_exhausted")) {
    return {
      status: 429,
      code: "GEMINI_QUOTA_ERROR",
      message: "تم تجاوز حد الطلبات المؤقت (429). يرجى المحاولة بعد لحظات.",
    };
  }
  if (status === 404 || lower.includes("not_found")) {
    return {
      status: 404,
      code: "GEMINI_MODEL_NOT_FOUND",
      message: "نموذج Gemini المطلوب غير متاح حالياً (404).",
    };
  }
  if (status === 503 || lower.includes("unavailable")) {
    return {
      status: 503,
      code: "GEMINI_UNAVAILABLE",
      message: "خدمة Gemini مشغولة مؤقتاً (503). يرجى إعادة المحاولة.",
    };
  }
  return {
    status: status >= 400 && status < 600 ? status : 500,
    code: "GEMINI_API_ERROR",
    message: `خطأ من Gemini API (${status}): ${String(rawBody).slice(0, 240)}`,
  };
}

/**
 * Centralized Gemini REST Gateway with model fallback & retries.
 * Never returns fake or mock data when upstream fails.
 */
async function callGemini(env, payload, options = {}) {
  const apiKey = getApiKey(env);
  if (!apiKey) {
    const err = new Error("GEMINI_NOT_CONFIGURED");
    err.status = 503;
    err.code = "GEMINI_NOT_CONFIGURED";
    err.userMessage = "مفتاح GEMINI_API_KEY غير مُعدّ في Cloudflare Worker Secrets.";
    throw err;
  }

  const models = options.models || CHAT_MODELS;
  let lastError = null;

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        model
      )}:generateContent?key=${encodeURIComponent(apiKey)}`;

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const rawText = await res.text();
      if (res.ok) {
        let apiJson;
        try {
          apiJson = JSON.parse(rawText);
        } catch {
          const e = new Error("INVALID_UPSTREAM_JSON");
          e.status = 502;
          e.code = "INVALID_AI_JSON";
          e.userMessage = "أعاد خادم Gemini استجابة غير صالحة.";
          throw e;
        }
        const parts = apiJson?.candidates?.[0]?.content?.parts || [];
        const textOutput = parts.map((p) => p.text || "").join("").trim();
        const audioData = parts.find((p) => p.inlineData?.data)?.inlineData?.data || null;
        return { textOutput, audioData, model, apiJson };
      }

      const translated = translateGeminiHttpError(res.status, rawText);
      const err = new Error(translated.message);
      err.status = translated.status;
      err.code = translated.code;
      err.userMessage = translated.message;
      lastError = err;

      // Do not retry auth or bad request errors
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        throw err;
      }
      // Switch to next model on 404
      if (res.status === 404) {
        break;
      }
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 400));
      }
    }
  }

  throw lastError || new Error("Gemini request failed.");
}

async function callGeminiJson(env, payload) {
  const { textOutput } = await callGemini(env, payload);
  const sliced = stripJsonFences(textOutput);
  try {
    return JSON.parse(sliced || "{}");
  } catch {
    const err = new Error("INVALID_AI_JSON");
    err.status = 502;
    err.code = "INVALID_AI_JSON";
    err.userMessage = "أعاد نموذج الذكاء الاصطناعي بيانات JSON غير مكتملة أو غير صالحة.";
    throw err;
  }
}

function buildSourcesText(sources) {
  const active = Array.isArray(sources) ? sources.filter((s) => s && s.enabled !== false) : [];
  if (active.length === 0) return "لا توجد مصادر مفعّلة حالياً.";
  return active
    .map((s, idx) => `[مصدر ${idx + 1}: ${s.title || "مصدر"} (${s.category || ""})]\n${s.content || ""}`)
    .join("\n\n");
}

function cleanBase64Image(rawImageStr, rawMime) {
  const trimmed = String(rawImageStr || "").trim();
  const match = trimmed.match(/^data:([^;]+);base64,(.*)$/s);
  const data = (match ? match[2] : trimmed).replace(/\s+/g, "").trim();
  const mime = (match ? match[1] : String(rawMime || "image/jpeg")).toLowerCase();
  return {
    data,
    mimeType: mime === "image/jpg" ? "image/jpeg" : mime || "image/jpeg",
  };
}

function sanitizeJsonContent(rawText) {
  return String(rawText || "").slice(0, 14000);
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: getCorsHeaders(request) });
    }

    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";

    try {
      // 1. Capabilities check
      if (request.method === "GET" && (pathname === "/" || pathname === "/api/capabilities")) {
        const hasKey = Boolean(getApiKey(env));
        return jsonResponse(request, {
          status: "ready",
          worker: "smart-science-ai-server",
          geminiConfigured: hasKey,
          databaseEngine: "Cloudflare Stateless Gateway + Client Storage",
          realtimeEngine: "Client/Optional WS",
          models: {
            chatAndVision: CHAT_MODELS[0],
            fallbackModel: CHAT_MODELS[1],
            tts: TTS_MODEL,
            stt: STT_MODEL,
            veoVideo: "gemini-omni-1.2-flash",
          },
          signLanguageExternalService: {
            configured: false,
            providerName: null,
            statusMessage: "يتوفر قاموس لغة الإشارة العلمي المحلي والتهجئة الإشارية.",
            requiredEnvVars: ["SIGN_LANGUAGE_API_URL", "SIGN_LANGUAGE_API_KEY"],
          },
        });
      }

      // 2. Daily Science Fact (GET)
      if (request.method === "GET" && pathname === "/api/daily-fact") {
        const lang = url.searchParams.get("lang") === "en" ? "en" : "ar";
        const dateKey = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
        const prompt =
          lang === "en"
            ? `Generate one surprising, scientifically accurate Daily Science Fact for ${dateKey}.`
            : `ولّد حقيقة علمية يومية مدهشة ودقيقة علمياً لتاريخ ${dateKey} بلغة عربية فصيحة وسلسة.`;

        const parsed = await callGeminiJson(env, {
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                discipline: { type: "STRING" },
                headline: { type: "STRING" },
                fact: { type: "STRING" },
                whyItMatters: { type: "STRING" },
                quickPrompt: { type: "STRING" },
              },
              required: ["discipline", "headline", "fact", "whyItMatters", "quickPrompt"],
            },
          },
        });
        return jsonResponse(request, { fact: { date: dateKey, lang, ...parsed, cached: false } });
      }

      // Stateless collection GET/POST/DELETE safe fallbacks for edge mode
      if (request.method === "GET" && pathname === "/api/lessons") return jsonResponse(request, { lessons: [] });
      if (request.method === "GET" && pathname === "/api/artifacts") return jsonResponse(request, { artifacts: [] });
      if (request.method === "GET" && pathname === "/api/books") return jsonResponse(request, { books: [] });
      if (request.method === "GET" && pathname === "/api/prep-templates") return jsonResponse(request, { templates: [] });
      if (request.method === "GET" && pathname === "/api/quiz-reports") return jsonResponse(request, { reports: [] });
      if (request.method === "GET" && pathname === "/api/radar/sessions") return jsonResponse(request, { sessions: [] });

      if (request.method !== "POST") {
        return errorResponse(request, 404, "ROUTE_NOT_FOUND", `المسار (${pathname}) غير متاح.`);
      }

      const body = await request.json().catch(() => null);
      if (!body || typeof body !== "object") {
        return errorResponse(request, 400, "INVALID_REQUEST_BODY", "يجب إرسال بيانات JSON صالحة في الطلب.");
      }

      // 3. Smart Educational Chatbot
      if (pathname === "/api/chat") {
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
          language = "auto",
          weakSpots = [],
        } = body;

        const resolvedMessages =
          Array.isArray(messages) && messages.length > 0
            ? messages
            : String(message || "").trim()
              ? [{ sender: "user", text: String(message).trim() }]
              : [];

        if (resolvedMessages.length === 0) {
          return errorResponse(request, 400, "EMPTY_MESSAGE", "يرجى كتابة سؤال أو رسالة قبل الإرسال.");
        }

        const systemText = `أنت "المساعد العلمي الذكي" (Smart Science AI Tutor).
الدرس: ${lessonTitle} | الملخص: ${lessonSummary}
الدور: ${role} | المستوى: ${studentLevel} | الوضع: ${actionMode} | اللغة: ${language}
سياسة المصادر: ${sourcePolicy}
مواطن الضعف السابقة: ${Array.isArray(weakSpots) ? weakSpots.map((w) => w.concept).join("، ") : "لا توجد"}
مصادر الدرس:\n${buildSourcesText(sources)}`;

        const contents = resolvedMessages.slice(-10).map((m) => ({
          role: m.sender === "assistant" ? "model" : "user",
          parts: [{ text: String(m.text || "") }],
        }));

        const exerciseSchema = {
          type: "OBJECT",
          properties: {
            question: { type: "STRING" },
            options: { type: "ARRAY", items: { type: "STRING" } },
            correctIndex: { type: "INTEGER" },
            hint: { type: "STRING" },
            explanation: { type: "STRING" },
          },
        };

        const parsed = await callGeminiJson(env, {
          systemInstruction: { parts: [{ text: systemText }] },
          contents,
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                reply: { type: "STRING" },
                outOfScopeNotice: { type: "STRING" },
                alternativeExplanation: { type: "STRING" },
                citations: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      sourceTitle: { type: "STRING" },
                      excerptUsed: { type: "STRING" },
                      withinApprovedSources: { type: "BOOLEAN" },
                    },
                  },
                },
                detectedWeakSpots: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      concept: { type: "STRING" },
                      observation: { type: "STRING" },
                      suggestedRemediation: { type: "STRING" },
                    },
                  },
                },
                quickExercise: exerciseSchema,
                remedialQuestions: { type: "ARRAY", items: exerciseSchema },
                followUpSuggestions: { type: "ARRAY", items: { type: "STRING" } },
              },
              required: ["reply", "citations", "detectedWeakSpots", "followUpSuggestions"],
            },
          },
        });
        return jsonResponse(request, parsed);
      }

      // 4. Discover World Object (Camera / Vision)
      if (pathname === "/api/discover-object") {
        const { imageBase64 = "", mimeType = "image/jpeg", question = "", language = "ar", studentLevel = "intermediate" } = body;
        const img = cleanBase64Image(imageBase64, mimeType);
        if (!img.data) {
          return errorResponse(request, 400, "MISSING_IMAGE", "يرجى التقاط صورة أو رفع صورة للتحليل.");
        }

        const prompt =
          language === "en"
            ? `Examine this photo carefully—whether food/snack packaging (like potato chips), plant, rock, household object, device, or organism. Identify the exact item and explain the real science behind it for level "${studentLevel}". ${question ? `Student question: "${question}"` : ""}`
            : `افحص الصورة بدقة وتعرّف على العنصر الظاهر (سواء طعام/منتج مغلف مثل شيبس، نبات، صخر، أداة منزلية، جهاز). سمِّ الشيء بدقة واشرح العلوم المرتبطة به لمستوى "${studentLevel}". ${question ? `سؤال الطالب: "${question}"` : ""}`;

        const parsed = await callGeminiJson(env, {
          contents: [
            {
              role: "user",
              parts: [{ inlineData: { mimeType: img.mimeType, data: img.data } }, { text: prompt }],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                objectName: { type: "STRING" },
                discipline: { type: "STRING" },
                summary: { type: "STRING" },
                scientificExplanation: { type: "STRING" },
                keyFacts: { type: "ARRAY", items: { type: "STRING" } },
                relatedConcepts: { type: "ARRAY", items: { type: "STRING" } },
                experimentIdea: { type: "STRING" },
                funQuestion: { type: "STRING" },
                funAnswer: { type: "STRING" },
              },
              required: ["objectName", "discipline", "summary", "scientificExplanation", "keyFacts", "relatedConcepts", "experimentIdea", "funQuestion", "funAnswer"],
            },
          },
        });
        return jsonResponse(request, parsed);
      }

      // 5. Generate Lesson Plan
      if (pathname === "/api/generate/lesson-plan") {
        const {
          lesson,
          language = "ar",
          sourcePolicy = "lesson_only",
          prepTemplate = null,
          teacherInputs = null,
          attachedNotes = "",
          attachedFiles = [],
        } = body;

        if (!lesson || !String(lesson.title || "").trim()) {
          return errorResponse(request, 400, "MISSING_LESSON", "يرجى اختيار درس أو إدخال عنوان الدرس قبل التوليد.");
        }

        const parts = [];
        const fileTexts = [];
        if (Array.isArray(attachedFiles)) {
          for (const f of attachedFiles.slice(0, 4)) {
            if (!f) continue;
            if (f.textContent) {
              fileTexts.push(`[${f.fileName || "attachment"}]\n${sanitizeJsonContent(f.textContent)}`);
            } else if (f.fileBase64) {
              const cleaned = cleanBase64Image(f.fileBase64, f.mimeType || "application/pdf");
              if (cleaned.mimeType.startsWith("text/")) {
                try {
                  fileTexts.push(`[${f.fileName || "attachment"}]\n${atob(cleaned.data).slice(0, 10000)}`);
                } catch {
                  // Ignore non-ascii raw atob edge
                }
              } else {
                parts.push({ inlineData: { mimeType: cleaned.mimeType, data: cleaned.data } });
              }
            }
          }
        }

        const tplBlock = prepTemplate
          ? `\nفورمة التحضير المعتمدة (${prepTemplate.templateName}):\nالبنود: ${(prepTemplate.requiredSections || []).join(" | ")}\n${String(prepTemplate.rawStructureText || "").slice(0, 4000)}`
          : "";
        const duration = Number(teacherInputs?.durationMinutes) || Number(lesson.estimatedMinutes) || 45;
        const promptText = `أعد تحضير درس احترافي متكامل لمادة "${lesson.subject || "العلوم"}" (${lesson.gradeLevel || ""}) بعنوان "${lesson.title}" بمدة ${duration} دقيقة.
سياسة المصادر: ${sourcePolicy}. اللغة المطلوبة: ${language === "en" ? "English" : "العربية الفصحى"}.
ملخص الدرس: ${lesson.summary || ""}
مدخلات المعلم: ${JSON.stringify(teacherInputs || {})}
ملاحظات إضافية: ${String(attachedNotes || "").slice(0, 8000)}
المصادر المعتمدة:\n${buildSourcesText(lesson.sources)}
${fileTexts.join("\n\n")}
${tplBlock}`;

        parts.push({ text: promptText });

        const parsed = await callGeminiJson(env, {
          contents: [{ role: "user", parts }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                lessonTitle: { type: "STRING" },
                subject: { type: "STRING" },
                stage: { type: "STRING" },
                gradeLevel: { type: "STRING" },
                durationMinutes: { type: "INTEGER" },
                templateNameUsed: { type: "STRING" },
                objectives: { type: "ARRAY", items: { type: "STRING" } },
                warmUp: { type: "STRING" },
                teachingStrategies: { type: "ARRAY", items: { type: "STRING" } },
                learningActivities: { type: "ARRAY", items: { type: "STRING" } },
                resourcesAndMedia: { type: "ARRAY", items: { type: "STRING" } },
                assessment: { type: "STRING" },
                homework: { type: "STRING" },
                differentiationAndInclusion: { type: "STRING" },
                customFormFields: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: { sectionName: { type: "STRING" }, content: { type: "STRING" } },
                    required: ["sectionName", "content"],
                  },
                },
              },
              required: [
                "lessonTitle", "subject", "stage", "gradeLevel", "durationMinutes",
                "objectives", "warmUp", "teachingStrategies", "learningActivities",
                "resourcesAndMedia", "assessment", "homework", "differentiationAndInclusion", "customFormFields"
              ],
            },
          },
        });
        return jsonResponse(request, { lessonPlan: parsed, source: "gemini-ai" });
      }

      // 6. Generate PowerPoint Deck (handles /api/generate/powerpoint, /api/generate/presentation, /api/presentation/auto-pptx)
      if (
        pathname === "/api/generate/powerpoint" ||
        pathname === "/api/generate/presentation" ||
        pathname === "/api/presentation/auto-pptx"
      ) {
        const { lesson, slideCount = 8, language = "ar", prepTemplate = null, lessonPlan = null } = body;
        if (!lesson || !String(lesson.title || "").trim()) {
          return errorResponse(request, 400, "MISSING_LESSON", "يرجى اختيار درس أو إدخال عنوان الدرس قبل توليد العرض.");
        }
        const safeCount = Math.max(6, Math.min(14, Number(slideCount) || 8));
        const prompt = `صمّم عرضاً تقديمياً تعليمياً احترافياً من ${safeCount} شرائح لدرس "${lesson.title}" (${lesson.subject || "العلوم"} - ${lesson.gradeLevel || ""}).
اللغة: ${language === "en" ? "English" : "العربية الفصحى"}.
المصادر:\n${buildSourcesText(lesson.sources)}
${prepTemplate ? `\nالقالب المعتمد (${prepTemplate.templateName}): ${(prepTemplate.requiredSections || []).join(" | ")}` : ""}
${lessonPlan ? `\nالتحضير:\n${JSON.stringify(lessonPlan).slice(0, 3500)}` : ""}
شمل العناصر كاملة: العنوان (title)، المقدمة والتمهيد (concept)، الأهداف (objectives)، المحتوى العلمي ورسم توضيحي (concept/diagram)، الأنشطة (example)، التقويم التفاعلي (interactive_quiz)، والخاتمة والملخص (summary).`;

        const deck = await callGeminiJson(env, {
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                deckTitle: { type: "STRING" },
                subject: { type: "STRING" },
                gradeLevel: { type: "STRING" },
                themeAccent: { type: "STRING" },
                templateNameUsed: { type: "STRING" },
                slides: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      slideNumber: { type: "INTEGER" },
                      slideType: { type: "STRING" },
                      title: { type: "STRING" },
                      subtitle: { type: "STRING" },
                      bullets: { type: "ARRAY", items: { type: "STRING" } },
                      speakerNotes: { type: "STRING" },
                      visualNote: { type: "STRING" },
                      quizQuestion: { type: "STRING" },
                      quizOptions: { type: "ARRAY", items: { type: "STRING" } },
                      quizAnswerIndex: { type: "INTEGER" },
                    },
                    required: ["slideNumber", "slideType", "title", "bullets", "speakerNotes"],
                  },
                },
              },
              required: ["deckTitle", "subject", "gradeLevel", "themeAccent", "slides"],
            },
          },
        });
        return jsonResponse(request, {
          deck,
          useClientPptx: pathname === "/api/presentation/auto-pptx",
        });
      }

      // 7. Generate Worksheet
      if (pathname === "/api/generate/worksheet") {
        const { lesson, language = "ar" } = body;
        if (!lesson || !String(lesson.title || "").trim()) {
          return errorResponse(request, 400, "MISSING_LESSON", "يرجى اختيار درس أو إدخال عنوان الدرس قبل توليد ورقة العمل.");
        }
        const prompt = `أعد ورقة عمل شاملة لدرس "${lesson.title}" (${lesson.subject || "العلوم"} - ${lesson.gradeLevel || ""}) بلغة ${language === "en" ? "English" : "العربية الفصحى"} من المصادر:\n${buildSourcesText(lesson.sources)}`;
        const worksheet = await callGeminiJson(env, {
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                worksheetTitle: { type: "STRING" },
                subject: { type: "STRING" },
                gradeLevel: { type: "STRING" },
                studentInstructions: { type: "STRING" },
                variedQuestions: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: { question: { type: "STRING" }, answer: { type: "STRING" } },
                    required: ["question", "answer"],
                  },
                },
                practicalActivity: {
                  type: "OBJECT",
                  properties: {
                    title: { type: "STRING" },
                    steps: { type: "ARRAY", items: { type: "STRING" } },
                    expectedOutcome: { type: "STRING" },
                  },
                  required: ["title", "steps", "expectedOutcome"],
                },
                fillInBlanks: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: { sentence: { type: "STRING" }, missingWord: { type: "STRING" } },
                    required: ["sentence", "missingWord"],
                  },
                },
                matchingPairs: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: { leftItem: { type: "STRING" }, rightMatch: { type: "STRING" } },
                    required: ["leftItem", "rightMatch"],
                  },
                },
                classificationTask: {
                  type: "OBJECT",
                  properties: {
                    prompt: { type: "STRING" },
                    categories: {
                      type: "ARRAY",
                      items: {
                        type: "OBJECT",
                        properties: { categoryName: { type: "STRING" }, items: { type: "ARRAY", items: { type: "STRING" } } },
                        required: ["categoryName", "items"],
                      },
                    },
                  },
                  required: ["prompt", "categories"],
                },
                problemSolving: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: { problem: { type: "STRING" }, solutionSteps: { type: "STRING" }, finalAnswer: { type: "STRING" } },
                    required: ["problem", "solutionSteps", "finalAnswer"],
                  },
                },
                higherOrderThinking: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: { question: { type: "STRING" }, modelAnswer: { type: "STRING" } },
                    required: ["question", "modelAnswer"],
                  },
                },
              },
              required: [
                "worksheetTitle", "subject", "gradeLevel", "studentInstructions",
                "variedQuestions", "practicalActivity", "fillInBlanks",
                "matchingPairs", "classificationTask", "problemSolving", "higherOrderThinking"
              ],
            },
          },
        });
        return jsonResponse(request, { worksheet });
      }

      // 8. Generate Quiz (/api/generate/quiz & /api/generate/kahoot-quiz)
      if (pathname === "/api/generate/quiz" || pathname === "/api/generate/kahoot-quiz") {
        const { lesson, questionCount = 6, language = "ar", mode = "competitive", studentLevel = "intermediate", weakConcepts = [] } = body;
        if (!lesson || !String(lesson.title || "").trim()) {
          return errorResponse(request, 400, "MISSING_LESSON", "يرجى اختيار درس أو إدخال عنوان الدرس قبل توليد الاختبار.");
        }
        const prompt = `أنشئ اختباراً تعليمياً (${mode}) من ${questionCount} أسئلة لدرس "${lesson.title}" لمستوى "${studentLevel}". المفاهيم المستهدفة: ${Array.isArray(weakConcepts) ? weakConcepts.join("، ") : ""}. اللغة: ${language === "en" ? "English" : "العربية"}. المصادر:\n${buildSourcesText(lesson.sources)}`;
        const quiz = await callGeminiJson(env, {
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                quizTitle: { type: "STRING" },
                lessonTitle: { type: "STRING" },
                questions: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      id: { type: "STRING" },
                      questionType: { type: "STRING" },
                      question: { type: "STRING" },
                      options: { type: "ARRAY", items: { type: "STRING" } },
                      correctIndex: { type: "INTEGER" },
                      timeLimitSec: { type: "INTEGER" },
                      points: { type: "INTEGER" },
                      explanation: { type: "STRING" },
                    },
                    required: ["id", "questionType", "question", "options", "correctIndex", "timeLimitSec", "points", "explanation"],
                  },
                },
              },
              required: ["quizTitle", "lessonTitle", "questions"],
            },
          },
        });
        return jsonResponse(request, { quiz });
      }

      // 9. Adaptive Quiz Question
      if (pathname === "/api/adaptive-quiz") {
        const { lessonTitle = "", sources = [], weakConcepts = [], accommodations = [], difficulty = "easy", studentLevel = "intermediate", studentStats = null } = body;
        const sourceText = Array.isArray(sources) ? sources.map((s) => s.content || "").join("\n").trim() : "";
        if (!String(lessonTitle).trim() && !sourceText) {
          return errorResponse(request, 400, "MISSING_ADAPTIVE_CONTEXT", "يرجى تحديد عنوان الدرس أو مصادره لتوليد سؤال تكيفي.");
        }
        const prompt = `صمّم سؤالاً علمياً تكيفياً لدرس "${lessonTitle}" لمستوى الطالب (${studentLevel} / صعوبة ${difficulty}).
أداء الطالب: ${JSON.stringify(studentStats || {})}
مفاهيم الدعم: ${(weakConcepts || []).join("، ") || "الفهم الأساسي"}
التسهيلات: ${(accommodations || []).join("، ") || "قياسي"}
المصادر:\n${sourceText}`;

        const parsed = await callGeminiJson(env, {
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                concept: { type: "STRING" },
                difficulty: { type: "STRING" },
                prompt: { type: "STRING" },
                simplifiedPrompt: { type: "STRING" },
                options: { type: "ARRAY", items: { type: "STRING" } },
                correctIndex: { type: "INTEGER" },
                hint: { type: "STRING" },
                explanation: { type: "STRING" },
                visualCue: { type: "STRING" },
              },
              required: ["concept", "difficulty", "prompt", "simplifiedPrompt", "options", "correctIndex", "hint", "explanation", "visualCue"],
            },
          },
        });
        return jsonResponse(request, { id: `adaptive-${Date.now()}`, ...parsed });
      }

      // 10. Concept Simplification
      if (pathname === "/api/simplify") {
        const { text = "", lessonTitle = "", studentLevel = "beginner", language = "ar" } = body;
        if (!String(text).trim()) {
          return errorResponse(request, 400, "EMPTY_TEXT", "يرجى إدخال نص لتبسيطه.");
        }
        const parsed = await callGeminiJson(env, {
          contents: [{ role: "user", parts: [{ text: `بسّط النص العلمي التالي لمستوى ${studentLevel} في درس "${lessonTitle}" إلى 4-5 خطوات قصيرة مرقمة بلغة ${language === "en" ? "English" : "العربية"}:\n\n${text}` }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                steps: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      stepNumber: { type: "INTEGER" },
                      title: { type: "STRING" },
                      simpleSentence: { type: "STRING" },
                      visualCue: { type: "STRING" },
                      checkQuestion: { type: "STRING" },
                    },
                    required: ["stepNumber", "title", "simpleSentence", "visualCue", "checkQuestion"],
                  },
                },
              },
              required: ["steps"],
            },
          },
        });
        return jsonResponse(request, parsed);
      }

      // 11. Image Spatial Description
      if (pathname === "/api/describe-image") {
        const { imageBase64 = "", mimeType = "image/jpeg", lessonTitle = "" } = body;
        const img = cleanBase64Image(imageBase64, mimeType);
        if (!img.data) {
          return errorResponse(request, 400, "MISSING_IMAGE", "تعذر العثور على بيانات الصورة للوصف.");
        }
        const parsed = await callGeminiJson(env, {
          contents: [
            {
              role: "user",
              parts: [
                { inlineData: { mimeType: img.mimeType, data: img.data } },
                { text: `صف هذه الصورة العلمية المرتبطة بدرس "${lessonTitle}" باللغة العربية وصفاً مكانياً دقيقاً.` },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                shortAlt: { type: "STRING" },
                detailedSpatialDescription: { type: "STRING" },
                scientificComponents: { type: "ARRAY", items: { type: "STRING" } },
                keyTakeaway: { type: "STRING" },
              },
              required: ["shortAlt", "detailedSpatialDescription", "scientificComponents", "keyTakeaway"],
            },
          },
        });
        return jsonResponse(request, parsed);
      }

      // 12. Extract Lesson from Uploaded File
      if (pathname === "/api/extract-lesson") {
        const { fileName = "lesson", mimeType = "application/pdf", fileBase64 = "", subjectName = "العلوم", gradeLevel = "" } = body;
        const cleaned = cleanBase64Image(fileBase64, mimeType);
        if (!cleaned.data) {
          return errorResponse(request, 400, "MISSING_FILE", "لم يتم إرفاق ملف الدرس.");
        }
        const parsed = await callGeminiJson(env, {
          contents: [
            {
              role: "user",
              parts: [
                { inlineData: { mimeType: cleaned.mimeType, data: cleaned.data } },
                { text: `حلّل ملف درس ${subjectName} (${gradeLevel}) "${fileName}" واستخرج العنوان والملخص والتلخيص الميسر والمحتوى والمفاهيم والأهداف والقوانين.` },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                title: { type: "STRING" },
                summary: { type: "STRING" },
                simplifiedSummary: { type: "STRING" },
                content: { type: "STRING" },
                extractedAnalysis: {
                  type: "OBJECT",
                  properties: {
                    concepts: { type: "ARRAY", items: { type: "STRING" } },
                    objectives: { type: "ARRAY", items: { type: "STRING" } },
                    tablesAndFiguresSummary: { type: "ARRAY", items: { type: "STRING" } },
                    keyFormulasOrRules: { type: "ARRAY", items: { type: "STRING" } },
                  },
                  required: ["concepts", "objectives", "tablesAndFiguresSummary", "keyFormulasOrRules"],
                },
              },
              required: ["title", "summary", "simplifiedSummary", "content", "extractedAnalysis"],
            },
          },
        });
        return jsonResponse(request, { category: `ملف مرفوع (${fileName})`, ...parsed });
      }

      // 12b. Extract Preparation Form Template
      if (pathname === "/api/prep-templates/extract") {
        const {
          fileName = "prep_form",
          mimeType = "application/octet-stream",
          fileBase64 = "",
          subjectScope = "all",
          templateName = "",
          customInstructions = "",
        } = body;
        const cleaned = cleanBase64Image(fileBase64, mimeType);
        if (!cleaned.data) {
          return errorResponse(request, 400, "MISSING_FILE", "لم يتم إرفاق ملف أو صورة فورمة التحضير.");
        }
        const parsed = await callGeminiJson(env, {
          contents: [
            {
              role: "user",
              parts: [
                { inlineData: { mimeType: cleaned.mimeType, data: cleaned.data } },
                {
                  text: `حلل فورمة التحضير المرفقة "${fileName}" واستخرج اسم القالب والجهة والأقسام المطلوبة بالترتيب والنص الكامل وإرشادات بناء شرائح البوربوينت.`,
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                templateName: { type: "STRING" },
                institutionOrSchool: { type: "STRING" },
                requiredSections: { type: "ARRAY", items: { type: "STRING" } },
                rawStructureText: { type: "STRING" },
                presentationMappingGuidelines: { type: "STRING" },
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
        });
        return jsonResponse(request, {
          template: {
            id: `tpl-${Date.now()}`,
            subjectScope,
            templateName: templateName.trim() || parsed.templateName || fileName.replace(/\.[^.]+$/, ""),
            sourceFileName: fileName,
            institutionOrSchool: parsed.institutionOrSchool || "",
            requiredSections: Array.isArray(parsed.requiredSections) ? parsed.requiredSections : [],
            rawStructureText: parsed.rawStructureText || "",
            presentationMappingGuidelines: parsed.presentationMappingGuidelines || "",
            customInstructions,
            updatedAt: new Date().toISOString(),
          },
        });
      }

      // 13. Understanding Radar Endpoints
      if (pathname === "/api/radar/extract-source") {
        const { fileName = "lesson", mimeType = "application/pdf", fileBase64 = "", subjectName = "العلوم", gradeLevel = "" } = body;
        const cleaned = cleanBase64Image(fileBase64, mimeType);
        if (!cleaned.data) return errorResponse(request, 400, "MISSING_FILE", "لم يتم إرفاق ملف.");
        const parsed = await callGeminiJson(env, {
          contents: [{ role: "user", parts: [{ inlineData: { mimeType: cleaned.mimeType, data: cleaned.data } }, { text: `استخرج محتوى درس ${subjectName} (${gradeLevel}) "${fileName}" والمفاهيم والأهداف.` }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                topicTitle: { type: "STRING" },
                extractedText: { type: "STRING" },
                keyConcepts: { type: "ARRAY", items: { type: "STRING" } },
                objectives: { type: "ARRAY", items: { type: "STRING" } },
              },
              required: ["topicTitle", "extractedText", "keyConcepts", "objectives"],
            },
          },
        });
        return jsonResponse(request, parsed);
      }

      if (pathname === "/api/radar/generate-questions") {
        const { subjectName = "العلوم", gradeLevel = "", lessonTopic = "", lessonContent = "", questionCount = 5, questionTypes = ["mcq", "true_false"], difficulty = "mixed", language = "ar" } = body;
        if (!String(lessonTopic).trim() && !String(lessonContent).trim()) {
          return errorResponse(request, 400, "MISSING_RADAR_TOPIC", "يرجى تحديد موضوع الدرس أو إدخال محتواه أولاً.");
        }
        const parsed = await callGeminiJson(env, {
          contents: [{ role: "user", parts: [{ text: `صمم ${questionCount} أسئلة تشخيصية لموضوع "${lessonTopic}" (${subjectName} - ${gradeLevel}) بصعوبة ${difficulty} وأنواع ${questionTypes.join(", ")} بلغة ${language}:\n${String(lessonContent).slice(0, 12000)}` }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                questions: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      questionType: { type: "STRING" },
                      cognitiveLevel: { type: "STRING" },
                      difficulty: { type: "STRING" },
                      concept: { type: "STRING" },
                      objective: { type: "STRING" },
                      misconceptionTarget: { type: "STRING" },
                      question: { type: "STRING" },
                      options: { type: "ARRAY", items: { type: "STRING" } },
                      correctIndex: { type: "INTEGER" },
                      timeLimitSec: { type: "INTEGER" },
                      explanation: { type: "STRING" },
                      hint: { type: "STRING" },
                    },
                    required: ["questionType", "cognitiveLevel", "difficulty", "concept", "objective", "misconceptionTarget", "question", "options", "correctIndex", "timeLimitSec", "explanation", "hint"],
                  },
                },
              },
              required: ["questions"],
            },
          },
        });
        return jsonResponse(request, parsed);
      }

      if (pathname === "/api/radar/intervene") {
        const { concept = "", lessonTopic = "", currentAccuracyPct = 0, misconceptions = [], language = "ar" } = body;
        if (!String(concept).trim() && !String(lessonTopic).trim()) {
          return errorResponse(request, 400, "MISSING_RADAR_CONTEXT", "يرجى تحديد المفهوم أو عنوان الدرس.");
        }
        const parsed = await callGeminiJson(env, {
          contents: [{ role: "user", parts: [{ text: `شخص صعوبة الفهم في "${concept}" (${lessonTopic}) بنسبة فهم ${currentAccuracyPct}% وأخطاء ${JSON.stringify(misconceptions).slice(0, 2000)} وقدّم 4 استراتيجيات وسؤال تحقق بلغة ${language}.` }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                diagnosisSummary: { type: "STRING" },
                strategies: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      id: { type: "STRING" },
                      strategyType: { type: "STRING" },
                      title: { type: "STRING" },
                      teacherScript: { type: "STRING" },
                      studentFacingExplanation: { type: "STRING" },
                      practicalExample: { type: "STRING" },
                      estimatedMinutes: { type: "INTEGER" },
                    },
                    required: ["id", "strategyType", "title", "teacherScript", "studentFacingExplanation", "practicalExample", "estimatedMinutes"],
                  },
                },
                verificationQuestion: {
                  type: "OBJECT",
                  properties: {
                    concept: { type: "STRING" },
                    question: { type: "STRING" },
                    options: { type: "ARRAY", items: { type: "STRING" } },
                    correctIndex: { type: "INTEGER" },
                    timeLimitSec: { type: "INTEGER" },
                    explanation: { type: "STRING" },
                    hint: { type: "STRING" },
                    misconceptionTarget: { type: "STRING" },
                  },
                  required: ["concept", "question", "options", "correctIndex", "timeLimitSec", "explanation", "hint", "misconceptionTarget"],
                },
              },
              required: ["diagnosisSummary", "strategies", "verificationQuestion"],
            },
          },
        });
        return jsonResponse(request, parsed);
      }

      if (pathname === "/api/radar/tutor") {
        const { userMessage = "", lessonTopic = "", subjectName = "العلوم", language = "ar" } = body;
        if (!String(userMessage).trim() && !String(lessonTopic).trim()) {
          return errorResponse(request, 400, "EMPTY_TUTOR_PROMPT", "يرجى كتابة سؤالك.");
        }
        const parsed = await callGeminiJson(env, {
          contents: [{ role: "user", parts: [{ text: `أنت معلم رادار الفهم في ${subjectName} (${lessonTopic}) بلغة ${language}. أجب عن: ${userMessage}` }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                reply: { type: "STRING" },
                simplifiedAnalogy: { type: "STRING" },
                scaffoldedHint: { type: "STRING" },
                followUpPrompts: { type: "ARRAY", items: { type: "STRING" } },
              },
              required: ["reply", "simplifiedAnalogy", "scaffoldedHint", "followUpPrompts"],
            },
          },
        });
        return jsonResponse(request, parsed);
      }

      // 14. Video Script, STT & TTS
      if (pathname === "/api/generate/video-script") {
        const { lesson, style = "educational_explainer", presenterPersona = "science_mentor", language = "ar" } = body;
        if (!lesson || !String(lesson.title || "").trim()) {
          return errorResponse(request, 400, "MISSING_LESSON", "يرجى اختيار درس أولاً.");
        }
        const parsed = await callGeminiJson(env, {
          contents: [{ role: "user", parts: [{ text: `اكتب سيناريو فيديو تعليمي من 5 مشاهد لدرس "${lesson.title}" بأسلوب ${style} وشخصية ${presenterPersona} بلغة ${language}. المصادر:\n${buildSourcesText(lesson.sources)}` }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                videoTitle: { type: "STRING" },
                fullScript: { type: "STRING" },
                scenes: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      sceneNumber: { type: "INTEGER" },
                      title: { type: "STRING" },
                      narration: { type: "STRING" },
                      subtitleText: { type: "STRING" },
                      visualCue: { type: "STRING" },
                      durationSec: { type: "INTEGER" },
                    },
                    required: ["sceneNumber", "title", "narration", "subtitleText", "visualCue", "durationSec"],
                  },
                },
              },
              required: ["videoTitle", "fullScript", "scenes"],
            },
          },
        });
        return jsonResponse(request, { project: { ...parsed, style, presenterPersona, language } });
      }

      if (pathname === "/api/tts") {
        const { text = "", voiceName = "Kore" } = body;
        const cleanText = String(text).trim().slice(0, 2500);
        if (!cleanText) return errorResponse(request, 400, "EMPTY_TEXT", "النص المطلوب قراءته فارغ.");
        const { audioData } = await callGemini(
          env,
          {
            contents: [{ role: "user", parts: [{ text: cleanText }] }],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
            },
          },
          { models: [TTS_MODEL] }
        );
        if (!audioData) return errorResponse(request, 502, "EMPTY_AUDIO", "لم يتم استلام بيانات صوتية.");
        return jsonResponse(request, { audioBase64: audioData, mimeType: "audio/wav" });
      }

      if (pathname === "/api/stt") {
        const { audioBase64 = "", mimeType = "audio/webm", language = "auto" } = body;
        if (!audioBase64) return errorResponse(request, 400, "EMPTY_AUDIO", "لا يوجد ملف صوتي مرسل.");
        const { textOutput } = await callGemini(
          env,
          {
            contents: [{ role: "user", parts: [{ inlineData: { mimeType, data: audioBase64 } }, { text: `Transcribe this ${language} audio.` }] }],
          },
          { models: [STT_MODEL, ...CHAT_MODELS] }
        );
        return jsonResponse(request, {
          transcript: textOutput,
          captions: textOutput ? [textOutput] : [],
          timedCaptions: textOutput ? [{ startSec: 0, endSec: 4, text: textOutput }] : [],
          vtt: "",
        });
      }

      // Stateless persistence acknowledgement for client-side cache
      if (pathname === "/api/artifacts" || pathname === "/api/lessons" || pathname === "/api/radar/sessions") {
        return jsonResponse(request, { ok: true, stateless: true });
      }

      // Raw Gemini generateContent proxy compatibility on POST /
      if ((pathname === "/" || pathname === "") && Array.isArray(body?.contents)) {
        const result = await callGemini(env, body);
        return jsonResponse(request, result.apiJson);
      }

      return errorResponse(request, 404, "ROUTE_NOT_FOUND", `المسار (${pathname}) غير معرف في Cloudflare Worker.`);
    } catch (err) {
      const status = err?.status || 500;
      const code = err?.code || "WORKER_ERROR";
      const message = err?.userMessage || err?.message || "حدث خطأ غير متوقع في الخادم.";
      return errorResponse(request, status, code, message);
    }
  },
};

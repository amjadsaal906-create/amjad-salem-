import { GoogleGenAI, type GenerateContentResponse } from "@google/genai";

export const CHAT_MODEL = "gemini-4-hydrogen";
export const FALLBACK_CHAT_MODEL = "gemini-3.1-flash-lite";
export const TTS_MODEL = "gemini-3.8-flash-lite-tts";
export const STT_MODEL = "gemini-3.5-transcribe";
export const VEO_MODEL = "gemini-omni-1.2-flash";

export class GeminiJsonParseError extends Error {
  rawPreview: string;
  constructor(message: string, rawPreview: string) {
    super(message);
    this.name = "GeminiJsonParseError";
    this.rawPreview = rawPreview;
  }
}

export function getGeminiApiKey(): string {
  const key = process.env.GEMINI_API_KEY?.trim() || "";
  if (!key || key === "MY_GEMINI_API_KEY") {
    return "";
  }
  return key;
}

export function getGeminiClient(): GoogleGenAI | null {
  const apiKey = getGeminiApiKey();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

export function stripJsonFences(raw: string): string {
  const cleaned = String(raw || "{}")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const firstObj = cleaned.indexOf("{");
  const firstArr = cleaned.indexOf("[");
  if (firstArr !== -1 && (firstObj === -1 || firstArr < firstObj)) {
    const lastArr = cleaned.lastIndexOf("]");
    if (lastArr > firstArr) {
      return cleaned.slice(firstArr, lastArr + 1);
    }
  }
  if (firstObj !== -1) {
    const lastObj = cleaned.lastIndexOf("}");
    if (lastObj > firstObj) {
      return cleaned.slice(firstObj, lastObj + 1);
    }
  }
  return cleaned;
}

export function parseAndValidateGeminiJson<T = Record<string, unknown>>(
  rawText: string | undefined | null,
  validate?: (obj: T) => boolean
): T {
  const raw = String(rawText ?? "").trim();
  const sliced = stripJsonFences(raw);
  let parsed: T;
  try {
    parsed = JSON.parse(sliced || "{}") as T;
  } catch {
    throw new GeminiJsonParseError(
      "أعاد نموذج الذكاء الاصطناعي استجابة غير صالحة بصيغة JSON.",
      raw.slice(0, 180)
    );
  }
  if (validate && !validate(parsed)) {
    throw new GeminiJsonParseError(
      "بيانات الاستجابة المولدة من الذكاء الاصطناعي غير مكتملة أو غير مطابقة للبنية المطلوبة.",
      raw.slice(0, 180)
    );
  }
  return parsed;
}

export function formatGeminiError(err: unknown): { status: number; message: string; code: string } {
  if (err instanceof GeminiJsonParseError) {
    return {
      status: 502,
      code: "INVALID_AI_JSON",
      message: err.message,
    };
  }

  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  if (
    lower.includes("401") ||
    lower.includes("unauthenticated") ||
    lower.includes("access_token_type_unsupported") ||
    lower.includes("api key not valid") ||
    lower.includes("api_key_invalid")
  ) {
    return {
      status: 401,
      code: "GEMINI_AUTH_ERROR",
      message:
        "مفتاح GEMINI_API_KEY على الخادم غير صالح أو غير متوافق مع Gemini API (401). تأكد من ضبط مفتاح Google AI Studio الصحيح في إعدادات الخادم أو ربط المنصة بخادم Cloudflare Worker (smart-science-ai-server).",
    };
  }

  if (lower.includes("permission_denied") || lower.includes("403")) {
    return {
      status: 403,
      code: "GEMINI_AUTH_ERROR",
      message:
        "تعذر التحقق من صلاحية مفتاح GEMINI_API_KEY (403). يرجى التأكد من تهيئة المفتاح الصحيح وصلاحيات الوصول في Settings > Secrets.",
    };
  }

  if (lower.includes("resource_exhausted") || lower.includes("429")) {
    return {
      status: 429,
      code: "GEMINI_QUOTA_ERROR",
      message:
        "تم تجاوز حد الطلبات (429) أو يلزم استخدام مفتاح يدعم الحصة المطلوبة في إعدادات الخادم.",
    };
  }

  if (lower.includes("not_found") || lower.includes("404")) {
    return {
      status: 404,
      code: "GEMINI_MODEL_NOT_FOUND",
      message: `النموذج المطلوب (${CHAT_MODEL}) غير متاح حالياً لدى Gemini API. يرجى التحقق من اسم النموذج وتحديثه.`,
    };
  }

  if (
    lower.includes("unavailable") ||
    lower.includes("503") ||
    lower.includes("high demand") ||
    lower.includes("gemini_timeout")
  ) {
    return {
      status: 503,
      code: "GEMINI_UNAVAILABLE",
      message: "خادم الذكاء الاصطناعي يواجه ضغطاً مؤقتاً حالياً (503). يرجى إعادة المحاولة بعد لحظات.",
    };
  }

  return {
    status: 500,
    code: "GEMINI_API_ERROR",
    message: `حدث خطأ أثناء الاتصال بخدمة الذكاء الاصطناعي: ${raw}`,
  };
}

function isRetryableError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  // Do NOT retry authentication failures (401/403) or malformed request errors (400)
  if (
    lower.includes("401") ||
    lower.includes("403") ||
    lower.includes("unauthenticated") ||
    lower.includes("api_key_invalid") ||
    lower.includes("api key not valid")
  ) {
    return false;
  }
  return (
    lower.includes("429") ||
    lower.includes("resource_exhausted") ||
    lower.includes("503") ||
    lower.includes("500") ||
    lower.includes("unavailable") ||
    lower.includes("internal") ||
    lower.includes("not_found") ||
    lower.includes("404") ||
    lower.includes("fetch failed")
  );
}

export interface GeminiCallOptions {
  models?: string[];
  maxTransientRetries?: number;
  timeoutMs?: number;
  label?: string;
}

/**
 * Centralized Gemini call with model fallback & bounded exponential backoff retries.
 * Never fabricates or returns placeholder content when upstream fails.
 */
export async function callGeminiWithRetry(
  ai: GoogleGenAI,
  params: Omit<Parameters<GoogleGenAI["models"]["generateContent"]>[0], "model">,
  options: GeminiCallOptions = {}
): Promise<GenerateContentResponse> {
  const modelsToTry = options.models?.length ? options.models : [CHAT_MODEL, FALLBACK_CHAT_MODEL];
  const maxRetries = options.maxTransientRetries ?? 2;
  const label = options.label || "Gemini";

  let lastErr: unknown = null;

  for (let mIdx = 0; mIdx < modelsToTry.length; mIdx++) {
    const model = modelsToTry[mIdx];
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const callPromise = ai.models.generateContent({ ...params, model });
        if (options.timeoutMs && options.timeoutMs > 0) {
          return await Promise.race([
            callPromise,
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("503 GEMINI_TIMEOUT")), options.timeoutMs)
            ),
          ]);
        }
        return await callPromise;
      } catch (err) {
        lastErr = err;
        const raw = err instanceof Error ? err.message : String(err);
        console.error(`[${label}][${model}][try ${attempt + 1}]`, raw.slice(0, 300));

        if (!isRetryableError(err)) {
          throw err;
        }

        const lower = raw.toLowerCase();
        // If 404 NOT_FOUND on model name, jump straight to fallback model
        if (lower.includes("404") || lower.includes("not_found")) {
          break;
        }

        if (attempt < maxRetries - 1) {
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        }
      }
    }
    if (mIdx < modelsToTry.length - 1) {
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  throw lastErr;
}

export async function callGeminiStructured<T = Record<string, unknown>>(
  ai: GoogleGenAI,
  params: Omit<Parameters<GoogleGenAI["models"]["generateContent"]>[0], "model">,
  options: GeminiCallOptions & { validate?: (obj: T) => boolean } = {}
): Promise<T> {
  const response = await callGeminiWithRetry(ai, params, options);
  return parseAndValidateGeminiJson<T>(response.text, options.validate);
}

export async function callGeminiText(
  ai: GoogleGenAI,
  params: Omit<Parameters<GoogleGenAI["models"]["generateContent"]>[0], "model">,
  options: GeminiCallOptions = {}
): Promise<string> {
  const response = await callGeminiWithRetry(ai, params, options);
  return String(response.text ?? "").trim();
}

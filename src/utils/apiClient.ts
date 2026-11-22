export const DEFAULT_WORKER_API_BASE_URL =
  "https://smart-science-ai-server.amjadsaal906.workers.dev";

const STORAGE_API_BASE_URL_KEY = "smart_science_api_base_url_v1";

export type AiRequestPhase =
  | "idle"
  | "connecting"
  | "generating"
  | "success"
  | "empty_response"
  | "connection_error"
  | "api_error";

export function getAiPhaseMessage(phase: AiRequestPhase, lang: "ar" | "en" = "ar"): string {
  const isAr = lang === "ar";
  switch (phase) {
    case "connecting":
      return isAr ? "جاري الاتصال بخادم Cloudflare Worker..." : "Connecting to Cloudflare Worker...";
    case "generating":
      return isAr ? "جاري إنشاء الإجابة بالذكاء الاصطناعي..." : "Generating AI response...";
    case "success":
      return isAr ? "تم استلام الرد بنجاح." : "Response received successfully.";
    case "empty_response":
      return isAr ? "لم يُرجع الخادم أي محتوى (عدم وجود رد)." : "Server returned an empty response.";
    case "connection_error":
      return isAr ? "فشل الاتصال بالخادم. تحقق من الشبكة وإعدادات CORS." : "Connection to server failed.";
    case "api_error":
      return isAr ? "أعاد الخادم أو Gemini API رسالة خطأ." : "Server or Gemini API returned an error.";
    default:
      return "";
  }
}

const baseUrlChangeListeners = new Set<() => void>();

export function onApiBaseUrlChange(listener: () => void): () => void {
  baseUrlChangeListeners.add(listener);
  return () => baseUrlChangeListeners.delete(listener);
}

function normalizeBaseUrl(raw?: string | null): string {
  return String(raw || "")
    .trim()
    .replace(/\/+$/, "");
}

/**
 * Returns the unified Cloudflare Worker / backend base URL.
 * Priority:
 *  1) Runtime override stored in browser localStorage (when customized by teacher/admin)
 *  2) VITE_API_BASE_URL build-time environment variable
 *  3) Default Cloudflare Worker: https://smart-science-ai-server.amjadsaal906.workers.dev
 * Note: Never stores or reads any API keys on the client.
 */
export function getApiBaseUrl(): string {
  try {
    if (typeof window !== "undefined") {
      const runtimeOverride = normalizeBaseUrl(localStorage.getItem(STORAGE_API_BASE_URL_KEY));
      if (runtimeOverride) return runtimeOverride;
    }
  } catch {
    // Ignore storage error
  }

  const envUrl = normalizeBaseUrl(
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_API_BASE_URL
  );
  return envUrl || DEFAULT_WORKER_API_BASE_URL;
}

export function setApiBaseUrl(url: string): void {
  const normalized = normalizeBaseUrl(url);
  try {
    if (typeof window !== "undefined") {
      if (normalized) {
        localStorage.setItem(STORAGE_API_BASE_URL_KEY, normalized);
      } else {
        localStorage.removeItem(STORAGE_API_BASE_URL_KEY);
      }
    }
  } catch {
    // Ignore storage error
  }
  baseUrlChangeListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // Ignore listener errors
    }
  });
}

export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const cleanPath = path === "" || path === "/" ? "/" : path.startsWith("/") ? path : `/${path}`;
  const base = getApiBaseUrl();
  if (!base) return cleanPath;
  return cleanPath === "/" ? `${base}/` : `${base}${cleanPath}`;
}

export class ApiResponseError extends Error {
  status: number;
  code: string;
  isHtmlFallback: boolean;
  rawText?: string;

  constructor(
    message: string,
    options: { status?: number; code?: string; isHtmlFallback?: boolean; rawText?: string } = {}
  ) {
    super(message);
    this.name = "ApiResponseError";
    this.status = options.status ?? 500;
    this.code = options.code ?? "API_ERROR";
    this.isHtmlFallback = Boolean(options.isHtmlFallback);
    this.rawText = options.rawText;
  }
}

export function looksLikeHtmlResponse(rawText: string, contentType?: string | null): boolean {
  const ct = String(contentType || "").toLowerCase();
  const trimmed = rawText.trim().toLowerCase();
  return (
    ct.includes("text/html") ||
    trimmed.startsWith("<!doctype") ||
    trimmed.startsWith("<html") ||
    trimmed.startsWith("<head") ||
    trimmed.startsWith("<body")
  );
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

export function extractErrorDetails(
  parsed: Record<string, unknown>,
  status: number,
  path: string
): { message: string; code: string } {
  const nestedError =
    parsed.error && typeof parsed.error === "object"
      ? (parsed.error as Record<string, unknown>)
      : null;

  const rawCode =
    (typeof parsed.error === "string" && parsed.error) ||
    (nestedError && typeof nestedError.status === "string" && nestedError.status) ||
    `HTTP_${status}`;

  const rawMessage =
    (typeof parsed.message === "string" && parsed.message.trim()) ||
    (nestedError && typeof nestedError.message === "string" && nestedError.message.trim()) ||
    (typeof parsed.error === "string" && parsed.error.trim()) ||
    "";

  const lower = rawMessage.toLowerCase();

  if (lower.includes("gemini-2.5-flash") && (status === 404 || lower.includes("no longer available"))) {
    return {
      code: "DEPRECATED_WORKER_MODEL",
      message:
        "الخادم الوسيط (Cloudflare Worker) ما زال يستخدم نموذجاً قديماً غير متاح (gemini-2.5-flash). يرجى تحديث النموذج في Cloudflare Worker إلى (gemini-4-hydrogen أو gemini-3.8-flash أو gemini-3.1-flash-lite).",
    };
  }

  if (status === 401 || lower.includes("api key not valid") || lower.includes("unauthenticated")) {
    return {
      code: "GEMINI_AUTH_ERROR",
      message:
        rawMessage ||
        "تعذر المصادقة مع Gemini API (401). تحقق من صحة GEMINI_API_KEY في إعدادات Cloudflare Worker Secrets.",
    };
  }

  if (status === 403 || lower.includes("permission_denied")) {
    return {
      code: "GEMINI_PERMISSION_DENIED",
      message:
        rawMessage ||
        "تم رفض الوصول إلى Gemini API (403). تحقق من صلاحيات GEMINI_API_KEY في Cloudflare Worker.",
    };
  }

  if (status === 429 || lower.includes("resource_exhausted")) {
    return {
      code: "GEMINI_QUOTA_ERROR",
      message:
        rawMessage ||
        "تم تجاوز حد الطلبات المؤقت على Gemini API (429). انتظر لحظات ثم أعد المحاولة.",
    };
  }

  if (status === 404 && !rawMessage) {
    return {
      code: "ROUTE_NOT_FOUND",
      message: `المسار (${path}) غير متوفر على الخادم (${getApiBaseUrl()}).`,
    };
  }

  if (status === 503 && !rawMessage) {
    return {
      code: "GEMINI_UNAVAILABLE",
      message: "خدمة الذكاء الاصطناعي غير مهيأة أو مشغولة مؤقتاً (503). تحقق من GEMINI_API_KEY.",
    };
  }

  return {
    code: rawCode,
    message: rawMessage || `فشل تنفيذ الطلب (${path}) برمز الحالة (${status}).`,
  };
}

export interface SafeFetchOptions extends RequestInit {
  timeoutMs?: number;
  onPhaseChange?: (phase: AiRequestPhase) => void;
}

/**
 * Safely calls an API endpoint with timeout, CORS/network detection, and HTML/text JSON safety.
 * Never throws `Unexpected token '<', "<!doctype "... is not valid JSON`.
 */
export async function safeFetchJson<T = Record<string, unknown>>(
  path: string,
  init: SafeFetchOptions = {}
): Promise<{ status: number; ok: boolean; data: T }> {
  const { timeoutMs = 45000, onPhaseChange, signal: externalSignal, ...fetchInit } = init;
  const url = resolveApiUrl(path);

  const controller = new AbortController();
  let timedOut = false;
  const timer =
    typeof window !== "undefined" && timeoutMs > 0
      ? window.setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs)
      : null;

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }

  onPhaseChange?.("connecting");

  let res: Response;
  try {
    res = await fetch(url, { ...fetchInit, signal: controller.signal });
  } catch (err) {
    if (timer !== null) window.clearTimeout(timer);
    onPhaseChange?.("connection_error");
    if (timedOut) {
      throw new ApiResponseError(
        `انتهت مهلة الاتصال بالخادم (${url}) دون استجابة. يرجى إعادة المحاولة.`,
        { status: 0, code: "TIMEOUT_ERROR" }
      );
    }
    const detail = err instanceof Error ? err.message : String(err);
    throw new ApiResponseError(
      `فشل الاتصال بالخادم الموحد (${url}). تحقق من الإنترنت وإعدادات CORS على Cloudflare Worker. (${detail})`,
      { status: 0, code: "NETWORK_OR_CORS_ERROR" }
    );
  }

  onPhaseChange?.("generating");

  let rawText = "";
  try {
    rawText = await res.text();
  } catch (err) {
    if (timer !== null) window.clearTimeout(timer);
    onPhaseChange?.("connection_error");
    const detail = err instanceof Error ? err.message : String(err);
    throw new ApiResponseError(`انقطع الاتصال أثناء قراءة استجابة الخادم (${detail}).`, {
      status: res.status || 0,
      code: "STREAM_READ_ERROR",
    });
  } finally {
    if (timer !== null) window.clearTimeout(timer);
  }

  const contentType = res.headers.get("content-type");

  if (looksLikeHtmlResponse(rawText, contentType)) {
    onPhaseChange?.("api_error");
    throw new ApiResponseError(
      `أعاد المسار (${path}) صفحة HTML بدلاً من JSON من العنوان (${url}). تأكد من إعدادات المسارات في Cloudflare Worker.`,
      {
        status: res.status || 502,
        code: "HTML_INSTEAD_OF_JSON",
        isHtmlFallback: true,
        rawText: rawText.slice(0, 200),
      }
    );
  }

  if (!rawText.trim()) {
    if (!res.ok) {
      onPhaseChange?.("api_error");
      const { message, code } = extractErrorDetails({}, res.status, path);
      throw new ApiResponseError(message, { status: res.status, code });
    }
    onPhaseChange?.("empty_response");
    throw new ApiResponseError(`لم يُرجع الخادم أي رد للمسار (${path}).`, {
      status: res.status || 502,
      code: "EMPTY_RESPONSE",
    });
  }

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    onPhaseChange?.("api_error");
    const preview = rawText.trim().slice(0, 140);
    throw new ApiResponseError(
      `أعاد الخادم استجابة نصية غير متوافقة مع JSON للمسار (${path}) [HTTP ${res.status}]: "${preview}".`,
      { status: res.status, code: "INVALID_JSON", rawText: preview }
    );
  }

  if (!res.ok) {
    onPhaseChange?.("api_error");
    const { message, code } = extractErrorDetails(parsed, res.status, path);
    throw new ApiResponseError(message, { status: res.status, code });
  }

  onPhaseChange?.("success");
  return { status: res.status, ok: true, data: parsed as T };
}

/**
 * Safely fetches binary payloads (e.g. .pptx downloads), ensuring HTML or JSON error
 * pages are never saved to disk as corrupt binary files.
 */
export async function safeFetchBlob(
  path: string,
  init: SafeFetchOptions = {}
): Promise<{ blob: Blob; headers: Headers }> {
  const { timeoutMs = 45000, onPhaseChange, signal: externalSignal, ...fetchInit } = init;
  const url = resolveApiUrl(path);
  const controller = new AbortController();
  const timer =
    typeof window !== "undefined" && timeoutMs > 0
      ? window.setTimeout(() => controller.abort(), timeoutMs)
      : null;

  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  onPhaseChange?.("connecting");

  let res: Response;
  try {
    res = await fetch(url, { ...fetchInit, signal: controller.signal });
  } catch (err) {
    if (timer !== null) window.clearTimeout(timer);
    onPhaseChange?.("connection_error");
    const detail = err instanceof Error ? err.message : String(err);
    throw new ApiResponseError(
      `تعذر الاتصال بالخادم الموحد (${url}) أثناء تنزيل الملف. تحقق من الاتصال وإعدادات CORS. (${detail})`,
      { status: 0, code: "NETWORK_OR_CORS_ERROR" }
    );
  }

  onPhaseChange?.("generating");

  const contentType = String(res.headers.get("content-type") || "").toLowerCase();

  if (!res.ok || contentType.includes("text/html") || contentType.includes("application/json") || contentType.includes("text/plain")) {
    const rawText = await res.text().catch(() => "");
    if (timer !== null) window.clearTimeout(timer);

    if (looksLikeHtmlResponse(rawText, contentType)) {
      onPhaseChange?.("api_error");
      throw new ApiResponseError(
        `أعاد المسار (${path}) صفحة HTML بدلاً من الملف المطلوب.`,
        { status: res.status || 502, code: "HTML_INSTEAD_OF_JSON", isHtmlFallback: true }
      );
    }
    if (rawText.trim()) {
      try {
        const parsed = JSON.parse(rawText) as Record<string, unknown>;
        const { message, code } = extractErrorDetails(parsed, res.status, path);
        onPhaseChange?.("api_error");
        throw new ApiResponseError(message, { status: res.status, code });
      } catch (e) {
        if (e instanceof ApiResponseError) throw e;
        onPhaseChange?.("api_error");
        throw new ApiResponseError(
          `تعذر تنزيل الملف من (${path}) [HTTP ${res.status}]: ${rawText.trim().slice(0, 120)}`,
          { status: res.status, code: "INVALID_BINARY_RESPONSE" }
        );
      }
    }
    onPhaseChange?.("api_error");
    throw new ApiResponseError(`فشل تنزيل الملف برمز الحالة (${res.status}).`, {
      status: res.status,
      code: `HTTP_${res.status}`,
    });
  }

  const blob = await res.blob();
  if (timer !== null) window.clearTimeout(timer);
  onPhaseChange?.("success");
  return { blob, headers: res.headers };
}

export async function fetchAssetAsBase64(
  url: string
): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("read failed"));
      reader.readAsDataURL(blob);
    });
    const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/s);
    if (!match) return null;
    return { mimeType: match[1], base64: match[2] };
  } catch {
    return null;
  }
}

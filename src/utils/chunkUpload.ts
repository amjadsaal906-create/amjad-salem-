import { blobToBase64 } from "./speech.ts";
import { resolveApiUrl, safeFetchJson, looksLikeHtmlResponse, ApiResponseError } from "./apiClient.ts";

const DIRECT_BASE64_THRESHOLD_BYTES = 4 * 1024 * 1024; // 4 MB
const CHUNK_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB raw binary per request (safe under Cloud Run 32 MB limit)

export function inferUploadMimeType(file: File): string {
  if (file.type && file.type !== "application/octet-stream") {
    return file.type;
  }
  const lower = file.name.toLowerCase();
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
  return "application/octet-stream";
}

export interface PreparedUploadPayload {
  fileBase64?: string;
  uploadId?: string;
}

/**
 * Prepares a file for upload to the backend:
 * - Files <= 4 MB use direct base64 JSON payload (single round-trip).
 * - Larger files (e.g., 35 MB PDF textbooks) stream in 2 MB raw binary chunks
 *   via /api/uploads/init + /api/uploads/:id/chunk to bypass HTTP payload limits.
 */
export async function prepareUploadPayload(
  file: File,
  onProgress?: (percent: number) => void
): Promise<PreparedUploadPayload> {
  if (file.size <= DIRECT_BASE64_THRESHOLD_BYTES) {
    const fileBase64 = await blobToBase64(file);
    onProgress?.(100);
    return { fileBase64 };
  }

  const { data: initData } = await safeFetchJson<{ uploadId?: string; message?: string }>(
    "/api/uploads/init",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: file.name,
        fileSize: file.size,
        mimeType: inferUploadMimeType(file),
      }),
    }
  );

  if (!initData.uploadId) {
    throw new ApiResponseError(initData.message || "تعذر بدء جلسة رفع الملف.", {
      status: 500,
      code: "UPLOAD_INIT_FAILED",
    });
  }

  const uploadId = initData.uploadId;

  try {
    let offset = 0;
    while (offset < file.size) {
      const end = Math.min(offset + CHUNK_SIZE_BYTES, file.size);
      const chunkBuffer = await file.slice(offset, end).arrayBuffer();

      const chunkRes = await fetch(
        resolveApiUrl(`/api/uploads/${encodeURIComponent(uploadId)}/chunk`),
        {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: chunkBuffer,
        }
      );

      if (!chunkRes.ok) {
        const rawErr = await chunkRes.text();
        if (looksLikeHtmlResponse(rawErr, chunkRes.headers.get("content-type"))) {
          throw new ApiResponseError("أعاد الخادم صفحة HTML أثناء رفع أجزاء الملف.", {
            status: chunkRes.status,
            code: "HTML_INSTEAD_OF_JSON",
            isHtmlFallback: true,
          });
        }
        let msg = `فشل إرسال جزء من الملف (${chunkRes.status}).`;
        try {
          const errJson = JSON.parse(rawErr) as { message?: string };
          if (errJson?.message) msg = errJson.message;
        } catch {
          // Ignore parse error
        }
        throw new ApiResponseError(msg, { status: chunkRes.status });
      }

      offset = end;
      onProgress?.(Math.min(100, Math.round((offset / file.size) * 100)));
    }

    return { uploadId };
  } catch (err) {
    fetch(resolveApiUrl(`/api/uploads/${encodeURIComponent(uploadId)}`), {
      method: "DELETE",
    }).catch(() => {});
    throw err;
  }
}

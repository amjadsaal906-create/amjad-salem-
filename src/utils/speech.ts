let activeAudio: HTMLAudioElement | null = null;

export function detectTextLanguage(text: string): "ar" | "en" {
  const arabicMatches = (text.match(/[\u0600-\u06FF]/g) || []).length;
  const latinMatches = (text.match(/[A-Za-z]/g) || []).length;
  return latinMatches > arabicMatches ? "en" : "ar";
}

export function stopAllSpeech(): void {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.currentTime = 0;
    activeAudio = null;
  }
}

export function speakWithBrowser(
  text: string,
  rate = 1.0,
  onEnd?: () => void,
  onError?: (msg: string) => void,
  lang: "ar" | "en" | "auto" = "auto"
): boolean {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    onError?.("المتصفح الحالي لا يدعم النطق الصوتي المدمج.");
    return false;
  }

  stopAllSpeech();
  const resolvedLang = lang === "auto" ? detectTextLanguage(text) : lang;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = resolvedLang === "en" ? "en-US" : "ar-SA";
  utterance.rate = Math.min(1.6, Math.max(0.7, rate));

  const voices = window.speechSynthesis.getVoices();
  const targetPrefix = resolvedLang === "en" ? "en" : "ar";
  const matchedVoice = voices.find((v) => v.lang.toLowerCase().startsWith(targetPrefix));
  if (matchedVoice) {
    utterance.voice = matchedVoice;
  }

  utterance.onend = () => onEnd?.();
  utterance.onerror = () => {
    onError?.("تعذر تشغيل القارئ الصوتي المدمج.");
    onEnd?.();
  };

  window.speechSynthesis.speak(utterance);
  return true;
}

export async function speakWithGeminiTTS(
  text: string,
  rate = 1.0,
  onStart?: () => void,
  onEnd?: () => void,
  lang: "ar" | "en" | "auto" = "auto"
): Promise<{ ok: boolean; error?: string }> {
  stopAllSpeech();
  const resolvedLang = lang === "auto" ? detectTextLanguage(text) : lang;

  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        style:
          resolvedLang === "en"
            ? "Clear, warm English educational narrator"
            : "Clear, warm Arabic educational narrator",
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.audioBase64) {
      return {
        ok: false,
        error: data.message || "تعذر توليد الصوت عبر خدمة الذكاء الاصطناعي.",
      };
    }

    const audio = new Audio(`data:${data.mimeType || "audio/wav"};base64,${data.audioBase64}`);
    audio.playbackRate = Math.min(1.5, Math.max(0.75, rate));
    activeAudio = audio;

    audio.onended = () => {
      activeAudio = null;
      onEnd?.();
    };
    audio.onerror = () => {
      activeAudio = null;
      onEnd?.();
    };

    onStart?.();
    await audio.play();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "فشل الاتصال بخدمة التحويل الصوتي.",
    };
  }
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result || "");
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("تعذر قراءة الملف الصوتي."));
    reader.readAsDataURL(blob);
  });
}

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export function createBrowserSpeechRecognition(
  lang: "ar" | "en" | "auto" = "ar"
): SpeechRecognitionLike | null {
  if (typeof window === "undefined") return null;
  const win = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Ctor = win.SpeechRecognition || win.webkitSpeechRecognition;
  if (!Ctor) return null;
  const recognition = new Ctor();
  recognition.lang = lang === "en" ? "en-US" : "ar-SA";
  recognition.continuous = false;
  recognition.interimResults = false;
  return recognition;
}

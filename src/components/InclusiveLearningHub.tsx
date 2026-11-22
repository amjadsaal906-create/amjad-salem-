import React, { useState, useRef, useEffect } from "react";
import {
  Volume2,
  Mic,
  Square,
  Upload,
  Eye,
  Keyboard,
  Hand,
  Captions,
  Type as TypeIcon,
  Sparkles,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  BookOpen,
  Download,
} from "lucide-react";
import type {
  AccessibilitySettings,
  ImageDescriptionResult,
  LessonData,
  PlatformCapabilities,
  SimplifiedStep,
  ThemeMode,
  TimedCaption,
  UILanguage,
} from "../types.ts";
import { SIGN_LANGUAGE_GLOSSARY } from "../data/signLanguageGlossary.ts";
import {
  blobToBase64,
  speakWithBrowser,
  speakWithGeminiTTS,
  stopAllSpeech,
} from "../utils/speech.ts";
import {
  describeScienceImage,
  simplifyScienceText,
  transcribeMediaAudio,
} from "../utils/aiApi.ts";

interface InclusiveLearningHubProps {
  lesson: LessonData;
  settings: AccessibilitySettings;
  onUpdateSettings: (patch: Partial<AccessibilitySettings>) => void;
  capabilities: PlatformCapabilities | null;
  onExecuteVoiceCommand: (spokenText: string) => string;
  onToggleVoiceCommand: () => void;
  isListeningCommand: boolean;
  voiceCommandLog: string[];
  uiLang?: UILanguage;
}

export const InclusiveLearningHub: React.FC<InclusiveLearningHubProps> = ({
  lesson,
  settings,
  onUpdateSettings,
  capabilities,
  onExecuteVoiceCommand,
  onToggleVoiceCommand,
  isListeningCommand,
  voiceCommandLog,
  uiLang = "ar",
}) => {
  const isAr = uiLang === "ar";

  // 1. TTS Tester
  const [ttsSample, setTtsSample] = useState(lesson.audioLessonScript);
  const [ttsLang, setTtsLang] = useState<"auto" | "ar" | "en">("auto");
  const [ttsBusy, setTtsBusy] = useState(false);
  const [ttsMsg, setTtsMsg] = useState<string | null>(null);

  useEffect(() => {
    setTtsSample(lesson.audioLessonScript);
    setTextToSimplify(lesson.summary);
    setSelectedSignTerm(lesson.keySignTerms[0] || "ضوء");
  }, [lesson]);

  // 2. STT & Video Closed Captions Tester
  const [sttRecording, setSttRecording] = useState(false);
  const [sttLoading, setSttLoading] = useState(false);
  const [sttTranscript, setSttTranscript] = useState("");
  const [sttCaptions, setSttCaptions] = useState<string[]>([]);
  const [timedCaptions, setTimedCaptions] = useState<TimedCaption[]>([]);
  const [vttContent, setVttContent] = useState<string>("");
  const [vttTrackUrl, setVttTrackUrl] = useState<string | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [sttError, setSttError] = useState<string | null>(null);
  const sttRecorderRef = useRef<MediaRecorder | null>(null);
  const sttChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (!vttContent) {
      setVttTrackUrl(null);
      return;
    }
    const blob = new Blob([vttContent], { type: "text/vtt;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    setVttTrackUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [vttContent]);

  useEffect(() => {
    return () => {
      if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    };
  }, [videoPreviewUrl]);

  // 4. Custom Image Vision Description for Blind Learners
  const [uploadedImgPreview, setUploadedImgPreview] = useState<string | null>(null);
  const [visionLoading, setVisionLoading] = useState(false);
  const [visionResult, setVisionResult] = useState<ImageDescriptionResult | null>(null);
  const [visionError, setVisionError] = useState<string | null>(null);

  // 5. Simplification Studio
  const [textToSimplify, setTextToSimplify] = useState(lesson.summary);
  const [simplifyLoading, setSimplifyLoading] = useState(false);
  const [simplifiedSteps, setSimplifiedSteps] = useState<SimplifiedStep[]>([]);
  const [simplifyError, setSimplifyError] = useState<string | null>(null);

  // 7. Sign Language Glossary Term Selection
  const [selectedSignTerm, setSelectedSignTerm] = useState<string>(
    lesson.keySignTerms[0] || "ضوء"
  );

  // Voice Command manual input fallback
  const [manualCommand, setManualCommand] = useState("");

  const handleTestTTS = async (engine: "browser" | "gemini") => {
    setTtsMsg(null);
    if (engine === "browser") {
      speakWithBrowser(ttsSample, settings.speechRate, undefined, undefined, ttsLang);
      return;
    }
    setTtsBusy(true);
    const res = await speakWithGeminiTTS(ttsSample, settings.speechRate, undefined, undefined, ttsLang);
    setTtsBusy(false);
    if (!res.ok) {
      setTtsMsg(res.error || (isAr ? "تعذر تشغيل صوت Gemini." : "Gemini TTS failed."));
    }
  };

  const handleToggleSttRecord = async () => {
    if (sttRecording) {
      sttRecorderRef.current?.stop();
      setSttRecording(false);
      return;
    }

    setSttError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setSttError(
        isAr
          ? "الميكروفون غير متاح في المتصفح. يمكنك رفع ملف صوتي أو فيديو للاختبار."
          : "Microphone unavailable. You can upload an audio or video file to test."
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      sttChunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) sttChunksRef.current.push(ev.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(sttChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        setVideoPreviewUrl(null);
        await transcribeMediaBlob(blob, "captions");
      };
      sttRecorderRef.current = recorder;
      recorder.start();
      setSttRecording(true);
    } catch {
      setSttError(
        isAr
          ? "يرجى منح إذن الميكروفون أو رفع ملف صوتي/فيديو لاختبار التفريغ النصي والترجمة."
          : "Please grant microphone permission or upload an audio/video file."
      );
    }
  };

  const transcribeMediaBlob = async (blob: Blob, mode: "captions" | "video_captions") => {
    if (!settings.aiProcessingConsent) {
      setSttError(
        isAr
          ? "يرجى تفعيل موافقة المعالجة بالذكاء الاصطناعي أولاً."
          : "Please enable AI processing consent first."
      );
      return;
    }
    setSttLoading(true);
    setSttError(null);
    try {
      const audioBase64 = await blobToBase64(blob);
      const data = await transcribeMediaAudio({
        audioBase64,
        mimeType: blob.type || "audio/webm",
        mode,
        language: uiLang,
      });
      setSttTranscript(data.transcript || "");
      setSttCaptions(data.captions || []);
      setTimedCaptions(data.timedCaptions || []);
      setVttContent(data.vtt || "");
    } catch (err) {
      setSttError(
        err instanceof Error
          ? err.message
          : isAr
            ? "تعذر الاتصال بخدمة تحويل الكلام إلى نص."
            : "Failed to reach STT service."
      );
    } finally {
      setSttLoading(false);
    }
  };

  const handleMediaFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isVideo = file.type.startsWith("video/");
    if (isVideo) {
      setVideoPreviewUrl(URL.createObjectURL(file));
    } else {
      setVideoPreviewUrl(null);
    }
    await transcribeMediaBlob(file, isVideo ? "video_captions" : "captions");
    e.target.value = "";
  };

  const handleDownloadVtt = () => {
    if (!vttContent) return;
    const blob = new Blob([vttContent], { type: "text/vtt;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${lesson.id}-subtitles.vtt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImageUploadDescribe = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!settings.aiProcessingConsent) {
      setVisionError(isAr ? "يرجى تفعيل موافقة المعالجة بالذكاء الاصطناعي أولاً." : "Enable AI consent first.");
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result || "");
      setUploadedImgPreview(dataUrl);
      const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;

      setVisionLoading(true);
      setVisionError(null);
      try {
        const data = await describeScienceImage({
          imageBase64: base64,
          mimeType: file.type || "image/png",
          lessonTitle: lesson.title,
        });
        setVisionResult(data);
      } catch (err) {
        setVisionError(
          err instanceof Error
            ? err.message
            : isAr
              ? "تعذر الاتصال بخدمة وصف الصور."
              : "Vision service unreachable."
        );
      } finally {
        setVisionLoading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSimplifySubmit = async () => {
    if (!settings.aiProcessingConsent) {
      setSimplifyError(isAr ? "يرجى تفعيل موافقة المعالجة بالذكاء الاصطناعي أولاً." : "Enable AI consent first.");
      return;
    }
    setSimplifyLoading(true);
    setSimplifyError(null);
    try {
      const data = await simplifyScienceText({
        text: textToSimplify,
        lessonTitle: lesson.title,
      });
      setSimplifiedSteps(data.steps || []);
    } catch (err) {
      setSimplifyError(
        err instanceof Error
          ? err.message
          : isAr
            ? "تعذر الاتصال بخدمة التبسيط."
            : "Simplification service unreachable."
      );
    } finally {
      setSimplifyLoading(false);
    }
  };

  const formatSec = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  const signEntry = SIGN_LANGUAGE_GLOSSARY[selectedSignTerm] || Object.values(SIGN_LANGUAGE_GLOSSARY)[0];

  return (
    <div className="space-y-6">
      {/* Intro Header */}
      <section
        className="rounded-xl border p-6"
        style={{
          backgroundColor: "var(--bg-surface)",
          borderColor: "var(--border-hairline)",
        }}
      >
        <h1 className="text-2xl font-bold">
          {isAr ? "منظومة التعلم الشامل لذوي الهمم" : "Inclusive Learning System for Students with Disabilities"}
        </h1>
        <p className="text-sm mt-1.5" style={{ color: "var(--text-secondary)" }}>
          {isAr
            ? "أدوات فعلية قابلة للتشغيل والاختبار المباشر لدعم الإعاقات البصرية والسمعية وصعوبات التعلم والتنقل بلوحة المفاتيح والأوامر الصوتية."
            : "Real, testable assistive tools for visual, hearing, cognitive, and motor accessibility."}
        </p>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 1. Text-to-Speech Reader */}
        <section
          className="science-card rounded-xl border p-5 space-y-4"
          style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Volume2 className="w-5 h-5" style={{ color: "var(--accent-primary)" }} />
              <h2 className="text-base font-bold">
                {isAr ? "1. قارئ النصوص الصوتي (TTS)" : "1. Audio Text-to-Speech Reader"}
              </h2>
            </div>
            <select
              aria-label={isAr ? "لغة النطق" : "Voice language"}
              value={ttsLang}
              onChange={(e) => setTtsLang(e.target.value as "auto" | "ar" | "en")}
              className="px-2.5 py-1 rounded-lg border text-xs"
              style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}
            >
              <option value="auto">{isAr ? "كشف تلقائي" : "Auto"}</option>
              <option value="ar">العربية</option>
              <option value="en">English</option>
            </select>
          </div>
          <textarea
            rows={3}
            value={ttsSample}
            onChange={(e) => setTtsSample(e.target.value)}
            aria-label={isAr ? "نص لاختبار القارئ الصوتي" : "Text to read aloud"}
            className="w-full p-3 rounded-lg border text-sm"
            style={{
              backgroundColor: "var(--bg-subtle)",
              borderColor: "var(--border-hairline)",
              color: "var(--text-primary)",
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleTestTTS("browser")}
              className="min-h-[42px] px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5"
              style={{ backgroundColor: "var(--accent-primary)", color: "var(--accent-contrast)" }}
            >
              <Volume2 className="w-4 h-4" />
              <span>{isAr ? "قراءة فورية (المتصفح)" : "Browser Speech"}</span>
            </button>
            <button
              type="button"
              onClick={() => handleTestTTS("gemini")}
              disabled={ttsBusy}
              className="min-h-[42px] px-4 py-2 rounded-lg border text-xs font-semibold flex items-center gap-1.5"
              style={{ borderColor: "var(--border-hairline)" }}
            >
              {ttsBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              <span>{isAr ? "توليد صوت طبيعي (Gemini TTS)" : "Neural Gemini TTS"}</span>
            </button>
            <button
              type="button"
              onClick={stopAllSpeech}
              className="min-h-[42px] px-3 py-2 rounded-lg border text-xs font-medium flex items-center gap-1"
              style={{ borderColor: "var(--border-hairline)" }}
            >
              <Square className="w-3.5 h-3.5" />
              <span>{isAr ? "إيقاف" : "Stop"}</span>
            </button>
          </div>
          {ttsMsg && <p className="text-xs text-amber-600 dark:text-amber-400">{ttsMsg}</p>}
        </section>

        {/* 2. Speech-to-Text & Video Closed Captions (.vtt) */}
        <section
          className="science-card rounded-xl border p-5 space-y-4"
          style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}
        >
          <div className="flex items-center gap-2">
            <Captions className="w-5 h-5" style={{ color: "var(--accent-primary)" }} />
            <h2 className="text-base font-bold">
              {isAr ? "2. تحويل الكلام إلى نص وترجمة الفيديو [CC]" : "2. Speech-to-Text & Video Subtitles [CC]"}
            </h2>
          </div>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            {isAr
              ? "سجّل مقطعاً صوتياً أو ارفع ملف صوت (MP3/WAV) أو فيديو (MP4/WEBM) لاستخراج النص وترجمة WebVTT متزامنة."
              : "Record audio or upload an audio (MP3/WAV) or video (MP4/WEBM) file to generate transcript and synchronized WebVTT subtitles."}
          </p>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={handleToggleSttRecord}
              disabled={sttLoading}
              className="min-h-[42px] px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5"
              style={{
                backgroundColor: sttRecording ? "#dc2626" : "var(--accent-primary)",
                color: "#ffffff",
              }}
            >
              {sttRecording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              <span>
                {sttRecording
                  ? isAr ? "إيقاف التسجيل وتفريغ الصوت" : "Stop & Transcribe"
                  : isAr ? "تسجيل صوتي جديد" : "Record Audio"}
              </span>
            </button>

            <label
              className="min-h-[42px] px-4 py-2 rounded-lg border text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              style={{ borderColor: "var(--border-hairline)" }}
            >
              <Upload className="w-4 h-4" />
              <span>{isAr ? "رفع ملف صوت أو فيديو" : "Upload Audio / Video"}</span>
              <input
                type="file"
                accept="audio/*,video/*"
                onChange={handleMediaFileUpload}
                className="sr-only"
              />
            </label>

            {sttLoading && <Loader2 className="w-4 h-4 animate-spin" />}
          </div>

          {sttError && (
            <p className="text-xs text-red-600 dark:text-red-400" role="alert">
              {sttError}
            </p>
          )}

          {videoPreviewUrl && (
            <div className="rounded-lg overflow-hidden border" style={{ borderColor: "var(--border-hairline)" }}>
              <video src={videoPreviewUrl} controls className="w-full max-h-56 bg-black">
                {vttTrackUrl && (
                  <track
                    kind="subtitles"
                    src={vttTrackUrl}
                    srcLang={uiLang}
                    label={isAr ? "الترجمة العربية" : "Subtitles"}
                    default
                  />
                )}
              </video>
            </div>
          )}

          {sttTranscript && (
            <div
              className="p-3 rounded-lg border space-y-2 text-sm"
              style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold" style={{ color: "var(--accent-primary)" }}>
                  {isAr ? "النص المفرّغ والترجمة المكتوبة [CC]:" : "Transcript & Closed Captions [CC]:"}
                </span>
                {vttContent && (
                  <button
                    type="button"
                    onClick={handleDownloadVtt}
                    className="px-2.5 py-1 rounded border text-xs font-semibold flex items-center gap-1"
                    style={{ borderColor: "var(--border-hairline)", backgroundColor: "var(--bg-surface)" }}
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>.vtt</span>
                  </button>
                )}
              </div>
              <p className="text-xs leading-relaxed">{sttTranscript}</p>
              {timedCaptions.length > 0 ? (
                <div className="space-y-1 pt-1 border-t text-xs max-h-36 overflow-y-auto" style={{ borderColor: "var(--border-hairline)" }}>
                  {timedCaptions.map((cap, idx) => (
                    <div key={idx}>
                      <span className="font-mono-num font-bold ml-1.5" style={{ color: "var(--accent-primary)" }}>
                        [{formatSec(cap.startSec)} → {formatSec(cap.endSec)}]
                      </span>
                      <span>{cap.text}</span>
                    </div>
                  ))}
                </div>
              ) : (
                sttCaptions.length > 0 && (
                  <div className="space-y-1 pt-1 border-t text-xs" style={{ borderColor: "var(--border-hairline)" }}>
                    {sttCaptions.map((cap, idx) => (
                      <div key={idx}>
                        <span className="font-mono-num font-bold ml-1">[CC {idx + 1}]</span>
                        <span>{cap}</span>
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>
          )}
        </section>

        {/* 3. Typography, Contrast & Dyslexia Controls */}
        <section
          className="science-card rounded-xl border p-5 space-y-4"
          style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}
        >
          <div className="flex items-center gap-2">
            <TypeIcon className="w-5 h-5" style={{ color: "var(--accent-primary)" }} />
            <h2 className="text-base font-bold">
              {isAr ? "3. تكبير الخط والتحكم بالتباين والألوان" : "3. Font Scaling, Contrast & Color Themes"}
            </h2>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(
              [
                { id: "light", labelAr: "نهاري واضح", labelEn: "Light" },
                { id: "dark", labelAr: "داكن مريح", labelEn: "Dark" },
                { id: "high-contrast", labelAr: "تباين عالٍ", labelEn: "High Contrast" },
                { id: "sepia", labelAr: "ورق دافئ", labelEn: "Sepia" },
              ] as Array<{ id: ThemeMode; labelAr: string; labelEn: string }>
            ).map((t) => {
              const active = settings.theme === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onUpdateSettings({ theme: t.id })}
                  className="min-h-[42px] px-2.5 py-2 rounded-lg border text-xs font-semibold whitespace-nowrap"
                  style={{
                    borderColor: active ? "var(--accent-primary)" : "var(--border-hairline)",
                    backgroundColor: active ? "var(--accent-primary)" : "var(--bg-subtle)",
                    color: active ? "var(--accent-contrast)" : "var(--text-primary)",
                  }}
                >
                  {isAr ? t.labelAr : t.labelEn}
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <label htmlFor="hub-font-scale" className="font-semibold">
                  {isAr ? "حجم الخط" : "Font Size"}
                </label>
                <span className="font-mono-num">{Math.round(settings.fontScale * 100)}%</span>
              </div>
              <input
                id="hub-font-scale"
                type="range"
                min={1}
                max={1.55}
                step={0.05}
                value={settings.fontScale}
                onChange={(e) => onUpdateSettings({ fontScale: Number(e.target.value) })}
                className="w-full accent-sky-600"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <label htmlFor="hub-word-spacing" className="font-semibold">
                  {isAr ? "تباعد الكلمات" : "Word Spacing"}
                </label>
                <span className="font-mono-num">{settings.wordSpacing.toFixed(2)}em</span>
              </div>
              <input
                id="hub-word-spacing"
                type="range"
                min={0}
                max={0.25}
                step={0.05}
                value={settings.wordSpacing}
                onChange={(e) => onUpdateSettings({ wordSpacing: Number(e.target.value) })}
                className="w-full accent-sky-600"
              />
            </div>
          </div>

          <label className="flex items-center justify-between p-3 rounded-lg border cursor-pointer text-sm" style={{ borderColor: "var(--border-hairline)" }}>
            <span>{isAr ? "تفعيل مسطرة القراءة البصرية لمتابعة السطر" : "Enable Dyslexia Reading Ruler"}</span>
            <input
              type="checkbox"
              checked={settings.readingRuler}
              onChange={(e) => onUpdateSettings({ readingRuler: e.target.checked })}
              className="w-5 h-5 accent-sky-600"
            />
          </label>
        </section>

        {/* 4. Visual Description for Blind Learners */}
        <section
          className="science-card rounded-xl border p-5 space-y-4"
          style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}
        >
          <div className="flex items-center gap-2">
            <Eye className="w-5 h-5" style={{ color: "var(--accent-primary)" }} />
            <h2 className="text-base font-bold">
              {isAr ? "4. وصف الصور والرسوم العلمية للمكفوفين" : "4. Audio Vision Descriptions for Blind Learners"}
            </h2>
          </div>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            {isAr
              ? "ارفع أي صورة أو مخطط علمي لتوليد وصف مكاني دقيق قابل للقراءة الصوتية عبر الرؤية الحاسوبية."
              : "Upload any scientific diagram or image to generate a spoken spatial description."}
          </p>

          <div className="flex flex-wrap items-center gap-2.5">
            <label
              className="min-h-[42px] px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              style={{ backgroundColor: "var(--accent-primary)", color: "var(--accent-contrast)" }}
            >
              <Upload className="w-4 h-4" />
              <span>{isAr ? "رفع صورة علمية ووصفها" : "Upload & Describe Image"}</span>
              <input
                type="file"
                accept="image/*"
                onChange={handleImageUploadDescribe}
                className="sr-only"
              />
            </label>
            {visionLoading && <Loader2 className="w-4 h-4 animate-spin" />}
          </div>

          {visionError && (
            <p className="text-xs text-red-600 dark:text-red-400" role="alert">
              {visionError}
            </p>
          )}

          {uploadedImgPreview && (
            <img
              src={uploadedImgPreview}
              alt={visionResult?.shortAlt || (isAr ? "معاينة الصورة المرفوعة" : "Uploaded image preview")}
              className="w-full h-36 object-contain rounded-lg border"
              style={{ borderColor: "var(--border-hairline)", backgroundColor: "var(--bg-subtle)" }}
            />
          )}

          {visionResult && (
            <div
              className="p-3 rounded-lg border space-y-1.5 text-xs"
              style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}
            >
              <div className="flex items-center justify-between">
                <span className="font-bold">{visionResult.shortAlt}</span>
                <button
                  type="button"
                  onClick={() =>
                    speakWithBrowser(
                      `${visionResult.shortAlt}. ${visionResult.detailedSpatialDescription}`,
                      settings.speechRate
                    )
                  }
                  className="px-2 py-1 rounded border flex items-center gap-1"
                  style={{ borderColor: "var(--border-hairline)", backgroundColor: "var(--bg-surface)" }}
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>{isAr ? "اقرأ الوصف" : "Read Aloud"}</span>
                </button>
              </div>
              <p className="leading-relaxed">{visionResult.detailedSpatialDescription}</p>
            </div>
          )}
        </section>

        {/* 5. Content Simplification Tool */}
        <section
          className="science-card rounded-xl border p-5 space-y-4"
          style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}
        >
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5" style={{ color: "var(--accent-primary)" }} />
            <h2 className="text-base font-bold">
              {isAr ? "5. تبسيط المحتوى وتقسيمه إلى خطوات قصيرة" : "5. Short-Step Content Simplifier"}
            </h2>
          </div>
          <textarea
            rows={3}
            value={textToSimplify}
            onChange={(e) => setTextToSimplify(e.target.value)}
            aria-label={isAr ? "نص علمي للتبسيط" : "Text to simplify"}
            className="w-full p-3 rounded-lg border text-sm"
            style={{
              backgroundColor: "var(--bg-subtle)",
              borderColor: "var(--border-hairline)",
              color: "var(--text-primary)",
            }}
          />
          <button
            type="button"
            onClick={handleSimplifySubmit}
            disabled={simplifyLoading}
            className="min-h-[42px] px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5"
            style={{ backgroundColor: "var(--accent-primary)", color: "var(--accent-contrast)" }}
          >
            {simplifyLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            <span>{isAr ? "تبسيط إلى خطوات قصيرة" : "Simplify into Short Steps"}</span>
          </button>

          {simplifyError && (
            <p className="text-xs text-red-600 dark:text-red-400" role="alert">
              {simplifyError}
            </p>
          )}

          {simplifiedSteps.length > 0 && (
            <div className="space-y-2">
              {simplifiedSteps.map((step) => (
                <div
                  key={step.stepNumber}
                  className="p-3 rounded-lg border text-xs space-y-1"
                  style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}
                >
                  <div className="font-bold">
                    {step.stepNumber}. {step.title}
                  </div>
                  <p>{step.simpleSentence}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 6. Keyboard Navigation & Voice Command Console */}
        <section
          className="rounded-xl border p-5 space-y-4"
          style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}
        >
          <div className="flex items-center gap-2">
            <Keyboard className="w-5 h-5" style={{ color: "var(--accent-primary)" }} />
            <h2 className="text-base font-bold">
              {isAr ? "6. التنقل بلوحة المفاتيح والأوامر الصوتية" : "6. Keyboard Navigation & Voice Commands"}
            </h2>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            {[
              { key: "Alt + 1", action: isAr ? "المواد والمكتبة" : "Subjects & Library" },
              { key: "Alt + 2", action: isAr ? "إنتاج المحتوى" : "Content Studio" },
              { key: "Alt + 3", action: isAr ? "المسابقات المباشرة" : "Live Quiz" },
              { key: "Alt + 4", action: isAr ? "المساعد الذكي" : "AI Tutor" },
              { key: "Alt + 5", action: isAr ? "التعلم الشامل" : "Inclusive Learning" },
              { key: "Alt + A", action: isAr ? "إعدادات الوصول" : "Accessibility Drawer" },
            ].map((sc) => (
              <div
                key={sc.key}
                className="p-2 rounded-lg border flex items-center justify-between gap-2"
                style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}
              >
                <span>{sc.action}</span>
                <kbd
                  dir="ltr"
                  className="px-1.5 py-0.5 rounded border font-mono-num text-[11px]"
                  style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}
                >
                  {sc.key}
                </kbd>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onToggleVoiceCommand}
              className="min-h-[42px] px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5"
              style={{
                backgroundColor: isListeningCommand ? "#dc2626" : "var(--accent-primary)",
                color: "#ffffff",
              }}
            >
              <Mic className="w-4 h-4" />
              <span>
                {isListeningCommand
                  ? isAr ? "إيقاف وضع الأوامر" : "Stop Listening"
                  : isAr ? "تشغيل الأوامر الصوتية" : "Start Voice Commands"}
              </span>
            </button>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!manualCommand.trim()) return;
              onExecuteVoiceCommand(manualCommand);
              setManualCommand("");
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={manualCommand}
              onChange={(e) => setManualCommand(e.target.value)}
              placeholder={isAr ? 'جرّب أمراً مثل: "كبّر الخط" أو "افتح المساعد"' : 'Try: "increase font" or "open tutor"'}
              className="flex-1 min-h-[40px] px-3 rounded-lg border text-xs"
              style={{
                backgroundColor: "var(--bg-subtle)",
                borderColor: "var(--border-hairline)",
                color: "var(--text-primary)",
              }}
            />
            <button
              type="submit"
              className="min-h-[40px] px-3 rounded-lg border text-xs font-semibold"
              style={{ borderColor: "var(--border-hairline)" }}
            >
              {isAr ? "تنفيذ الأمر" : "Run"}
            </button>
          </form>

          {voiceCommandLog.length > 0 && (
            <div
              className="p-2.5 rounded-lg border text-xs space-y-1"
              style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}
            >
              {voiceCommandLog.slice(0, 3).map((entry, idx) => (
                <div key={idx}>• {entry}</div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* 7. Sign Language Support */}
      <section
        className="rounded-xl border p-6 space-y-4"
        style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <Hand className="w-5 h-5" style={{ color: "var(--accent-primary)" }} />
            <div>
              <h2 className="text-lg font-bold">
                {isAr ? "7. ترجمة لغة الإشارة والمصطلحات الإشارية العلمية" : "7. Sign Language Translation & Scientific Sign Glossary"}
              </h2>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                {isAr
                  ? "عرض شفاف لحالة الربط مع خدمات ترجمة لغة الإشارة الآلية، مع قاموس إشاري علمي فوري لمصطلحات الدرس"
                  : "Transparent integration status for external Sign Language video APIs plus an immediate local scientific sign glossary."}
              </p>
            </div>
          </div>
        </div>

        <div
          className="p-4 rounded-lg border flex items-start gap-3"
          style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}
        >
          {capabilities?.signLanguageExternalService.configured ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          )}
          <div className="space-y-1 text-xs">
            <div className="font-bold">
              {isAr ? "حالة خدمة الترجمة المرئية الآلية بلغة الإشارة: " : "Automated Sign Video Service Status: "}
              {capabilities?.signLanguageExternalService.configured
                ? isAr ? "مهيأة ومتصلة" : "Configured & Connected"
                : isAr ? "غير مهيأة (تتطلب خدمة خارجية)" : "Not Configured (External API Required)"}
            </div>
            <p style={{ color: "var(--text-secondary)" }}>
              {capabilities?.signLanguageExternalService.statusMessage ||
                "لا توجد خدمة خارجية مهيأة حالياً لتوليد فيديو/أفاتار لغة الإشارة الآلي."}
            </p>
            {!capabilities?.signLanguageExternalService.configured && (
              <p className="font-mono-num" style={{ color: "var(--text-secondary)" }}>
                SIGN_LANGUAGE_API_URL &amp; SIGN_LANGUAGE_API_KEY
              </p>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {(lesson.keySignTerms.length > 0 ? lesson.keySignTerms : ["ضوء", "خلية", "ذرة"]).map((term) => {
              const active = selectedSignTerm === term;
              return (
                <button
                  key={term}
                  type="button"
                  onClick={() => setSelectedSignTerm(term)}
                  className="min-h-[40px] px-3.5 py-1.5 rounded-lg border text-xs font-semibold"
                  style={{
                    borderColor: active ? "var(--accent-primary)" : "var(--border-hairline)",
                    backgroundColor: active ? "var(--accent-primary)" : "var(--bg-subtle)",
                    color: active ? "var(--accent-contrast)" : "var(--text-primary)",
                  }}
                >
                  {term}
                </button>
              );
            })}
          </div>

          {signEntry && (
            <div
              className="p-4 rounded-lg border grid grid-cols-1 md:grid-cols-3 gap-4 text-sm"
              style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}
            >
              <div>
                <div className="text-xs font-bold mb-1" style={{ color: "var(--accent-primary)" }}>
                  {isAr ? "المصطلح العلمي" : "Scientific Term"}
                </div>
                <div className="text-base font-bold">{signEntry.term}</div>
                <div className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
                  {signEntry.english}
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {signEntry.fingerspelling.map((ch, idx) => (
                    <span
                      key={idx}
                      className="w-8 h-8 rounded-md border flex items-center justify-center font-bold text-sm"
                      style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}
                    >
                      {ch}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs font-bold mb-1" style={{ color: "var(--accent-primary)" }}>
                  {isAr ? "وضعية اليد والحركة" : "Handshape & Movement"}
                </div>
                <p className="text-xs leading-relaxed">
                  <strong>{isAr ? "شكل اليد:" : "Handshape:"}</strong> {signEntry.handshape}
                </p>
                <p className="text-xs leading-relaxed mt-1.5">
                  <strong>{isAr ? "اتجاه الحركة:" : "Movement:"}</strong> {signEntry.movement}
                </p>
              </div>

              <div>
                <div className="text-xs font-bold mb-1" style={{ color: "var(--accent-primary)" }}>
                  {isAr ? "التعبير الوجهي المرافق" : "Facial Expression"}
                </div>
                <p className="text-xs leading-relaxed">{signEntry.facialExpression}</p>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

import React, { useState, useEffect, useRef } from "react";
import { motion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  GraduationCap,
  Mic,
  MicOff,
  Send,
  Square,
  UserCheck,
  Volume2,
} from "lucide-react";
import type {
  AccessibilitySettings,
  LessonData,
  SubjectId,
  UILanguage,
  UserRole,
} from "../types.ts";
import {
  SmartClassroom3D,
  type RobotGesture,
} from "./SmartClassroom3D.tsx";
import {
  createBrowserSpeechRecognition,
  speakWithBrowser,
  speakWithGeminiTTS,
  stopAllSpeech,
} from "../utils/speech.ts";
import { sendChatRequest } from "../utils/aiApi.ts";

export type PortalDestination = "home" | "library" | "studio" | "radar" | "kahoot" | "chatbot" | "inclusive";

export interface RobotPromptOption {
  id: string;
  labelAr: string;
  labelEn: string;
  speechAr: string;
  speechEn: string;
  gesture: RobotGesture;
}

interface EntrancePortalProps {
  uiLang: UILanguage;
  userRole: UserRole;
  userName: string;
  onUserNameChange: (name: string) => void;
  onRoleChange: (role: UserRole) => void;
  activeLesson: LessonData;
  lessonsCount: number;
  settings: AccessibilitySettings;
  onEnterPlatform: (destination: PortalDestination, subjectId?: SubjectId) => void;
}

const ROBOT_GREETING_OPTIONS: RobotPromptOption[] = [
  {
    id: "welcome",
    labelAr: "الترحيب",
    labelEn: "Welcome",
    gesture: "wave",
    speechAr:
      "أهلاً بك في smart science ai! أنا مساعدك الذكي في هذا الصف التفاعلي. اختر دورك ثم اضغط دخول لفتح مساحة العمل الكاملة.",
    speechEn:
      "Welcome to smart science ai! I am your 3D classroom guide. Choose your role and click Enter to open the workspace.",
  },
  {
    id: "teacher",
    labelAr: "للمعلمين",
    labelEn: "For Teachers",
    gesture: "point_board",
    speechAr:
      "للمعلمين: عند الدخول يمكنك رفع الكتب وفهرستها، وإرفاق فورمة التحضير، وبناء عروض PowerPoint والمسابقات المباشرة بضغطة واحدة.",
    speechEn:
      "For teachers: once inside, index textbooks permanently, attach your prep form, and auto-build PowerPoint decks and live quizzes.",
  },
  {
    id: "inclusive",
    labelAr: "التعلم الشامل",
    labelEn: "Inclusive",
    gesture: "wave",
    speechAr:
      "المنصة تدعم جميع الطلاب بقراءة صوتية عصبية، وترجمة مرئية، وتبسيط للخطوات، وتحكم كامل بالتباين وحجم الخط.",
    speechEn:
      "Built for inclusive access with neural speech synthesis, captions, step-by-step simplification, and visual controls.",
  },
];

export const EntrancePortal: React.FC<EntrancePortalProps> = ({
  uiLang,
  userRole,
  userName,
  onUserNameChange,
  onRoleChange,
  activeLesson,
  lessonsCount,
  settings,
  onEnterPlatform,
}) => {
  const isAr = uiLang === "ar";
  const [selectedPromptId, setSelectedPromptId] = useState<string>("welcome");
  const [robotGesture, setRobotGesture] = useState<RobotGesture>("wave");
  const [customInput, setCustomInput] = useState("");
  const [spokenCaption, setSpokenCaption] = useState<string>(() =>
    isAr ? ROBOT_GREETING_OPTIONS[0].speechAr : ROBOT_GREETING_OPTIONS[0].speechEn
  );
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [isListeningMic, setIsListeningMic] = useState(false);
  const [voiceMode, setVoiceMode] = useState<"neural" | "browser">("browser");
  const [speechNotice, setSpeechNotice] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopAllSpeech();
    };
  }, []);

  useEffect(() => {
    const preset = ROBOT_GREETING_OPTIONS.find((item) => item.id === selectedPromptId);
    if (preset) {
      setSpokenCaption(isAr ? preset.speechAr : preset.speechEn);
    }
  }, [isAr, selectedPromptId]);

  const speakUtterance = async (text: string, gesture: RobotGesture = "wave") => {
    setSpokenCaption(text);
    setSpeechNotice(null);
    setRobotGesture(gesture);
    setIsSpeaking(true);

    if (voiceMode === "neural") {
      const result = await speakWithGeminiTTS(
        text,
        settings.speechRate,
        () => {
          if (mountedRef.current) setIsSpeaking(true);
        },
        () => {
          if (mountedRef.current) setIsSpeaking(false);
        },
        uiLang
      );

      if (result.ok) return;

      if (mountedRef.current) {
        setSpeechNotice(
          isAr
            ? "تم التبديل تلقائياً إلى صوت المتصفح الفوري."
            : "Switched automatically to instant browser voice."
        );
      }
    }

    const started = speakWithBrowser(
      text,
      settings.speechRate,
      () => {
        if (mountedRef.current) setIsSpeaking(false);
      },
      (err) => {
        if (mountedRef.current) {
          setIsSpeaking(false);
          setSpeechNotice(err);
        }
      },
      uiLang
    );

    if (!started && mountedRef.current) {
      setIsSpeaking(false);
    }
  };

  const handleStopVoice = () => {
    stopAllSpeech();
    setIsSpeaking(false);
  };

  const handleSelectGreeting = (opt: RobotPromptOption) => {
    setSelectedPromptId(opt.id);
    const text = isAr ? opt.speechAr : opt.speechEn;
    void speakUtterance(text, opt.gesture);
  };

  const askRobotQuestion = async (rawQuery: string) => {
    const query = rawQuery.trim();
    if (!query || isThinking) return;

    setSelectedPromptId("custom");
    setIsThinking(true);
    setSpeechNotice(null);

    try {
      const data = await sendChatRequest({
        role: userRole,
        messages: [{ sender: "user", text: query }],
        lessonTitle: activeLesson.title,
        lessonSummary: activeLesson.summary,
        sources: activeLesson.sources,
        sourcePolicy: "open_scientific",
        actionMode: "explain",
        studentLevel: "intermediate",
        language: uiLang,
        simplifiedMode: true,
      });

      const replyText = String(data.reply || "").trim();
      if (replyText) {
        setCustomInput("");
        await speakUtterance(replyText, "point_board");
      }
    } catch (err) {
      const fallbackText =
        err instanceof Error
          ? err.message
          : isAr
            ? "يمكنك الدخول مباشرة إلى المنصة واستكشاف كافة الأدوات والملفات التعليمية."
            : "You can enter the workspace directly to explore all lessons and tools.";
      setSpeechNotice(fallbackText);
      setSpokenCaption(fallbackText);
    } finally {
      if (mountedRef.current) setIsThinking(false);
    }
  };

  const handleAskRobotAtGate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    await askRobotQuestion(customInput);
  };

  const handleVoiceQuestion = () => {
    if (isListeningMic) {
      setIsListeningMic(false);
      return;
    }
    const recognition = createBrowserSpeechRecognition(uiLang);
    if (!recognition) {
      setSpeechNotice(
        isAr
          ? "المتصفح لا يدعم الإدخال الصوتي المباشر؛ يمكنك كتابة سؤالك للروبوت."
          : "Live microphone input is unavailable in this browser; please type your question."
      );
      return;
    }
    setIsListeningMic(true);
    setSpeechNotice(isAr ? "الروبوت يستمع الآن لسؤالك..." : "Robot is listening to your question...");
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript || "";
      if (transcript) {
        setCustomInput(transcript);
      }
    };
    recognition.onerror = () => setIsListeningMic(false);
    recognition.onend = () => setIsListeningMic(false);
    recognition.start();
  };

  const EnterArrow = isAr ? ArrowLeft : ArrowRight;

  return (
    <section
      aria-label={isAr ? "صفحة الدخول — smart science ai" : "Entry Page — smart science ai"}
      className="min-h-[calc(100vh-96px)] flex items-center py-2"
    >
      {/* Dedicated Single-Screen Entry Layout (Side-by-Side 3D Classroom + Login Gate, Nothing Stacked Below) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch w-full">
        {/* Column 1 (7 cols): Interactive 3D Futuristic Smart Classroom */}
        <div className="lg:col-span-7 flex flex-col">
          <SmartClassroom3D
            uiLang={uiLang}
            reducedMotion={settings.reduceMotion}
            isSpeaking={isSpeaking}
            activeGesture={robotGesture}
            onGestureChange={setRobotGesture}
            onRobotClicked={() => void speakUtterance(spokenCaption, "wave")}
            onBoardOpenStudio={() => onEnterPlatform("studio")}
          />
        </div>

        {/* Column 2 (5 cols): Clean Dedicated Entry / Sign-In Card */}
        <motion.div
          initial={settings.reduceMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.36, ease: [0.16, 1, 0.3, 1] }}
          className="lg:col-span-5 rounded-3xl border p-6 md:p-7 science-card flex flex-col justify-between gap-4"
          style={{
            backgroundColor: "var(--bg-surface)",
            borderColor: "var(--border-hairline)",
          }}
        >
          <div className="space-y-4">
            {/* Unboxed Metadata Kicker */}
            <div
              className="flex flex-wrap items-center gap-2 text-xs font-medium"
              style={{ color: "var(--text-secondary)" }}
            >
              <span>smart science ai</span>
              <span aria-hidden="true">·</span>
              <span>{isAr ? "بوابة الدخول" : "Entry Gate"}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-num">
                {isAr ? `${lessonsCount} دروس` : `${lessonsCount} Lessons`}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <img
                src="/assets/aistudio/image_cbd252d9.png"
                alt="smart science ai logo"
                referrerPolicy="no-referrer"
                className="w-12 h-12 rounded-full object-cover border shrink-0"
                style={{ borderColor: "var(--border-hairline)" }}
              />
              <h1
                className="font-display font-bold tracking-tight leading-[1.22]"
                style={{
                  fontSize: "clamp(1.5rem, 2.3vw, 2.05rem)",
                  color: "var(--text-primary)",
                }}
              >
                {isAr
                  ? "تسجيل الدخول إلى smart science ai"
                  : "Sign In to smart science ai"}
              </h1>
            </div>

            {/* Role Toggle */}
            <div className="space-y-1.5">
              <span className="block text-xs font-bold" style={{ color: "var(--text-secondary)" }}>
                {isAr ? "اختر صفة الدخول:" : "Select Your Role:"}
              </span>
              <div
                className="flex items-center p-1 rounded-xl border w-full"
                style={{
                  backgroundColor: "var(--bg-subtle)",
                  borderColor: "var(--border-hairline)",
                }}
              >
                <button
                  type="button"
                  onClick={() => onRoleChange("student")}
                  className="flex-1 min-h-[42px] px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap"
                  style={{
                    backgroundColor: userRole === "student" ? "var(--bg-surface)" : "transparent",
                    color: userRole === "student" ? "var(--accent-primary)" : "var(--text-secondary)",
                  }}
                >
                  <GraduationCap className="w-4 h-4" />
                  <span>{isAr ? "طالب" : "Student"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onRoleChange("teacher")}
                  className="flex-1 min-h-[42px] px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap"
                  style={{
                    backgroundColor: userRole === "teacher" ? "var(--bg-surface)" : "transparent",
                    color: userRole === "teacher" ? "var(--accent-primary)" : "var(--text-secondary)",
                  }}
                >
                  <UserCheck className="w-4 h-4" />
                  <span>{isAr ? "معلم" : "Teacher"}</span>
                </button>
              </div>
            </div>

            {/* Optional Name Input */}
            <div className="space-y-1.5">
              <label
                htmlFor="portal-user-name"
                className="block text-xs font-bold"
                style={{ color: "var(--text-secondary)" }}
              >
                {isAr ? "الاسم (اختياري):" : "Your Name (optional):"}
              </label>
              <input
                id="portal-user-name"
                type="text"
                value={userName}
                onChange={(e) => onUserNameChange(e.target.value)}
                placeholder={
                  userRole === "teacher"
                    ? isAr
                      ? "مثلاً: أ. أمجد — معلم العلوم"
                      : "e.g., Mr. Amjad"
                    : isAr
                      ? "مثلاً: سارة — الصف العاشر"
                      : "e.g., Sara — Grade 10"
                }
                className="w-full min-h-[42px] px-3.5 rounded-xl text-sm border"
                style={{
                  backgroundColor: "var(--bg-subtle)",
                  borderColor: "var(--border-hairline)",
                  color: "var(--text-primary)",
                }}
              />
            </div>

            {/* Compact Robot Greeting & Direct Gate Voice Q&A */}
            <div
              className="rounded-2xl border p-3.5 space-y-2.5"
              style={{
                backgroundColor: "var(--bg-subtle)",
                borderColor: isSpeaking ? "var(--accent-primary)" : "var(--border-hairline)",
              }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1 p-0.5 rounded-lg border" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}>
                  <button
                    type="button"
                    onClick={() => setVoiceMode("browser")}
                    className="px-2 py-1 rounded-md text-[11px] font-semibold whitespace-nowrap"
                    style={{
                      backgroundColor: voiceMode === "browser" ? "var(--accent-primary)" : "transparent",
                      color: voiceMode === "browser" ? "var(--accent-contrast)" : "var(--text-secondary)",
                    }}
                  >
                    {isAr ? "صوت فوري" : "Instant"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setVoiceMode("neural")}
                    className="px-2 py-1 rounded-md text-[11px] font-semibold whitespace-nowrap"
                    style={{
                      backgroundColor: voiceMode === "neural" ? "var(--accent-primary)" : "transparent",
                      color: voiceMode === "neural" ? "var(--accent-contrast)" : "var(--text-secondary)",
                    }}
                  >
                    {isAr ? "صوت عصبي" : "Neural AI"}
                  </button>
                </div>

                {isSpeaking ? (
                  <button
                    type="button"
                    onClick={handleStopVoice}
                    className="min-h-[32px] px-2.5 py-1 rounded-lg bg-rose-600 text-white text-xs font-semibold flex items-center gap-1 whitespace-nowrap"
                  >
                    <Square className="w-3 h-3 fill-current" />
                    <span>{isAr ? "إيقاف" : "Stop"}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void speakUtterance(spokenCaption, "wave")}
                    className="min-h-[32px] px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 whitespace-nowrap"
                    style={{
                      backgroundColor: "var(--accent-primary)",
                      color: "var(--accent-contrast)",
                    }}
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                    <span>{isAr ? "استمع للروبوت" : "Hear Robot"}</span>
                  </button>
                )}
              </div>

              {settings.captionsEnabled && (
                <p className="text-xs leading-relaxed line-clamp-3" style={{ color: "var(--text-primary)" }}>
                  “{spokenCaption}”
                </p>
              )}

              {speechNotice && (
                <p className="text-[11px] text-amber-700 dark:text-amber-300" role="status">
                  {speechNotice}
                </p>
              )}

              <div className="flex flex-wrap gap-1.5">
                {ROBOT_GREETING_OPTIONS.map((opt) => {
                  const active = selectedPromptId === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleSelectGreeting(opt)}
                      className="px-2.5 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap border"
                      style={{
                        backgroundColor: active ? "var(--accent-primary)" : "var(--bg-surface)",
                        borderColor: active ? "var(--accent-primary)" : "var(--border-hairline)",
                        color: active ? "var(--accent-contrast)" : "var(--text-primary)",
                      }}
                    >
                      {isAr ? opt.labelAr : opt.labelEn}
                    </button>
                  );
                })}
              </div>

              <form onSubmit={handleAskRobotAtGate} className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleVoiceQuestion}
                  aria-label={isAr ? "تحدث إلى الروبوت" : "Speak to robot"}
                  className="min-h-[36px] min-w-[36px] rounded-lg flex items-center justify-center shrink-0 border"
                  style={{
                    backgroundColor: isListeningMic ? "#e11d48" : "var(--bg-surface)",
                    borderColor: "var(--border-hairline)",
                    color: isListeningMic ? "#ffffff" : "var(--text-primary)",
                  }}
                >
                  {isListeningMic ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                </button>
                <input
                  type="text"
                  value={customInput}
                  onChange={(e) => setCustomInput(e.target.value)}
                  placeholder={isAr ? "اسأل الروبوت..." : "Ask the robot..."}
                  className="flex-1 min-h-[36px] px-3 rounded-lg text-xs border"
                  style={{
                    backgroundColor: "var(--bg-surface)",
                    borderColor: "var(--border-hairline)",
                    color: "var(--text-primary)",
                  }}
                />
                <button
                  type="submit"
                  disabled={!customInput.trim() || isThinking}
                  className="min-h-[36px] px-3 rounded-lg text-xs font-bold flex items-center gap-1 disabled:opacity-50 shrink-0"
                  style={{
                    backgroundColor: "var(--accent-primary)",
                    color: "var(--accent-contrast)",
                  }}
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{isAr ? "إرسال" : "Ask"}</span>
                </button>
              </form>
            </div>
          </div>

          {/* Primary Button That Opens The Next Page (Workspace Hub) */}
          <div className="pt-3 border-t space-y-2.5" style={{ borderColor: "var(--border-hairline)" }}>
            <button
              type="button"
              onClick={() => onEnterPlatform("home")}
              className="w-full min-h-[52px] px-6 py-3 rounded-2xl text-sm md:text-base font-bold flex items-center justify-center gap-2.5 shadow-md whitespace-nowrap"
              style={{
                backgroundColor: "var(--accent-primary)",
                color: "var(--accent-contrast)",
              }}
            >
              <span>
                {isAr
                  ? "دخول إلى المنصة"
                  : "Enter Platform"}
              </span>
              <EnterArrow className="w-5 h-5" />
            </button>

            <p className="text-[11px] text-center" style={{ color: "var(--text-secondary)" }}>
              {isAr
                ? "سيتم نقلك مباشرة إلى صفحة لوحة المنصة والأدوات التعليمية"
                : "Opens the main workspace dashboard and subject tools"}
            </p>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

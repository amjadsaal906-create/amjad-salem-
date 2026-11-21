import React, { useState, useRef, useEffect } from "react";
import {
  Send,
  Mic,
  Square,
  Volume2,
  BookMarked,
  AlertCircle,
  Sparkles,
  Loader2,
  UserCheck,
  GraduationCap,
  CheckCircle2,
  Lightbulb,
  Globe,
  Layers,
} from "lucide-react";
import type {
  AccessibilitySettings,
  ChatActionMode,
  ChatLanguage,
  ChatMessage,
  LessonData,
  SourcePolicy,
  StudentLevel,
  UILanguage,
  UserRole,
  WeakSpot,
} from "../types.ts";
import {
  blobToBase64,
  createBrowserSpeechRecognition,
  speakWithBrowser,
  speakWithGeminiTTS,
} from "../utils/speech.ts";
import { buildDemoChatReply } from "../utils/demoSamples.ts";

interface SmartChatbotProps {
  lesson: LessonData;
  userRole: UserRole;
  onRoleChange: (role: UserRole) => void;
  sourcePolicy: SourcePolicy;
  onSourcePolicyChange: (policy: SourcePolicy) => void;
  studentLevel: StudentLevel;
  onStudentLevelChange: (level: StudentLevel) => void;
  chatLanguage: ChatLanguage;
  onChatLanguageChange: (lang: ChatLanguage) => void;
  uiLang: UILanguage;
  settings: AccessibilitySettings;
  messages: ChatMessage[];
  onAddMessage: (msg: ChatMessage) => void;
  weakSpots: WeakSpot[];
  onRecordWeakSpots: (spots: Array<{ concept: string; observation: string; suggestedRemediation: string }>) => void;
  pendingPrompt: string | null;
  onConsumePendingPrompt: () => void;
  demoMode?: boolean;
  onToggleDemoMode?: (enabled: boolean) => void;
}

const ACTION_MODES: Array<{
  id: ChatActionMode;
  labelAr: string;
  labelEn: string;
  forRole?: UserRole;
}> = [
  { id: "explain", labelAr: "شرح مفهوم", labelEn: "Explain Concept" },
  { id: "example", labelAr: "توليد مثال", labelEn: "Real Example" },
  { id: "exercise", labelAr: "تمرين تفاعلي", labelEn: "Quick Exercise" },
  { id: "diagnose_weakness", labelAr: "كشف مواطن الضعف", labelEn: "Diagnose Weakness" },
  { id: "alternative_explanation", labelAr: "شرح بديل ميسّر", labelEn: "Alternative Explanation" },
  { id: "teacher_assist", labelAr: "تخطيط للمعلم", labelEn: "Teacher Assist", forRole: "teacher" },
];

export const SmartChatbot: React.FC<SmartChatbotProps> = ({
  lesson,
  userRole,
  onRoleChange,
  sourcePolicy,
  onSourcePolicyChange,
  studentLevel,
  onStudentLevelChange,
  chatLanguage,
  onChatLanguageChange,
  uiLang,
  settings,
  messages,
  onAddMessage,
  weakSpots,
  onRecordWeakSpots,
  pendingPrompt,
  onConsumePendingPrompt,
  demoMode = false,
  onToggleDemoMode,
}) => {
  const isAr = uiLang === "ar";
  const [input, setInput] = useState("");
  const [actionMode, setActionMode] = useState<ChatActionMode>("explain");
  const [isSending, setIsSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Track interactive quick & remedial exercise answers keyed by unique card key
  const [exerciseAnswers, setExerciseAnswers] = useState<Record<string, number>>({});
  const [exerciseHintsOpen, setExerciseHintsOpen] = useState<Record<string, boolean>>({});
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: settings.reduceMotion ? "auto" : "smooth" });
  }, [messages, settings.reduceMotion]);

  useEffect(() => {
    if (pendingPrompt) {
      setInput(pendingPrompt);
      onConsumePendingPrompt();
    }
  }, [pendingPrompt, onConsumePendingPrompt]);

  const sendMessage = async (
    textOverride?: string,
    modeOverride?: ChatActionMode,
    inputMode: "text" | "voice" = "text"
  ) => {
    const query = (textOverride ?? input).trim();
    if (!query || isSending) return;

    if (!settings.aiProcessingConsent) {
      setErrorMsg(
        isAr
          ? "يرجى تفعيل موافقة المعالجة بالذكاء الاصطناعي في تبويب الخصوصية لاستخدام البوت الذكي."
          : "Please enable AI processing consent in Privacy settings to use the Smart Chatbot."
      );
      return;
    }

    setErrorMsg(null);
    const chosenMode = modeOverride ?? actionMode;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      sender: "user",
      roleContext: userRole,
      text: query,
      timestamp: new Date().toLocaleTimeString(isAr ? "ar-EG" : "en-US", { hour: "2-digit", minute: "2-digit" }),
      inputMode,
      languageUsed: chatLanguage,
    };

    const updatedHistory = [...messages, userMsg];
    onAddMessage(userMsg);
    if (!textOverride) setInput("");

    if (demoMode) {
      const demo = buildDemoChatReply({
        query,
        lesson,
        role: userRole,
        actionMode: chosenMode,
        language: chatLanguage,
        uiLang,
      });
      const demoMsg: ChatMessage = {
        id: `demo-${Date.now()}`,
        sender: "assistant",
        roleContext: userRole,
        text: demo.reply,
        timestamp: new Date().toLocaleTimeString(isAr ? "ar-EG" : "en-US", { hour: "2-digit", minute: "2-digit" }),
        languageUsed: chatLanguage,
        citations: demo.citations,
        alternativeExplanation: demo.alternativeExplanation,
        quickExercise: demo.quickExercise,
        followUpSuggestions: demo.followUpSuggestions,
        isDemoPreset: true,
        isAiGenerated: false,
      };
      onAddMessage(demoMsg);
      if (settings.autoReadResponses) {
        speakWithBrowser(demoMsg.text, settings.speechRate, undefined, undefined, chatLanguage);
      }
      return;
    }

    setIsSending(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: userRole,
          messages: updatedHistory.map((m) => ({ sender: m.sender, text: m.text })),
          lessonTitle: lesson.title,
          lessonSummary: lesson.summary,
          sources: lesson.sources,
          sourcePolicy,
          actionMode: chosenMode,
          studentLevel,
          language: chatLanguage,
          weakSpots,
          accommodations: settings.accommodations,
          simplifiedMode: settings.simplifiedMode,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.message || (isAr ? "حدث خطأ أثناء استجابة البوت الذكي." : "Chatbot request failed."));
        return;
      }

      if (Array.isArray(data.detectedWeakSpots) && data.detectedWeakSpots.length > 0) {
        onRecordWeakSpots(data.detectedWeakSpots);
      }

      const botMsg: ChatMessage = {
        id: `a-${Date.now()}`,
        sender: "assistant",
        roleContext: userRole,
        text: data.reply || (isAr ? "لم يتم استلام نص." : "No reply received."),
        timestamp: new Date().toLocaleTimeString(isAr ? "ar-EG" : "en-US", { hour: "2-digit", minute: "2-digit" }),
        languageUsed: chatLanguage,
        citations: data.citations || [],
        alternativeExplanation: data.alternativeExplanation || undefined,
        detectedWeakSpots: data.detectedWeakSpots || [],
        quickExercise:
          data.quickExercise && data.quickExercise.question && Array.isArray(data.quickExercise.options) && data.quickExercise.options.length > 0
            ? data.quickExercise
            : undefined,
        remedialQuestions: Array.isArray(data.remedialQuestions)
          ? data.remedialQuestions.filter(
              (rq: { question?: string; options?: unknown[] }) =>
                rq && rq.question && Array.isArray(rq.options) && rq.options.length > 0
            )
          : [],
        followUpSuggestions: data.followUpSuggestions || [],
        outOfScopeNotice: data.outOfScopeNotice || undefined,
        isDemoPreset: false,
        isAiGenerated: true,
      };

      onAddMessage(botMsg);

      if (settings.autoReadResponses) {
        speakWithBrowser(botMsg.text, settings.speechRate, undefined, undefined, chatLanguage);
      }
    } catch {
      setErrorMsg(isAr ? "تعذر الاتصال بخادم المساعد الذكي." : "Could not reach the AI Tutor server.");
    } finally {
      setIsSending(false);
    }
  };

  const toggleVoiceRecording = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      return;
    }

    setErrorMsg(null);
    if (typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream);
        audioChunksRef.current = [];

        recorder.ondataavailable = (ev) => {
          if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
        };

        recorder.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
          if (blob.size < 200) return;

          setIsTranscribing(true);
          try {
            const audioBase64 = await blobToBase64(blob);
            const res = await fetch("/api/stt", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                audioBase64,
                mimeType: blob.type || "audio/webm",
                mode: "transcribe",
                language: chatLanguage,
              }),
            });
            const data = await res.json();
            if (!res.ok) {
              setErrorMsg(data.message || (isAr ? "تعذر تحويل الصوت إلى نص عبر الخادم." : "Audio transcription failed."));
            } else if (data.transcript) {
              setInput(data.transcript);
            }
          } catch {
            setErrorMsg(isAr ? "تعذر إرسال التسجيل الصوتي للتحويل." : "Failed to upload voice recording.");
          } finally {
            setIsTranscribing(false);
          }
        };

        mediaRecorderRef.current = recorder;
        recorder.start();
        setIsRecording(true);
        return;
      } catch {
        // Fall through to browser Web Speech Recognition
      }
    }

    const recognition = createBrowserSpeechRecognition(chatLanguage === "auto" ? uiLang : chatLanguage);
    if (!recognition) {
      setErrorMsg(
        isAr
          ? "الميكروفون غير متاح في هذا المتصفح أو لم يتم منحه الإذن."
          : "Microphone is unavailable or permission was denied."
      );
      return;
    }
    setIsRecording(true);
    recognition.onresult = (event) => {
      const spoken = event.results?.[0]?.[0]?.transcript || "";
      if (spoken) setInput(spoken);
    };
    recognition.onerror = () => {
      setErrorMsg(isAr ? "تعذر التقاط الصوت عبر المتصفح." : "Browser voice capture failed.");
      setIsRecording(false);
    };
    recognition.onend = () => setIsRecording(false);
    recognition.start();
  };

  const handleReadMessage = async (text: string, lang: ChatLanguage = chatLanguage, useGemini = false) => {
    if (useGemini) {
      const res = await speakWithGeminiTTS(text, settings.speechRate, undefined, undefined, lang);
      if (!res.ok) {
        speakWithBrowser(text, settings.speechRate, undefined, undefined, lang);
      }
    } else {
      speakWithBrowser(text, settings.speechRate, undefined, undefined, lang);
    }
  };

  const activeSourcesCount = lesson.sources.filter((s) => s.enabled).length;

  const renderExerciseCard = (
    cardKey: string,
    titleLabel: string,
    ex: { question: string; options: string[]; correctIndex: number; hint: string; explanation: string }
  ) => {
    const selectedIdx = exerciseAnswers[cardKey];
    const isAnswered = selectedIdx !== undefined;
    return (
      <div
        key={cardKey}
        className="p-3.5 rounded-lg border space-y-2.5"
        style={{
          backgroundColor: "var(--bg-subtle)",
          borderColor: "var(--border-hairline)",
        }}
      >
        <div className="text-xs font-bold" style={{ color: "var(--accent-primary)" }}>
          {titleLabel}
        </div>
        <p className="text-sm font-semibold">{ex.question}</p>
        <div className="space-y-1.5">
          {ex.options.map((opt, idx) => {
            const selected = selectedIdx === idx;
            const isCorrect = idx === ex.correctIndex;
            return (
              <button
                key={idx}
                type="button"
                onClick={() =>
                  setExerciseAnswers((prev) => ({
                    ...prev,
                    [cardKey]: idx,
                  }))
                }
                className="w-full text-start px-3 py-2 rounded-lg border text-xs font-medium flex items-center justify-between gap-2"
                style={{
                  backgroundColor: selected ? "var(--bg-surface)" : "transparent",
                  borderColor:
                    isAnswered && isCorrect
                      ? "#059669"
                      : selected && !isCorrect
                      ? "#dc2626"
                      : "var(--border-hairline)",
                }}
              >
                <span>{opt}</span>
                {isAnswered && isCorrect && (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-2 text-xs pt-1">
          <button
            type="button"
            onClick={() =>
              setExerciseHintsOpen((prev) => ({
                ...prev,
                [cardKey]: !prev[cardKey],
              }))
            }
            className="underline font-medium"
            style={{ color: "var(--accent-primary)" }}
          >
            {exerciseHintsOpen[cardKey]
              ? isAr ? "إخفاء التلميح" : "Hide Hint"
              : isAr ? "عرض تلميح" : "Show Hint"}
          </button>
          {isAnswered && (
            <span className="font-semibold">
              {selectedIdx === ex.correctIndex
                ? isAr ? "إجابة صحيحة! أحسنت." : "Correct! Well done."
                : isAr ? "راجع التفسير التالي:" : "Review the explanation:"}
            </span>
          )}
        </div>

        {exerciseHintsOpen[cardKey] && ex.hint && (
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            {isAr ? "تلميح:" : "Hint:"} {ex.hint}
          </p>
        )}

        {isAnswered && ex.explanation && (
          <p className="text-xs pt-1" style={{ color: "var(--text-secondary)" }}>
            {isAr ? "التفسير:" : "Explanation:"} {ex.explanation}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Sidebar Governance & Smart Controls */}
      <aside
        className="lg:col-span-4 rounded-xl border p-5 space-y-5 h-fit"
        style={{
          backgroundColor: "var(--bg-surface)",
          borderColor: "var(--border-hairline)",
        }}
      >
        <div>
          <h2 className="text-base font-bold mb-2">
            {isAr ? "وضع المستخدم في المحادثة" : "Conversation Role"}
          </h2>
          <div
            className="grid grid-cols-2 gap-1 p-1 rounded-lg border"
            style={{
              backgroundColor: "var(--bg-subtle)",
              borderColor: "var(--border-hairline)",
            }}
          >
            <button
              type="button"
              onClick={() => onRoleChange("student")}
              className="min-h-[40px] px-3 py-1.5 rounded-md text-sm font-medium flex items-center justify-center gap-1.5 transition-colors"
              style={{
                backgroundColor: userRole === "student" ? "var(--bg-surface)" : "transparent",
                color: userRole === "student" ? "var(--text-primary)" : "var(--text-secondary)",
              }}
            >
              <GraduationCap className="w-4 h-4" />
              <span>{isAr ? "طالب" : "Student"}</span>
            </button>
            <button
              type="button"
              onClick={() => onRoleChange("teacher")}
              className="min-h-[40px] px-3 py-1.5 rounded-md text-sm font-medium flex items-center justify-center gap-1.5 transition-colors"
              style={{
                backgroundColor: userRole === "teacher" ? "var(--bg-surface)" : "transparent",
                color: userRole === "teacher" ? "var(--text-primary)" : "var(--text-secondary)",
              }}
            >
              <UserCheck className="w-4 h-4" />
              <span>{isAr ? "معلم" : "Teacher"}</span>
            </button>
          </div>
        </div>

        {/* Bilingual Language + Student Level Adaptation */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3">
          <div>
            <label htmlFor="chatbot-lang" className="flex items-center gap-1.5 text-xs font-bold mb-1">
              <Globe className="w-3.5 h-3.5" style={{ color: "var(--accent-primary)" }} />
              <span>{isAr ? "لغة المحادثة والصوت" : "Chat & Voice Language"}</span>
            </label>
            <select
              id="chatbot-lang"
              value={chatLanguage}
              onChange={(e) => onChatLanguageChange(e.target.value as ChatLanguage)}
              className="w-full min-h-[40px] px-3 py-1.5 rounded-lg border text-xs"
              style={{
                backgroundColor: "var(--bg-subtle)",
                borderColor: "var(--border-hairline)",
                color: "var(--text-primary)",
              }}
            >
              <option value="auto">{isAr ? "تلقائي (عربي / إنجليزي)" : "Auto (Arabic / English)"}</option>
              <option value="ar">العربية (Arabic)</option>
              <option value="en">English (الإنجليزية)</option>
            </select>
          </div>

          <div>
            <label htmlFor="chatbot-level" className="flex items-center gap-1.5 text-xs font-bold mb-1">
              <Layers className="w-3.5 h-3.5" style={{ color: "var(--accent-primary)" }} />
              <span>{isAr ? "مستوى تبسيط الشرح" : "Student Adaptation Level"}</span>
            </label>
            <select
              id="chatbot-level"
              value={studentLevel}
              onChange={(e) => onStudentLevelChange(e.target.value as StudentLevel)}
              className="w-full min-h-[40px] px-3 py-1.5 rounded-lg border text-xs"
              style={{
                backgroundColor: "var(--bg-subtle)",
                borderColor: "var(--border-hairline)",
                color: "var(--text-primary)",
              }}
            >
              <option value="beginner">{isAr ? "مبتدئ (لغة مبسطة وأمثلة يومية)" : "Beginner (Very simple & visual)"}</option>
              <option value="intermediate">{isAr ? "متوسط (توازن علمي واضح)" : "Intermediate (Balanced)"}</option>
              <option value="advanced">{isAr ? "متقدم (تعمق ومصطلحات دقيقة)" : "Advanced (Deep & technical)"}</option>
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="chatbot-source-policy" className="block text-sm font-bold mb-1.5">
            {isAr ? "خيار المصادر (إعداد المعلم)" : "Knowledge Source Policy (Teacher)"}
          </label>
          <select
            id="chatbot-source-policy"
            value={sourcePolicy}
            onChange={(e) => onSourcePolicyChange(e.target.value as SourcePolicy)}
            className="w-full min-h-[44px] px-3 py-2 rounded-lg border text-sm"
            style={{
              backgroundColor: "var(--bg-subtle)",
              borderColor: "var(--border-hairline)",
              color: "var(--text-primary)",
            }}
          >
            <option value="lesson_only">
              {isAr
                ? `الالتزام الصارم بمصادر الدرس فقط (${activeSourcesCount})`
                : `Strict Lesson Sources Only (${activeSourcesCount})`}
            </option>
            <option value="lesson_plus_curriculum">
              {isAr ? "مصادر الدرس + المنهج المعتمد" : "Lesson + Approved Curriculum"}
            </option>
            <option value="open_scientific">
              {isAr ? "مصادر الدرس + توسع علمي عام" : "Lesson + Open Scientific Enrichment"}
            </option>
          </select>
          <p className="text-xs mt-1.5 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            {isAr
              ? "عند اختيار الالتزام الصارم، يمتنع البوت عن اختراع إجابات من خارج قاعدة معرفة الدرس المعتمدة."
              : "Under Strict policy, the tutor refuses to fabricate facts outside the enabled lesson sources."}
          </p>
        </div>

        <div>
          <h3 className="text-sm font-bold mb-2">{isAr ? "نوع المساعدة الذكية" : "Assistance Mode"}</h3>
          <div className="flex flex-wrap gap-2">
            {ACTION_MODES.filter((m) => !m.forRole || m.forRole === userRole).map((mode) => {
              const active = actionMode === mode.id;
              return (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => setActionMode(mode.id)}
                  className="min-h-[38px] px-3 py-1.5 rounded-lg border text-xs font-medium whitespace-nowrap transition-colors"
                  style={{
                    borderColor: active ? "var(--accent-primary)" : "var(--border-hairline)",
                    backgroundColor: active ? "var(--accent-primary)" : "transparent",
                    color: active ? "var(--accent-contrast)" : "var(--text-primary)",
                  }}
                >
                  {isAr ? mode.labelAr : mode.labelEn}
                </button>
              );
            })}
          </div>
        </div>

        {/* Weak Spots Tracker */}
        <div
          className="p-4 rounded-lg border space-y-2"
          style={{
            backgroundColor: "var(--bg-subtle)",
            borderColor: "var(--border-hairline)",
          }}
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold">
              {isAr ? "مواطن ضعف الفهم المرصودة" : "Detected Weak Spots"}
            </h3>
            <span className="font-mono-num text-xs font-semibold" style={{ color: "var(--accent-primary)" }}>
              {weakSpots.length}
            </span>
          </div>
          {weakSpots.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              {isAr
                ? "لم تُرصد صعوبات بعد. اطرح سؤالاً أو أجب عن تمرين ليكتشف البوت المفاهيم التي تحتاج دعماً إضافياً."
                : "No misconceptions recorded yet. Ask a question or try an exercise to detect weak spots."}
            </p>
          ) : (
            <div className="space-y-2">
              {weakSpots.slice(0, 3).map((spot, idx) => (
                <div
                  key={idx}
                  className="p-2.5 rounded-lg border text-xs space-y-1"
                  style={{
                    backgroundColor: "var(--bg-surface)",
                    borderColor: "var(--border-hairline)",
                  }}
                >
                  <div className="font-bold">{spot.concept}</div>
                  <p style={{ color: "var(--text-secondary)" }}>{spot.observation}</p>
                  <button
                    type="button"
                    onClick={() =>
                      sendMessage(
                        isAr
                          ? `أشعر بصعوبة في فهم "${spot.concept}". قدّم لي شرحاً بديلاً مبسطاً جداً مع سؤال علاجي.`
                          : `I find "${spot.concept}" confusing. Please give me a very simple alternative explanation and a remedial question.`,
                        "alternative_explanation"
                      )
                    }
                    className="font-semibold underline"
                    style={{ color: "var(--accent-primary)" }}
                  >
                    {isAr ? "اطلب شرحاً بديلاً وسؤالاً علاجياً" : "Request alternative + remedial question"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* Main Conversation Stream */}
      <section
        className="lg:col-span-8 rounded-xl border flex flex-col h-[700px]"
        style={{
          backgroundColor: "var(--bg-surface)",
          borderColor: "var(--border-hairline)",
        }}
      >
        <div
          className="px-5 py-4 border-b flex flex-wrap items-center justify-between gap-2"
          style={{ borderColor: "var(--border-hairline)" }}
        >
          <div>
            <h2 className="text-lg font-bold">
              {isAr ? `البوت التعليمي الذكي — ${lesson.title}` : `Smart Educational Chatbot — ${lesson.title}`}
            </h2>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              {isAr
                ? "يدعم الكتابة والصوت بالعربية والإنجليزية والرد الموثق بمصادر الدرس"
                : "Supports Arabic & English text/voice, level adaptation, and source-grounded answers"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                sendMessage(
                  userRole === "teacher"
                    ? isAr
                      ? `اقترح خطة شرح بديلة ونشاطاً مكيّفاً لطلبة صعوبات التعلم في درس "${lesson.title}".`
                      : `Suggest an alternative teaching plan and inclusive activity for "${lesson.title}".`
                    : isAr
                    ? `اختبر فهمي في درس "${lesson.title}" بتمرين سريع.`
                    : `Test my understanding of "${lesson.title}" with a quick exercise.`,
                  userRole === "teacher" ? "teacher_assist" : "exercise"
                )
              }
              className="min-h-[38px] px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 whitespace-nowrap"
              style={{ borderColor: "var(--border-hairline)" }}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>
                {userRole === "teacher"
                  ? isAr ? "مقترح تكييف للمعلم" : "Teacher Differentiation"
                  : isAr ? "توليد تمرين سريع" : "Quick Practice"}
              </span>
            </button>
          </div>
        </div>

        {/* Message List */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-3">
              <Sparkles className="w-8 h-8" style={{ color: "var(--accent-primary)" }} />
              <h3 className="text-base font-bold">
                {isAr ? "ابدأ الحوار العلمي بالكتابة أو الصوت" : "Start a Bilingual Science Dialogue"}
              </h3>
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                {isAr
                  ? "يمكنك طلب شرح فكرة، مثال حياتي، تمرين تفاعلي، أو اختبار مدى ارتباط السؤال بمصادر الدرس المعتمدة."
                  : "Ask for a concept explanation, real-world example, interactive exercise, or test strict lesson-source grounding."}
              </p>
              <div className="flex flex-wrap justify-center gap-2 pt-2">
                {(isAr
                  ? [
                      "اشرح لي الفكرة الأساسية لهذا الدرس بخطوات بسيطة",
                      "أعطني مثالاً عملياً من حياتنا اليومية",
                      "Explain the key concept in simple English",
                    ]
                  : [
                      "Explain the main concept of this lesson in simple steps",
                      "Give me a practical everyday example",
                      "Detect weak spots and give me a remedial question",
                    ]
                ).map((sample) => (
                  <button
                    key={sample}
                    type="button"
                    onClick={() => sendMessage(sample)}
                    className="px-3 py-2 rounded-lg border text-xs font-medium hover:opacity-80"
                    style={{
                      backgroundColor: "var(--bg-subtle)",
                      borderColor: "var(--border-hairline)",
                    }}
                  >
                    {sample}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.sender === "user" ? "items-start" : "items-end"}`}
            >
              <div
                className="max-w-[90%] rounded-xl border p-4 space-y-3"
                style={{
                  backgroundColor: msg.sender === "user" ? "var(--bg-subtle)" : "var(--bg-surface)",
                  borderColor:
                    msg.sender === "assistant" ? "var(--accent-primary)" : "var(--border-hairline)",
                }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">
                      {msg.sender === "user"
                        ? msg.roleContext === "teacher"
                          ? isAr ? "المعلم" : "Teacher"
                          : isAr ? "الطالب" : "Student"
                        : isAr ? "المساعد العلمي الذكي" : "Smart Science AI Tutor"}
                      {msg.inputMode === "voice" ? (isAr ? " · رسالة صوتية" : " · Voice") : ""}
                    </span>
                    {msg.sender === "assistant" && (
                      <span
                        className="px-2 py-0.5 rounded-md text-[10px] font-bold border"
                        style={
                          msg.isDemoPreset
                            ? { backgroundColor: "#fef3c7", borderColor: "#f59e0b", color: "#92400e" }
                            : { backgroundColor: "var(--bg-subtle)", borderColor: "var(--accent-primary)", color: "var(--accent-primary)" }
                        }
                      >
                        {msg.isDemoPreset
                          ? isAr
                            ? "محتوى تجريبي مسبق (Demo) — غير مولّد بالذكاء الاصطناعي"
                            : "Preset Demo Sample — Not Live AI"
                          : isAr
                            ? "مولّد فعلياً بالذكاء الاصطناعي"
                            : "Live AI Generated"}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono-num">{msg.timestamp}</span>
                    {msg.sender === "assistant" && (
                      <button
                        type="button"
                        onClick={() => handleReadMessage(msg.text, msg.languageUsed || chatLanguage)}
                        aria-label={isAr ? "قراءة الرد صوتياً" : "Read response aloud"}
                        className="px-2 py-1 rounded border flex items-center gap-1 hover:opacity-80"
                        style={{ borderColor: "var(--border-hairline)" }}
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                        <span>{isAr ? "استمع" : "Listen"}</span>
                      </button>
                    )}
                  </div>
                </div>

                {msg.outOfScopeNotice && (
                  <div
                    className="p-3 rounded-lg border text-xs flex items-start gap-2"
                    style={{
                      backgroundColor: "var(--bg-subtle)",
                      borderColor: "var(--border-hairline)",
                    }}
                  >
                    <AlertCircle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
                    <span>{msg.outOfScopeNotice}</span>
                  </div>
                )}

                <p className="text-sm leading-relaxed whitespace-pre-line">{msg.text}</p>

                {msg.alternativeExplanation && (
                  <div
                    className="p-3 rounded-lg border space-y-1 text-sm"
                    style={{
                      backgroundColor: "var(--bg-subtle)",
                      borderColor: "var(--border-hairline)",
                    }}
                  >
                    <div className="flex items-center gap-1.5 text-xs font-bold" style={{ color: "var(--accent-primary)" }}>
                      <Lightbulb className="w-3.5 h-3.5" />
                      <span>{isAr ? "شرح بديل مبسط يناسب مستواك" : "Simplified Alternative Explanation"}</span>
                    </div>
                    <p className="leading-relaxed">{msg.alternativeExplanation}</p>
                  </div>
                )}

                {msg.quickExercise &&
                  renderExerciseCard(
                    `${msg.id}-quick`,
                    isAr ? "تمرين تحقق تفاعلي" : "Interactive Practice Question",
                    msg.quickExercise
                  )}

                {msg.remedialQuestions && msg.remedialQuestions.length > 0 && (
                  <div className="space-y-2.5">
                    {msg.remedialQuestions.map((rq, idx) =>
                      renderExerciseCard(
                        `${msg.id}-remedial-${idx}`,
                        isAr ? `سؤال علاجي مقترح #${idx + 1}` : `Targeted Remedial Question #${idx + 1}`,
                        rq
                      )
                    )}
                  </div>
                )}

                {msg.citations && msg.citations.length > 0 && (
                  <div className="pt-2 border-t space-y-1" style={{ borderColor: "var(--border-hairline)" }}>
                    <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
                      <BookMarked className="w-3.5 h-3.5" />
                      <span>{isAr ? "الاستناد إلى المصادر:" : "Source Citations:"}</span>
                    </div>
                    {msg.citations.map((cit, i) => (
                      <div key={i} className="text-xs" style={{ color: "var(--text-secondary)" }}>
                        • {cit.sourceTitle} (
                        {cit.withinApprovedSources
                          ? isAr ? "من مصادر الدرس المعتمدة" : "Approved Lesson Source"
                          : isAr ? "معلومة منهجية مساندة" : "Supporting Curriculum"}
                        )
                      </div>
                    ))}
                  </div>
                )}

                {msg.followUpSuggestions && msg.followUpSuggestions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {msg.followUpSuggestions.map((sug, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => sendMessage(sug)}
                        className="px-2.5 py-1 rounded-md border text-xs hover:opacity-80"
                        style={{
                          backgroundColor: "var(--bg-subtle)",
                          borderColor: "var(--border-hairline)",
                        }}
                      >
                        {sug}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {isSending && (
            <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-secondary)" }}>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>
                {isAr
                  ? "جارٍ تحليل السؤال والتحقق من مصادر الدرس..."
                  : "Analyzing question and verifying lesson sources..."}
              </span>
            </div>
          )}

          {errorMsg && (
            <div
              role="alert"
              className="p-3.5 rounded-xl border flex flex-wrap items-center justify-between gap-3 text-xs"
              style={{
                backgroundColor: "#fff1f2",
                borderColor: "#fda4af",
                color: "#9f1239",
              }}
            >
              <div className="flex items-center gap-2 font-semibold">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {messages.length > 0 && messages[messages.length - 1]?.sender === "user" && (
                  <>
                    <button
                      type="button"
                      onClick={() => sendMessage(messages[messages.length - 1].text)}
                      disabled={isSending}
                      className="px-3 py-1.5 rounded-lg border font-bold bg-white hover:opacity-90"
                      style={{ borderColor: "#fda4af", color: "#9f1239" }}
                    >
                      {isAr ? "إعادة المحاولة" : "Retry"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const lastUserText = messages[messages.length - 1].text;
                        const demo = buildDemoChatReply({
                          query: lastUserText,
                          lesson,
                          role: userRole,
                          actionMode,
                          language: chatLanguage,
                          uiLang,
                        });
                        setErrorMsg(null);
                        onToggleDemoMode?.(true);
                        onAddMessage({
                          id: `demo-${Date.now()}`,
                          sender: "assistant",
                          roleContext: userRole,
                          text: demo.reply,
                          timestamp: new Date().toLocaleTimeString(isAr ? "ar-EG" : "en-US", {
                            hour: "2-digit",
                            minute: "2-digit",
                          }),
                          languageUsed: chatLanguage,
                          citations: demo.citations,
                          alternativeExplanation: demo.alternativeExplanation,
                          quickExercise: demo.quickExercise,
                          followUpSuggestions: demo.followUpSuggestions,
                          isDemoPreset: true,
                          isAiGenerated: false,
                        });
                      }}
                      className="px-3 py-1.5 rounded-lg border font-bold bg-amber-100 hover:opacity-90"
                      style={{ borderColor: "#f59e0b", color: "#92400e" }}
                    >
                      {isAr ? "عرض رد تجريبي (Demo Mode)" : "Use Demo Mode"}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Composer */}
        <div className="p-4 border-t space-y-2" style={{ borderColor: "var(--border-hairline)" }}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage();
            }}
            className="flex items-center gap-2"
          >
            <button
              type="button"
              onClick={toggleVoiceRecording}
              disabled={isTranscribing}
              aria-label={isRecording ? (isAr ? "إيقاف التسجيل الصوتي" : "Stop voice recording") : isAr ? "تسجيل سؤال صوتي" : "Record voice question"}
              className="min-h-[44px] min-w-[44px] px-3 rounded-lg border flex items-center justify-center gap-1.5 text-sm font-medium shrink-0"
              style={{
                borderColor: isRecording ? "#dc2626" : "var(--border-hairline)",
                backgroundColor: isRecording ? "var(--bg-subtle)" : "transparent",
              }}
            >
              {isTranscribing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : isRecording ? (
                <>
                  <Square className="w-4 h-4 text-red-600" />
                  <span className="text-xs">{isAr ? "إيقاف" : "Stop"}</span>
                </>
              ) : (
                <Mic className="w-4 h-4" />
              )}
            </button>

            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                isRecording
                  ? isAr ? "جارٍ الاستماع لصوتك..." : "Listening..."
                  : isTranscribing
                  ? isAr ? "جارٍ تحويل الصوت إلى نص..." : "Transcribing audio..."
                  : isAr ? "اكتب سؤالك العلمي بالعربية أو الإنجليزية أو استخدم الميكروفون..." : "Type your question in Arabic or English, or use voice..."
              }
              aria-label={isAr ? "نص الرسالة للمساعد الذكي" : "AI Tutor message input"}
              className="flex-1 min-h-[44px] px-3.5 py-2 rounded-lg border text-sm"
              style={{
                backgroundColor: "var(--bg-subtle)",
                borderColor: "var(--border-hairline)",
                color: "var(--text-primary)",
              }}
            />

            <button
              type="submit"
              disabled={isSending || !input.trim()}
              className="min-h-[44px] px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50 shrink-0"
              style={{
                backgroundColor: "var(--accent-primary)",
                color: "var(--accent-contrast)",
              }}
            >
              <Send className="w-4 h-4" />
              <span>{isAr ? "إرسال" : "Send"}</span>
            </button>
          </form>
        </div>
      </section>
    </div>
  );
};

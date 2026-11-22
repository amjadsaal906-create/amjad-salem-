import React, { useState, useEffect } from "react";
import {
  Volume2,
  CheckCircle2,
  XCircle,
  Lightbulb,
  Sparkles,
  Loader2,
  Eye,
  RotateCcw,
} from "lucide-react";
import type { AccessibilitySettings, LessonData, QuizQuestion } from "../types.ts";
import { speakWithBrowser } from "../utils/speech.ts";
import { getAiPhaseMessage, type AiRequestPhase } from "../utils/apiClient.ts";
import { generateAdaptiveQuizQuestion } from "../utils/aiApi.ts";

interface AdaptiveQuizStudioProps {
  lesson: LessonData;
  settings: AccessibilitySettings;
  weakConcepts: string[];
  onRecordQuizWeakSpot: (concept: string, observation: string, suggestedRemediation: string) => void;
  onAskBotRemediation: (prompt: string) => void;
}

export const AdaptiveQuizStudio: React.FC<AdaptiveQuizStudioProps> = ({
  lesson,
  settings,
  weakConcepts,
  onRecordQuizWeakSpot,
  onAskBotRemediation,
}) => {
  const [questions, setQuestions] = useState<QuizQuestion[]>(lesson.quizQuestions);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [showVisualCue, setShowVisualCue] = useState(
    settings.accommodations.includes("learning_difficulty")
  );
  const [useSimplifiedWording, setUseSimplifiedWording] = useState(settings.simplifiedMode);
  const [score, setScore] = useState(0);
  const [answeredIds, setAnsweredIds] = useState<Record<string, boolean>>({});
  const [generating, setGenerating] = useState(false);
  const [requestPhase, setRequestPhase] = useState<AiRequestPhase>("idle");
  const [genError, setGenError] = useState<string | null>(null);

  useEffect(() => {
    setQuestions(lesson.quizQuestions);
    setCurrentIndex(0);
    setSelectedOption(null);
    setShowHint(false);
    setScore(0);
    setAnsweredIds({});
    setGenError(null);
  }, [lesson]);

  useEffect(() => {
    setUseSimplifiedWording(settings.simplifiedMode);
  }, [settings.simplifiedMode]);

  const currentQuestion = questions[currentIndex];

  // Support keyboard number keys 1-4 for motor accessibility
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!currentQuestion) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (["1", "2", "3", "4"].includes(e.key)) {
        const idx = Number(e.key) - 1;
        if (idx < currentQuestion.options.length && selectedOption === null) {
          handleSelectOption(idx);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const handleSelectOption = (idx: number) => {
    if (!currentQuestion || selectedOption !== null) return;
    setSelectedOption(idx);
    const isCorrect = idx === currentQuestion.correctIndex;

    if (!answeredIds[currentQuestion.id]) {
      setAnsweredIds((prev) => ({ ...prev, [currentQuestion.id]: true }));
      if (isCorrect) {
        setScore((s) => s + 1);
      } else {
        onRecordQuizWeakSpot(
          currentQuestion.concept,
          `أخطأ الطالب في سؤال حول "${currentQuestion.concept}"`,
          currentQuestion.explanation
        );
      }
    }
  };

  const handleGenerateAdaptiveQuestion = async () => {
    if (!settings.aiProcessingConsent) {
      setGenError("يرجى تفعيل موافقة المعالجة بالذكاء الاصطناعي من إعدادات الخصوصية أولاً.");
      return;
    }
    setGenerating(true);
    setGenError(null);

    try {
      const answeredCount = Object.keys(answeredIds).length;
      const accuracyPct = answeredCount > 0 ? Math.round((score / answeredCount) * 100) : 70;
      const adaptiveDifficulty =
        settings.simplifiedMode || accuracyPct < 55
          ? "easy"
          : accuracyPct >= 85 && answeredCount >= 2
            ? "hard"
            : "medium";
      const data = await generateAdaptiveQuizQuestion(
        {
          lessonTitle: lesson.title,
          sources: lesson.sources.filter((s) => s.enabled),
          weakConcepts,
          accommodations: settings.accommodations,
          difficulty: adaptiveDifficulty,
          studentLevel: settings.simplifiedMode ? "beginner" : accuracyPct >= 85 && answeredCount >= 2 ? "advanced" : "intermediate",
          studentStats: { answered: answeredCount, correct: score },
          language: "ar",
        },
        { onPhaseChange: setRequestPhase }
      );
      setQuestions((prev) => [...prev, data]);
      setCurrentIndex(questions.length);
      setSelectedOption(null);
      setShowHint(false);
    } catch (err) {
      setGenError(
        err instanceof Error ? err.message : "تعذر الاتصال بخدمة توليد الاختبارات."
      );
    } finally {
      setGenerating(false);
    }
  };

  if (!currentQuestion) return null;

  const displayedPrompt = useSimplifiedWording
    ? currentQuestion.simplifiedPrompt
    : currentQuestion.prompt;

  return (
    <div className="space-y-6">
      <section
        className="rounded-xl border p-6 space-y-5"
        style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}
      >
        <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4" style={{ borderColor: "var(--border-hairline)" }}>
          <div>
            <h1 className="text-xl font-bold">الأنشطة والاختبارات المرنة — {lesson.title}</h1>
            <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
              وضع غير مؤقت خالٍ من التوتر · يدعم القراءة الصوتية · اختيار عبر الأرقام 1–4 بلوحة المفاتيح
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono-num text-sm font-bold px-3 py-1.5 rounded-lg border" style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}>
              النتيجة: {score} / {Object.keys(answeredIds).length || questions.length}
            </span>
            <button
              type="button"
              onClick={handleGenerateAdaptiveQuestion}
              disabled={generating}
              className="min-h-[42px] px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5"
              style={{ backgroundColor: "var(--accent-primary)", color: "var(--accent-contrast)" }}
            >
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              <span>
                {generating
                  ? getAiPhaseMessage(requestPhase, "ar") || "جاري إنشاء السؤال التكيفي..."
                  : "توليد سؤال تكيفي لمستواك"}
              </span>
            </button>
          </div>
        </div>

        {genError && (
          <p className="text-xs text-red-600 dark:text-red-400" role="alert">
            {genError}
          </p>
        )}

        {/* Adaptation Controls Bar */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() =>
              speakWithBrowser(
                `${displayedPrompt}. الخيارات: ${currentQuestion.options
                  .map((o, i) => `${i + 1}: ${o}`)
                  .join("، ")}`,
                settings.speechRate
              )
            }
            className="min-h-[40px] px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5"
            style={{ borderColor: "var(--border-hairline)" }}
          >
            <Volume2 className="w-4 h-4" />
            <span>قراءة السؤال والخيارات صوتياً</span>
          </button>

          <button
            type="button"
            onClick={() => setUseSimplifiedWording((v) => !v)}
            aria-pressed={useSimplifiedWording}
            className="min-h-[40px] px-3 py-1.5 rounded-lg border text-xs font-medium"
            style={{
              borderColor: useSimplifiedWording ? "var(--accent-primary)" : "var(--border-hairline)",
              backgroundColor: useSimplifiedWording ? "var(--bg-subtle)" : "transparent",
            }}
          >
            {useSimplifiedWording ? "العودة للصياغة القياسية" : "تبسيط صياغة السؤال"}
          </button>

          <button
            type="button"
            onClick={() => setShowHint((h) => !h)}
            className="min-h-[40px] px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5"
            style={{ borderColor: "var(--border-hairline)" }}
          >
            <Lightbulb className="w-4 h-4" />
            <span>{showHint ? "إخفاء التلميح" : "تلميح ميسّر"}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowVisualCue((v) => !v)}
            className="min-h-[40px] px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5"
            style={{ borderColor: "var(--border-hairline)" }}
          >
            <Eye className="w-4 h-4" />
            <span>{showVisualCue ? "إخفاء التمثيل البصري" : "تمثيل ذهني مساعد"}</span>
          </button>
        </div>

        {/* Question Card */}
        <div
          className="p-5 rounded-xl border space-y-4"
          style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}
        >
          <div className="flex items-center justify-between text-xs" style={{ color: "var(--text-secondary)" }}>
            <span className="font-mono-num font-bold">
              السؤال {currentIndex + 1} من {questions.length} · المفهوم: {currentQuestion.concept}
            </span>
            <span>
              المستوى:{" "}
              {currentQuestion.difficulty === "easy"
                ? "أساسي ميسّر"
                : currentQuestion.difficulty === "medium"
                ? "متوسط"
                : "تحدي"}
            </span>
          </div>

          <h2 className="text-lg font-bold leading-relaxed">{displayedPrompt}</h2>

          {showHint && (
            <div className="p-3 rounded-lg border text-xs" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}>
              <strong>تلميح مساعد: </strong>
              {currentQuestion.hint}
            </div>
          )}

          {showVisualCue && (
            <div className="p-3 rounded-lg border text-xs" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}>
              <strong>تصور ذهني: </strong>
              {currentQuestion.visualCue}
            </div>
          )}

          <div className="space-y-2.5">
            {currentQuestion.options.map((opt, idx) => {
              const isSelected = selectedOption === idx;
              const isRevealed = selectedOption !== null;
              const isCorrect = idx === currentQuestion.correctIndex;

              return (
                <button
                  key={idx}
                  type="button"
                  disabled={isRevealed}
                  onClick={() => handleSelectOption(idx)}
                  className="w-full min-h-[48px] px-4 py-3 rounded-lg border text-right text-sm font-medium flex items-center justify-between gap-3 transition-colors"
                  style={{
                    backgroundColor: isSelected ? "var(--bg-surface)" : "var(--bg-surface)",
                    borderColor:
                      isRevealed && isCorrect
                        ? "#059669"
                        : isSelected && !isCorrect
                        ? "#dc2626"
                        : "var(--border-hairline)",
                    borderWidth: isRevealed && (isCorrect || isSelected) ? "2px" : "1px",
                  }}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="w-7 h-7 rounded-md border flex items-center justify-center font-mono-num text-xs shrink-0"
                      style={{ borderColor: "var(--border-hairline)" }}
                    >
                      {idx + 1}
                    </span>
                    <span>{opt}</span>
                  </div>

                  {isRevealed && isCorrect && (
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>صحيحة</span>
                    </span>
                  )}
                  {isRevealed && isSelected && !isCorrect && (
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-red-600">
                      <XCircle className="w-4 h-4" />
                      <span>غير دقيقة</span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {selectedOption !== null && (
            <div
              className="p-4 rounded-lg border space-y-2"
              style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}
            >
              <div className="text-sm font-bold">
                {selectedOption === currentQuestion.correctIndex
                  ? "أحسنت! إجابة موفقة."
                  : "لا بأس، هذه فرصة ممتازة لتثبيت المفهوم:"}
              </div>
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                {currentQuestion.explanation}
              </p>
              {selectedOption !== currentQuestion.correctIndex && (
                <button
                  type="button"
                  onClick={() =>
                    onAskBotRemediation(
                      `أخطأت في سؤال حول "${currentQuestion.concept}". اشرح لي الفكرة بطريقة بديلة ومبسطة مع مثال.`
                    )
                  }
                  className="text-xs font-bold underline pt-1"
                  style={{ color: "var(--accent-primary)" }}
                >
                  اطلب شرحاً بديلاً من المساعد الذكي حول هذا المفهوم
                </button>
              )}
            </div>
          )}
        </div>

        {/* Navigation Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={currentIndex === 0}
              onClick={() => {
                setCurrentIndex((i) => Math.max(0, i - 1));
                setSelectedOption(null);
                setShowHint(false);
              }}
              className="min-h-[42px] px-4 py-2 rounded-lg border text-sm font-medium disabled:opacity-40"
              style={{ borderColor: "var(--border-hairline)" }}
            >
              السابق
            </button>
            <button
              type="button"
              disabled={currentIndex >= questions.length - 1}
              onClick={() => {
                setCurrentIndex((i) => Math.min(questions.length - 1, i + 1));
                setSelectedOption(null);
                setShowHint(false);
              }}
              className="min-h-[42px] px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40"
              style={{ backgroundColor: "var(--accent-primary)", color: "var(--accent-contrast)" }}
            >
              السؤال التالي
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              setCurrentIndex(0);
              setSelectedOption(null);
              setScore(0);
              setAnsweredIds({});
              setShowHint(false);
            }}
            className="min-h-[42px] px-3 py-2 rounded-lg border text-xs font-medium flex items-center gap-1.5"
            style={{ borderColor: "var(--border-hairline)" }}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>إعادة النشاط</span>
          </button>
        </div>
      </section>
    </div>
  );
};

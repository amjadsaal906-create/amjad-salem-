import React, { useState, useEffect, useMemo } from "react";
import {
  Volume2,
  Square,
  Eye,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Sliders,
  Captions,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Loader2,
  BookOpen,
} from "lucide-react";
import type {
  AccessibilitySettings,
  ImageDescriptionResult,
  LessonData,
  SimplifiedStep,
  UILanguage,
} from "../types.ts";
import { speakWithBrowser, speakWithGeminiTTS, stopAllSpeech } from "../utils/speech.ts";

interface ScienceSimulationProps {
  lesson: LessonData;
  settings: AccessibilitySettings;
  onAskBotAboutConcept: (prompt: string) => void;
  onToggleSimplified: () => void;
  uiLang?: UILanguage;
}

export const ScienceSimulation: React.FC<ScienceSimulationProps> = ({
  lesson,
  settings,
  onAskBotAboutConcept,
  onToggleSimplified,
  uiLang = "ar",
}) => {
  const isAr = uiLang === "ar";
  const [simValues, setSimValues] = useState<Record<string, number>>({});
  const [imgError, setImgError] = useState(false);

  // Audio Narration & Captions state
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [ttsEngine, setTtsEngine] = useState<"gemini" | "browser">("browser");
  const [ttsError, setTtsError] = useState<string | null>(null);
  const [captionIndex, setCaptionIndex] = useState(0);

  // Vision Description for Blind / Low-Vision
  const [visionLoading, setVisionLoading] = useState(false);
  const [visionResult, setVisionResult] = useState<ImageDescriptionResult | null>(null);
  const [visionError, setVisionError] = useState<string | null>(null);

  // Short-step simplification state
  const [simplifyLoading, setSimplifyLoading] = useState(false);
  const [simplifiedSteps, setSimplifiedSteps] = useState<SimplifiedStep[] | null>(null);
  const [simplifyError, setSimplifyError] = useState<string | null>(null);
  const [activeStepIdx, setActiveStepIdx] = useState(0);

  useEffect(() => {
    const defaults: Record<string, number> = {};
    lesson.simulationControls.forEach((ctrl) => {
      defaults[ctrl.id] = ctrl.defaultValue;
    });
    setSimValues(defaults);
    setImgError(false);
    setVisionResult(null);
    setVisionError(null);
    setSimplifiedSteps(null);
    setSimplifyError(null);
    setActiveStepIdx(0);
    setCaptionIndex(0);
    stopAllSpeech();
    setIsSpeaking(false);
  }, [lesson]);

  const captionSentences = useMemo(() => {
    return lesson.audioLessonScript
      .split(/(?<=[.،؟])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }, [lesson.audioLessonScript]);

  useEffect(() => {
    if (!isSpeaking || captionSentences.length <= 1) return;
    const intervalMs = Math.max(2400, Math.round(3600 / settings.speechRate));
    const timer = window.setInterval(() => {
      setCaptionIndex((prev) => (prev + 1 < captionSentences.length ? prev + 1 : prev));
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [isSpeaking, captionSentences.length, settings.speechRate]);

  // Compute live scientific simulation output
  const simulationReadout = useMemo(() => {
    if (lesson.id === "photosynthesis") {
      const sun = simValues.sunlight ?? 75;
      const co2 = simValues.co2 ?? 400;
      const water = simValues.water ?? 80;
      const co2Factor = Math.min(100, (co2 / 600) * 100);
      const rate = Math.round(Math.min(sun, co2Factor, water) * 0.92 + ((sun + co2Factor + water) / 3) * 0.08);
      const limiting =
        sun <= co2Factor && sun <= water
          ? "شدة الإضاءة"
          : co2Factor <= sun && co2Factor <= water
          ? "تركيز ثاني أكسيد الكربون"
          : "توافر الماء";
      const status =
        rate >= 65
          ? { label: "إنتاج نشط ومستقر", tone: "nominal" as const }
          : rate >= 35
          ? { label: "معدل متوسط — عامل محدد", tone: "warning" as const }
          : { label: "تباطؤ شديد في التفاعل", tone: "critical" as const };
      return {
        primaryMetric: `${rate}%`,
        primaryLabel: "معدل إنتاج الجلوكوز والأكسجين",
        secondaryMetric: limiting,
        secondaryLabel: "العامل المحدد حالياً",
        status,
        rate,
      };
    }

    if (lesson.id === "circulatory") {
      const po2 = simValues.oxygenPressure ?? 95;
      const ph = simValues.bloodPh ?? 7.4;
      const bohrShift = (7.4 - ph) * 28;
      const effectiveP50 = Math.max(15, 27 + bohrShift);
      const saturation = Math.min(
        99,
        Math.max(18, Math.round((Math.pow(po2, 2.5) / (Math.pow(po2, 2.5) + Math.pow(effectiveP50, 2.5))) * 100))
      );
      const status =
        saturation >= 90
          ? { label: "ارتباط طبيعي ممتاز", tone: "nominal" as const }
          : saturation >= 65
          ? { label: "تحرير مرتفع للأنسجة (تأثير بور)", tone: "warning" as const }
          : { label: "تشبع منخفض — يتطلب تعويضاً", tone: "critical" as const };
      return {
        primaryMetric: `${saturation}%`,
        primaryLabel: "تشبع الهيموجلوبين بالأكسجين",
        secondaryMetric: `${effectiveP50.toFixed(1)} mmHg`,
        secondaryLabel: "نقطة نصف التشبع (P50)",
        status,
        rate: saturation,
      };
    }

    if (lesson.id === "physics-waves") {
      const f = simValues.frequency ?? 5;
      const lambda = simValues.wavelength ?? 4;
      const speed = f * lambda;
      const status =
        speed >= 80
          ? { label: isAr ? "موجة سريعة عالية الطاقة" : "High-velocity wave", tone: "nominal" as const }
          : speed >= 30
          ? { label: isAr ? "انتشار موجي قياسي" : "Standard propagation", tone: "warning" as const }
          : { label: isAr ? "سرعة انتشار منخفضة" : "Low propagation speed", tone: "critical" as const };
      return {
        primaryMetric: `${speed.toFixed(1)} m/s`,
        primaryLabel: isAr ? "سرعة انتشار الموجة (v = f × λ)" : "Wave Speed (v = f × λ)",
        secondaryMetric: `${(1 / f).toFixed(2)} s`,
        secondaryLabel: isAr ? "الزمن الدوري (T = 1/f)" : "Wave Period (T = 1/f)",
        status,
        rate: Math.min(100, Math.round((speed / 200) * 100)),
      };
    }

    if (lesson.id === "geology-tectonics") {
      const temp = simValues.mantleTemp ?? 1350;
      const speed = simValues.plateSpeed ?? 5;
      const subductionIntensity = Math.round(((temp - 900) / 900) * 50 + (speed / 12) * 50);
      const status =
        subductionIntensity >= 70
          ? { label: isAr ? "نشاط اندساس وبركانية مرتفع" : "High subduction & volcanism", tone: "critical" as const }
          : subductionIntensity >= 40
          ? { label: isAr ? "حركة تكتونية نشطة ومستقرة" : "Active plate convergence", tone: "nominal" as const }
          : { label: isAr ? "انجراف قاري بطيء" : "Slow continental drift", tone: "warning" as const };
      return {
        primaryMetric: `${(speed * 100).toFixed(0)} km / Myr`,
        primaryLabel: isAr ? "معدل الإزاحة التكتونية لكل مليون سنة" : "Tectonic Displacement Rate",
        secondaryMetric: `${temp} °C`,
        secondaryLabel: isAr ? "طاقة الحمل الحراري في الوشاح" : "Mantle Convection Temp",
        status,
        rate: Math.min(100, Math.max(10, subductionIntensity)),
      };
    }

    if (lesson.id === "math-functions") {
      const m = simValues.slope ?? 1;
      const x = simValues.pointX ?? 3;
      const y = simValues.pointY ?? 4;
      const r = Math.sqrt(x * x + y * y);
      const linearVal = m * x;
      const status =
        Math.abs(r - Math.round(r)) < 0.01
          ? { label: isAr ? "ثلاثية فيثاغورس صحيحة!" : "Exact Pythagorean triple!", tone: "nominal" as const }
          : { label: isAr ? "متجه إحداثي نشط" : "Active coordinate vector", tone: "warning" as const };
      return {
        primaryMetric: `r = ${r.toFixed(2)}`,
        primaryLabel: isAr ? "طول الوتر الإحداثي √(x² + y²)" : "Vector Magnitude √(x² + y²)",
        secondaryMetric: `y(${x}) = ${linearVal.toFixed(1)}`,
        secondaryLabel: isAr ? "قيمة الدالة الخطية y = mx" : "Linear Output y = mx",
        status,
        rate: Math.min(100, Math.round((r / 14.2) * 100)),
      };
    }

    const deltaEN = simValues.electronegativityDiff ?? 1.2;
    const energy = simValues.thermalEnergy ?? 100;
    const bondType =
      deltaEN >= 1.7
        ? isAr ? "رابطة أيونية (انتقال إلكترون)" : "Ionic Bond (electron transfer)"
        : deltaEN >= 0.4
        ? isAr ? "رابطة تساهمية قطبية (مثل H₂O)" : "Polar Covalent Bond (e.g. H₂O)"
        : isAr ? "رابطة تساهمية غير قطبية" : "Non-polar Covalent Bond";
    const status =
      energy > 380
        ? { label: isAr ? "طاقة عالية — تفكك جزئي للروابط" : "High energy — partial dissociation", tone: "critical" as const }
        : deltaEN >= 1.7
        ? { label: isAr ? "تجاذب أيوني قوي" : "Strong ionic attraction", tone: "nominal" as const }
        : { label: isAr ? "تشارك إلكتروني مستقر" : "Stable electron sharing", tone: "warning" as const };

    return {
      primaryMetric: bondType,
      primaryLabel: isAr ? "نوع الرابطة المتوقعة" : "Predicted Bond Type",
      secondaryMetric: `${deltaEN.toFixed(1)} ΔEN`,
      secondaryLabel: isAr ? "فرق السالبية الكهربائية" : "Electronegativity Diff",
      status,
      rate: Math.min(100, Math.round((deltaEN / 3.0) * 100)),
    };
  }, [lesson.id, simValues, isAr]);

  const handlePlayAudioLesson = async () => {
    if (isSpeaking) {
      stopAllSpeech();
      setIsSpeaking(false);
      return;
    }

    setTtsError(null);
    setCaptionIndex(0);
    const textToSpeak = settings.simplifiedMode ? lesson.simplifiedSummary : lesson.audioLessonScript;

    if (ttsEngine === "gemini") {
      setIsSpeaking(true);
      const result = await speakWithGeminiTTS(
        textToSpeak,
        settings.speechRate,
        () => setIsSpeaking(true),
        () => setIsSpeaking(false)
      );
      if (!result.ok) {
        setIsSpeaking(false);
        setTtsError(result.error || "تعذر تشغيل صوت الذكاء الاصطناعي، يمكنك التبديل لقارئ المتصفح.");
      }
    } else {
      setIsSpeaking(true);
      speakWithBrowser(
        textToSpeak,
        settings.speechRate,
        () => setIsSpeaking(false),
        (msg) => {
          setIsSpeaking(false);
          setTtsError(msg);
        }
      );
    }
  };

  const handleDescribeDiagramWithAI = async () => {
    if (!settings.aiProcessingConsent) {
      setVisionError("يرجى تفعيل موافقة المعالجة بالذكاء الاصطناعي من إعدادات الخصوصية أولاً.");
      return;
    }
    setVisionLoading(true);
    setVisionError(null);
    try {
      const res = await fetch("/api/describe-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl: lesson.diagramUrl,
          lessonTitle: lesson.title,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setVisionError(data.message || "تعذر تحليل الرسم العلمي.");
      } else {
        setVisionResult(data);
      }
    } catch {
      setVisionError("تعذر الاتصال بخدمة الوصف البصري.");
    } finally {
      setVisionLoading(false);
    }
  };

  const handleSimplifyLessonWithAI = async () => {
    if (!settings.aiProcessingConsent) {
      setSimplifyError("يرجى تفعيل موافقة المعالجة بالذكاء الاصطناعي من إعدادات الخصوصية أولاً.");
      return;
    }
    setSimplifyLoading(true);
    setSimplifyError(null);
    const combinedText = `${lesson.summary}\n\n${lesson.sources
      .filter((s) => s.enabled)
      .map((s) => s.content)
      .join("\n")}`;

    try {
      const res = await fetch("/api/simplify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: combinedText,
          lessonTitle: lesson.title,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSimplifyError(data.message || "تعذر تبسيط المحتوى حالياً.");
      } else {
        setSimplifiedSteps(data.steps || []);
        setActiveStepIdx(0);
      }
    } catch {
      setSimplifyError("تعذر الاتصال بخدمة تبسيط المحتوى.");
    } finally {
      setSimplifyLoading(false);
    }
  };

  const readVisionDescription = () => {
    const text = visionResult
      ? `${visionResult.shortAlt}. ${visionResult.detailedSpatialDescription}. الخلاصة: ${visionResult.keyTakeaway}`
      : lesson.diagramBaselineAlt;
    speakWithBrowser(text, settings.speechRate);
  };

  return (
    <div className="space-y-6">
      {/* Lesson Header Summary */}
      <section
        className="rounded-xl border p-6"
        style={{
          backgroundColor: "var(--bg-surface)",
          borderColor: "var(--border-hairline)",
        }}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-xs mb-2" style={{ color: "var(--text-secondary)" }}>
              <span>{lesson.subject}</span>
              <span aria-hidden="true">·</span>
              <span>{lesson.gradeLevel}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-num">{lesson.estimatedMinutes} دقيقة</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-bold leading-snug">{lesson.title}</h1>
            <p className="mt-3 text-base leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              {settings.simplifiedMode ? lesson.simplifiedSummary : lesson.summary}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={onToggleSimplified}
              aria-pressed={settings.simplifiedMode}
              className="min-h-[44px] px-4 py-2 rounded-lg border text-sm font-medium flex items-center gap-2 transition-colors whitespace-nowrap"
              style={{
                borderColor: settings.simplifiedMode ? "var(--accent-primary)" : "var(--border-hairline)",
                backgroundColor: settings.simplifiedMode ? "var(--bg-subtle)" : "transparent",
              }}
            >
              <BookOpen className="w-4 h-4 shrink-0" />
              <span>{settings.simplifiedMode ? "عرض الشرح الكامل" : "تبسيط لخطوات قصيرة"}</span>
            </button>
            <button
              type="button"
              onClick={() => onAskBotAboutConcept(`اشرح لي درس "${lesson.title}" بطريقة مبسطة مع مثال عملي.`)}
              className="min-h-[44px] px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors whitespace-nowrap"
              style={{
                backgroundColor: "var(--accent-primary)",
                color: "var(--accent-contrast)",
              }}
            >
              <Sparkles className="w-4 h-4 shrink-0" />
              <span>اسأل المساعد الذكي</span>
            </button>
          </div>
        </div>

        {/* Audio Lesson Player + Synchronized Closed Captions */}
        <div
          className="mt-5 p-4 rounded-lg border flex flex-col gap-3"
          style={{
            backgroundColor: "var(--bg-subtle)",
            borderColor: "var(--border-hairline)",
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handlePlayAudioLesson}
                className="min-h-[44px] px-4 py-2 rounded-lg font-medium text-sm flex items-center gap-2 transition-colors whitespace-nowrap"
                style={{
                  backgroundColor: "var(--accent-primary)",
                  color: "var(--accent-contrast)",
                }}
              >
                {isSpeaking ? (
                  <>
                    <Square className="w-4 h-4 shrink-0" />
                    <span>إيقاف الشرح الصوتي</span>
                  </>
                ) : (
                  <>
                    <Volume2 className="w-4 h-4 shrink-0" />
                    <span>استماع للدرس صوتياً</span>
                  </>
                )}
              </button>

              <div
                className="flex items-center p-1 rounded-lg border text-xs"
                style={{
                  backgroundColor: "var(--bg-surface)",
                  borderColor: "var(--border-hairline)",
                }}
              >
                <button
                  type="button"
                  onClick={() => setTtsEngine("browser")}
                  className="px-3 py-1.5 rounded-md font-medium whitespace-nowrap transition-colors"
                  style={{
                    backgroundColor: ttsEngine === "browser" ? "var(--accent-primary)" : "transparent",
                    color: ttsEngine === "browser" ? "var(--accent-contrast)" : "var(--text-secondary)",
                  }}
                >
                  قارئ المتصفح الفوري
                </button>
                <button
                  type="button"
                  onClick={() => setTtsEngine("gemini")}
                  className="px-3 py-1.5 rounded-md font-medium whitespace-nowrap transition-colors"
                  style={{
                    backgroundColor: ttsEngine === "gemini" ? "var(--accent-primary)" : "transparent",
                    color: ttsEngine === "gemini" ? "var(--accent-contrast)" : "var(--text-secondary)",
                  }}
                >
                  صوت Gemini الذكي
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
              <Captions className="w-4 h-4" />
              <span>{settings.captionsEnabled ? "الترجمة النصية الفورية مفعّلة" : "الترجمة مخفية"}</span>
            </div>
          </div>

          {ttsError && (
            <p className="text-xs font-medium text-amber-700 dark:text-amber-300" role="alert">
              {ttsError}
            </p>
          )}

          {settings.captionsEnabled && (
            <div
              className="p-3 rounded-lg border text-sm leading-relaxed"
              aria-live="polite"
              style={{
                backgroundColor: "var(--bg-surface)",
                borderColor: "var(--border-hairline)",
              }}
            >
              <span className="text-xs font-mono-num ml-2 font-semibold" style={{ color: "var(--accent-primary)" }}>
                [CC {captionIndex + 1}/{captionSentences.length}]
              </span>
              <span>{captionSentences[captionIndex] || lesson.audioLessonScript}</span>
            </div>
          )}
        </div>
      </section>

      {/* Two-Zone Interactive Sandbox Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left/Main Zone (7 cols): Scientific Diagram + Accessible Visual Description */}
        <section
          className="science-card lg:col-span-7 rounded-xl border p-6 flex flex-col justify-between gap-4"
          style={{
            backgroundColor: "var(--bg-surface)",
            borderColor: "var(--border-hairline)",
          }}
        >
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <h2 className="text-lg font-bold">{lesson.diagramTitle}</h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={readVisionDescription}
                  className="min-h-[40px] px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 whitespace-nowrap hover:opacity-80"
                  style={{ borderColor: "var(--border-hairline)" }}
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>قراءة الوصف للمكفوفين</span>
                </button>
                <button
                  type="button"
                  onClick={handleDescribeDiagramWithAI}
                  disabled={visionLoading}
                  className="min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 whitespace-nowrap transition-colors"
                  style={{
                    backgroundColor: "var(--accent-primary)",
                    color: "var(--accent-contrast)",
                  }}
                >
                  {visionLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Eye className="w-3.5 h-3.5" />
                  )}
                  <span>تحليل الرسم بصرياً بالذكاء الاصطناعي</span>
                </button>
              </div>
            </div>

            <div
              className="rounded-lg overflow-hidden border"
              style={{
                borderColor: "var(--border-hairline)",
                backgroundColor: "var(--bg-subtle)",
              }}
            >
              {!imgError ? (
                <img
                  src={lesson.diagramUrl}
                  alt={visionResult?.shortAlt || lesson.diagramBaselineAlt}
                  referrerPolicy="no-referrer"
                  onError={() => setImgError(true)}
                  className="w-full h-72 object-cover"
                />
              ) : (
                <div className="w-full h-72 flex flex-col items-center justify-center p-6 text-center">
                  <Eye className="w-10 h-10 mb-2" style={{ color: "var(--accent-primary)" }} />
                  <p className="font-semibold text-sm">{lesson.diagramTitle}</p>
                  <p className="text-xs mt-1 max-w-md" style={{ color: "var(--text-secondary)" }}>
                    {lesson.diagramBaselineAlt}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Accessible Spatial Description Box */}
          <div
            className="p-4 rounded-lg border space-y-2"
            style={{
              backgroundColor: "var(--bg-subtle)",
              borderColor: "var(--border-hairline)",
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold" style={{ color: "var(--accent-primary)" }}>
                وصف الرسم العلمي للمكفوفين وضعاف البصر
              </span>
              {visionResult && (
                <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  تم التوليد عبر الرؤية الحاسوبية
                </span>
              )}
            </div>

            {visionError && (
              <p className="text-xs text-red-600 dark:text-red-400" role="alert">
                {visionError}
              </p>
            )}

            {visionResult ? (
              <div className="space-y-2 text-sm">
                <p className="font-semibold">{visionResult.shortAlt}</p>
                <p style={{ color: "var(--text-secondary)" }}>
                  {visionResult.detailedSpatialDescription}
                </p>
                <ul className="list-disc list-inside space-y-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                  {visionResult.scientificComponents.map((comp, i) => (
                    <li key={i}>{comp}</li>
                  ))}
                </ul>
                <p className="text-xs font-semibold pt-1">الخلاصة العلمية: {visionResult.keyTakeaway}</p>
              </div>
            ) : (
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                {lesson.diagramBaselineAlt}
              </p>
            )}
          </div>
        </section>

        {/* Right/Control Zone (5 cols): Interactive Simulation Controls OR Extracted Lesson Formulas & Concepts */}
        <section
          className="science-card lg:col-span-5 rounded-xl border p-6 flex flex-col justify-between gap-5"
          style={{
            backgroundColor: "var(--bg-surface)",
            borderColor: "var(--border-hairline)",
          }}
        >
          {lesson.simulationControls.length > 0 ? (
            <>
              <div className="space-y-5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Sliders className="w-5 h-5" style={{ color: "var(--accent-primary)" }} />
                    <h2 className="text-lg font-bold">{isAr ? "المختبر التفاعلي للدرس" : "Interactive Lesson Lab"}</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const defaults: Record<string, number> = {};
                      lesson.simulationControls.forEach((c) => {
                        defaults[c.id] = c.defaultValue;
                      });
                      setSimValues(defaults);
                    }}
                    className="min-h-[36px] px-3 py-1 rounded-lg border text-xs font-medium flex items-center gap-1.5 hover:opacity-80"
                    style={{ borderColor: "var(--border-hairline)" }}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>{isAr ? "إعادة ضبط" : "Reset"}</span>
                  </button>
                </div>

                {/* Live Dual-Coded Readout Card */}
                <div
                  className="p-4 rounded-lg border space-y-3"
                  style={{
                    backgroundColor: "var(--bg-subtle)",
                    borderColor: "var(--border-hairline)",
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                      {simulationReadout.primaryLabel}
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
                      {simulationReadout.status.tone === "nominal" ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                      )}
                      <span>{simulationReadout.status.label}</span>
                    </span>
                  </div>

                  <div className="text-2xl font-bold font-mono-num" style={{ color: "var(--accent-primary)" }}>
                    {simulationReadout.primaryMetric}
                  </div>

                  <div className="w-full h-3 rounded-full overflow-hidden bg-slate-200 dark:bg-slate-700">
                    <div
                      className="h-full transition-all duration-200"
                      style={{
                        width: `${simulationReadout.rate}%`,
                        backgroundColor: "var(--accent-primary)",
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-xs pt-1" style={{ color: "var(--text-secondary)" }}>
                    <span>{simulationReadout.secondaryLabel}:</span>
                    <span className="font-mono-num font-semibold" style={{ color: "var(--text-primary)" }}>
                      {simulationReadout.secondaryMetric}
                    </span>
                  </div>
                </div>

                {/* Parameter Sliders */}
                <div className="space-y-4">
                  {lesson.simulationControls.map((ctrl) => {
                    const current = simValues[ctrl.id] ?? ctrl.defaultValue;
                    return (
                      <div key={ctrl.id}>
                        <div className="flex items-center justify-between text-sm mb-1.5">
                          <label htmlFor={`sim-${ctrl.id}`} className="font-semibold">
                            {ctrl.label}
                          </label>
                          <span className="font-mono-num text-xs font-semibold" style={{ color: "var(--accent-primary)" }}>
                            {current} {ctrl.unit}
                          </span>
                        </div>
                        <input
                          id={`sim-${ctrl.id}`}
                          type="range"
                          min={ctrl.min}
                          max={ctrl.max}
                          step={ctrl.step}
                          value={current}
                          onChange={(e) =>
                            setSimValues((prev) => ({
                              ...prev,
                              [ctrl.id]: Number(e.target.value),
                            }))
                          }
                          className="w-full accent-sky-600"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  onAskBotAboutConcept(
                    isAr
                      ? `في محاكاة "${lesson.title}"، وصلت النتيجة إلى ${simulationReadout.primaryMetric} (${simulationReadout.status.label}). لماذا حدث ذلك علمياً؟`
                      : `In the "${lesson.title}" simulation, why did the metric reach ${simulationReadout.primaryMetric}?`
                  )
                }
                className="w-full min-h-[44px] px-4 py-2 rounded-lg border text-sm font-medium flex items-center justify-center gap-2 hover:opacity-80"
                style={{ borderColor: "var(--border-hairline)" }}
              >
                <Sparkles className="w-4 h-4" />
                <span>{isAr ? "فسّر هذه النتيجة مع المساعد الذكي" : "Explain Result with AI Tutor"}</span>
              </button>
            </>
          ) : (
            <>
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-5 h-5" style={{ color: "var(--accent-primary)" }} />
                  <h2 className="text-lg font-bold">
                    {isAr ? "المفاهيم والقوانين المستخرجة من الدرس" : "Extracted Concepts & Key Rules"}
                  </h2>
                </div>

                {lesson.extractedAnalysis ? (
                  <div className="space-y-3 text-xs">
                    {lesson.extractedAnalysis.objectives.length > 0 && (
                      <div className="p-3.5 rounded-lg border space-y-1.5" style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}>
                        <div className="font-bold" style={{ color: "var(--accent-primary)" }}>
                          {isAr ? "الأهداف التعليمية" : "Learning Objectives"}
                        </div>
                        <ul className="list-disc list-inside space-y-1">
                          {lesson.extractedAnalysis.objectives.map((obj, idx) => (
                            <li key={idx}>{obj}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {lesson.extractedAnalysis.keyFormulasOrRules.length > 0 && (
                      <div className="p-3.5 rounded-lg border space-y-1.5" style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}>
                        <div className="font-bold" style={{ color: "var(--accent-primary)" }}>
                          {isAr ? "القوانين والمعادلات الأساسية" : "Key Formulas & Rules"}
                        </div>
                        {lesson.extractedAnalysis.keyFormulasOrRules.map((f, idx) => (
                          <div key={idx} className="font-mono-num" dir="auto">
                            • {f}
                          </div>
                        ))}
                      </div>
                    )}

                    {lesson.extractedAnalysis.concepts.length > 0 && (
                      <div className="p-3.5 rounded-lg border space-y-1" style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}>
                        <div className="font-bold" style={{ color: "var(--accent-primary)" }}>
                          {isAr ? "المفاهيم المحورية" : "Core Concepts"}
                        </div>
                        <p>{lesson.extractedAnalysis.concepts.join(" · ")}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                    {lesson.summary}
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() =>
                  onAskBotAboutConcept(
                    isAr
                      ? `اشرح لي المفاهيم الأساسية والقوانين في درس "${lesson.title}" مع مثال تطبيقي.`
                      : `Explain the core concepts and rules in "${lesson.title}" with an example.`
                  )
                }
                className="w-full min-h-[44px] px-4 py-2 rounded-lg border text-sm font-medium flex items-center justify-center gap-2 hover:opacity-80"
                style={{ borderColor: "var(--border-hairline)" }}
              >
                <Sparkles className="w-4 h-4" />
                <span>{isAr ? "ناقش هذا الدرس مع المساعد الذكي" : "Discuss with AI Tutor"}</span>
              </button>
            </>
          )}
        </section>
      </div>

      {/* Step-by-Step Simplified Content Chunking Section */}
      <section
        className="rounded-xl border p-6 space-y-4"
        style={{
          backgroundColor: "var(--bg-surface)",
          borderColor: "var(--border-hairline)",
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">تبسيط الدرس إلى خطوات قصيرة (لدعم صعوبات التعلم)</h2>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
              تقسيم المفاهيم إلى بطاقات متدرجة مع سؤال تحقق سريع لكل خطوة
            </p>
          </div>
          <button
            type="button"
            onClick={handleSimplifyLessonWithAI}
            disabled={simplifyLoading}
            className="min-h-[44px] px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 whitespace-nowrap"
            style={{
              backgroundColor: "var(--accent-primary)",
              color: "var(--accent-contrast)",
            }}
          >
            {simplifyLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            <span>توليد خطوات مبسطة بالذكاء الاصطناعي</span>
          </button>
        </div>

        {simplifyError && (
          <p className="text-xs text-red-600 dark:text-red-400" role="alert">
            {simplifyError}
          </p>
        )}

        {simplifiedSteps && simplifiedSteps.length > 0 ? (
          <div
            className="p-5 rounded-lg border space-y-4"
            style={{
              backgroundColor: "var(--bg-subtle)",
              borderColor: "var(--border-hairline)",
            }}
          >
            <div className="flex items-center justify-between text-xs">
              <span className="font-mono-num font-bold" style={{ color: "var(--accent-primary)" }}>
                الخطوة {simplifiedSteps[activeStepIdx].stepNumber} من {simplifiedSteps.length}
              </span>
              <button
                type="button"
                onClick={() =>
                  speakWithBrowser(
                    `${simplifiedSteps[activeStepIdx].title}. ${simplifiedSteps[activeStepIdx].simpleSentence}`,
                    settings.speechRate
                  )
                }
                className="px-3 py-1 rounded-md border flex items-center gap-1.5"
                style={{ borderColor: "var(--border-hairline)", backgroundColor: "var(--bg-surface)" }}
              >
                <Volume2 className="w-3.5 h-3.5" />
                <span>استمع للخطوة</span>
              </button>
            </div>

            <h3 className="text-lg font-bold">{simplifiedSteps[activeStepIdx].title}</h3>
            <p className="text-base leading-relaxed">{simplifiedSteps[activeStepIdx].simpleSentence}</p>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              تلميح بصري: {simplifiedSteps[activeStepIdx].visualCue}
            </p>
            <div
              className="p-3 rounded-lg border text-sm"
              style={{
                backgroundColor: "var(--bg-surface)",
                borderColor: "var(--border-hairline)",
              }}
            >
              <span className="font-semibold">تحقق سريع: </span>
              <span>{simplifiedSteps[activeStepIdx].checkQuestion}</span>
            </div>

            <div className="flex items-center justify-between gap-3 pt-1">
              <button
                type="button"
                disabled={activeStepIdx === 0}
                onClick={() => setActiveStepIdx((i) => Math.max(0, i - 1))}
                className="min-h-[40px] px-4 py-2 rounded-lg border text-sm font-medium flex items-center gap-1.5 disabled:opacity-40"
                style={{ borderColor: "var(--border-hairline)", backgroundColor: "var(--bg-surface)" }}
              >
                <ChevronRight className="w-4 h-4" />
                <span>الخطوة السابقة</span>
              </button>
              <button
                type="button"
                disabled={activeStepIdx >= simplifiedSteps.length - 1}
                onClick={() => setActiveStepIdx((i) => Math.min(simplifiedSteps.length - 1, i + 1))}
                className="min-h-[40px] px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 disabled:opacity-40"
                style={{
                  backgroundColor: "var(--accent-primary)",
                  color: "var(--accent-contrast)",
                }}
              >
                <span>الخطوة التالية</span>
                <ChevronLeft className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {lesson.sources
              .filter((s) => s.enabled)
              .map((src, idx) => (
                <div
                  key={src.id}
                  className="p-4 rounded-lg border space-y-2"
                  style={{
                    backgroundColor: "var(--bg-subtle)",
                    borderColor: "var(--border-hairline)",
                  }}
                >
                  <div className="flex items-center justify-between text-xs" style={{ color: "var(--text-secondary)" }}>
                    <span className="font-mono-num font-semibold">0{idx + 1}.</span>
                    <span>{src.category}</span>
                  </div>
                  <h3 className="text-sm font-bold">{src.title}</h3>
                  <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                    {src.content}
                  </p>
                </div>
              ))}
          </div>
        )}
      </section>
    </div>
  );
};

import React, { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  Atom,
  BookOpen,
  Bot,
  Camera,
  CheckCircle2,
  Droplets,
  Eye,
  FlaskConical,
  HelpCircle,
  ImagePlus,
  Leaf,
  Lightbulb,
  Loader2,
  Mountain,
  RefreshCw,
  RotateCcw,
  Sparkles,
  SwitchCamera,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type { AccessibilitySettings, StudentLevel, UILanguage } from "../types.ts";
import {
  buildDemoDiscoveryResult,
  type WorldDiscoveryResult,
} from "../utils/demoSamples.ts";
import { speakWithBrowser, stopAllSpeech } from "../utils/speech.ts";

interface DiscoverWorldExplorerProps {
  uiLang: UILanguage;
  settings: AccessibilitySettings;
  studentLevel: StudentLevel;
  demoMode: boolean;
  onToggleDemoMode: (enabled: boolean) => void;
  onBackToHome: () => void;
  onAskChatbot: (prompt: string) => void;
}

type DiscoveryProvenance = "live_ai" | "preset_demo";

interface SavedDiscoveryItem {
  id: string;
  createdAt: string;
  imageDataUrl: string;
  provenance: DiscoveryProvenance;
  result: WorldDiscoveryResult;
}

const DISCOVERY_HISTORY_KEY = "smart_science_world_discoveries_v1";

function buildPresetPreviewSvgDataUrl(
  preset: "leaf" | "water" | "lamp" | "rock",
  isAr: boolean
): string {
  const configs: Record<
    typeof preset,
    { bg1: string; bg2: string; label: string; emoji: string }
  > = {
    leaf: {
      bg1: "#10b981",
      bg2: "#047857",
      label: isAr ? "ورقة نبات" : "Plant Leaf",
      emoji: "🌿",
    },
    water: {
      bg1: "#0ea5e9",
      bg2: "#0369a1",
      label: isAr ? "ماء وثلج" : "Water & Ice",
      emoji: "🧊",
    },
    lamp: {
      bg1: "#f59e0b",
      bg2: "#d97706",
      label: isAr ? "مصباح إضاءة" : "LED Lamp",
      emoji: "💡",
    },
    rock: {
      bg1: "#8b5cf6",
      bg2: "#6d28d9",
      label: isAr ? "عينة صخرية" : "Rock Specimen",
      emoji: "🪨",
    },
  };
  const cfg = configs[preset];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="220" viewBox="0 0 320 220">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${cfg.bg1}" />
        <stop offset="100%" stop-color="${cfg.bg2}" />
      </linearGradient>
    </defs>
    <rect width="320" height="220" rx="20" fill="url(#g)" />
    <circle cx="160" cy="92" r="46" fill="rgba(255,255,255,0.22)" />
    <text x="160" y="108" font-size="48" text-anchor="middle">${cfg.emoji}</text>
    <text x="160" y="176" font-size="20" font-family="sans-serif" font-weight="bold" fill="#ffffff" text-anchor="middle">${cfg.label}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function readFileAsDataUrl(file: File): Promise<{ dataUrl: string; base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("تعذر قراءة ملف الصورة."));
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/s);
      const mimeType = match ? match[1] : file.type || "image/jpeg";
      const base64 = match ? match[2] : dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
      resolve({ dataUrl, base64, mimeType });
    };
    reader.readAsDataURL(file);
  });
}

async function resizeImageFileToJpeg(
  file: File,
  maxDim = 1024,
  quality = 0.85
): Promise<{ dataUrl: string; base64: string; mimeType: string }> {
  const objectUrl = typeof URL !== "undefined" && URL.createObjectURL ? URL.createObjectURL(file) : null;
  if (!objectUrl) {
    return readFileAsDataUrl(file);
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = async () => {
      URL.revokeObjectURL(objectUrl);
      try {
        // Fallback for formats the browser canvas cannot decode (e.g., HEIC/HEIF)
        const raw = await readFileAsDataUrl(file);
        resolve(raw);
      } catch (err) {
        reject(err);
      }
    };
    img.onload = async () => {
      try {
        const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
        const targetW = Math.max(1, Math.round((img.width || 800) * scale));
        const targetH = Math.max(1, Math.round((img.height || 600) * scale));
        const canvas = document.createElement("canvas");
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          URL.revokeObjectURL(objectUrl);
          const raw = await readFileAsDataUrl(file);
          resolve(raw);
          return;
        }
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, targetW, targetH);
        ctx.drawImage(img, 0, 0, targetW, targetH);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
        URL.revokeObjectURL(objectUrl);
        resolve({ dataUrl, base64, mimeType: "image/jpeg" });
      } catch {
        URL.revokeObjectURL(objectUrl);
        try {
          const raw = await readFileAsDataUrl(file);
          resolve(raw);
        } catch (err) {
          reject(err);
        }
      }
    };
    img.src = objectUrl;
  });
}

function captureVideoFrameToJpeg(
  video: HTMLVideoElement,
  maxDim = 1024,
  quality = 0.86
): { dataUrl: string; base64: string; mimeType: string } | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;

  const scale = Math.min(1, maxDim / Math.max(vw, vh));
  const targetW = Math.max(1, Math.round(vw * scale));
  const targetH = Math.max(1, Math.round(vh * scale));
  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, targetW, targetH);
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
  return { dataUrl, base64, mimeType: "image/jpeg" };
}

export const DiscoverWorldExplorer: React.FC<DiscoverWorldExplorerProps> = ({
  uiLang,
  settings,
  studentLevel,
  demoMode,
  onToggleDemoMode,
  onBackToHome,
  onAskChatbot,
}) => {
  const isAr = uiLang === "ar";
  const BackArrow = isAr ? ArrowRight : ArrowLeft;
  const isSpecialTheme = settings.theme === "high-contrast" || settings.theme === "dark";

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<"environment" | "user">("environment");
  const [cameraError, setCameraError] = useState<string | null>(null);

  const [capturedImageUrl, setCapturedImageUrl] = useState<string | null>(null);
  const [capturedBase64, setCapturedBase64] = useState<string | null>(null);
  const [capturedMimeType, setCapturedMimeType] = useState<string>("image/jpeg");
  const [question, setQuestion] = useState("");

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [activeResult, setActiveResult] = useState<WorldDiscoveryResult | null>(null);
  const [resultProvenance, setResultProvenance] = useState<DiscoveryProvenance | null>(null);
  const [showFunAnswer, setShowFunAnswer] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const [history, setHistory] = useState<SavedDiscoveryItem[]>(() => {
    try {
      const raw = localStorage.getItem(DISCOVERY_HISTORY_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  const stopCameraStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraOpen(false);
  }, []);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      stopAllSpeech();
    };
  }, []);

  const persistHistoryItem = useCallback((item: SavedDiscoveryItem) => {
    setHistory((prev) => {
      const next = [item, ...prev.filter((p) => p.id !== item.id)].slice(0, 6);
      try {
        localStorage.setItem(DISCOVERY_HISTORY_KEY, JSON.stringify(next));
      } catch {
        // Storage quota might reject large images; store fewer if needed
        try {
          localStorage.setItem(DISCOVERY_HISTORY_KEY, JSON.stringify(next.slice(0, 2)));
        } catch {
          // Ignore
        }
      }
      return next;
    });
  }, []);

  const startLiveCamera = useCallback(
    async (facing: "environment" | "user" = cameraFacing) => {
      setCameraError(null);
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setCameraError(
          isAr
            ? "المتصفح الحالي لا يدعم فتح الكاميرا المباشرة هنا — استخدم زر «تصوير بكاميرا الجوال» أو «رفع صورة من الجهاز» بالأسفل."
            : "Live camera access is unavailable in this browser — please use Mobile Camera or Upload Photo below."
        );
        return;
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: facing,
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        streamRef.current = stream;
        setCameraOpen(true);
        requestAnimationFrame(() => {
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play().catch(() => {});
          }
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        const denied =
          msg.toLowerCase().includes("denied") ||
          msg.toLowerCase().includes("permission") ||
          msg.toLowerCase().includes("notallowed");
        setCameraError(
          denied
            ? isAr
              ? "لم يتم السماح بالوصول للكاميرا. يمكنك منح الإذن من شريط المتصفح أو استخدام «تصوير بكاميرا الجوال» / «رفع صورة من الجهاز»."
              : "Camera permission was denied. Allow camera access or use Mobile Camera / Upload Photo."
            : isAr
              ? "تعذر تشغيل الكاميرا المباشرة على هذا الجهاز. جرّب «تصوير بكاميرا الجوال» أو «رفع صورة من الجهاز»."
              : "Could not start live camera on this device. Try Mobile Camera or Upload Photo."
        );
        setCameraOpen(false);
      }
    },
    [cameraFacing, isAr]
  );

  const handleFlipCamera = useCallback(() => {
    const nextFacing = cameraFacing === "environment" ? "user" : "environment";
    setCameraFacing(nextFacing);
    if (cameraOpen) {
      startLiveCamera(nextFacing);
    }
  }, [cameraFacing, cameraOpen, startLiveCamera]);

  const analyzeImage = useCallback(
    async (
      base64: string,
      mimeType: string,
      dataUrl: string,
      customQuestion: string,
      forceDemo = false,
      forceLive = false
    ) => {
      setIsAnalyzing(true);
      setAnalysisError(null);
      setShowFunAnswer(false);

      if ((demoMode && !forceLive) || forceDemo) {
        const demoResult = buildDemoDiscoveryResult("custom", uiLang);
        setActiveResult(demoResult);
        setResultProvenance("preset_demo");
        persistHistoryItem({
          id: `disc-${Date.now()}`,
          createdAt: new Date().toLocaleTimeString(isAr ? "ar-EG" : "en-US", {
            hour: "2-digit",
            minute: "2-digit",
          }),
          imageDataUrl: dataUrl,
          provenance: "preset_demo",
          result: demoResult,
        });
        setIsAnalyzing(false);
        return;
      }

      try {
        const res = await fetch("/api/discover-object", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imageBase64: base64,
            mimeType,
            question: customQuestion.trim(),
            language: uiLang,
            studentLevel,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.objectName) {
          throw new Error(
            data.message ||
              (isAr
                ? "تعذر تحليل الصورة بالذكاء الاصطناعي حالياً."
                : "Could not analyze image with AI right now.")
          );
        }

        const parsed: WorldDiscoveryResult = {
          objectName: String(data.objectName || ""),
          discipline: String(data.discipline || (isAr ? "العلوم المتكاملة" : "General Science")),
          summary: String(data.summary || ""),
          scientificExplanation: String(data.scientificExplanation || ""),
          keyFacts: Array.isArray(data.keyFacts) ? data.keyFacts.map(String) : [],
          relatedConcepts: Array.isArray(data.relatedConcepts)
            ? data.relatedConcepts.map(String)
            : [],
          experimentIdea: String(data.experimentIdea || ""),
          funQuestion: String(data.funQuestion || ""),
          funAnswer: String(data.funAnswer || ""),
        };

        setActiveResult(parsed);
        setResultProvenance("live_ai");
        persistHistoryItem({
          id: `disc-${Date.now()}`,
          createdAt: new Date().toLocaleTimeString(isAr ? "ar-EG" : "en-US", {
            hour: "2-digit",
            minute: "2-digit",
          }),
          imageDataUrl: dataUrl,
          provenance: "live_ai",
          result: parsed,
        });

        if (settings.autoReadResponses) {
          const speechText = `${parsed.objectName}. ${parsed.summary}. ${parsed.scientificExplanation}`;
          setIsSpeaking(true);
          speakWithBrowser(
            speechText,
            settings.speechRate,
            () => setIsSpeaking(false),
            () => setIsSpeaking(false),
            uiLang
          );
        }
      } catch (err) {
        setAnalysisError(
          err instanceof Error
            ? err.message
            : isAr
              ? "تعذر الاتصال بخدمة تحليل الصور."
              : "Failed to connect to image analysis service."
        );
      } finally {
        setIsAnalyzing(false);
      }
    },
    [demoMode, isAr, persistHistoryItem, settings.autoReadResponses, settings.speechRate, studentLevel, uiLang]
  );

  const handleCaptureFromVideo = useCallback(() => {
    if (!videoRef.current) return;
    const captured = captureVideoFrameToJpeg(videoRef.current);
    if (!captured) {
      setCameraError(
        isAr ? "انتظر لحظة حتى تجهز صورة الكاميرا ثم حاول مجدداً." : "Camera frame is not ready yet."
      );
      return;
    }
    setCapturedImageUrl(captured.dataUrl);
    setCapturedBase64(captured.base64);
    setCapturedMimeType(captured.mimeType);
    stopCameraStream();
    analyzeImage(captured.base64, captured.mimeType, captured.dataUrl, question);
  }, [analyzeImage, isAr, question, stopCameraStream]);

  const processImageFile = useCallback(
    async (file: File) => {
      stopCameraStream();
      setAnalysisError(null);
      try {
        const resized = await resizeImageFileToJpeg(file);
        setCapturedImageUrl(resized.dataUrl);
        setCapturedBase64(resized.base64);
        setCapturedMimeType(resized.mimeType);
        await analyzeImage(resized.base64, resized.mimeType, resized.dataUrl, question);
      } catch (err) {
        setAnalysisError(
          err instanceof Error
            ? err.message
            : isAr
              ? "تعذر قراءة الصورة المختارة."
              : "Failed to read selected photo."
        );
      }
    },
    [analyzeImage, isAr, question, stopCameraStream]
  );

  const handleFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      await processImageFile(file);
    },
    [processImageFile]
  );

  const handleDropImage = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (file && (file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|heic|heif)$/i.test(file.name))) {
        await processImageFile(file);
      }
    },
    [processImageFile]
  );

  const handlePasteImage = useCallback(
    async (e: React.ClipboardEvent<HTMLDivElement>) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            await processImageFile(file);
            return;
          }
        }
      }
    },
    [processImageFile]
  );

  const handleLoadQuickDemoSample = useCallback(
    (preset: "leaf" | "water" | "lamp" | "rock") => {
      stopCameraStream();
      setAnalysisError(null);
      setShowFunAnswer(false);
      const demo = buildDemoDiscoveryResult(preset, uiLang);
      const svgUrl = buildPresetPreviewSvgDataUrl(preset, isAr);
      setCapturedImageUrl(svgUrl);
      setCapturedBase64(null);
      setActiveResult(demo);
      setResultProvenance("preset_demo");
      persistHistoryItem({
        id: `demo-${preset}-${Date.now()}`,
        createdAt: new Date().toLocaleTimeString(isAr ? "ar-EG" : "en-US", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        imageDataUrl: svgUrl,
        provenance: "preset_demo",
        result: demo,
      });
    },
    [isAr, persistHistoryItem, stopCameraStream, uiLang]
  );

  const handleReadResultAloud = () => {
    if (!activeResult) return;
    const text = [
      activeResult.objectName,
      activeResult.discipline,
      activeResult.summary,
      activeResult.scientificExplanation,
      activeResult.keyFacts.slice(0, 3).join(". "),
    ]
      .filter(Boolean)
      .join(". ");
    setIsSpeaking(true);
    speakWithBrowser(
      text,
      settings.speechRate,
      () => setIsSpeaking(false),
      () => setIsSpeaking(false),
      uiLang
    );
  };

  const quickSamples: Array<{
    key: "leaf" | "water" | "lamp" | "rock";
    labelAr: string;
    labelEn: string;
    color: string;
    icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  }> = [
    { key: "leaf", labelAr: "ورقة نبات", labelEn: "Plant Leaf", color: "#059669", icon: Leaf },
    { key: "water", labelAr: "ماء وثلج", labelEn: "Water & Ice", color: "#0284c7", icon: Droplets },
    { key: "lamp", labelAr: "مصباح إضاءة", labelEn: "LED Lamp", color: "#d97706", icon: Lightbulb },
    { key: "rock", labelAr: "عينة صخرية", labelEn: "Rock Specimen", color: "#7c3aed", icon: Mountain },
  ];

  return (
    <div className="space-y-6 pb-8">
      {/* ================================================================= */}
      {/* HEADER CARD WITH BACK BUTTON + MODE SWITCH                        */}
      {/* ================================================================= */}
      <motion.section
        initial={settings.reduceMotion ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        className="science-card rounded-3xl border overflow-hidden"
        style={{
          backgroundColor: "var(--bg-surface)",
          borderColor: "var(--border-hairline)",
        }}
      >
        <div
          className="h-1.5 w-full"
          style={{
            background: "linear-gradient(90deg, #10b981 0%, #0ea5e9 35%, #f59e0b 70%, #8b5cf6 100%)",
          }}
          aria-hidden="true"
        />
        <div className="p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <button
              type="button"
              onClick={onBackToHome}
              aria-label={isAr ? "العودة إلى الرئيسية" : "Back to Home"}
              title={isAr ? "العودة إلى الرئيسية" : "Back to Home"}
              className="w-11 h-11 rounded-2xl border flex items-center justify-center shrink-0 transition-transform hover:scale-105"
              style={{
                backgroundColor: "var(--bg-subtle)",
                borderColor: "var(--border-hairline)",
                color: "var(--text-primary)",
              }}
            >
              <BackArrow className="w-5 h-5" />
            </button>

            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="px-2.5 py-0.5 rounded-lg text-[11px] font-bold text-white"
                  style={{ background: "linear-gradient(135deg, #10b981 0%, #0284c7 100%)" }}
                >
                  {isAr ? "عدسة العلوم الذكية" : "Smart Science Lens"}
                </span>
                <span className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
                  {isAr ? "تصوير وتحليل علمي فوري" : "Snap & Explain Any Object"}
                </span>
              </div>
              <h1
                className="font-display text-xl sm:text-2xl font-bold"
                style={{ color: "var(--text-primary)" }}
              >
                {isAr ? "اكتشف العالم من حولك" : "Discover the World Around You"}
              </h1>
              <p className="text-xs sm:text-sm leading-relaxed max-w-2xl" style={{ color: "var(--text-secondary)" }}>
                {isAr
                  ? "صوّر أي شيء حولك بالكاميرا أو ارفع صورته (نبات، صخر، جهاز، سائل، أداة...)، وسيتعرف عليه ويشرح لك المعلومات العلمية والحقائق المرتبطة به فوراً."
                  : "Take a photo or upload an image of anything around you (plant, rock, device, liquid, tool...) and get instant scientific explanations and facts."}
              </p>
            </div>
          </div>

          {/* Live AI vs Demo Mode Toggle */}
          <div
            className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl border self-start lg:self-center shrink-0"
            style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}
          >
            <button
              type="button"
              onClick={() => {
                onToggleDemoMode(false);
                if (capturedBase64 && capturedImageUrl) {
                  analyzeImage(
                    capturedBase64,
                    capturedMimeType,
                    capturedImageUrl,
                    question,
                    false,
                    true
                  );
                }
              }}
              className="min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors"
              style={{
                background: !demoMode
                  ? "linear-gradient(135deg, #059669 0%, #0284c7 100%)"
                  : "transparent",
                color: !demoMode ? "#ffffff" : "var(--text-secondary)",
              }}
            >
              {isAr ? "الذكاء الاصطناعي المباشر" : "Live AI Vision"}
            </button>
            <button
              type="button"
              onClick={() => onToggleDemoMode(true)}
              className="min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors"
              style={{
                background: demoMode
                  ? "linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)"
                  : "transparent",
                color: demoMode ? "#ffffff" : "var(--text-secondary)",
              }}
            >
              {isAr ? "الوضع التجريبي (Demo)" : "Demo Mode"}
            </button>
          </div>
        </div>
      </motion.section>

      {/* ================================================================= */}
      {/* CAPTURE + RESULT TWO-COLUMN WORKSPACE                             */}
      {/* ================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT/START COLUMN: CAMERA, CAPTURE CONTROLS & QUICK SAMPLES */}
        <section
          className="lg:col-span-5 rounded-3xl border overflow-hidden science-card"
          style={{
            backgroundColor: "var(--bg-surface)",
            borderColor: "var(--border-hairline)",
          }}
        >
          <div className="p-5 space-y-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-base font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
                <Camera className="w-5 h-5" style={{ color: "#059669" }} />
                <span>{isAr ? "التقط صورة أو ارفعها" : "Capture or Upload Photo"}</span>
              </h2>
              {capturedImageUrl && (
                <button
                  type="button"
                  onClick={() => {
                    setCapturedImageUrl(null);
                    setCapturedBase64(null);
                    setActiveResult(null);
                    setResultProvenance(null);
                    setAnalysisError(null);
                  }}
                  className="text-xs font-semibold flex items-center gap-1 px-2.5 py-1 rounded-lg border"
                  style={{
                    backgroundColor: "var(--bg-subtle)",
                    borderColor: "var(--border-hairline)",
                    color: "var(--text-secondary)",
                  }}
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>{isAr ? "صورة جديدة" : "Reset"}</span>
                </button>
              )}
            </div>

            {/* Live Camera Viewfinder OR Preview Frame (supports Drop & Paste) */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDropImage}
              onPaste={handlePasteImage}
              tabIndex={0}
              className="relative rounded-2xl border overflow-hidden aspect-[4/3] flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
              style={{
                backgroundColor: isSpecialTheme ? "var(--bg-subtle)" : "#f0fdf4",
                borderColor: "var(--border-hairline)",
              }}
            >
              {cameraOpen ? (
                <>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute bottom-3 inset-x-3 flex items-center justify-center gap-2.5">
                    <button
                      type="button"
                      onClick={handleCaptureFromVideo}
                      className="min-h-[44px] px-4 py-2 rounded-xl text-xs font-bold text-white shadow-lg flex items-center gap-2"
                      style={{ background: "linear-gradient(135deg, #10b981 0%, #0284c7 100%)" }}
                    >
                      <Camera className="w-4 h-4" />
                      <span>{isAr ? "التقاط وتحليل الآن" : "Snap & Analyze"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleFlipCamera}
                      aria-label={isAr ? "تبديل الكاميرا" : "Switch camera"}
                      title={isAr ? "تبديل الكاميرا" : "Switch camera"}
                      className="w-11 h-11 rounded-xl bg-black/65 text-white flex items-center justify-center backdrop-blur-sm"
                    >
                      <SwitchCamera className="w-5 h-5" />
                    </button>
                    <button
                      type="button"
                      onClick={stopCameraStream}
                      aria-label={isAr ? "إغلاق الكاميرا" : "Close camera"}
                      title={isAr ? "إغلاق الكاميرا" : "Close camera"}
                      className="w-11 h-11 rounded-xl bg-red-600/85 text-white flex items-center justify-center backdrop-blur-sm"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </>
              ) : capturedImageUrl ? (
                <>
                  <img
                    src={capturedImageUrl}
                    alt={activeResult?.objectName || (isAr ? "الصورة الملتقطة" : "Captured object")}
                    className="w-full h-full object-contain bg-black/5"
                  />
                  {isAnalyzing && (
                    <div className="absolute inset-0 bg-black/50 backdrop-blur-xs flex flex-col items-center justify-center gap-2 text-white p-4 text-center">
                      <Loader2 className="w-8 h-8 animate-spin" />
                      <span className="text-sm font-bold">
                        {isAr ? "جارٍ التعرّف على العنصر وشرحه علمياً..." : "Identifying object & analyzing science..."}
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <div className="p-6 text-center space-y-3">
                  <div
                    className="w-16 h-16 rounded-3xl mx-auto flex items-center justify-center shadow-sm"
                    style={{
                      background: "linear-gradient(135deg, #10b981 0%, #0ea5e9 100%)",
                      color: "#ffffff",
                    }}
                  >
                    <Eye className="w-8 h-8" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                      {isAr ? "وجّه الكاميرا نحو أي شيء حولك!" : "Point your camera at anything around you!"}
                    </p>
                    <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                      {isAr
                        ? "ورقة شجر، كوب ماء، مغناطيس، مصباح، حجر، أو تجربة صفية — اختر طريقة التصوير بالأسفل."
                        : "A leaf, glass of water, magnet, lamp, rock, or lab setup — choose a capture option below."}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {cameraError && (
              <div
                className="p-3 rounded-xl border text-xs leading-relaxed"
                style={{
                  backgroundColor: "#fef3c7",
                  borderColor: "#f59e0b",
                  color: "#92400e",
                }}
              >
                {cameraError}
              </div>
            )}

            {/* 3 Reliable Capture Options */}
            <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={() => (cameraOpen ? stopCameraStream() : startLiveCamera(cameraFacing))}
                className="min-h-[46px] px-3 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-sm transition-transform hover:scale-[1.01]"
                style={{
                  background: cameraOpen
                    ? "#dc2626"
                    : "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                  color: "#ffffff",
                }}
              >
                <Camera className="w-4 h-4 shrink-0" />
                <span>
                  {cameraOpen
                    ? isAr
                      ? "إغلاق الكاميرا"
                      : "Close Camera"
                    : isAr
                      ? "كاميرا مباشرة"
                      : "Live Camera"}
                </span>
              </button>

              <label
                className="min-h-[46px] px-3 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 cursor-pointer shadow-sm transition-transform hover:scale-[1.01]"
                style={{
                  background: "linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)",
                  color: "#ffffff",
                }}
              >
                <Camera className="w-4 h-4 shrink-0" />
                <span>{isAr ? "تصوير الجوال" : "Phone Cam"}</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleFileSelected}
                  className="hidden"
                />
              </label>

              <label
                className="min-h-[46px] px-3 py-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors hover:opacity-90"
                style={{
                  backgroundColor: "var(--bg-subtle)",
                  borderColor: "var(--border-hairline)",
                  color: "var(--text-primary)",
                }}
              >
                <ImagePlus className="w-4 h-4 shrink-0" style={{ color: "#7c3aed" }} />
                <span>{isAr ? "رفع صورة" : "Upload Photo"}</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileSelected}
                  className="hidden"
                />
              </label>
            </div>

            {/* Optional Custom Question About Photo */}
            <div className="space-y-2 pt-1">
              <label
                htmlFor="discover-question-input"
                className="block text-xs font-bold"
                style={{ color: "var(--text-secondary)" }}
              >
                {isAr
                  ? "هل لديك سؤال محدد حول ما تصوّره؟ (اختياري)"
                  : "Ask a specific question about the photo (optional)"}
              </label>
              <div className="flex gap-2">
                <input
                  id="discover-question-input"
                  type="text"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder={
                    isAr
                      ? "مثال: لماذا لونه هكذا؟ أو كيف يعمل؟"
                      : "e.g., How does this work? Why is it colored like this?"
                  }
                  className="flex-1 min-h-[42px] px-3 rounded-xl border text-xs"
                  style={{
                    backgroundColor: "var(--bg-subtle)",
                    borderColor: "var(--border-hairline)",
                    color: "var(--text-primary)",
                  }}
                />
                {capturedBase64 && capturedImageUrl && (
                  <button
                    type="button"
                    disabled={isAnalyzing}
                    onClick={() =>
                      analyzeImage(
                        capturedBase64,
                        capturedMimeType,
                        capturedImageUrl,
                        question
                      )
                    }
                    className="min-h-[42px] px-3.5 rounded-xl text-xs font-bold text-white flex items-center gap-1.5 shrink-0 disabled:opacity-60"
                    style={{
                      background: "linear-gradient(135deg, #7c3aed 0%, #db2777 100%)",
                    }}
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isAnalyzing ? "animate-spin" : ""}`} />
                    <span>{isAr ? "تحليل الصورة" : "Analyze"}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Quick Interactive Demo Samples */}
            <div className="pt-3 border-t space-y-2.5" style={{ borderColor: "var(--border-hairline)" }}>
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold" style={{ color: "var(--text-primary)" }}>
                  {isAr ? "نماذج جاهزة للتجربة السريعة (Demo):" : "Quick Interactive Demo Samples:"}
                </span>
                <span className="text-[11px]" style={{ color: "#d97706" }}>
                  {isAr ? "محتوى مسبق" : "Preset"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {quickSamples.map((s) => {
                  const Icon = s.icon;
                  return (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => handleLoadQuickDemoSample(s.key)}
                      className="min-h-[42px] px-3 py-2 rounded-xl border text-xs font-semibold flex items-center gap-2 transition-all hover:-translate-y-0.5"
                      style={{
                        backgroundColor: isSpecialTheme ? "var(--bg-subtle)" : `${s.color}12`,
                        borderColor: `${s.color}40`,
                        color: "var(--text-primary)",
                      }}
                    >
                      <Icon className="w-4 h-4 shrink-0" style={{ color: s.color }} />
                      <span className="truncate">{isAr ? s.labelAr : s.labelEn}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* RIGHT/END COLUMN: SCIENTIFIC EXPLANATION PANEL */}
        <section
          className="lg:col-span-7 rounded-3xl border overflow-hidden science-card"
          style={{
            backgroundColor: "var(--bg-surface)",
            borderColor: "var(--border-hairline)",
          }}
        >
          <div className="p-5 sm:p-6 space-y-5">
            {analysisError && (
              <div
                className="p-4 rounded-2xl border space-y-3"
                style={{
                  backgroundColor: "#fef2f2",
                  borderColor: "#f87171",
                  color: "#991b1b",
                }}
              >
                <div className="text-xs sm:text-sm font-bold">{analysisError}</div>
                {capturedBase64 && capturedImageUrl && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={isAnalyzing}
                      onClick={() => {
                        onToggleDemoMode(false);
                        analyzeImage(
                          capturedBase64,
                          capturedMimeType,
                          capturedImageUrl,
                          question,
                          false,
                          true
                        );
                      }}
                      className="min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-bold text-white flex items-center gap-1.5"
                      style={{ backgroundColor: "#059669" }}
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isAnalyzing ? "animate-spin" : ""}`} />
                      <span>{isAr ? "إعادة تحليل الصورة" : "Retry Analysis"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onToggleDemoMode(true);
                        analyzeImage(
                          capturedBase64,
                          capturedMimeType,
                          capturedImageUrl,
                          question,
                          true
                        );
                      }}
                      className="min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-bold text-white"
                      style={{ backgroundColor: "#d97706" }}
                    >
                      {isAr
                        ? "عرض نموذج إرشادي في الوضع التجريبي (Demo Mode)"
                        : "View Preset Sample in Demo Mode"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {resultProvenance === "preset_demo" && capturedBase64 && capturedImageUrl && (
              <div
                className="p-4 rounded-2xl border flex flex-wrap items-center justify-between gap-3"
                style={{
                  backgroundColor: "#fef3c7",
                  borderColor: "#f59e0b",
                  color: "#92400e",
                }}
              >
                <div className="text-xs sm:text-sm font-bold">
                  {isAr
                    ? "الوضع التجريبي (Demo) مفعّل حالياً، لذلك لم تُرسَل صورتك للذكاء الاصطناعي للتعرف عليها بعد."
                    : "Demo Mode is currently active, so your photo wasn't sent to AI recognition yet."}
                </div>
                <button
                  type="button"
                  disabled={isAnalyzing}
                  onClick={() => {
                    onToggleDemoMode(false);
                    analyzeImage(
                      capturedBase64,
                      capturedMimeType,
                      capturedImageUrl,
                      question,
                      false,
                      true
                    );
                  }}
                  className="min-h-[38px] px-4 py-1.5 rounded-xl text-xs font-bold text-white shadow-sm shrink-0"
                  style={{ background: "linear-gradient(135deg, #059669 0%, #0284c7 100%)" }}
                >
                  {isAr ? "تحليل صورتي فعلياً الآن بالذكاء الاصطناعي" : "Recognize My Photo with Live AI Now"}
                </button>
              </div>
            )}

            {!activeResult ? (
              <div className="py-10 px-4 text-center space-y-4">
                <div
                  className="w-16 h-16 rounded-3xl mx-auto flex items-center justify-center"
                  style={{
                    background: "linear-gradient(135deg, #0ea5e9 0%, #8b5cf6 100%)",
                    color: "#ffffff",
                  }}
                >
                  <Sparkles className="w-8 h-8" />
                </div>
                <div className="space-y-1.5 max-w-md mx-auto">
                  <h2 className="font-display text-lg font-bold" style={{ color: "var(--text-primary)" }}>
                    {isAr ? "ماذا ستكتشف اليوم؟" : "What will you discover today?"}
                  </h2>
                  <p className="text-xs sm:text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                    {isAr
                      ? "بمجرد التقاط صورة أي شيء أو اختيار أحد النماذج الجاهزة، ستظهر هنا بطاقة علمية كاملة تتضمن: اسم العنصر، التخصص العلمي، التفسير المبسط، الحقائق، وتجربة مقترحة."
                      : "As soon as you capture a photo or pick a sample, a full scientific card appears here with object identity, science discipline, explanation, key facts, and an experiment idea."}
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 text-start max-w-2xl mx-auto">
                  <div
                    className="p-3.5 rounded-2xl border"
                    style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}
                  >
                    <Atom className="w-5 h-5 mb-1.5" style={{ color: "#0284c7" }} />
                    <div className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>
                      {isAr ? "1. تعرّف علمي فوري" : "1. Instant Identification"}
                    </div>
                    <p className="text-[11px] mt-0.5" style={{ color: "var(--text-secondary)" }}>
                      {isAr ? "يربط الصورة بالكيمياء والفيزياء والأحياء والجيولوجيا." : "Connects photos to Chemistry, Physics, Biology & Geology."}
                    </p>
                  </div>
                  <div
                    className="p-3.5 rounded-2xl border"
                    style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}
                  >
                    <FlaskConical className="w-5 h-5 mb-1.5" style={{ color: "#059669" }} />
                    <div className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>
                      {isAr ? "2. تجربة منزلية آمنة" : "2. Safe Mini-Experiment"}
                    </div>
                    <p className="text-[11px] mt-0.5" style={{ color: "var(--text-secondary)" }}>
                      {isAr ? "يقترح ملاحظة عملية بسيطة لتعميق الفهم." : "Suggests a hands-on observation to deepen learning."}
                    </p>
                  </div>
                  <div
                    className="p-3.5 rounded-2xl border"
                    style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}
                  >
                    <Volume2 className="w-5 h-5 mb-1.5" style={{ color: "#ea580c" }} />
                    <div className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>
                      {isAr ? "3. قراءة صوتية وسؤال" : "3. Audio & Tutor Follow-up"}
                    </div>
                    <p className="text-[11px] mt-0.5" style={{ color: "var(--text-secondary)" }}>
                      {isAr ? "استمع للشرح أو انتقل للمساعد الذكي." : "Listen aloud or continue with the Smart Assistant."}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                {/* Provenance + Discipline + Object Title */}
                <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b" style={{ borderColor: "var(--border-hairline)" }}>
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="px-2.5 py-0.5 rounded-lg text-[11px] font-bold"
                        style={{
                          backgroundColor:
                            resultProvenance === "live_ai" ? "#dcfce7" : "#fef3c7",
                          color:
                            resultProvenance === "live_ai" ? "#166534" : "#92400e",
                        }}
                      >
                        {resultProvenance === "live_ai"
                          ? isAr
                            ? "مولّد فعلياً بالذكاء الاصطناعي"
                            : "Generated via Live AI Vision"
                          : isAr
                            ? "محتوى تجريبي مسبق (Demo) — غير مولّد بالذكاء الاصطناعي"
                            : "Preset Demo Sample — Not Live AI"}
                      </span>

                      <span
                        className="px-2.5 py-0.5 rounded-lg text-[11px] font-bold"
                        style={{
                          backgroundColor: "rgba(2, 132, 199, 0.12)",
                          color: "#0284c7",
                        }}
                      >
                        {activeResult.discipline}
                      </span>
                    </div>

                    <h2 className="font-display text-xl sm:text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
                      {activeResult.objectName}
                    </h2>
                    <p className="text-sm leading-relaxed font-medium" style={{ color: "var(--text-secondary)" }}>
                      {activeResult.summary}
                    </p>
                  </div>

                  {/* Audio Controls */}
                  <div className="flex items-center gap-2 shrink-0">
                    {!isSpeaking ? (
                      <button
                        type="button"
                        onClick={handleReadResultAloud}
                        className="min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-bold text-white flex items-center gap-1.5 shadow-sm"
                        style={{ background: "linear-gradient(135deg, #0ea5e9 0%, #059669 100%)" }}
                      >
                        <Volume2 className="w-4 h-4" />
                        <span>{isAr ? "استمع للشرح" : "Listen"}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          stopAllSpeech();
                          setIsSpeaking(false);
                        }}
                        className="min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-bold text-white flex items-center gap-1.5"
                        style={{ backgroundColor: "#dc2626" }}
                      >
                        <VolumeX className="w-4 h-4" />
                        <span>{isAr ? "إيقاف الصوت" : "Stop Audio"}</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Scientific Explanation */}
                <div
                  className="p-4 rounded-2xl border space-y-1.5"
                  style={{
                    backgroundColor: "var(--bg-subtle)",
                    borderColor: "var(--border-hairline)",
                  }}
                >
                  <div className="text-xs font-bold flex items-center gap-1.5" style={{ color: "#0284c7" }}>
                    <BookOpen className="w-4 h-4" />
                    <span>{isAr ? "التفسير العلمي المفصّل" : "Scientific Explanation"}</span>
                  </div>
                  <p className="text-sm leading-relaxed" style={{ color: "var(--text-primary)" }}>
                    {activeResult.scientificExplanation}
                  </p>
                </div>

                {/* Key Scientific Facts */}
                {activeResult.keyFacts.length > 0 && (
                  <div className="space-y-2.5">
                    <div className="text-xs font-bold flex items-center gap-1.5" style={{ color: "#059669" }}>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>{isAr ? "حقائق علمية مهمة" : "Key Scientific Facts"}</span>
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      {activeResult.keyFacts.map((fact, idx) => (
                        <div
                          key={idx}
                          className="p-3 rounded-xl border flex items-start gap-2.5 text-xs sm:text-sm"
                          style={{
                            backgroundColor: isSpecialTheme ? "var(--bg-subtle)" : "rgba(16, 185, 129, 0.08)",
                            borderColor: "rgba(16, 185, 129, 0.3)",
                            color: "var(--text-primary)",
                          }}
                        >
                          <span
                            className="w-6 h-6 rounded-lg font-mono-num text-xs font-bold flex items-center justify-center shrink-0 text-white"
                            style={{ backgroundColor: "#059669" }}
                          >
                            {idx + 1}
                          </span>
                          <span className="leading-relaxed">{fact}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Related Curriculum Concepts */}
                {activeResult.relatedConcepts.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>
                      {isAr ? "المفاهيم العلمية المرتبطة في المنهج:" : "Related Science Concepts:"}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {activeResult.relatedConcepts.map((concept, idx) => {
                        const palette = ["#0284c7", "#7c3aed", "#ea580c", "#059669"];
                        const c = palette[idx % palette.length];
                        return (
                          <span
                            key={idx}
                            className="px-3 py-1 rounded-xl border text-xs font-bold"
                            style={{
                              backgroundColor: `${c}14`,
                              borderColor: `${c}40`,
                              color: c,
                            }}
                          >
                            {concept}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Experiment & Curiosity Challenge */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {activeResult.experimentIdea && (
                    <div
                      className="p-4 rounded-2xl border space-y-1.5"
                      style={{
                        backgroundColor: isSpecialTheme ? "var(--bg-subtle)" : "rgba(14, 165, 233, 0.09)",
                        borderColor: "rgba(14, 165, 233, 0.35)",
                      }}
                    >
                      <div className="text-xs font-bold flex items-center gap-1.5" style={{ color: "#0284c7" }}>
                        <FlaskConical className="w-4 h-4" />
                        <span>{isAr ? "جرّب واكتشف بنفسك" : "Try & Observe Yourself"}</span>
                      </div>
                      <p className="text-xs leading-relaxed" style={{ color: "var(--text-primary)" }}>
                        {activeResult.experimentIdea}
                      </p>
                    </div>
                  )}

                  {activeResult.funQuestion && (
                    <div
                      className="p-4 rounded-2xl border space-y-2"
                      style={{
                        backgroundColor: isSpecialTheme ? "var(--bg-subtle)" : "rgba(249, 115, 22, 0.09)",
                        borderColor: "rgba(249, 115, 22, 0.35)",
                      }}
                    >
                      <div className="text-xs font-bold flex items-center gap-1.5" style={{ color: "#ea580c" }}>
                        <HelpCircle className="w-4 h-4" />
                        <span>{isAr ? "تحدي الفضول" : "Curiosity Challenge"}</span>
                      </div>
                      <p className="text-xs font-semibold leading-relaxed" style={{ color: "var(--text-primary)" }}>
                        {activeResult.funQuestion}
                      </p>
                      {!showFunAnswer ? (
                        <button
                          type="button"
                          onClick={() => setShowFunAnswer(true)}
                          className="min-h-[34px] px-3 py-1 rounded-lg text-xs font-bold text-white"
                          style={{ backgroundColor: "#ea580c" }}
                        >
                          {isAr ? "اكشف الإجابة العلمية" : "Reveal Answer"}
                        </button>
                      ) : (
                        <p
                          className="text-xs leading-relaxed p-2.5 rounded-xl border"
                          style={{
                            backgroundColor: "var(--bg-surface)",
                            borderColor: "rgba(249, 115, 22, 0.35)",
                            color: "var(--text-primary)",
                          }}
                        >
                          {activeResult.funAnswer}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Continue with Smart Chatbot */}
                <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      onAskChatbot(
                        isAr
                          ? `لقد صوّرتُ واكتشفت «${activeResult.objectName}» (${activeResult.discipline}). اشرح لي بمزيد من التفاصيل والأسئلة التفاعلية كيف يرتبط هذا بمفاهيم: ${activeResult.relatedConcepts.join("، ")}.`
                          : `I photographed and discovered "${activeResult.objectName}" (${activeResult.discipline}). Explain more deeply how it connects to: ${activeResult.relatedConcepts.join(", ")}.`
                      )
                    }
                    className="min-h-[44px] px-4 py-2 rounded-xl text-xs font-bold text-white flex items-center gap-2 shadow-sm"
                    style={{ background: "linear-gradient(135deg, #7c3aed 0%, #db2777 100%)" }}
                  >
                    <Bot className="w-4 h-4" />
                    <span>{isAr ? "اسأل المساعد الذكي عن هذا الاكتشاف" : "Ask AI Tutor About This Discovery"}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* ================================================================= */}
      {/* RECENT DISCOVERY GALLERY (LOCAL STORAGE)                          */}
      {/* ================================================================= */}
      {history.length > 0 && (
        <section
          className="rounded-3xl border p-5 space-y-4 science-card"
          style={{
            backgroundColor: "var(--bg-surface)",
            borderColor: "var(--border-hairline)",
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-sm sm:text-base font-bold" style={{ color: "var(--text-primary)" }}>
              {isAr ? "سجل اكتشافاتك المصوّرة الأخيرة (محفوظ محلياً على جهازك)" : "Recent Photo Discoveries (Saved Locally)"}
            </h3>
            <button
              type="button"
              onClick={() => {
                setHistory([]);
                try {
                  localStorage.removeItem(DISCOVERY_HISTORY_KEY);
                } catch {
                  // Ignore
                }
              }}
              className="text-xs font-semibold flex items-center gap-1 px-2.5 py-1.5 rounded-lg border"
              style={{
                backgroundColor: "var(--bg-subtle)",
                borderColor: "var(--border-hairline)",
                color: "var(--text-secondary)",
              }}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{isAr ? "مسح السجل" : "Clear History"}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {history.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setCapturedImageUrl(item.imageDataUrl);
                  setCapturedBase64(null);
                  setActiveResult(item.result);
                  setResultProvenance(item.provenance);
                  setAnalysisError(null);
                  setShowFunAnswer(false);
                }}
                className="p-3 rounded-2xl border flex items-center gap-3 text-start transition-all hover:-translate-y-0.5"
                style={{
                  backgroundColor: "var(--bg-subtle)",
                  borderColor: "var(--border-hairline)",
                }}
              >
                <img
                  src={item.imageDataUrl}
                  alt={item.result.objectName}
                  className="w-16 h-16 rounded-xl object-cover shrink-0 border"
                  style={{ borderColor: "var(--border-hairline)" }}
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="text-xs font-bold truncate" style={{ color: "var(--text-primary)" }}>
                    {item.result.objectName}
                  </div>
                  <div className="text-[11px] truncate" style={{ color: "#0284c7" }}>
                    {item.result.discipline}
                  </div>
                  <div className="text-[10px] font-semibold" style={{ color: item.provenance === "live_ai" ? "#059669" : "#d97706" }}>
                    {item.provenance === "live_ai"
                      ? isAr
                        ? `ذكاء اصطناعي · ${item.createdAt}`
                        : `Live AI · ${item.createdAt}`
                      : isAr
                        ? `نموذج تجريبي · ${item.createdAt}`
                        : `Demo · ${item.createdAt}`}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

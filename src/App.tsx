import React, { useState, useEffect, useCallback } from "react";
import { MotionConfig, motion, AnimatePresence } from "motion/react";
import { INITIAL_LESSONS, SUBJECTS } from "./data/lessons.ts";
import type {
  AccessibilitySettings,
  ChatLanguage,
  ChatMessage,
  LessonData,
  PlatformCapabilities,
  PreparationTemplate,
  SourcePolicy,
  StudentLevel,
  SubjectId,
  UILanguage,
  UserRole,
  WeakSpot,
} from "./types.ts";
import { AccessibilityDrawer } from "./components/AccessibilityDrawer.tsx";
import { AnimatedScienceCanvas } from "./components/AnimatedScienceCanvas.tsx";
import { EntrancePortal, type PortalDestination } from "./components/EntrancePortal.tsx";
import { PlatformHomeHub } from "./components/PlatformHomeHub.tsx";
import { SubjectsAndLibrary, type SectionLibraryTab } from "./components/SubjectsAndLibrary.tsx";
import { ContentStudio, type StudioSubTab } from "./components/ContentStudio.tsx";
import { LiveKahootQuiz } from "./components/LiveKahootQuiz.tsx";
import { QuizBuzzerMapGame } from "./components/QuizBuzzerMapGame.tsx";
import { UnderstandingRadar } from "./components/UnderstandingRadar.tsx";
import { SmartChatbot } from "./components/SmartChatbot.tsx";
import { ScienceSimulation } from "./components/ScienceSimulation.tsx";
import { DiscoverWorldExplorer } from "./components/DiscoverWorldExplorer.tsx";
import { InclusiveLearningHub } from "./components/InclusiveLearningHub.tsx";
import { AdaptiveQuizStudio } from "./components/AdaptiveQuizStudio.tsx";
import { TeacherAndPrivacyPanel } from "./components/TeacherAndPrivacyPanel.tsx";
import {
  createBrowserSpeechRecognition,
  speakWithBrowser,
  stopAllSpeech,
} from "./utils/speech.ts";

type ActiveTab = "home" | "library" | "studio" | "radar" | "kahoot" | "chatbot" | "inclusive";
type InclusiveSubTab = "discover" | "simulation" | "hub" | "adaptive_quiz" | "privacy";

const DEFAULT_SETTINGS: AccessibilitySettings = {
  theme: "light",
  fontScale: 1,
  lineHeight: 1.65,
  letterSpacing: 0,
  wordSpacing: 0,
  simplifiedMode: false,
  readingRuler: false,
  reduceMotion: false,
  autoReadResponses: false,
  speechRate: 1.0,
  captionsEnabled: true,
  keyboardHintsVisible: false,
  accommodations: [],
  aiProcessingConsent: true,
};

const STORAGE_SETTINGS_KEY = "smart_science_a11y_v1";
const STORAGE_WEAKSPOTS_KEY = "smart_science_weakspots_v1";
const STORAGE_UILANG_KEY = "smart_science_uilang_v1";
const STORAGE_DEMO_MODE_KEY = "smart_science_demo_mode_v1";

export default function App() {
  const [uiLang, setUiLang] = useState<UILanguage>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_UILANG_KEY);
      return saved === "en" ? "en" : "ar";
    } catch {
      return "ar";
    }
  });
  const isAr = uiLang === "ar";

  const [initialRadarJoinCode] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    return (params.get("radar") || "").trim().toUpperCase();
  });
  const [initialMapJoinCode] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    return (params.get("mapjoin") || "").trim().toUpperCase();
  });

  const [showPortal, setShowPortal] = useState<boolean>(() => {
    const params = new URLSearchParams(window.location.search);
    return !params.get("join") && !params.get("radar") && !params.get("mapjoin");
  });
  const [activeTab, setActiveTab] = useState<ActiveTab>(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("radar")) return "radar";
    if (params.get("join")) return "kahoot";
    return "home";
  });
  const [studioSubTab, setStudioSubTab] = useState<StudioSubTab>("lesson_plan");
  const [inclusiveSubTab, setInclusiveSubTab] = useState<InclusiveSubTab>("simulation");
  const [insideSubjectDept, setInsideSubjectDept] = useState<boolean>(false);
  const [subjectDeptTab, setSubjectDeptTab] = useState<SectionLibraryTab>("lessons");
  const [buzzerGameOpen, setBuzzerGameOpen] = useState<boolean>(() => {
    const params = new URLSearchParams(window.location.search);
    return Boolean(params.get("mapjoin"));
  });

  const [lessons, setLessons] = useState<LessonData[]>(INITIAL_LESSONS);
  const [selectedSubject, setSelectedSubject] = useState<SubjectId>("chemistry");
  const [selectedLessonId, setSelectedLessonId] = useState<string>(INITIAL_LESSONS[0].id);

  const [prepTemplates, setPrepTemplates] = useState<PreparationTemplate[]>([]);
  const [selectedPrepTemplateId, setSelectedPrepTemplateId] = useState<string | null>(null);

  const [userRole, setUserRole] = useState<UserRole>("student");
  const [userName, setUserName] = useState<string>(() => {
    try {
      return localStorage.getItem("smart_science_user_name_v1") || "";
    } catch {
      return "";
    }
  });
  const [sourcePolicy, setSourcePolicy] = useState<SourcePolicy>("lesson_only");
  const [studentLevel, setStudentLevel] = useState<StudentLevel>("intermediate");
  const [chatLanguage, setChatLanguage] = useState<ChatLanguage>("auto");
  const [chatByLesson, setChatByLesson] = useState<Record<string, ChatMessage[]>>({});
  const [pendingBotPrompt, setPendingBotPrompt] = useState<string | null>(null);
  const [demoMode, setDemoMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_DEMO_MODE_KEY) === "1";
    } catch {
      return false;
    }
  });

  const [settings, setSettings] = useState<AccessibilitySettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_SETTINGS_KEY);
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  const [weakSpots, setWeakSpots] = useState<WeakSpot[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_WEAKSPOTS_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [capabilities, setCapabilities] = useState<PlatformCapabilities | null>(null);
  const [rulerY, setRulerY] = useState<number>(240);
  const [isListeningCommand, setIsListeningCommand] = useState(false);
  const [voiceCommandLog, setVoiceCommandLog] = useState<string[]>([]);
  const [liveStatusAnnouncement, setLiveStatusAnnouncement] = useState<string>("");

  const currentLesson = lessons.find((l) => l.id === selectedLessonId) || lessons[0];
  const activePrepTemplate =
    (selectedPrepTemplateId ? prepTemplates.find((t) => t.id === selectedPrepTemplateId) : null) ||
    prepTemplates.find((t) => t.subjectScope === selectedSubject) ||
    prepTemplates.find((t) => t.subjectScope === "all") ||
    null;

  // Sync HTML dir/lang attribute cleanly
  useEffect(() => {
    document.documentElement.lang = uiLang;
    document.documentElement.dir = uiLang === "ar" ? "rtl" : "ltr";
    try {
      localStorage.setItem(STORAGE_UILANG_KEY, uiLang);
    } catch {
      // Ignore
    }
  }, [uiLang]);

  useEffect(() => {
    try {
      localStorage.setItem("smart_science_user_name_v1", userName);
    } catch {
      // Ignore
    }
  }, [userName]);

  const handleToggleDemoMode = useCallback((enabled: boolean) => {
    setDemoMode(enabled);
    try {
      localStorage.setItem(STORAGE_DEMO_MODE_KEY, enabled ? "1" : "0");
    } catch {
      // Ignore
    }
  }, []);

  // Load lessons from SQLite & fetch live capabilities
  useEffect(() => {
    fetch("/api/capabilities")
      .then((r) => r.json())
      .then((data) => setCapabilities(data))
      .catch(() => setCapabilities(null));

    fetch("/api/lessons")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.lessons) && data.lessons.length > 0) {
          setLessons(data.lessons);
          const firstChem =
            data.lessons.find((l: LessonData) => l.subjectId === "chemistry") || data.lessons[0];
          if (firstChem) {
            setSelectedSubject(firstChem.subjectId);
            setSelectedLessonId(firstChem.id);
          }
        }
      })
      .catch(() => {
        // Keep INITIAL_LESSONS fallback
      });

    fetch("/api/prep-templates")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.templates)) {
          setPrepTemplates(data.templates);
        }
      })
      .catch(() => {});
  }, []);

  // Persist accessibility settings & apply CSS root tokens
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Ignore
    }

    const root = document.documentElement;
    root.classList.remove("dark", "theme-high-contrast", "theme-sepia", "reduce-motion");
    if (settings.theme === "dark") root.classList.add("dark");
    if (settings.theme === "high-contrast") root.classList.add("theme-high-contrast");
    if (settings.theme === "sepia") root.classList.add("theme-sepia");
    if (settings.reduceMotion) root.classList.add("reduce-motion");

    root.style.setProperty("--font-scale", String(settings.fontScale));
    root.style.setProperty("--line-height-scale", String(settings.lineHeight));
    root.style.setProperty("--letter-spacing-scale", `${settings.letterSpacing}em`);
    root.style.setProperty("--word-spacing-scale", `${settings.wordSpacing}em`);
  }, [settings]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_WEAKSPOTS_KEY, JSON.stringify(weakSpots));
    } catch {
      // Ignore
    }
  }, [weakSpots]);

  useEffect(() => {
    if (!settings.readingRuler) return;
    const onMove = (e: MouseEvent) => setRulerY(e.clientY);
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [settings.readingRuler]);

  const updateSettings = useCallback((patch: Partial<AccessibilitySettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleSelectLesson = useCallback(
    (lessonId: string) => {
      setSelectedLessonId(lessonId);
      const found = lessons.find((l) => l.id === lessonId);
      if (found) setSelectedSubject(found.subjectId);
    },
    [lessons]
  );

  const handleEnterFromPortal = useCallback(
    (destination: PortalDestination, subjectId?: SubjectId) => {
      if (subjectId) {
        setSelectedSubject(subjectId);
        const first = lessons.find((l) => l.subjectId === subjectId);
        if (first) setSelectedLessonId(first.id);
        setSubjectDeptTab("lessons");
        setInsideSubjectDept(true);
      } else if (destination === "library") {
        setInsideSubjectDept(false);
      }
      setActiveTab(destination);
      setShowPortal(false);
    },
    [lessons]
  );

  const handleOpenStudentDestination = useCallback(
    (destination: "library" | "discover" | "radar" | "chatbot") => {
      setUserRole("student");
      setShowPortal(false);
      if (destination === "library") {
        setInsideSubjectDept(false);
        setActiveTab("library");
      } else if (destination === "discover") {
        setInclusiveSubTab("discover");
        setActiveTab("inclusive");
      } else if (destination === "radar") {
        setActiveTab("radar");
      } else if (destination === "chatbot") {
        setActiveTab("chatbot");
      }
    },
    []
  );

  const handleOpenTeacherSubjectTool = useCallback(
    (
      subjectId: SubjectId,
      tool:
        | { type: "library"; tab: SectionLibraryTab }
        | { type: "destination"; dest: "studio" | "radar" | "kahoot" | "chatbot" | "inclusive" }
        | { type: "buzzer" }
    ) => {
      setUserRole("teacher");
      setSelectedSubject(subjectId);
      const activeMatches = currentLesson.subjectId === subjectId;
      if (!activeMatches) {
        const first = lessons.find((l) => l.subjectId === subjectId);
        if (first) setSelectedLessonId(first.id);
      }
      setShowPortal(false);

      if (tool.type === "library") {
        setSubjectDeptTab(tool.tab);
        setInsideSubjectDept(true);
        setActiveTab("library");
      } else if (tool.type === "buzzer") {
        setBuzzerGameOpen(true);
      } else {
        if (tool.dest === "studio") setStudioSubTab("lesson_plan");
        if (tool.dest === "inclusive") setInclusiveSubTab("simulation");
        setActiveTab(tool.dest);
      }
    },
    [currentLesson.subjectId, lessons]
  );

  const handleSaveNewLesson = async (newLesson: LessonData) => {
    const res = await fetch("/api/lessons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newLesson),
    });
    const data = await res.json();
    const saved: LessonData = data.lesson || newLesson;
    setLessons((prev) => [saved, ...prev.filter((l) => l.id !== saved.id)]);
    setSelectedSubject(saved.subjectId);
    setSelectedLessonId(saved.id);
  };

  const handleDeleteLesson = async (lessonId: string) => {
    const res = await fetch(`/api/lessons/${encodeURIComponent(lessonId)}`, {
      method: "DELETE",
    });
    if (!res.ok) return;
    setLessons((prev) => {
      const next = prev.filter((l) => l.id !== lessonId);
      if (selectedLessonId === lessonId && next.length > 0) {
        setSelectedLessonId(next[0].id);
        setSelectedSubject(next[0].subjectId);
      }
      return next;
    });
  };

  const handleSavePrepTemplate = (tpl: PreparationTemplate) => {
    setPrepTemplates((prev) => [tpl, ...prev.filter((t) => t.id !== tpl.id)]);
    setSelectedPrepTemplateId(tpl.id);
  };

  const handleDeletePrepTemplate = (templateId: string) => {
    setPrepTemplates((prev) => prev.filter((t) => t.id !== templateId));
    if (selectedPrepTemplateId === templateId) {
      setSelectedPrepTemplateId(null);
    }
  };

  const readCurrentSection = useCallback(() => {
    const text = settings.simplifiedMode
      ? `${currentLesson.title}. ${currentLesson.simplifiedSummary}`
      : `${currentLesson.title}. ${currentLesson.summary}`;
    speakWithBrowser(text, settings.speechRate, undefined, undefined, uiLang);
    setLiveStatusAnnouncement(isAr ? "تم بدء القراءة الصوتية للدرس." : "Started reading current lesson.");
  }, [currentLesson, settings.simplifiedMode, settings.speechRate, uiLang, isAr]);

  const executeVoiceCommand = useCallback(
    (spoken: string): string => {
      const cmd = spoken.trim().toLowerCase();
      let result = isAr ? `لم يتم التعرف على الأمر: "${spoken}"` : `Command not recognized: "${spoken}"`;

      if (cmd.includes("بوابة") || cmd.includes("الرئيسية") || cmd.includes("portal") || cmd.includes("home")) {
        setShowPortal(true);
        result = isAr ? "تمت العودة إلى بوابة الدخول والروبوت المتحدث." : "Returned to Entrance Portal.";
      } else if (cmd.includes("مكتبة") || cmd.includes("مواد") || cmd.includes("library") || cmd.includes("subject")) {
        setShowPortal(false);
        setActiveTab("library");
        result = isAr ? "تم الانتقال إلى المواد والمكتبة الذكية." : "Switched to Subjects & Library.";
      } else if (cmd.includes("استوديو") || cmd.includes("تحضير") || cmd.includes("عرض") || cmd.includes("فيديو") || cmd.includes("studio")) {
        setShowPortal(false);
        setActiveTab("studio");
        result = isAr ? "تم الانتقال إلى استوديو إنتاج المحتوى." : "Switched to Content Studio.";
      } else if (cmd.includes("رادار") || cmd.includes("فهم") || cmd.includes("radar")) {
        setShowPortal(false);
        setActiveTab("radar");
        result = isAr ? "تم الانتقال إلى رادار الفهم المباشر." : "Switched to AI Understanding Radar.";
      } else if (cmd.includes("مسابق") || cmd.includes("كاهوت") || cmd.includes("kahoot") || cmd.includes("live")) {
        setShowPortal(false);
        setActiveTab("kahoot");
        result = isAr ? "تم الانتقال إلى المسابقات المباشرة." : "Switched to Live Quiz.";
      } else if (cmd.includes("مساعد") || cmd.includes("بوت") || cmd.includes("دردش") || cmd.includes("tutor") || cmd.includes("chat")) {
        setShowPortal(false);
        setActiveTab("chatbot");
        result = isAr ? "تم الانتقال إلى المساعد التعليمي الذكي." : "Switched to AI Tutor.";
      } else if (cmd.includes("اكتشف") || cmd.includes("عدسة") || cmd.includes("كاميرا") || cmd.includes("صور") || cmd.includes("discover") || cmd.includes("camera")) {
        setShowPortal(false);
        setActiveTab("inclusive");
        setInclusiveSubTab("discover");
        result = isAr ? "تم الانتقال إلى عدسة اكتشف العالم من حولك." : "Switched to Discover Camera Explorer.";
      } else if (cmd.includes("درس") || cmd.includes("محاكاة") || cmd.includes("simulation")) {
        setShowPortal(false);
        setActiveTab("inclusive");
        setInclusiveSubTab("simulation");
        result = isAr ? "تم الانتقال إلى الدرس والمحاكاة." : "Switched to Lesson & Simulation.";
      } else if (cmd.includes("شامل") || cmd.includes("همم") || cmd.includes("وصول") || cmd.includes("inclusive")) {
        setShowPortal(false);
        setActiveTab("inclusive");
        setInclusiveSubTab("hub");
        result = isAr ? "تم الانتقال إلى منظومة التعلم الشامل." : "Switched to Inclusive Learning Hub.";
      } else if (cmd.includes("اختبار") || cmd.includes("نشاط") || cmd.includes("quiz")) {
        setShowPortal(false);
        setActiveTab("inclusive");
        setInclusiveSubTab("adaptive_quiz");
        result = isAr ? "تم الانتقال إلى الأنشطة والاختبارات المرنة." : "Switched to Adaptive Quizzes.";
      } else if (cmd.includes("معلم") || cmd.includes("مصادر") || cmd.includes("خصوصية") || cmd.includes("privacy")) {
        setShowPortal(false);
        setActiveTab("inclusive");
        setInclusiveSubTab("privacy");
        result = isAr ? "تم الانتقال إلى إعدادات المعلم والخصوصية." : "Switched to Teacher & Privacy.";
      } else if (cmd.includes("اقرأ") || cmd.includes("استمع") || cmd.includes("read") || cmd.includes("listen")) {
        readCurrentSection();
        result = isAr ? "تم تشغيل القارئ الصوتي." : "Started text-to-speech reader.";
      } else if (cmd.includes("إيقاف") || cmd.includes("توقف") || cmd.includes("اسكت") || cmd.includes("stop")) {
        stopAllSpeech();
        result = isAr ? "تم إيقاف القراءة الصوتية." : "Stopped speech playback.";
      } else if (cmd.includes("كبر") || cmd.includes("كبّر") || cmd.includes("تكبير") || cmd.includes("increase") || cmd.includes("larger")) {
        setSettings((p) => ({ ...p, fontScale: Math.min(1.55, Number((p.fontScale + 0.1).toFixed(2))) }));
        result = isAr ? "تم تكبير حجم الخط." : "Increased font size.";
      } else if (cmd.includes("صغر") || cmd.includes("صغّر") || cmd.includes("تصغير") || cmd.includes("decrease")) {
        setSettings((p) => ({ ...p, fontScale: Math.max(1.0, Number((p.fontScale - 0.1).toFixed(2))) }));
        result = isAr ? "تم تصغير حجم الخط." : "Decreased font size.";
      } else if (cmd.includes("تباين") || cmd.includes("contrast")) {
        updateSettings({ theme: "high-contrast" });
        result = isAr ? "تم تفعيل وضع التباين العالي AAA." : "Enabled high-contrast theme.";
      } else if (cmd.includes("داكن") || cmd.includes("ليلي") || cmd.includes("dark")) {
        updateSettings({ theme: "dark" });
        result = isAr ? "تم تفعيل الوضع الداكن المريح." : "Enabled dark theme.";
      } else if (cmd.includes("نهاري") || cmd.includes("عادي") || cmd.includes("فاتح") || cmd.includes("light")) {
        updateSettings({ theme: "light" });
        result = isAr ? "تم تفعيل الوضع النهاري الواضح." : "Enabled light theme.";
      } else if (cmd.includes("بسط") || cmd.includes("بسّط") || cmd.includes("تبسيط") || cmd.includes("simplify")) {
        setSettings((p) => ({ ...p, simplifiedMode: !p.simplifiedMode }));
        result = isAr ? "تم تبديل وضع التبسيط إلى خطوات قصيرة." : "Toggled simplified mode.";
      }

      setVoiceCommandLog((prev) => [`"${spoken}" → ${result}`, ...prev.slice(0, 8)]);
      setLiveStatusAnnouncement(result);
      return result;
    },
    [readCurrentSection, updateSettings, isAr]
  );

  const toggleVoiceCommandListening = useCallback(() => {
    if (isListeningCommand) {
      setIsListeningCommand(false);
      return;
    }
    const recognition = createBrowserSpeechRecognition(uiLang);
    if (!recognition) {
      setVoiceCommandLog((prev) => [
        isAr
          ? "المتصفح لا يدعم التعرف التلقائي للأوامر الصوتية — استخدم حقل تنفيذ الأمر النصي في تبويب أدوات ذوي الهمم."
          : "Browser speech recognition is unavailable — use the manual voice-command input in Inclusive Learning.",
        ...prev,
      ]);
      setActiveTab("inclusive");
      setInclusiveSubTab("hub");
      return;
    }
    setIsListeningCommand(true);
    setLiveStatusAnnouncement(isAr ? "جارٍ الاستماع للأمر الصوتي..." : "Listening for voice command...");
    recognition.onresult = (event) => {
      const spoken = event.results?.[0]?.[0]?.transcript || "";
      if (spoken) executeVoiceCommand(spoken);
    };
    recognition.onerror = () => setIsListeningCommand(false);
    recognition.onend = () => setIsListeningCommand(false);
    recognition.start();
  }, [isListeningCommand, executeVoiceCommand, uiLang, isAr]);

  // Global keyboard shortcuts (Alt+1..5, Alt+A, Alt+R, Alt+S, Alt+V)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      switch (e.key.toLowerCase()) {
        case "1":
          e.preventDefault();
          setShowPortal(false);
          setActiveTab("library");
          break;
        case "2":
          e.preventDefault();
          setShowPortal(false);
          setActiveTab("studio");
          break;
        case "3":
          e.preventDefault();
          setShowPortal(false);
          setActiveTab("kahoot");
          break;
        case "4":
          e.preventDefault();
          setShowPortal(false);
          setActiveTab("chatbot");
          break;
        case "5":
          e.preventDefault();
          setShowPortal(false);
          setActiveTab("inclusive");
          break;
        case "a":
        case "ش":
          e.preventDefault();
          setDrawerOpen((o) => !o);
          break;
        case "r":
        case "ق":
          e.preventDefault();
          readCurrentSection();
          break;
        case "s":
        case "س":
          e.preventDefault();
          setSettings((p) => ({ ...p, simplifiedMode: !p.simplifiedMode }));
          break;
        case "v":
        case "ر":
          e.preventDefault();
          toggleVoiceCommandListening();
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [readCurrentSection, toggleVoiceCommandListening]);

  const handleAddMessage = (msg: ChatMessage) => {
    setChatByLesson((prev) => ({
      ...prev,
      [currentLesson.id]: [...(prev[currentLesson.id] || []), msg],
    }));
  };

  const handleRecordWeakSpots = (
    spots: Array<{ concept: string; observation: string; suggestedRemediation: string }>
  ) => {
    const time = new Date().toLocaleTimeString(isAr ? "ar-EG" : "en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
    setWeakSpots((prev) => {
      const next = [...prev];
      spots.forEach((s) => {
        if (!next.some((existing) => existing.concept === s.concept)) {
          next.unshift({ ...s, detectedAt: time });
        }
      });
      return next;
    });
  };

  const handleToggleSourceEnabled = async (lessonId: string, sourceId: string) => {
    let updatedLesson: LessonData | undefined;
    setLessons((prev) =>
      prev.map((l) => {
        if (l.id !== lessonId) return l;
        updatedLesson = {
          ...l,
          sources: l.sources.map((s) => (s.id === sourceId ? { ...s, enabled: !s.enabled } : s)),
        };
        return updatedLesson;
      })
    );
    if (updatedLesson) {
      fetch(`/api/lessons/${encodeURIComponent(lessonId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedLesson),
      }).catch(() => {});
    }
  };

  const handleAddLessonSource = async (
    lessonId: string,
    title: string,
    category: string,
    content: string
  ) => {
    let updatedLesson: LessonData | undefined;
    setLessons((prev) =>
      prev.map((l) => {
        if (l.id !== lessonId) return l;
        updatedLesson = {
          ...l,
          sources: [
            ...l.sources,
            {
              id: `custom-${Date.now()}`,
              title,
              category,
              content,
              enabled: true,
            },
          ],
        };
        return updatedLesson;
      })
    );
    if (updatedLesson) {
      fetch(`/api/lessons/${encodeURIComponent(lessonId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedLesson),
      }).catch(() => {});
    }
  };

  const handleClearAllStudentData = () => {
    stopAllSpeech();
    setChatByLesson({});
    setWeakSpots([]);
    setSettings(DEFAULT_SETTINGS);
    localStorage.removeItem(STORAGE_SETTINGS_KEY);
    localStorage.removeItem(STORAGE_WEAKSPOTS_KEY);
    setLiveStatusAnnouncement(isAr ? "تم مسح جميع بيانات الجلسة بنجاح." : "Session data cleared.");
  };

  const handleExportStudentData = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      lessonId: currentLesson.id,
      accessibilitySettings: settings,
      detectedWeakSpots: weakSpots,
      chatCount: (chatByLesson[currentLesson.id] || []).length,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `smart-science-progress-${currentLesson.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const NAV_ITEMS: Array<{ id: ActiveTab; labelAr: string; labelEn: string; shortcut: string }> = [
    { id: "home", labelAr: "الرئيسية", labelEn: "Home", shortcut: "Alt+0" },
    { id: "radar", labelAr: "رادار الفهم", labelEn: "Understanding Radar", shortcut: "Alt+6" },
    { id: "library", labelAr: "المواد والمكتبة", labelEn: "Subjects & Library", shortcut: "Alt+1" },
    { id: "studio", labelAr: "إنتاج المحتوى", labelEn: "Content Studio", shortcut: "Alt+2" },
    { id: "kahoot", labelAr: "المسابقات المباشرة", labelEn: "Live Quiz", shortcut: "Alt+3" },
    { id: "chatbot", labelAr: "المساعد الذكي", labelEn: "AI Tutor", shortcut: "Alt+4" },
    { id: "inclusive", labelAr: "التعلم الشامل", labelEn: "Inclusive Learning", shortcut: "Alt+5" },
  ];

  const subjectLessons = lessons.filter((l) => l.subjectId === selectedSubject);

  return (
    <MotionConfig reducedMotion={settings.reduceMotion ? "user" : "never"}>
      <div
        className="relative min-h-screen flex flex-col"
        style={{
          backgroundColor: "var(--bg-canvas)",
          color: "var(--text-primary)",
        }}
      >
        {/* Ambient Kinetic Mint-Green Canvas & Floating 3D Scientific Geometry */}
        <AnimatedScienceCanvas
          reducedMotion={settings.reduceMotion}
          theme={settings.theme}
        />

        {/* Skip-to-content accessibility link */}
        <a href="#main-workspace" className="skip-link">
          {isAr ? "تخطي إلى المحتوى الرئيسي" : "Skip to main content"}
        </a>

        {/* Screen-reader live region */}
        <div className="sr-only" aria-live="polite">
          {liveStatusAnnouncement}
        </div>

        {/* Dyslexia Reading Ruler Overlay */}
        {settings.readingRuler && (
          <div
            aria-hidden="true"
            className="fixed left-0 right-0 h-14 pointer-events-none z-40 border-y"
            style={{
              top: `${Math.max(64, rulerY - 28)}px`,
              borderColor: "var(--accent-primary)",
              backgroundColor: "rgba(15, 118, 110, 0.08)",
            }}
          />
        )}

        {/* Top Bar: Minimal on Entry Page (Page 1), Full Workspace Nav after Entry (Page 2) */}
        <header
          className="sticky top-0 z-30 border-b backdrop-blur-md"
          style={{
            backgroundColor: "var(--bg-surface)",
            borderColor: "var(--border-hairline)",
          }}
        >
          <div className="prism-top-bar" aria-hidden="true" />
          <div className="px-4 md:px-8 py-3 flex items-center justify-between gap-8">
            {/* Zone 1: Brand Wordmark with Attached Logo Emblem */}
            <a
              href="#main-workspace"
              onClick={(e) => {
                e.preventDefault();
                setShowPortal(true);
              }}
              className="font-display text-lg font-bold tracking-tight whitespace-nowrap shrink-0 flex items-center gap-2.5"
              style={{ color: "var(--text-primary)" }}
            >
              <img
                src="/assets/aistudio/image_cbd252d9.png"
                alt="AM Smart Science AI Logo"
                referrerPolicy="no-referrer"
                className="w-8 h-8 rounded-full object-cover border shrink-0"
                style={{ borderColor: "var(--border-hairline)" }}
              />
              <span>smart science ai</span>
            </a>

            {/* Zone 2: Workspace Navigation Links (Visible only on Page 2 after entering) */}
            {!showPortal && (
              <nav aria-label={isAr ? "التنقل الرئيسي" : "Primary Navigation"} className="hidden lg:flex items-center gap-5">
                {NAV_ITEMS.map((item, idx) => {
                  const active = activeTab === item.id;
                  const navPalette = ["#0284c7", "#ea580c", "#059669", "#7c3aed", "#db2777", "#6d28d9", "#0d9488"];
                  const tabAccent = navPalette[idx % navPalette.length];
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        if (item.id === "library") setInsideSubjectDept(false);
                        setActiveTab(item.id);
                      }}
                      aria-current={active ? "page" : undefined}
                      className="relative text-sm font-semibold whitespace-nowrap shrink-0 py-1.5 transition-colors"
                      style={{
                        color: active ? tabAccent : "var(--text-secondary)",
                      }}
                    >
                      {isAr ? item.labelAr : item.labelEn}
                      {settings.keyboardHintsVisible && (
                        <span className="mx-1 font-mono-num text-[11px]" dir="ltr">
                          ({item.shortcut})
                        </span>
                      )}
                      {active && (
                        <motion.span
                          layoutId="topNavUnderline"
                          className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full"
                          style={{ backgroundColor: tabAccent }}
                          transition={{ type: "spring", stiffness: 360, damping: 32 }}
                        />
                      )}
                    </button>
                  );
                })}
              </nav>
            )}

            {/* Zone 3: Language Switch (on Entry Page) or Accessibility Primary Action */}
            <div className="shrink-0 flex items-center gap-2.5">
              {showPortal && (
                <div
                  className="flex items-center p-0.5 rounded-lg border"
                  style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}
                >
                  <button
                    type="button"
                    onClick={() => setUiLang("ar")}
                    className="px-2.5 py-1 rounded-md font-bold text-xs"
                    style={{
                      backgroundColor: uiLang === "ar" ? "var(--accent-primary)" : "transparent",
                      color: uiLang === "ar" ? "var(--accent-contrast)" : "var(--text-secondary)",
                    }}
                  >
                    عربي
                  </button>
                  <button
                    type="button"
                    onClick={() => setUiLang("en")}
                    className="px-2.5 py-1 rounded-md font-bold text-xs"
                    style={{
                      backgroundColor: uiLang === "en" ? "var(--accent-primary)" : "transparent",
                      color: uiLang === "en" ? "var(--accent-contrast)" : "var(--text-secondary)",
                    }}
                  >
                    EN
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                aria-label={isAr ? "أدوات الوصول" : "Accessibility Tools"}
                title={isAr ? "أدوات الوصول" : "Accessibility Tools"}
                className="w-11 h-11 rounded-full p-0.5 shrink-0 shadow-md transition-transform hover:scale-105 active:scale-95 flex items-center justify-center"
                style={{
                  background: "linear-gradient(135deg, #a7d7bf 0%, #52a382 48%, #1d5c48 100%)",
                  border: "2px solid #d5ece0",
                }}
              >
              <svg
                viewBox="0 0 64 64"
                className="w-full h-full rounded-full"
                aria-hidden="true"
              >
                <defs>
                  <linearGradient id="a11yGreenGrad" x1="12%" y1="10%" x2="88%" y2="90%">
                    <stop offset="0%" stopColor="#5fb892" />
                    <stop offset="52%" stopColor="#2e7a5f" />
                    <stop offset="100%" stopColor="#164a38" />
                  </linearGradient>
                </defs>
                <circle cx="32" cy="32" r="30" fill="url(#a11yGreenGrad)" />
                {/* White Wheelchair Accessibility Symbol matching reference */}
                <circle cx="27" cy="15.5" r="4.3" fill="#ffffff" />
                <path
                  d="M27.5 20.5 L27.5 34.5 L40.5 34.5 L46.2 46.5 L50.5 44.5"
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth="4.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M27.5 27.5 L37.5 27.5"
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth="4.2"
                  strokeLinecap="round"
                />
                <path
                  d="M22.5 27.2 A 12 12 0 1 0 38.8 43.2"
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth="4.4"
                  strokeLinecap="round"
                />
              </svg>
              </button>
            </div>
          </div>
        </header>

        {/* Mobile Navigation & Workspace Source Bar (Only rendered on Page 2 after entering) */}
        {!showPortal && (
          <>
            <nav
              aria-label={isAr ? "التنقل للجوال" : "Mobile Navigation"}
              className="relative z-20 lg:hidden border-b px-4 py-2 flex items-center gap-2 overflow-x-auto backdrop-blur-sm"
              style={{
                backgroundColor: "var(--bg-surface)",
                borderColor: "var(--border-hairline)",
              }}
            >
              {NAV_ITEMS.map((item) => {
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      if (item.id === "library") setInsideSubjectDept(false);
                      setActiveTab(item.id);
                    }}
                    className="min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0"
                    style={{
                      backgroundColor: active ? "var(--accent-primary)" : "var(--bg-subtle)",
                      color: active ? "var(--accent-contrast)" : "var(--text-primary)",
                    }}
                  >
                    {isAr ? item.labelAr : item.labelEn}
                  </button>
                );
              })}
            </nav>

            <div
              className="relative z-10 border-b px-4 md:px-8 py-2.5 backdrop-blur-sm"
              style={{
                backgroundColor: "var(--bg-subtle)",
                borderColor: "var(--border-hairline)",
              }}
            >
              <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <label htmlFor="workspace-subject-select" className="font-bold" style={{ color: "var(--text-secondary)" }}>
                    {isAr ? "المادة:" : "Subject:"}
                  </label>
                  <select
                    id="workspace-subject-select"
                    value={selectedSubject}
                    onChange={(e) => {
                      const subj = e.target.value as SubjectId;
                      setSelectedSubject(subj);
                      const first = lessons.find((l) => l.subjectId === subj);
                      if (first) setSelectedLessonId(first.id);
                    }}
                    className="min-h-[36px] px-2.5 rounded-lg border text-xs font-semibold"
                    style={{
                      backgroundColor: "var(--bg-surface)",
                      borderColor: "var(--border-hairline)",
                      color: "var(--text-primary)",
                    }}
                  >
                    {SUBJECTS.map((s) => (
                      <option key={s.id} value={s.id}>
                        {isAr ? s.nameAr : s.nameEn}
                      </option>
                    ))}
                  </select>

                  <label htmlFor="workspace-lesson-select" className="font-bold mx-1" style={{ color: "var(--text-secondary)" }}>
                    {isAr ? "الدرس النشط:" : "Active Lesson:"}
                  </label>
                  <select
                    id="workspace-lesson-select"
                    value={currentLesson.id}
                    onChange={(e) => handleSelectLesson(e.target.value)}
                    className="min-h-[36px] px-2.5 rounded-lg border text-xs font-semibold max-w-[260px]"
                    style={{
                      backgroundColor: "var(--bg-surface)",
                      borderColor: "var(--border-hairline)",
                      color: "var(--text-primary)",
                    }}
                  >
                    {(subjectLessons.length > 0 ? subjectLessons : lessons).map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.title}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-xs" style={{ color: "var(--text-secondary)" }}>
                  <span>
                    {isAr ? "حجم الخط:" : "Font:"}{" "}
                    <strong className="font-mono-num" style={{ color: "var(--text-primary)" }}>
                      {Math.round(settings.fontScale * 100)}%
                    </strong>
                  </span>
                  <span aria-hidden="true">·</span>
                  <div
                    className="flex items-center p-0.5 rounded-lg border"
                    style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}
                  >
                    <button
                      type="button"
                      onClick={() => setUiLang("ar")}
                      className="px-2.5 py-1 rounded-md font-bold text-[11px]"
                      style={{
                        backgroundColor: uiLang === "ar" ? "var(--accent-primary)" : "transparent",
                        color: uiLang === "ar" ? "var(--accent-contrast)" : "var(--text-secondary)",
                      }}
                    >
                      عربي
                    </button>
                    <button
                      type="button"
                      onClick={() => setUiLang("en")}
                      className="px-2.5 py-1 rounded-md font-bold text-[11px]"
                      style={{
                        backgroundColor: uiLang === "en" ? "var(--accent-primary)" : "transparent",
                        color: uiLang === "en" ? "var(--accent-contrast)" : "var(--text-secondary)",
                      }}
                    >
                      EN
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Main Content Area with Smooth AnimatePresence Page Transitions */}
        <main id="main-workspace" className="relative z-10 flex-1 px-4 md:px-8 py-4 md:py-6">
          <div className="max-w-7xl mx-auto">
            <AnimatePresence mode="wait">
              {showPortal ? (
                <motion.div
                  key="portal-entry-page"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                >
                  <EntrancePortal
                    uiLang={uiLang}
                    userRole={userRole}
                    userName={userName}
                    onUserNameChange={setUserName}
                    onRoleChange={setUserRole}
                    activeLesson={currentLesson}
                    lessonsCount={lessons.length}
                    settings={settings}
                    onEnterPlatform={handleEnterFromPortal}
                  />
                </motion.div>
              ) : (
              <motion.div
                key={`workspace-${activeTab}`}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              >
                {activeTab === "home" && (
                  <PlatformHomeHub
                    uiLang={uiLang}
                    userRole={userRole}
                    userName={userName}
                    activeLesson={currentLesson}
                    lessons={lessons}
                    settings={settings}
                    capabilities={capabilities}
                    demoMode={demoMode}
                    onToggleDemoMode={handleToggleDemoMode}
                    onNavigate={handleEnterFromPortal}
                    onOpenStudentDestination={handleOpenStudentDestination}
                    onOpenTeacherSubjectTool={handleOpenTeacherSubjectTool}
                    onBackToEntry={() => setShowPortal(true)}
                    onLaunchBuzzerMap={() => setBuzzerGameOpen(true)}
                  />
                )}

                {activeTab === "library" && (
                  <SubjectsAndLibrary
                    lessons={lessons}
                    selectedSubject={selectedSubject}
                    onSelectSubject={setSelectedSubject}
                    activeLessonId={currentLesson.id}
                    onSelectLesson={handleSelectLesson}
                    onSaveNewLesson={handleSaveNewLesson}
                    onDeleteLesson={handleDeleteLesson}
                    onOpenTool={(tab, sub) => {
                      if (tab === "studio") {
                        if (sub && sub !== "adaptive_quiz") setStudioSubTab(sub);
                        setActiveTab("studio");
                      } else if (tab === "radar") {
                        setActiveTab("radar");
                      } else if (tab === "kahoot") {
                        setActiveTab("kahoot");
                      } else if (tab === "chatbot") {
                        setActiveTab("chatbot");
                      } else if (tab === "inclusive") {
                        setInclusiveSubTab(sub === "adaptive_quiz" ? "adaptive_quiz" : "simulation");
                        setActiveTab("inclusive");
                      }
                    }}
                    uiLang={uiLang}
                    userRole={userRole}
                    settings={settings}
                    sourcePolicy={sourcePolicy}
                    prepTemplates={prepTemplates}
                    activePrepTemplate={activePrepTemplate}
                    onSelectPrepTemplate={setSelectedPrepTemplateId}
                    onSavePrepTemplate={handleSavePrepTemplate}
                    onDeletePrepTemplate={handleDeletePrepTemplate}
                    insideDepartment={insideSubjectDept}
                    onInsideDepartmentChange={setInsideSubjectDept}
                    activeSectionTab={subjectDeptTab}
                    onActiveSectionTabChange={setSubjectDeptTab}
                    onLaunchBuzzerMap={() => setBuzzerGameOpen(true)}
                  />
                )}

                {activeTab === "studio" && (
                  <ContentStudio
                    lesson={currentLesson}
                    activeSubTab={studioSubTab}
                    onSubTabChange={setStudioSubTab}
                    sourcePolicy={sourcePolicy}
                    prepTemplates={prepTemplates}
                    activePrepTemplate={activePrepTemplate}
                    onSelectPrepTemplate={setSelectedPrepTemplateId}
                    onOpenPrepForm={() => {
                      setInsideSubjectDept(true);
                      setSubjectDeptTab("prep_form");
                      setActiveTab("library");
                    }}
                    uiLang={uiLang}
                    settings={settings}
                    demoMode={demoMode}
                    onToggleDemoMode={handleToggleDemoMode}
                  />
                )}

                {activeTab === "radar" && (
                  <UnderstandingRadar
                    lessons={lessons}
                    activeLesson={currentLesson}
                    userRole={userRole}
                    userName={userName}
                    uiLang={uiLang}
                    settings={settings}
                    initialJoinCode={initialRadarJoinCode}
                    demoMode={demoMode}
                    onToggleDemoMode={handleToggleDemoMode}
                  />
                )}

                {activeTab === "kahoot" && (
                  <LiveKahootQuiz
                    lesson={currentLesson}
                    uiLang={uiLang}
                    settings={settings}
                    onLaunchBuzzerMap={() => setBuzzerGameOpen(true)}
                  />
                )}

                {activeTab === "chatbot" && (
                  <SmartChatbot
                    lesson={currentLesson}
                    userRole={userRole}
                    onRoleChange={setUserRole}
                    sourcePolicy={sourcePolicy}
                    onSourcePolicyChange={setSourcePolicy}
                    studentLevel={studentLevel}
                    onStudentLevelChange={setStudentLevel}
                    chatLanguage={chatLanguage}
                    onChatLanguageChange={setChatLanguage}
                    uiLang={uiLang}
                    settings={settings}
                    messages={chatByLesson[currentLesson.id] || []}
                    onAddMessage={handleAddMessage}
                    weakSpots={weakSpots}
                    onRecordWeakSpots={handleRecordWeakSpots}
                    pendingPrompt={pendingBotPrompt}
                    onConsumePendingPrompt={() => setPendingBotPrompt(null)}
                    demoMode={demoMode}
                    onToggleDemoMode={handleToggleDemoMode}
                  />
                )}

                {activeTab === "inclusive" && (
                  <div className="space-y-6">
                    <div
                      className="flex flex-wrap items-center gap-1.5 p-1.5 rounded-xl border w-fit backdrop-blur-sm"
                      style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}
                    >
                      {[
                        { id: "discover" as const, labelAr: "اكتشف العالم (الكاميرا)", labelEn: "Discover Camera", accent: "#059669" },
                        { id: "simulation" as const, labelAr: "الدرس والمختبر التفاعلي", labelEn: "Lesson & Lab", accent: "#0284c7" },
                        { id: "hub" as const, labelAr: "أدوات ذوي الهمم الشاملة", labelEn: "Assistive Tools Hub", accent: "#7c3aed" },
                        { id: "adaptive_quiz" as const, labelAr: "الأنشطة والاختبارات المرنة", labelEn: "Adaptive Quizzes", accent: "#ea580c" },
                        { id: "privacy" as const, labelAr: "حوكمة المعلم والخصوصية", labelEn: "Teacher & Privacy", accent: "#0d9488" },
                      ].map((sub) => {
                        const active = inclusiveSubTab === sub.id;
                        return (
                          <button
                            key={sub.id}
                            type="button"
                            onClick={() => setInclusiveSubTab(sub.id)}
                            className="min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors"
                            style={{
                              backgroundColor: active ? sub.accent : "transparent",
                              color: active ? "#ffffff" : "var(--text-secondary)",
                            }}
                          >
                            {isAr ? sub.labelAr : sub.labelEn}
                          </button>
                        );
                      })}
                    </div>

                    <AnimatePresence mode="wait">
                      <motion.div
                        key={inclusiveSubTab}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                      >
                        {inclusiveSubTab === "discover" && (
                          <DiscoverWorldExplorer
                            uiLang={uiLang}
                            settings={settings}
                            studentLevel={studentLevel}
                            demoMode={demoMode}
                            onToggleDemoMode={handleToggleDemoMode}
                            onBackToHome={() => setActiveTab("home")}
                            onAskChatbot={(prompt) => {
                              setPendingBotPrompt(prompt);
                              setActiveTab("chatbot");
                            }}
                          />
                        )}

                        {inclusiveSubTab === "simulation" && (
                          <ScienceSimulation
                            lesson={currentLesson}
                            settings={settings}
                            uiLang={uiLang}
                            onToggleSimplified={() =>
                              updateSettings({ simplifiedMode: !settings.simplifiedMode })
                            }
                            onAskBotAboutConcept={(prompt) => {
                              setPendingBotPrompt(prompt);
                              setActiveTab("chatbot");
                            }}
                          />
                        )}

                        {inclusiveSubTab === "hub" && (
                          <InclusiveLearningHub
                            lesson={currentLesson}
                            settings={settings}
                            onUpdateSettings={updateSettings}
                            capabilities={capabilities}
                            onExecuteVoiceCommand={executeVoiceCommand}
                            onToggleVoiceCommand={toggleVoiceCommandListening}
                            isListeningCommand={isListeningCommand}
                            voiceCommandLog={voiceCommandLog}
                            uiLang={uiLang}
                          />
                        )}

                        {inclusiveSubTab === "adaptive_quiz" && (
                          <AdaptiveQuizStudio
                            lesson={currentLesson}
                            settings={settings}
                            weakConcepts={weakSpots.map((w) => w.concept)}
                            onRecordQuizWeakSpot={(concept, observation, suggestedRemediation) =>
                              handleRecordWeakSpots([{ concept, observation, suggestedRemediation }])
                            }
                            onAskBotRemediation={(prompt) => {
                              setPendingBotPrompt(prompt);
                              setActiveTab("chatbot");
                            }}
                          />
                        )}

                        {inclusiveSubTab === "privacy" && (
                          <TeacherAndPrivacyPanel
                            lesson={currentLesson}
                            sourcePolicy={sourcePolicy}
                            onSourcePolicyChange={setSourcePolicy}
                            onToggleSourceEnabled={handleToggleSourceEnabled}
                            onAddLessonSource={handleAddLessonSource}
                            weakSpots={weakSpots}
                            settings={settings}
                            onUpdateSettings={updateSettings}
                            onClearAllStudentData={handleClearAllStudentData}
                            onExportStudentData={handleExportStudentData}
                            capabilities={capabilities}
                            uiLang={uiLang}
                          />
                        )}
                      </motion.div>
                    </AnimatePresence>
                  </div>
                )}
              </motion.div>
              )}
            </AnimatePresence>
          </div>
        </main>

        {/* Clean Minimal Footer */}
        <footer
          className="relative z-10 border-t px-4 md:px-8 py-4 text-xs backdrop-blur-sm"
          style={{
            backgroundColor: "var(--bg-surface)",
            borderColor: "var(--border-hairline)",
            color: "var(--text-secondary)",
          }}
        >
          <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
            <span>
              {isAr
                ? "Smart Science AI — منصة علمية ذكية متكاملة لإنشاء المحتوى ودعم التعلم الشامل"
                : "Smart Science AI — Integrated Scientific Content Creation & Inclusive Learning Platform"}
            </span>
            <div className="flex items-center gap-4">
              {!showPortal && (
                <button
                  type="button"
                  onClick={() => setShowPortal(true)}
                  className="underline hover:opacity-80"
                >
                  {isAr ? "بوابة الدخول" : "Entrance Portal"}
                </button>
              )}
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                className="underline hover:opacity-80"
              >
                {isAr ? "تخصيص إمكانية الوصول" : "Accessibility Settings"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowPortal(false);
                  setActiveTab("inclusive");
                  setInclusiveSubTab("privacy");
                }}
                className="underline hover:opacity-80"
              >
                {isAr ? "الخصوصية وحوكمة المصادر" : "Privacy & Sources"}
              </button>
            </div>
          </div>
        </footer>

        {/* Full-Viewport Stages & Buzzer Quiz Map Game */}
        {buzzerGameOpen && (
          <QuizBuzzerMapGame
            lesson={currentLesson}
            allLessons={lessons}
            uiLang={uiLang}
            settings={settings}
            userName={userName}
            initialJoinCode={initialMapJoinCode}
            onClose={() => setBuzzerGameOpen(false)}
          />
        )}

        {/* Global Slide-over Accessibility Drawer */}
        <AccessibilityDrawer
          isOpen={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          settings={settings}
          onUpdate={updateSettings}
          onReset={() => setSettings(DEFAULT_SETTINGS)}
          onReadCurrentPage={readCurrentSection}
          onToggleVoiceCommand={toggleVoiceCommandListening}
          isListeningCommand={isListeningCommand}
        />
      </div>
    </MotionConfig>
  );
}

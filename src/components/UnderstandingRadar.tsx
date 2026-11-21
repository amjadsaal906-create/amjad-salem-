import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpen,
  Bot,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  Edit3,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FileText,
  History,
  Layers,
  Loader2,
  MessageSquare,
  Mic,
  MicOff,
  Play,
  Plus,
  Printer,
  Radar,
  RefreshCw,
  Send,
  Sparkles,
  Square,
  Trash2,
  TrendingUp,
  Upload,
  UserCheck,
  Users,
  Volume2,
  X,
} from "lucide-react";
import { SUBJECTS } from "../data/lessons.ts";
import type {
  AccessibilitySettings,
  BookRecord,
  LessonData,
  RadarDifficulty,
  RadarInterventionStrategy,
  RadarQuestion,
  RadarQuestionType,
  RadarSavedReport,
  RadarSessionSnapshot,
  RadarStudentProfile,
  UILanguage,
  UserRole,
} from "../types.ts";
import {
  BeforeAfterImpactCard,
  ConceptRadarChart,
  exportRadarExcel,
  exportRadarWordReport,
} from "./RadarCharts.tsx";
import {
  createBrowserSpeechRecognition,
  speakWithBrowser,
  speakWithGeminiTTS,
  stopAllSpeech,
} from "../utils/speech.ts";
import { buildDemoRadarQuestions } from "../utils/demoSamples.ts";

interface UnderstandingRadarProps {
  lessons: LessonData[];
  activeLesson: LessonData;
  userRole: UserRole;
  userName: string;
  uiLang: UILanguage;
  settings: AccessibilitySettings;
  initialJoinCode?: string;
  demoMode?: boolean;
  onToggleDemoMode?: (enabled: boolean) => void;
}

type RadarMode = "setup" | "host" | "student" | "history";
type ContentSourceMode = "platform_lesson" | "book_lesson" | "paste_text" | "upload_file";

const GRADE_OPTIONS_AR = [
  "الصف الرابع الابتدائي",
  "الصف الخامس الابتدائي",
  "الصف السادس الابتدائي",
  "الصف الأول المتوسط",
  "الصف الثاني المتوسط",
  "الصف الثالث المتوسط",
  "الصف العاشر",
  "الصف الحادي عشر",
  "الصف الثاني عشر",
];

const QUESTION_TYPE_LABELS: Record<RadarQuestionType, { ar: string; en: string }> = {
  mcq: { ar: "اختيار من متعدد", en: "Multiple Choice" },
  true_false: { ar: "صح أو خطأ", en: "True / False" },
  short_answer: { ar: "أسئلة قصيرة", en: "Short Answer" },
  applied: { ar: "أسئلة تطبيقية", en: "Applied Scenario" },
  misconception: { ar: "كشف التصورات الخاطئة", en: "Misconception Probe" },
};

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const str = String(reader.result || "");
      const idx = str.indexOf(",");
      resolve(idx >= 0 ? str.slice(idx + 1) : str);
    };
    reader.onerror = () => reject(new Error("فشل قراءة الملف المحدد."));
    reader.readAsDataURL(file);
  });
}

function getWsUrl(path: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${path}`;
}

export const UnderstandingRadar: React.FC<UnderstandingRadarProps> = ({
  lessons,
  activeLesson,
  userRole,
  userName,
  uiLang,
  settings,
  initialJoinCode,
  demoMode = false,
  onToggleDemoMode,
}) => {
  const isAr = uiLang === "ar";
  const [questionsSource, setQuestionsSource] = useState<"ai" | "demo" | null>(null);

  const [mode, setMode] = useState<RadarMode>(() => {
    if (initialJoinCode) return "student";
    return userRole === "student" ? "student" : "setup";
  });

  // 1. Setup & Diagnostic Question Builder State
  const [subjectId, setSubjectId] = useState<string>(activeLesson.subjectId || "chemistry");
  const [customSubjectName, setCustomSubjectName] = useState<string>("");
  const [gradeLevel, setGradeLevel] = useState<string>(activeLesson.gradeLevel || "الصف العاشر");
  const [lessonTopic, setLessonTopic] = useState<string>(activeLesson.title || "");
  const [sourceMode, setSourceMode] = useState<ContentSourceMode>("platform_lesson");
  const [selectedPlatformLessonId, setSelectedPlatformLessonId] = useState<string>(activeLesson.id);
  const [lessonContent, setLessonContent] = useState<string>(() => {
    const srcText = (activeLesson.sources || [])
      .filter((s) => s.enabled)
      .map((s) => `${s.title}: ${s.content}`)
      .join("\n\n");
    return `${activeLesson.summary}\n\n${srcText}`.trim();
  });

  const [books, setBooks] = useState<BookRecord[]>([]);
  const [selectedBookId, setSelectedBookId] = useState<string>("");
  const [selectedBookLessonId, setSelectedBookLessonId] = useState<string>("");
  const [isExtractingSource, setIsExtractingSource] = useState(false);

  const [questionCount, setQuestionCount] = useState<number>(5);
  const [selectedTypes, setSelectedTypes] = useState<RadarQuestionType[]>([
    "mcq",
    "true_false",
    "applied",
    "misconception",
  ]);
  const [difficulty, setDifficulty] = useState<RadarDifficulty>("mixed");
  const [thresholdPct, setThresholdPct] = useState<number>(65);

  const [questions, setQuestions] = useState<RadarQuestion[]>([]);
  const [isGeneratingQuestions, setIsGeneratingQuestions] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);

  // 2. Live WebSocket & Session State
  const wsRef = useRef<WebSocket | null>(null);
  const [snapshot, setSnapshot] = useState<RadarSessionSnapshot | null>(null);
  const [wsError, setWsError] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [privacyHideNames, setPrivacyHideNames] = useState(false);
  const [projectorMode, setProjectorMode] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number>(0);

  // Student play state
  const [joinCodeInput, setJoinCodeInput] = useState<string>(initialJoinCode || "");
  const [studentNameInput, setStudentNameInput] = useState<string>(userName || "");
  const [joinedStudentId, setJoinedStudentId] = useState<string | null>(null);
  const [studentSelectedOption, setStudentSelectedOption] = useState<number | null>(null);
  const [studentShortAnswer, setStudentShortAnswer] = useState<string>("");
  const [studentFeedback, setStudentFeedback] = useState<{
    questionId: string;
    isCorrect: boolean;
    explanation: string;
    concept: string;
  } | null>(null);

  // 3. Host Analytics & Intervention State
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [interventionConcept, setInterventionConcept] = useState<string | null>(null);
  const [isGeneratingIntervention, setIsGeneratingIntervention] = useState(false);
  const [interventionDraft, setInterventionDraft] = useState<{
    concept: string;
    diagnosisSummary: string;
    strategies: RadarInterventionStrategy[];
    verificationQuestion: RadarQuestion;
  } | null>(null);
  const [selectedStrategyIdx, setSelectedStrategyIdx] = useState<number>(0);

  // 4. Interactive Talking AI Tutor Drawer State
  const [tutorOpen, setTutorOpen] = useState(false);
  const [tutorMessages, setTutorMessages] = useState<
    Array<{
      id: string;
      sender: "user" | "assistant";
      text: string;
      analogy?: string;
      hint?: string;
      followUps?: string[];
    }>
  >([]);
  const [tutorInput, setTutorInput] = useState("");
  const [isTutorThinking, setIsTutorThinking] = useState(false);
  const [isTutorSpeaking, setIsTutorSpeaking] = useState(false);
  const [isListeningTutorMic, setIsListeningTutorMic] = useState(false);

  // 5. Saved History, Cross-Lesson Comparison & Print View
  const [savedSessions, setSavedSessions] = useState<RadarSavedReport[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [viewingReport, setViewingReport] = useState<RadarSessionSnapshot | null>(null);
  const [printPreviewSnapshot, setPrintPreviewSnapshot] = useState<RadarSessionSnapshot | null>(null);

  const resolvedSubjectName = useMemo(() => {
    if (subjectId === "custom") {
      return customSubjectName.trim() || (isAr ? "مادة دراسية" : "Custom Subject");
    }
    const found = SUBJECTS.find((s) => s.id === subjectId);
    return found ? (isAr ? found.nameAr : found.nameEn) : subjectId;
  }, [subjectId, customSubjectName, isAr]);

  // Fetch Books Library & Saved Sessions on mount
  useEffect(() => {
    fetch("/api/books")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.books)) {
          setBooks(d.books);
          const indexed = d.books.find((b: BookRecord) => b.analysisStatus === "indexed");
          if (indexed) setSelectedBookId(indexed.id);
        }
      })
      .catch(() => {});

    fetchHistory();

    return () => {
      stopAllSpeech();
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const fetchHistory = () => {
    setIsLoadingHistory(true);
    fetch("/api/radar/sessions")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.sessions)) {
          setSavedSessions(d.sessions);
        }
      })
      .catch(() => {})
      .finally(() => setIsLoadingHistory(false));
  };

  // Sync Platform Lesson Selection
  const applyPlatformLesson = (id: string) => {
    setSelectedPlatformLessonId(id);
    const l = lessons.find((item) => item.id === id);
    if (!l) return;
    setSubjectId(l.subjectId);
    setGradeLevel(l.gradeLevel);
    setLessonTopic(l.title);
    const srcText = (l.sources || [])
      .filter((s) => s.enabled)
      .map((s) => `${s.title}: ${s.content}`)
      .join("\n\n");
    setLessonContent(`${l.summary}\n\n${srcText}`.trim());
  };

  // Flattened lessons inside selected Book
  const selectedBookLessons = useMemo(() => {
    const book = books.find((b) => b.id === selectedBookId);
    if (!book) return [];
    const list: Array<{
      id: string;
      unitTitle: string;
      title: string;
      pages: string;
      content: string;
    }> = [];
    for (const u of book.units || []) {
      for (const c of u.chapters || []) {
        for (const l of c.lessons || []) {
          list.push({
            id: l.id,
            unitTitle: u.unitTitle,
            title: l.title,
            pages: `${l.startPage}-${l.endPage}`,
            content: `${l.summary}\nالأهداف: ${(l.objectives || []).join("، ")}\nالمفاهيم: ${(
              l.keyConcepts || []
            ).join("، ")}\n\n${l.contentExcerpt}`,
          });
        }
      }
    }
    return list;
  }, [books, selectedBookId]);

  const applyBookLesson = (bookLessonId: string) => {
    setSelectedBookLessonId(bookLessonId);
    const book = books.find((b) => b.id === selectedBookId);
    const found = selectedBookLessons.find((x) => x.id === bookLessonId);
    if (!found || !book) return;
    setSubjectId(book.subjectId);
    setGradeLevel(book.gradeLevel);
    setLessonTopic(found.title);
    setLessonContent(found.content);
  };

  // Upload File & Extract for Radar
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsExtractingSource(true);
    setSetupError(null);
    try {
      const fileBase64 = await readFileAsBase64(file);
      const res = await fetch("/api/radar/extract-source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          fileBase64,
          subjectName: resolvedSubjectName,
          gradeLevel,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "تعذر تحليل الملف المرفوع.");
      }
      if (data.topicTitle && !lessonTopic.trim()) {
        setLessonTopic(data.topicTitle);
      }
      const conceptsLine = Array.isArray(data.keyConcepts) && data.keyConcepts.length > 0
        ? `\n\nالمفاهيم الرئيسية: ${data.keyConcepts.join("، ")}`
        : "";
      const objectivesLine = Array.isArray(data.objectives) && data.objectives.length > 0
        ? `\nالأهداف: ${data.objectives.join(" | ")}`
        : "";
      setLessonContent(`${data.extractedText || ""}${conceptsLine}${objectivesLine}`.trim());
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : "خطأ أثناء قراءة الملف.");
    } finally {
      setIsExtractingSource(false);
      e.target.value = "";
    }
  };

  // Toggle question type selection
  const toggleQuestionType = (t: RadarQuestionType) => {
    setSelectedTypes((prev) => {
      if (prev.includes(t)) {
        return prev.length > 1 ? prev.filter((x) => x !== t) : prev;
      }
      return [...prev, t];
    });
  };

  // Generate AI Diagnostic Questions (or honest Preset Demo Mode)
  const loadDemoQuestions = () => {
    setSetupError(null);
    const demoQs = buildDemoRadarQuestions(
      lessonTopic.trim() || resolvedSubjectName,
      resolvedSubjectName,
      lessons,
      uiLang
    );
    setQuestions(demoQs);
    setQuestionsSource("demo");
  };

  const handleGenerateQuestions = async () => {
    setSetupError(null);
    if (demoMode) {
      loadDemoQuestions();
      return;
    }
    if (!lessonTopic.trim() && !lessonContent.trim()) {
      setSetupError(
        isAr
          ? "يرجى تحديد عنوان الدرس أو إدخال محتواه أولاً."
          : "Please provide a lesson topic or lesson content first."
      );
      return;
    }

    setIsGeneratingQuestions(true);
    try {
      const res = await fetch("/api/radar/generate-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectName: resolvedSubjectName,
          gradeLevel,
          lessonTopic: lessonTopic.trim() || resolvedSubjectName,
          lessonContent,
          questionCount,
          questionTypes: selectedTypes,
          difficulty,
          language: uiLang,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "تعذر توليد الأسئلة التشخيصية.");
      }
      setQuestions(Array.isArray(data.questions) ? data.questions : []);
      setQuestionsSource("ai");
    } catch (err) {
      setSetupError(
        err instanceof Error ? err.message : "فشل توليد الأسئلة التشخيصية."
      );
    } finally {
      setIsGeneratingQuestions(false);
    }
  };

  // Add manual blank question
  const handleAddManualQuestion = () => {
    const newQ: RadarQuestion = {
      id: `rq-manual-${Date.now().toString(36)}`,
      questionType: "mcq",
      cognitiveLevel: "understanding",
      difficulty: "medium",
      concept: lessonTopic || resolvedSubjectName,
      objective: isAr ? "قياس الفهم التطبيقي للمفهوم" : "Assess applied understanding",
      misconceptionTarget: isAr ? "الخلط بين السبب والنتيجة" : "Confusing cause and effect",
      question: isAr ? "اكتب نص السؤال التشخيصي هنا..." : "Write diagnostic question here...",
      options: isAr
        ? ["الخيار الأول", "الخيار الثاني", "الخيار الثالث", "الخيار الرابع"]
        : ["Option A", "Option B", "Option C", "Option D"],
      correctIndex: 0,
      timeLimitSec: 45,
      explanation: isAr ? "التفسير العلمي للإجابة الصحيحة..." : "Explanation...",
      hint: isAr ? "تلميح توجيهي للطالب..." : "Hint...",
    };
    setQuestions((prev) => [...prev, newQ]);
    setEditingQuestionId(newQ.id);
  };

  const updateQuestionField = (id: string, patch: Partial<RadarQuestion>) => {
    setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  };

  // WebSocket Countdown Timer Sync
  useEffect(() => {
    if (!snapshot || snapshot.status !== "question" || !snapshot.currentQuestion) {
      setSecondsLeft(0);
      return;
    }
    const total = snapshot.currentQuestion.timeLimitSec || 45;
    const tick = () => {
      const elapsed = Math.floor((Date.now() - snapshot.questionStartedAt) / 1000);
      setSecondsLeft(Math.max(0, total - elapsed));
    };
    tick();
    const id = setInterval(tick, 300);
    return () => clearInterval(id);
  }, [snapshot?.status, snapshot?.questionStartedAt, snapshot?.currentQuestion?.id]);

  // Reset student local selections on new question
  useEffect(() => {
    setStudentSelectedOption(null);
    setStudentShortAnswer("");
    if (snapshot?.currentQuestion?.id !== studentFeedback?.questionId) {
      setStudentFeedback(null);
    }
  }, [snapshot?.currentQuestion?.id, snapshot?.currentQuestionIndex]);

  // Launch Live Host Room via WebSocket
  const handleLaunchLiveSession = () => {
    if (questions.length === 0) {
      setSetupError(
        isAr
          ? "قم بتوليد أو إضافة سؤال واحد على الأقل قبل بدء الجلسة."
          : "Generate or add at least one question before starting."
      );
      return;
    }
    setWsError(null);
    if (wsRef.current) wsRef.current.close();

    const ws = new WebSocket(getWsUrl("/ws/radar"));
    wsRef.current = ws;
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: "radar:create",
          subjectId,
          subjectName: resolvedSubjectName,
          gradeLevel,
          lessonTopic: lessonTopic || activeLesson.title,
          lessonId: selectedPlatformLessonId,
          interventionThresholdPct: thresholdPct,
          questions,
        })
      );
      setMode("host");
    };
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === "radar:state") {
          setSnapshot(msg.snapshot);
        } else if (msg.type === "radar:error") {
          setWsError(msg.message);
        }
      } catch {
        // Ignore
      }
    };
    ws.onerror = () => {
      setWsError(isAr ? "تعذر الاتصال بخادم الجلسات المباشرة." : "WebSocket connection failed.");
    };
  };

  // Student Join via WebSocket
  const handleStudentJoin = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const code = joinCodeInput.trim().toUpperCase();
    const name = studentNameInput.trim();
    if (!code || !name) {
      setWsError(
        isAr ? "يرجى إدخال رمز الجلسة واسمك للمتابعة." : "Enter room code and your name."
      );
      return;
    }
    setWsError(null);
    if (wsRef.current) wsRef.current.close();

    const ws = new WebSocket(getWsUrl("/ws/radar"));
    wsRef.current = ws;
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: "radar:join",
          roomCode: code,
          name,
          studentId: joinedStudentId || undefined,
        })
      );
    };
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === "radar:joined") {
          setJoinedStudentId(msg.studentId);
        } else if (msg.type === "radar:state") {
          setSnapshot(msg.snapshot);
        } else if (msg.type === "radar:feedback") {
          setStudentFeedback({
            questionId: msg.questionId,
            isCorrect: msg.isCorrect,
            explanation: msg.explanation,
            concept: msg.concept,
          });
        } else if (msg.type === "radar:error") {
          setWsError(msg.message);
        }
      } catch {
        // Ignore
      }
    };
    ws.onerror = () => {
      setWsError(isAr ? "تعذر الاتصال بالجلسة المباشرة." : "Failed to connect to session.");
    };
  };

  const sendWsAction = (payload: Record<string, unknown>) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  };

  const handleSubmitStudentAnswer = (optionIdx?: number) => {
    const q = snapshot?.currentQuestion;
    if (!q || studentFeedback?.questionId === q.id) return;
    if (q.questionType === "short_answer") {
      if (!studentShortAnswer.trim()) return;
      sendWsAction({ type: "radar:answer", textAnswer: studentShortAnswer.trim() });
    } else if (typeof optionIdx === "number") {
      setStudentSelectedOption(optionIdx);
      sendWsAction({ type: "radar:answer", optionIndex: optionIdx });
    }
  };

  // Trigger AI Instructional Intervention for a Struggling Concept
  const handleRequestIntervention = async (concept: string) => {
    if (!snapshot) return;
    setInterventionConcept(concept);
    setIsGeneratingIntervention(true);
    setInterventionDraft(null);
    setWsError(null);

    try {
      const cStat = snapshot.conceptStats.find((c) => c.concept === concept);
      const qRelated = snapshot.allQuestions.find((q) => q.concept === concept);
      const qStat = qRelated
        ? snapshot.questionStats.find((s) => s.questionId === qRelated.id)
        : null;
      const misconceptionsForConcept = snapshot.topMisconceptions.filter(
        (m) => m.concept === concept
      );

      const res = await fetch("/api/radar/intervene", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectName: snapshot.subjectName,
          gradeLevel: snapshot.gradeLevel,
          lessonTopic: snapshot.lessonTopic,
          concept,
          currentAccuracyPct: cStat?.understandingPct ?? 0,
          misconceptions: misconceptionsForConcept,
          questionContext: qRelated || null,
          wrongShortAnswers: qStat?.sampleWrongTextAnswers || [],
          language: uiLang,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "تعذر توليد مقترحات التدخل.");
      }
      setInterventionDraft({
        concept,
        diagnosisSummary: data.diagnosisSummary || "",
        strategies: data.strategies || [],
        verificationQuestion: data.verificationQuestion,
      });
      setSelectedStrategyIdx(0);
    } catch (err) {
      setWsError(err instanceof Error ? err.message : "خطأ أثناء طلب التدخل التعليمي.");
    } finally {
      setIsGeneratingIntervention(false);
    }
  };

  const handleBroadcastIntervention = () => {
    if (!interventionDraft) return;
    const strat = interventionDraft.strategies[selectedStrategyIdx];
    if (!strat) return;
    sendWsAction({
      type: "radar:intervene",
      concept: interventionDraft.concept,
      strategy: strat,
      verificationQuestion: interventionDraft.verificationQuestion,
    });
    setInterventionDraft(null);
    setInterventionConcept(null);
  };

  // Talking AI Tutor Query + Speech Synthesis
  const handleAskTutor = async (
    customText?: string,
    tutorMode: "ask" | "hint" | "simplify" | "explain_error" = "ask"
  ) => {
    const query = (customText ?? tutorInput).trim();
    if (!query || isTutorThinking) return;
    setTutorInput("");
    const userMsgId = `tm-u-${Date.now()}`;
    setTutorMessages((prev) => [...prev, { id: userMsgId, sender: "user", text: query }]);
    setIsTutorThinking(true);

    try {
      const res = await fetch("/api/radar/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userRole: mode === "student" ? "student" : "teacher",
          subjectName: snapshot?.subjectName || resolvedSubjectName,
          gradeLevel: snapshot?.gradeLevel || gradeLevel,
          lessonTopic: snapshot?.lessonTopic || lessonTopic,
          lessonContent,
          activeQuestion: snapshot?.currentQuestion || null,
          sessionStatus: snapshot?.status || "lobby",
          mode: tutorMode,
          userMessage: query,
          history: tutorMessages.slice(-6).map((m) => ({ sender: m.sender, text: m.text })),
          language: uiLang,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "تعذر استجابة المعلم الذكي.");
      }
      const replyText = String(data.reply || "");
      setTutorMessages((prev) => [
        ...prev,
        {
          id: `tm-a-${Date.now()}`,
          sender: "assistant",
          text: replyText,
          analogy: data.simplifiedAnalogy,
          hint: data.scaffoldedHint,
          followUps: Array.isArray(data.followUpPrompts) ? data.followUpPrompts : [],
        },
      ]);
      if (settings.autoReadResponses && replyText) {
        void speakTutorText(replyText);
      }
    } catch (err) {
      setTutorMessages((prev) => [
        ...prev,
        {
          id: `tm-err-${Date.now()}`,
          sender: "assistant",
          text: err instanceof Error ? err.message : "حدث خطأ في الاتصال بالمعلم الذكي.",
        },
      ]);
    } finally {
      setIsTutorThinking(false);
    }
  };

  const speakTutorText = async (text: string) => {
    stopAllSpeech();
    setIsTutorSpeaking(true);
    const res = await speakWithGeminiTTS(
      text,
      settings.speechRate,
      () => setIsTutorSpeaking(true),
      () => setIsTutorSpeaking(false),
      uiLang
    );
    if (!res.ok) {
      const started = speakWithBrowser(
        text,
        settings.speechRate,
        () => setIsTutorSpeaking(false),
        () => setIsTutorSpeaking(false),
        uiLang
      );
      if (!started) setIsTutorSpeaking(false);
    }
  };

  const handleTutorVoiceInput = () => {
    if (isListeningTutorMic) {
      setIsListeningTutorMic(false);
      return;
    }
    const rec = createBrowserSpeechRecognition(uiLang);
    if (!rec) return;
    setIsListeningTutorMic(true);
    rec.onresult = (event) => {
      const spoken = event.results?.[0]?.[0]?.transcript || "";
      if (spoken) {
        void handleAskTutor(spoken, "ask");
      }
    };
    rec.onerror = () => setIsListeningTutorMic(false);
    rec.onend = () => setIsListeningTutorMic(false);
    rec.start();
  };

  const handleCopyStudentLink = () => {
    if (!snapshot?.roomCode) return;
    const url = `${window.location.origin}${window.location.pathname}?radar=${snapshot.roomCode}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const selectedStudentProfile: RadarStudentProfile | null = useMemo(() => {
    if (!snapshot || !selectedStudentId) return null;
    return snapshot.studentProfiles.find((s) => s.id === selectedStudentId) || null;
  }, [snapshot, selectedStudentId]);

  const selectedStudentRadarData = useMemo(() => {
    if (!selectedStudentProfile || !snapshot) return undefined;
    return snapshot.conceptStats.map((cs) => {
      const stuAns = selectedStudentProfile.answers.filter((a) => a.concept === cs.concept);
      const pct =
        stuAns.length > 0
          ? Math.round((stuAns.filter((a) => a.isCorrect).length / stuAns.length) * 100)
          : 0;
      return { concept: cs.concept, pct };
    });
  }, [selectedStudentProfile, snapshot]);

  const activeDataSnapshot = viewingReport || snapshot;

  return (
    <div className="space-y-6 pb-10">
      {/* Top Mode Navigation Bar */}
      <section
        className="science-card rounded-3xl border p-5 flex flex-wrap items-center justify-between gap-4"
        style={{
          backgroundColor: "var(--bg-surface)",
          borderColor: "var(--border-hairline)",
        }}
      >
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            <Radar className="w-4 h-4" style={{ color: "var(--accent-primary)" }} />
            <span>{isAr ? "بوابة المعلم والطالب" : "Teacher & Student Portal"}</span>
            <span aria-hidden="true">·</span>
            <span>smart science ai</span>
            {snapshot?.roomCode && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono-num font-bold" style={{ color: "var(--accent-primary)" }}>
                  {isAr ? `غرفة ${snapshot.roomCode}` : `Room ${snapshot.roomCode}`}
                </span>
              </>
            )}
          </div>
          <h1 className="font-display text-xl md:text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
            {isAr ? "رادار الفهم الذكي المباشر" : "AI Understanding Radar"}
          </h1>
          <p className="text-xs md:text-sm" style={{ color: "var(--text-secondary)" }}>
            {isAr
              ? "رصد لحظي لفهم الطلاب، تشخيص التصورات الخاطئة، تدخل تدريسي ذكي، وقياس أثر التحسن مباشرة."
              : "Real-time comprehension radar, misconception diagnosis, AI intervention & before/after impact tracking."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {[
            { id: "setup" as const, labelAr: "إعداد الأسئلة التشخيصية", labelEn: "Setup & Builder", icon: Sparkles },
            { id: "host" as const, labelAr: "لوحة الرادار المباشرة", labelEn: "Live Radar Host", icon: Activity },
            { id: "student" as const, labelAr: "دخول الطالب", labelEn: "Student Join", icon: Users },
            { id: "history" as const, labelAr: "السجل والمقارنة والتصدير", labelEn: "History & Export", icon: History },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = mode === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setMode(tab.id);
                  if (tab.id === "history") fetchHistory();
                }}
                className="min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap border transition-colors"
                style={{
                  backgroundColor: active ? "var(--accent-primary)" : "var(--bg-subtle)",
                  borderColor: active ? "var(--accent-primary)" : "var(--border-hairline)",
                  color: active ? "var(--accent-contrast)" : "var(--text-primary)",
                }}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{isAr ? tab.labelAr : tab.labelEn}</span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => setTutorOpen((o) => !o)}
            className="min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 whitespace-nowrap border"
            style={{
              backgroundColor: tutorOpen ? "var(--accent-primary)" : "var(--bg-surface)",
              borderColor: "var(--accent-primary)",
              color: tutorOpen ? "var(--accent-contrast)" : "var(--accent-primary)",
            }}
          >
            <Bot className="w-4 h-4 shrink-0" />
            <span>{isAr ? "المساعد المتحدث" : "Talking AI Tutor"}</span>
          </button>
        </div>
      </section>

      {/* ===================================================== */}
      {/* MODE 1: TEACHER SETUP & DIAGNOSTIC QUESTION BUILDER   */}
      {/* ===================================================== */}
      {mode === "setup" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Lesson Source & Configuration */}
          <div
            className="lg:col-span-5 rounded-3xl border p-5 md:p-6 space-y-5 science-card"
            style={{
              backgroundColor: "var(--bg-surface)",
              borderColor: "var(--border-hairline)",
            }}
          >
            <h2 className="font-display text-base md:text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
              <Layers className="w-5 h-5" style={{ color: "var(--accent-primary)" }} />
              <span>{isAr ? "1. إعداد الدرس ومحتوى الفحص" : "1. Lesson & Source Setup"}</span>
            </h2>

            {/* Subject & Grade */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="block text-xs font-bold" style={{ color: "var(--text-secondary)" }}>
                  {isAr ? "المادة الدراسية" : "Subject"}
                </label>
                <select
                  value={subjectId}
                  onChange={(e) => setSubjectId(e.target.value)}
                  className="w-full min-h-[40px] px-3 rounded-xl border text-xs font-semibold"
                  style={{
                    backgroundColor: "var(--bg-subtle)",
                    borderColor: "var(--border-hairline)",
                    color: "var(--text-primary)",
                  }}
                >
                  {SUBJECTS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {isAr ? s.nameAr : s.nameEn}
                    </option>
                  ))}
                  <option value="custom">
                    {isAr ? "مادة تعليمية أخرى (مخصصة)" : "Other Subject (Custom)"}
                  </option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-bold" style={{ color: "var(--text-secondary)" }}>
                  {isAr ? "الصف الدراسي" : "Grade Level"}
                </label>
                <input
                  list="radar-grade-list"
                  value={gradeLevel}
                  onChange={(e) => setGradeLevel(e.target.value)}
                  className="w-full min-h-[40px] px-3 rounded-xl border text-xs font-semibold"
                  style={{
                    backgroundColor: "var(--bg-subtle)",
                    borderColor: "var(--border-hairline)",
                    color: "var(--text-primary)",
                  }}
                />
                <datalist id="radar-grade-list">
                  {GRADE_OPTIONS_AR.map((g) => (
                    <option key={g} value={g} />
                  ))}
                </datalist>
              </div>
            </div>

            {subjectId === "custom" && (
              <div className="space-y-1.5">
                <label className="block text-xs font-bold" style={{ color: "var(--text-secondary)" }}>
                  {isAr ? "اسم المادة المخصصة" : "Custom Subject Name"}
                </label>
                <input
                  type="text"
                  value={customSubjectName}
                  onChange={(e) => setCustomSubjectName(e.target.value)}
                  placeholder={isAr ? "مثلاً: اللغة العربية، الدراسات الاجتماعية..." : "e.g., History, Computer Science"}
                  className="w-full min-h-[40px] px-3 rounded-xl border text-xs"
                  style={{
                    backgroundColor: "var(--bg-subtle)",
                    borderColor: "var(--border-hairline)",
                    color: "var(--text-primary)",
                  }}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label className="block text-xs font-bold" style={{ color: "var(--text-secondary)" }}>
                {isAr ? "موضوع الدرس" : "Lesson Topic"}
              </label>
              <input
                type="text"
                value={lessonTopic}
                onChange={(e) => setLessonTopic(e.target.value)}
                placeholder={isAr ? "مثلاً: الروابط التساهمية والأيونية" : "e.g., Ionic & Covalent Bonding"}
                className="w-full min-h-[40px] px-3 rounded-xl border text-xs font-semibold"
                style={{
                  backgroundColor: "var(--bg-subtle)",
                  borderColor: "var(--border-hairline)",
                  color: "var(--text-primary)",
                }}
              />
            </div>

            {/* Source Picker Tabs */}
            <div className="space-y-2.5">
              <span className="block text-xs font-bold" style={{ color: "var(--text-secondary)" }}>
                {isAr ? "مصدر محتوى الدرس:" : "Lesson Content Source:"}
              </span>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: "platform_lesson" as const, labelAr: "دروس المنصة المحفوظة", labelEn: "Platform Lessons" },
                  { id: "book_lesson" as const, labelAr: "من مكتبة الكتب", labelEn: "Textbook Library" },
                  { id: "paste_text" as const, labelAr: "إدخال / لصق نص", labelEn: "Paste Lesson Text" },
                  { id: "upload_file" as const, labelAr: "رفع PDF / Word / PPT", labelEn: "Upload File" },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setSourceMode(opt.id)}
                    className="min-h-[38px] px-2.5 py-1.5 rounded-xl border text-xs font-semibold whitespace-nowrap"
                    style={{
                      backgroundColor:
                        sourceMode === opt.id ? "var(--accent-primary)" : "var(--bg-subtle)",
                      borderColor:
                        sourceMode === opt.id ? "var(--accent-primary)" : "var(--border-hairline)",
                      color:
                        sourceMode === opt.id ? "var(--accent-contrast)" : "var(--text-primary)",
                    }}
                  >
                    {isAr ? opt.labelAr : opt.labelEn}
                  </button>
                ))}
              </div>

              {sourceMode === "platform_lesson" && (
                <select
                  value={selectedPlatformLessonId}
                  onChange={(e) => applyPlatformLesson(e.target.value)}
                  className="w-full min-h-[40px] px-3 rounded-xl border text-xs font-semibold"
                  style={{
                    backgroundColor: "var(--bg-subtle)",
                    borderColor: "var(--border-hairline)",
                    color: "var(--text-primary)",
                  }}
                >
                  {lessons.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.title} ({l.subject} · {l.gradeLevel})
                    </option>
                  ))}
                </select>
              )}

              {sourceMode === "book_lesson" && (
                <div className="space-y-2">
                  <select
                    value={selectedBookId}
                    onChange={(e) => setSelectedBookId(e.target.value)}
                    className="w-full min-h-[40px] px-3 rounded-xl border text-xs font-semibold"
                    style={{
                      backgroundColor: "var(--bg-subtle)",
                      borderColor: "var(--border-hairline)",
                      color: "var(--text-primary)",
                    }}
                  >
                    <option value="">
                      {books.length === 0
                        ? isAr
                          ? "لا توجد كتب مرفوعة في المكتبة بعد"
                          : "No uploaded books yet"
                        : isAr
                          ? "اختر كتاباً من المكتبة..."
                          : "Choose textbook..."}
                    </option>
                    {books.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.title} ({b.gradeLevel})
                      </option>
                    ))}
                  </select>

                  {selectedBookLessons.length > 0 && (
                    <select
                      value={selectedBookLessonId}
                      onChange={(e) => applyBookLesson(e.target.value)}
                      className="w-full min-h-[40px] px-3 rounded-xl border text-xs font-semibold"
                      style={{
                        backgroundColor: "var(--bg-subtle)",
                        borderColor: "var(--border-hairline)",
                        color: "var(--text-primary)",
                      }}
                    >
                      <option value="">{isAr ? "اختر درساً من فهرس الكتاب..." : "Select book lesson..."}</option>
                      {selectedBookLessons.map((bl) => (
                        <option key={bl.id} value={bl.id}>
                          {bl.unitTitle} — {bl.title} (ص {bl.pages})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {sourceMode === "upload_file" && (
                <label
                  className="flex items-center justify-center gap-2 p-3.5 rounded-xl border border-dashed cursor-pointer text-xs font-semibold"
                  style={{
                    backgroundColor: "var(--bg-subtle)",
                    borderColor: "var(--accent-primary)",
                    color: "var(--accent-primary)",
                  }}
                >
                  {isExtractingSource ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4" />
                  )}
                  <span>
                    {isExtractingSource
                      ? isAr
                        ? "جارٍ استخلاص مفاهيم الملف..."
                        : "Extracting lesson concepts..."
                      : isAr
                        ? "اختر ملف PDF أو Word (.docx) أو PowerPoint (.pptx) أو صورة"
                        : "Upload PDF, DOCX, PPTX, TXT or Image"}
                  </span>
                  <input
                    type="file"
                    accept=".pdf,.docx,.pptx,.txt,.md,image/*"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              )}

              <textarea
                rows={5}
                value={lessonContent}
                onChange={(e) => setLessonContent(e.target.value)}
                placeholder={
                  isAr
                    ? "محتوى الدرس والأهداف العلمية التي سيبني رادار الفهم الأسئلة التشخيصية منها..."
                    : "Lesson text, definitions, equations and objectives..."
                }
                className="w-full p-3 rounded-xl border text-xs leading-relaxed"
                style={{
                  backgroundColor: "var(--bg-subtle)",
                  borderColor: "var(--border-hairline)",
                  color: "var(--text-primary)",
                }}
              />
            </div>

            {/* Diagnostic Question Config */}
            <div className="space-y-3 pt-2 border-t" style={{ borderColor: "var(--border-hairline)" }}>
              <div className="grid grid-cols-3 gap-2.5">
                <div className="space-y-1">
                  <label className="block text-[11px] font-bold" style={{ color: "var(--text-secondary)" }}>
                    {isAr ? "عدد الأسئلة" : "Questions"}
                  </label>
                  <input
                    type="number"
                    min={2}
                    max={15}
                    value={questionCount}
                    onChange={(e) => setQuestionCount(Math.min(15, Math.max(2, Number(e.target.value) || 5)))}
                    className="w-full min-h-[38px] px-2.5 rounded-xl border text-xs font-mono-num font-bold"
                    style={{
                      backgroundColor: "var(--bg-subtle)",
                      borderColor: "var(--border-hairline)",
                      color: "var(--text-primary)",
                    }}
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-[11px] font-bold" style={{ color: "var(--text-secondary)" }}>
                    {isAr ? "مستوى الصعوبة" : "Difficulty"}
                  </label>
                  <select
                    value={difficulty}
                    onChange={(e) => setDifficulty(e.target.value as RadarDifficulty)}
                    className="w-full min-h-[38px] px-2 rounded-xl border text-xs font-semibold"
                    style={{
                      backgroundColor: "var(--bg-subtle)",
                      borderColor: "var(--border-hairline)",
                      color: "var(--text-primary)",
                    }}
                  >
                    <option value="mixed">{isAr ? "متدرج شامل" : "Mixed"}</option>
                    <option value="easy">{isAr ? "أساسي / ميسّر" : "Easy"}</option>
                    <option value="medium">{isAr ? "متوسط" : "Medium"}</option>
                    <option value="hard">{isAr ? "تحليل وتحدي" : "Hard"}</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="block text-[11px] font-bold" style={{ color: "var(--text-secondary)" }}>
                    {isAr ? "حد إنذار التدخل" : "Alert Threshold"}
                  </label>
                  <input
                    type="number"
                    min={30}
                    max={90}
                    step={5}
                    value={thresholdPct}
                    onChange={(e) => setThresholdPct(Math.min(90, Math.max(30, Number(e.target.value) || 65)))}
                    className="w-full min-h-[38px] px-2.5 rounded-xl border text-xs font-mono-num font-bold"
                    style={{
                      backgroundColor: "var(--bg-subtle)",
                      borderColor: "var(--border-hairline)",
                      color: "var(--text-primary)",
                    }}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="block text-[11px] font-bold" style={{ color: "var(--text-secondary)" }}>
                  {isAr ? "أنماط الأسئلة التشخيصية المطلوبة:" : "Diagnostic Question Types:"}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(QUESTION_TYPE_LABELS) as RadarQuestionType[]).map((qt) => {
                    const active = selectedTypes.includes(qt);
                    return (
                      <button
                        key={qt}
                        type="button"
                        onClick={() => toggleQuestionType(qt)}
                        className="px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold whitespace-nowrap"
                        style={{
                          backgroundColor: active ? "var(--accent-primary)" : "var(--bg-subtle)",
                          borderColor: active ? "var(--accent-primary)" : "var(--border-hairline)",
                          color: active ? "var(--accent-contrast)" : "var(--text-primary)",
                        }}
                      >
                        {isAr ? QUESTION_TYPE_LABELS[qt].ar : QUESTION_TYPE_LABELS[qt].en}
                      </button>
                    );
                  })}
                </div>
              </div>

              {setupError && (
                <div className="p-3 rounded-xl border border-rose-500/40 bg-rose-500/10 text-xs text-rose-700 dark:text-rose-300 space-y-2">
                  <div>{setupError}</div>
                  <button
                    type="button"
                    onClick={() => {
                      onToggleDemoMode?.(true);
                      loadDemoQuestions();
                    }}
                    className="px-3 py-1.5 rounded-lg border font-bold bg-amber-100 text-amber-900 border-amber-400 hover:opacity-90"
                  >
                    {isAr ? "توليد أسئلة تجريبية جاهزة (Demo Mode)" : "Load Demo Diagnostic Questions"}
                  </button>
                </div>
              )}
              {questionsSource && questions.length > 0 && (
                <div
                  className="px-3 py-2 rounded-xl border text-[11px] font-bold"
                  style={
                    questionsSource === "demo"
                      ? { backgroundColor: "#fef3c7", borderColor: "#f59e0b", color: "#92400e" }
                      : { backgroundColor: "var(--bg-subtle)", borderColor: "var(--accent-primary)", color: "var(--accent-primary)" }
                  }
                >
                  {questionsSource === "demo"
                    ? isAr
                      ? "أسئلة تجريبية مسبقة (Demo Mode) — غير مولّدة بالذكاء الاصطناعي (تعمل فوراً مع البث المباشر للطلاب)"
                      : "Preset Demo Sample Questions — Not Live AI (ready to launch live)"
                    : isAr
                      ? "أسئلة تشخيصية مولّدة فعلياً بالذكاء الاصطناعي"
                      : "Live AI-generated diagnostic questions"}
                </div>
              )}

              <button
                type="button"
                disabled={isGeneratingQuestions}
                onClick={handleGenerateQuestions}
                className="w-full min-h-[46px] px-4 py-2.5 rounded-2xl text-xs md:text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60 shadow-sm"
                style={{
                  backgroundColor: "var(--accent-primary)",
                  color: "var(--accent-contrast)",
                }}
              >
                {isGeneratingQuestions ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                <span>
                  {isGeneratingQuestions
                    ? isAr
                      ? "جارٍ بناء الأسئلة التشخيصية بالذكاء الاصطناعي..."
                      : "Generating Diagnostic Questions..."
                    : isAr
                      ? "توليد أسئلة الفحص التشخيصي بالذكاء الاصطناعي"
                      : "Generate AI Diagnostic Questions"}
                </span>
              </button>
            </div>
          </div>

          {/* Right Column: Review, Edit, Add & Launch Live Session */}
          <div
            className="lg:col-span-7 rounded-3xl border p-5 md:p-6 space-y-4 science-card"
            style={{
              backgroundColor: "var(--bg-surface)",
              borderColor: "var(--border-hairline)",
            }}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-base md:text-lg font-bold" style={{ color: "var(--text-primary)" }}>
                  {isAr ? "2. مراجعة الأسئلة واعتماد الجلسة" : "2. Review Questions & Launch"}
                </h2>
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {isAr
                    ? "يمكنك تعديل أي سؤال أو حذفه أو إضافة سؤال مخصص قبل إطلاق رادار الفهم للطلاب."
                    : "Edit, reorder, delete, or add questions manually before launching live."}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleAddManualQuestion}
                  className="min-h-[38px] px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
                  style={{
                    backgroundColor: "var(--bg-subtle)",
                    borderColor: "var(--border-hairline)",
                    color: "var(--text-primary)",
                  }}
                >
                  <Plus className="w-4 h-4" />
                  <span>{isAr ? "إضافة سؤال يدوياً" : "Add Question"}</span>
                </button>

                <button
                  type="button"
                  disabled={questions.length === 0}
                  onClick={handleLaunchLiveSession}
                  className="min-h-[40px] px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 whitespace-nowrap disabled:opacity-45 shadow-sm"
                  style={{
                    backgroundColor: "#0f766e",
                    color: "#ffffff",
                  }}
                >
                  <Play className="w-4 h-4" />
                  <span>{isAr ? "بدء جلسة رادار الفهم" : "Launch Live Radar"}</span>
                </button>
              </div>
            </div>

            {questions.length === 0 ? (
              <div
                className="rounded-2xl border border-dashed p-10 text-center space-y-2"
                style={{
                  backgroundColor: "var(--bg-subtle)",
                  borderColor: "var(--border-hairline)",
                }}
              >
                <Radar className="w-9 h-9 mx-auto opacity-60" style={{ color: "var(--accent-primary)" }} />
                <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                  {isAr
                    ? "لم يتم إعداد أسئلة تشخيصية بعد"
                    : "No diagnostic questions prepared yet"}
                </p>
                <p className="text-xs max-w-md mx-auto" style={{ color: "var(--text-secondary)" }}>
                  {isAr
                    ? "اضغط على زر «توليد أسئلة الفحص التشخيصي بالذكاء الاصطناعي» أو أضف سؤالاً يدوياً لبدء الجلسة."
                    : "Click Generate AI Diagnostic Questions on the left or add a question manually."}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {questions.map((q, idx) => {
                  const isEditing = editingQuestionId === q.id;
                  return (
                    <div
                      key={q.id}
                      className="rounded-2xl border p-4 space-y-3"
                      style={{
                        backgroundColor: "var(--bg-subtle)",
                        borderColor: isEditing ? "var(--accent-primary)" : "var(--border-hairline)",
                      }}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>
                          <span className="font-mono-num font-bold" style={{ color: "var(--accent-primary)" }}>
                            Q{idx + 1}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {isAr
                              ? QUESTION_TYPE_LABELS[q.questionType]?.ar || q.questionType
                              : QUESTION_TYPE_LABELS[q.questionType]?.en || q.questionType}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span style={{ color: "var(--text-primary)" }}>{q.concept}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono-num">{q.timeLimitSec}s</span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setEditingQuestionId(isEditing ? null : q.id)}
                            className="px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1"
                            style={{
                              backgroundColor: "var(--bg-surface)",
                              borderColor: "var(--border-hairline)",
                              color: "var(--text-primary)",
                            }}
                          >
                            <Edit3 className="w-3 h-3" />
                            <span>{isEditing ? (isAr ? "إنهاء" : "Done") : isAr ? "تعديل" : "Edit"}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setQuestions((prev) => prev.filter((item) => item.id !== q.id))
                            }
                            aria-label={isAr ? "حذف السؤال" : "Delete question"}
                            className="p-1.5 rounded-lg border text-rose-600"
                            style={{
                              backgroundColor: "var(--bg-surface)",
                              borderColor: "var(--border-hairline)",
                            }}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {isEditing ? (
                        <div className="space-y-2.5 pt-2 border-t" style={{ borderColor: "var(--border-hairline)" }}>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <input
                              type="text"
                              value={q.concept}
                              onChange={(e) => updateQuestionField(q.id, { concept: e.target.value })}
                              placeholder={isAr ? "المفهوم العلمي" : "Concept"}
                              className="px-3 py-1.5 rounded-xl border text-xs"
                              style={{
                                backgroundColor: "var(--bg-surface)",
                                borderColor: "var(--border-hairline)",
                                color: "var(--text-primary)",
                              }}
                            />
                            <select
                              value={q.questionType}
                              onChange={(e) =>
                                updateQuestionField(q.id, {
                                  questionType: e.target.value as RadarQuestionType,
                                  options:
                                    e.target.value === "true_false"
                                      ? isAr
                                        ? ["صحيح", "خطأ"]
                                        : ["True", "False"]
                                      : e.target.value === "short_answer"
                                        ? []
                                        : q.options.length >= 2
                                          ? q.options
                                          : ["أ", "ب", "ج", "د"],
                                })
                              }
                              className="px-2.5 py-1.5 rounded-xl border text-xs"
                              style={{
                                backgroundColor: "var(--bg-surface)",
                                borderColor: "var(--border-hairline)",
                                color: "var(--text-primary)",
                              }}
                            >
                              {(Object.keys(QUESTION_TYPE_LABELS) as RadarQuestionType[]).map((qt) => (
                                <option key={qt} value={qt}>
                                  {isAr ? QUESTION_TYPE_LABELS[qt].ar : QUESTION_TYPE_LABELS[qt].en}
                                </option>
                              ))}
                            </select>
                            <input
                              type="number"
                              min={15}
                              max={180}
                              value={q.timeLimitSec}
                              onChange={(e) =>
                                updateQuestionField(q.id, { timeLimitSec: Number(e.target.value) || 45 })
                              }
                              className="px-3 py-1.5 rounded-xl border text-xs font-mono-num"
                              style={{
                                backgroundColor: "var(--bg-surface)",
                                borderColor: "var(--border-hairline)",
                                color: "var(--text-primary)",
                              }}
                            />
                          </div>

                          <textarea
                            rows={2}
                            value={q.question}
                            onChange={(e) => updateQuestionField(q.id, { question: e.target.value })}
                            className="w-full p-2.5 rounded-xl border text-xs font-semibold"
                            style={{
                              backgroundColor: "var(--bg-surface)",
                              borderColor: "var(--border-hairline)",
                              color: "var(--text-primary)",
                            }}
                          />

                          {q.questionType === "short_answer" ? (
                            <input
                              type="text"
                              value={(q.acceptableAnswers || []).join("، ")}
                              onChange={(e) =>
                                updateQuestionField(q.id, {
                                  acceptableAnswers: e.target.value
                                    .split(/[,،]/)
                                    .map((s) => s.trim())
                                    .filter(Boolean),
                                })
                              }
                              placeholder={
                                isAr
                                  ? "الإجابات القصيرة المقبولة مفصولة بفاصلة..."
                                  : "Accepted short answers (comma-separated)..."
                              }
                              className="w-full px-3 py-2 rounded-xl border text-xs"
                              style={{
                                backgroundColor: "var(--bg-surface)",
                                borderColor: "var(--border-hairline)",
                                color: "var(--text-primary)",
                              }}
                            />
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {q.options.map((opt, oIdx) => (
                                <div key={oIdx} className="flex items-center gap-1.5">
                                  <input
                                    type="radio"
                                    name={`correct-${q.id}`}
                                    checked={q.correctIndex === oIdx}
                                    onChange={() => updateQuestionField(q.id, { correctIndex: oIdx })}
                                  />
                                  <input
                                    type="text"
                                    value={opt}
                                    onChange={(e) => {
                                      const next = [...q.options];
                                      next[oIdx] = e.target.value;
                                      updateQuestionField(q.id, { options: next });
                                    }}
                                    className="flex-1 px-2.5 py-1.5 rounded-xl border text-xs"
                                    style={{
                                      backgroundColor: "var(--bg-surface)",
                                      borderColor: "var(--border-hairline)",
                                      color: "var(--text-primary)",
                                    }}
                                  />
                                </div>
                              ))}
                            </div>
                          )}

                          <input
                            type="text"
                            value={q.explanation}
                            onChange={(e) => updateQuestionField(q.id, { explanation: e.target.value })}
                            placeholder={isAr ? "الشرح العلمي للإجابة" : "Scientific explanation"}
                            className="w-full px-3 py-1.5 rounded-xl border text-xs"
                            style={{
                              backgroundColor: "var(--bg-surface)",
                              borderColor: "var(--border-hairline)",
                              color: "var(--text-primary)",
                            }}
                          />
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-sm font-bold leading-relaxed" style={{ color: "var(--text-primary)" }}>
                            {q.question}
                          </p>
                          {q.misconceptionTarget && (
                            <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                              <strong>{isAr ? "التصور الخاطئ المستهدف:" : "Target misconception:"}</strong>{" "}
                              {q.misconceptionTarget}
                            </p>
                          )}
                          {q.questionType === "short_answer" ? (
                            <p className="text-xs font-semibold" style={{ color: "#0f766e" }}>
                              {isAr ? "الإجابات المقبولة:" : "Accepted answers:"}{" "}
                              {(q.acceptableAnswers || []).join(" · ")}
                            </p>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                              {q.options.map((opt, oIdx) => (
                                <div
                                  key={oIdx}
                                  className="px-3 py-1.5 rounded-xl border text-xs flex items-center gap-2"
                                  style={{
                                    backgroundColor:
                                      oIdx === q.correctIndex
                                        ? "rgba(15, 118, 110, 0.1)"
                                        : "var(--bg-surface)",
                                    borderColor:
                                      oIdx === q.correctIndex ? "#0f766e" : "var(--border-hairline)",
                                    color: "var(--text-primary)",
                                  }}
                                >
                                  {oIdx === q.correctIndex && (
                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                                  )}
                                  <span>{opt}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===================================================== */}
      {/* MODE 2: LIVE HOST RADAR DASHBOARD & INTERVENTION      */}
      {/* ===================================================== */}
      {mode === "host" && (
        <div className="space-y-5">
          {!snapshot ? (
            <div
              className="rounded-3xl border p-8 text-center space-y-3 science-card"
              style={{
                backgroundColor: "var(--bg-surface)",
                borderColor: "var(--border-hairline)",
              }}
            >
              <Radar className="w-10 h-10 mx-auto opacity-65" style={{ color: "var(--accent-primary)" }} />
              <h2 className="font-display text-lg font-bold" style={{ color: "var(--text-primary)" }}>
                {isAr ? "لا توجد جلسة رادار نشطة حالياً" : "No Active Radar Session"}
              </h2>
              <p className="text-xs max-w-md mx-auto" style={{ color: "var(--text-secondary)" }}>
                {isAr
                  ? "ابدأ من تبويب «إعداد الأسئلة التشخيصية» لتوليد أو إضافة الأسئلة ثم إطلاق الغرفة المباشرة."
                  : "Go to Setup & Builder to prepare diagnostic questions and launch a live room."}
              </p>
              <button
                type="button"
                onClick={() => setMode("setup")}
                className="min-h-[42px] px-5 py-2 rounded-xl text-xs font-bold"
                style={{
                  backgroundColor: "var(--accent-primary)",
                  color: "var(--accent-contrast)",
                }}
              >
                {isAr ? "الانتقال إلى إعداد الأسئلة" : "Go to Question Setup"}
              </button>
            </div>
          ) : (
            <>
              {/* Room Banner + Controls */}
              <div
                className="rounded-3xl border p-5 flex flex-wrap items-center justify-between gap-4 science-card"
                style={{
                  backgroundColor: "var(--bg-surface)",
                  borderColor: "var(--border-hairline)",
                }}
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
                    <span>{snapshot.subjectName}</span>
                    <span aria-hidden="true">·</span>
                    <span>{snapshot.gradeLevel}</span>
                    <span aria-hidden="true">·</span>
                    <span>{snapshot.lessonTopic}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="px-4 py-1.5 rounded-xl border text-lg font-mono-num font-extrabold tracking-widest" style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--accent-primary)", color: "var(--accent-primary)" }}>
                      {snapshot.roomCode}
                    </div>
                    <button
                      type="button"
                      onClick={handleCopyStudentLink}
                      className="min-h-[38px] px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
                      style={{
                        backgroundColor: "var(--bg-subtle)",
                        borderColor: "var(--border-hairline)",
                        color: "var(--text-primary)",
                      }}
                    >
                      {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>
                        {copiedLink
                          ? isAr
                            ? "تم نسخ رابط الدخول"
                            : "Copied Join Link"
                          : isAr
                            ? "نسخ رابط دخول الطلاب"
                            : "Copy Student Link"}
                      </span>
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPrivacyHideNames((v) => !v)}
                    className="min-h-[38px] px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
                    style={{
                      backgroundColor: privacyHideNames ? "var(--accent-primary)" : "var(--bg-subtle)",
                      borderColor: "var(--border-hairline)",
                      color: privacyHideNames ? "var(--accent-contrast)" : "var(--text-primary)",
                    }}
                  >
                    {privacyHideNames ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    <span>{privacyHideNames ? (isAr ? "الأسماء مخفية" : "Names Hidden") : isAr ? "وضع الخصوصية" : "Privacy Mode"}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setProjectorMode((p) => !p)}
                    className="min-h-[38px] px-3 py-1.5 rounded-xl border text-xs font-semibold whitespace-nowrap"
                    style={{
                      backgroundColor: projectorMode ? "var(--accent-primary)" : "var(--bg-subtle)",
                      borderColor: "var(--border-hairline)",
                      color: projectorMode ? "var(--accent-contrast)" : "var(--text-primary)",
                    }}
                  >
                    {projectorMode ? (isAr ? "عرض التحليلات" : "Analytics View") : isAr ? "شاشة الفصل" : "Classroom Screen"}
                  </button>

                  {snapshot.status === "lobby" && (
                    <button
                      type="button"
                      onClick={() => sendWsAction({ type: "radar:start", questionIndex: 0 })}
                      className="min-h-[40px] px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 whitespace-nowrap"
                      style={{ backgroundColor: "#0f766e", color: "#ffffff" }}
                    >
                      <Play className="w-4 h-4" />
                      <span>{isAr ? "إطلاق السؤال الأول" : "Start Question 1"}</span>
                    </button>
                  )}

                  {snapshot.status === "question" && (
                    <button
                      type="button"
                      onClick={() => sendWsAction({ type: "radar:reveal" })}
                      className="min-h-[40px] px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap"
                      style={{ backgroundColor: "#d97706", color: "#ffffff" }}
                    >
                      {isAr ? "إنهاء الوقت وإظهار التصحيح" : "Reveal Answer"}
                    </button>
                  )}

                  {(snapshot.status === "reveal" || snapshot.status === "intervention") && (
                    <button
                      type="button"
                      onClick={() => sendWsAction({ type: "radar:next" })}
                      className="min-h-[40px] px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap"
                      style={{ backgroundColor: "#0f766e", color: "#ffffff" }}
                    >
                      {snapshot.currentQuestionIndex + 1 < snapshot.totalQuestions
                        ? isAr
                          ? "السؤال التالي"
                          : "Next Question"
                        : isAr
                          ? "إنهاء وحفظ الجلسة"
                          : "Finish & Save"}
                    </button>
                  )}

                  {snapshot.status !== "finished" && (
                    <button
                      type="button"
                      onClick={() => sendWsAction({ type: "radar:finish" })}
                      className="min-h-[40px] px-3.5 py-2 rounded-xl border text-xs font-semibold text-rose-700 dark:text-rose-300 whitespace-nowrap"
                      style={{
                        backgroundColor: "var(--bg-subtle)",
                        borderColor: "var(--border-hairline)",
                      }}
                    >
                      {isAr ? "حفظ وإنهاء" : "End & Save"}
                    </button>
                  )}
                </div>
              </div>

              {wsError && (
                <div className="p-3.5 rounded-2xl border border-rose-500/40 bg-rose-500/10 text-xs text-rose-700 dark:text-rose-300">
                  {wsError}
                </div>
              )}

              {/* 4 Live Telemetry KPI Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                <div className="p-4 rounded-2xl border science-card" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}>
                  <span className="text-xs block" style={{ color: "var(--text-secondary)" }}>
                    {isAr ? "الطلاب المشاركون" : "Participants"}
                  </span>
                  <strong className="font-mono-num text-2xl font-extrabold" style={{ color: "var(--text-primary)" }}>
                    {snapshot.studentCount}
                  </strong>
                </div>

                <div className="p-4 rounded-2xl border science-card" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}>
                  <span className="text-xs block" style={{ color: "var(--text-secondary)" }}>
                    {isAr ? "أجابوا على السؤال الحالي" : "Answered Current"}
                  </span>
                  <strong className="font-mono-num text-2xl font-extrabold" style={{ color: "var(--accent-primary)" }}>
                    {snapshot.answeredCurrentCount} / {snapshot.studentCount}
                  </strong>
                  <span className="text-[11px] block" style={{ color: "var(--text-secondary)" }}>
                    {isAr ? `متبقي ${snapshot.waitingCurrentCount}` : `${snapshot.waitingCurrentCount} waiting`}
                  </span>
                </div>

                <div className="p-4 rounded-2xl border science-card" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}>
                  <span className="text-xs block" style={{ color: "var(--text-secondary)" }}>
                    {isAr ? "نسبة فهم الفصل الكلية" : "Class Mastery"}
                  </span>
                  <strong
                    className="font-mono-num text-2xl font-extrabold"
                    style={{
                      color:
                        snapshot.overallUnderstandingPct >= 75
                          ? "#0f766e"
                          : snapshot.overallUnderstandingPct >= snapshot.interventionThresholdPct
                            ? "#d97706"
                            : "#be123c",
                    }}
                  >
                    {snapshot.overallUnderstandingPct}%
                  </strong>
                </div>

                <div className="p-4 rounded-2xl border science-card" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}>
                  <span className="text-xs block" style={{ color: "var(--text-secondary)" }}>
                    {isAr ? "مفاهيم تحتاج لتدخل" : "Intervention Alerts"}
                  </span>
                  <strong
                    className="font-mono-num text-2xl font-extrabold"
                    style={{
                      color: snapshot.needsReteachingConcepts.length > 0 ? "#be123c" : "#0f766e",
                    }}
                  >
                    {snapshot.needsReteachingConcepts.length}
                  </strong>
                </div>
              </div>

              {/* Active Classroom Projector Question + Option Distribution */}
              {snapshot.currentQuestion && snapshot.status !== "finished" && (
                <div
                  className="rounded-3xl border p-6 space-y-4 science-card"
                  style={{
                    backgroundColor: "var(--bg-surface)",
                    borderColor: "var(--border-hairline)",
                  }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-bold" style={{ color: "var(--text-secondary)" }}>
                      <span className="font-mono-num" style={{ color: "var(--accent-primary)" }}>
                        {isAr
                          ? `السؤال ${snapshot.currentQuestionIndex + 1} من ${snapshot.totalQuestions}`
                          : `Question ${snapshot.currentQuestionIndex + 1} / ${snapshot.totalQuestions}`}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{snapshot.currentQuestion.concept}</span>
                      {snapshot.currentQuestion.isVerification && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-emerald-700 dark:text-emerald-300">
                            {isAr ? "سؤال التحقق بعد التدخل" : "Post-Intervention Check"}
                          </span>
                        </>
                      )}
                    </div>

                    {snapshot.status === "question" && (
                      <div className="flex items-center gap-1.5 text-sm font-mono-num font-extrabold" style={{ color: secondsLeft <= 10 ? "#be123c" : "var(--accent-primary)" }}>
                        <Clock className="w-4 h-4" />
                        <span>{secondsLeft}s</span>
                      </div>
                    )}
                  </div>

                  <h2
                    className={`font-display font-bold leading-snug ${
                      projectorMode ? "text-2xl md:text-3xl py-2" : "text-lg md:text-xl"
                    }`}
                    style={{ color: "var(--text-primary)" }}
                  >
                    {snapshot.currentQuestion.question}
                  </h2>

                  {snapshot.currentQuestion.questionType === "short_answer" ? (
                    <div className="p-4 rounded-2xl border space-y-2" style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}>
                      <div className="flex items-center justify-between text-xs font-bold">
                        <span>{isAr ? "استجابات الطلاب القصيرة:" : "Short-Answer Responses:"}</span>
                        <span className="font-mono-num">
                          {isAr ? "الصحيحة:" : "Correct:"}{" "}
                          {snapshot.currentQuestionStat?.understandingPct ?? 0}%
                        </span>
                      </div>
                      {snapshot.currentQuestionStat?.sampleWrongTextAnswers.length ? (
                        <p className="text-xs text-rose-700 dark:text-rose-300">
                          {isAr ? "نماذج إجابات غير دقيقة:" : "Inaccurate samples:"}{" "}
                          {snapshot.currentQuestionStat.sampleWrongTextAnswers.join(" | ")}
                        </p>
                      ) : (
                        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                          {isAr ? "تظهر الإجابات الواردة فور إرسال الطلاب." : "Incoming student answers appear live."}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {snapshot.currentQuestion.options.map((opt, idx) => {
                        const count = snapshot.currentQuestionStat?.optionCounts[idx] || 0;
                        const totalAns = snapshot.currentQuestionStat?.totalAnswered || 0;
                        const pct = totalAns > 0 ? Math.round((count / totalAns) * 100) : 0;
                        const isCorrect = idx === snapshot.currentQuestion?.correctIndex;
                        const revealColors = snapshot.status === "reveal" || !projectorMode;

                        return (
                          <div
                            key={idx}
                            className="p-3.5 rounded-2xl border space-y-2"
                            style={{
                              backgroundColor:
                                revealColors && isCorrect
                                  ? "rgba(15, 118, 110, 0.08)"
                                  : "var(--bg-subtle)",
                              borderColor:
                                revealColors && isCorrect
                                  ? "#0f766e"
                                  : "var(--border-hairline)",
                            }}
                          >
                            <div className="flex items-center justify-between gap-2 text-xs md:text-sm font-semibold">
                              <span style={{ color: "var(--text-primary)" }}>{opt}</span>
                              {!projectorMode && (
                                <span className="font-mono-num text-xs shrink-0" style={{ color: "var(--text-secondary)" }}>
                                  {count} ({pct}%)
                                </span>
                              )}
                            </div>
                            {!projectorMode && (
                              <div className="h-2 rounded-full overflow-hidden bg-slate-200/70 dark:bg-slate-800">
                                <div
                                  className="h-full rounded-full transition-all duration-300"
                                  style={{
                                    width: `${pct}%`,
                                    backgroundColor: isCorrect ? "#0f766e" : "#64748b",
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {snapshot.status === "reveal" && (
                    <div className="p-3.5 rounded-2xl border bg-emerald-500/10 border-emerald-600/30 text-xs leading-relaxed">
                      <strong>{isAr ? "التفسير التشخيصي:" : "Diagnostic Explanation:"}</strong>{" "}
                      {snapshot.currentQuestion.explanation}
                    </div>
                  )}
                </div>
              )}

              {/* Real-Time Analytics Split: SVG Radar Chart + AI Intervention Engine */}
              {!projectorMode && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                  {/* Left: Concept Radar Chart & Mastered vs Needs Reteaching */}
                  <div
                    className="lg:col-span-6 rounded-3xl border p-5 space-y-4 science-card"
                    style={{
                      backgroundColor: "var(--bg-surface)",
                      borderColor: "var(--border-hairline)",
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="font-display text-base font-bold" style={{ color: "var(--text-primary)" }}>
                        {isAr ? "خريطة رادار إتقان المفاهيم" : "Concept Mastery Radar"}
                      </h3>
                      {selectedStudentProfile && (
                        <button
                          type="button"
                          onClick={() => setSelectedStudentId(null)}
                          className="text-xs underline"
                          style={{ color: "var(--accent-primary)" }}
                        >
                          {isAr ? "إلغاء مقارنة الطالب" : "Clear Student Overlay"}
                        </button>
                      )}
                    </div>

                    <ConceptRadarChart
                      concepts={snapshot.conceptStats}
                      selectedStudentConcepts={selectedStudentRadarData}
                      selectedStudentName={
                        selectedStudentProfile
                          ? privacyHideNames
                            ? isAr
                              ? "الطالب المحدد"
                              : "Selected Student"
                            : selectedStudentProfile.name
                          : undefined
                      }
                      thresholdPct={snapshot.interventionThresholdPct}
                      isAr={isAr}
                    />

                    {/* Concepts Table + Direct Intervention Buttons */}
                    <div className="space-y-2 pt-2 border-t" style={{ borderColor: "var(--border-hairline)" }}>
                      {snapshot.conceptStats.map((c) => {
                        const needsHelp =
                          c.totalAnswers > 0 && c.understandingPct < snapshot.interventionThresholdPct;
                        return (
                          <div
                            key={c.concept}
                            className="p-3 rounded-2xl border flex flex-wrap items-center justify-between gap-2 text-xs"
                            style={{
                              backgroundColor: needsHelp
                                ? "rgba(190, 18, 60, 0.06)"
                                : "var(--bg-subtle)",
                              borderColor: needsHelp ? "#be123c" : "var(--border-hairline)",
                            }}
                          >
                            <div className="space-y-0.5">
                              <span className="font-bold block" style={{ color: "var(--text-primary)" }}>
                                {c.concept}
                              </span>
                              <span className="font-mono-num text-[11px]" style={{ color: "var(--text-secondary)" }}>
                                {c.understandingPct}% ({c.correctAnswers}/{c.totalAnswers}) ·{" "}
                                {c.status === "mastered"
                                  ? isAr
                                    ? "متقن"
                                    : "Mastered"
                                  : c.status === "developing"
                                    ? isAr
                                      ? "متوسط"
                                      : "Developing"
                                    : isAr
                                      ? "يحتاج إعادة شرح"
                                      : "Needs Reteaching"}
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={() => void handleRequestIntervention(c.concept)}
                              className="min-h-[34px] px-3 py-1 rounded-xl text-[11px] font-bold flex items-center gap-1 whitespace-nowrap"
                              style={{
                                backgroundColor: needsHelp ? "#be123c" : "var(--accent-primary)",
                                color: "#ffffff",
                              }}
                            >
                              <Sparkles className="w-3.5 h-3.5" />
                              <span>{isAr ? "تفعيل التدخل الذكي" : "AI Intervene"}</span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Right: AI Instructional Intervention + Impact Measurement + Misconceptions */}
                  <div className="lg:col-span-6 space-y-5">
                    {/* Intervention Draft or Alert Prompt */}
                    <div
                      className="rounded-3xl border p-5 space-y-4 science-card"
                      style={{
                        backgroundColor: "var(--bg-surface)",
                        borderColor:
                          snapshot.needsReteachingConcepts.length > 0 || interventionDraft
                            ? "#d97706"
                            : "var(--border-hairline)",
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="font-display text-base font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
                          <AlertTriangle className="w-5 h-5 text-amber-600" />
                          <span>{isAr ? "محرك التدخل التعليمي الذكي" : "AI Instructional Intervention"}</span>
                        </h3>
                      </div>

                      {isGeneratingIntervention && (
                        <div className="p-6 text-center space-y-2">
                          <Loader2 className="w-6 h-6 animate-spin mx-auto" style={{ color: "var(--accent-primary)" }} />
                          <p className="text-xs font-semibold">
                            {isAr
                              ? `جارٍ تحليل أخطاء الفصل في «${interventionConcept}» وإعداد استراتيجيات التدخل وسؤال التحقق...`
                              : `Analyzing class errors for "${interventionConcept}" and preparing intervention strategies...`}
                          </p>
                        </div>
                      )}

                      {!isGeneratingIntervention && interventionDraft && (
                        <div className="space-y-3.5">
                          <div className="p-3.5 rounded-2xl border bg-amber-500/10 border-amber-600/30 text-xs space-y-1">
                            <span className="font-bold block">
                              {isAr ? `تشخيص السبب الجذري (${interventionDraft.concept}):` : "Root Diagnosis:"}
                            </span>
                            <p>{interventionDraft.diagnosisSummary}</p>
                          </div>

                          <div className="space-y-2">
                            <span className="text-xs font-bold block" style={{ color: "var(--text-secondary)" }}>
                              {isAr ? "اختر التدخل المناسب لإرساله للطلاب:" : "Select strategy to broadcast live:"}
                            </span>
                            {interventionDraft.strategies.map((st, sIdx) => (
                              <button
                                key={st.id || sIdx}
                                type="button"
                                onClick={() => setSelectedStrategyIdx(sIdx)}
                                className="w-full text-start p-3 rounded-2xl border space-y-1 transition-all"
                                style={{
                                  backgroundColor:
                                    selectedStrategyIdx === sIdx
                                      ? "rgba(47, 107, 91, 0.1)"
                                      : "var(--bg-subtle)",
                                  borderColor:
                                    selectedStrategyIdx === sIdx
                                      ? "var(--accent-primary)"
                                      : "var(--border-hairline)",
                                }}
                              >
                                <div className="flex items-center justify-between text-xs font-bold">
                                  <span>{st.title}</span>
                                  <span className="font-mono-num text-[11px]" style={{ color: "var(--accent-primary)" }}>
                                    {st.estimatedMinutes} min
                                  </span>
                                </div>
                                <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                                  {st.studentFacingExplanation}
                                </p>
                                {st.practicalExample && (
                                  <p className="text-[11px]" style={{ color: "var(--text-primary)" }}>
                                    <strong>{isAr ? "مثال:" : "Example:"}</strong> {st.practicalExample}
                                  </p>
                                )}
                              </button>
                            ))}
                          </div>

                          <div className="p-3 rounded-2xl border text-xs space-y-1" style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}>
                            <span className="font-bold block" style={{ color: "var(--accent-primary)" }}>
                              {isAr ? "سؤال التحقق الجاهز (من زاوية جديدة):" : "Ready Verification Question (New Angle):"}
                            </span>
                            <p className="font-semibold">{interventionDraft.verificationQuestion?.question}</p>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={handleBroadcastIntervention}
                              className="flex-1 min-h-[42px] px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5"
                              style={{
                                backgroundColor: "var(--accent-primary)",
                                color: "var(--accent-contrast)",
                              }}
                            >
                              <Send className="w-4 h-4" />
                              <span>{isAr ? "تنفيذ التدخل وإرساله للطلاب الآن" : "Broadcast Intervention Live"}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setInterventionDraft(null)}
                              className="min-h-[42px] px-3 py-2 rounded-xl border text-xs font-semibold"
                              style={{ borderColor: "var(--border-hairline)" }}
                            >
                              {isAr ? "إلغاء" : "Cancel"}
                            </button>
                          </div>
                        </div>
                      )}

                      {!isGeneratingIntervention && !interventionDraft && (
                        <div className="space-y-3">
                          {snapshot.needsReteachingConcepts.length > 0 ? (
                            <div className="p-3.5 rounded-2xl border border-rose-500/40 bg-rose-500/10 text-xs space-y-2">
                              <p className="font-bold text-rose-700 dark:text-rose-300">
                                {isAr
                                  ? `تنبيه رادار الفهم: انخفض الفهم دون ${snapshot.interventionThresholdPct}% في:`
                                  : `Radar Alert: Concepts below ${snapshot.interventionThresholdPct}%:`}{" "}
                                {snapshot.needsReteachingConcepts.join("، ")}
                              </p>
                              <button
                                type="button"
                                onClick={() =>
                                  void handleRequestIntervention(snapshot.needsReteachingConcepts[0])
                                }
                                className="min-h-[36px] px-3.5 py-1.5 rounded-xl bg-rose-700 text-white text-xs font-bold flex items-center gap-1.5"
                              >
                                <Sparkles className="w-3.5 h-3.5" />
                                <span>
                                  {isAr
                                    ? `اقتراح تدخل علاجي لـ «${snapshot.needsReteachingConcepts[0]}»`
                                    : `Suggest Intervention for "${snapshot.needsReteachingConcepts[0]}"`}
                                </span>
                              </button>
                            </div>
                          ) : (
                            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                              {isAr
                                ? "يمكنك الضغط على «تفعيل التدخل الذكي» بجانب أي مفهوم لإعداد شرح بديل وإطلاق سؤال تحقق قبل/بعد."
                                : "Click AI Intervene next to any concept to prepare alternative explanations & verification checks."}
                            </p>
                          )}

                          {/* Launched Intervention History & Verification Trigger + Impact Report */}
                          {snapshot.interventionHistory.map((rec) => (
                            <div key={rec.id} className="space-y-2.5 pt-2 border-t" style={{ borderColor: "var(--border-hairline)" }}>
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>
                                  {rec.selectedStrategy?.title} ({rec.concept})
                                </span>
                                {!rec.verificationLaunched && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      sendWsAction({
                                        type: "radar:start_verification",
                                        interventionId: rec.id,
                                      })
                                    }
                                    className="min-h-[34px] px-3 py-1 rounded-xl text-[11px] font-bold flex items-center gap-1"
                                    style={{ backgroundColor: "#0f766e", color: "#ffffff" }}
                                  >
                                    <TrendingUp className="w-3.5 h-3.5" />
                                    <span>{isAr ? "إطلاق سؤال التحقق لقياس الأثر" : "Launch Verification Check"}</span>
                                  </button>
                                )}
                              </div>

                              {rec.impact && <BeforeAfterImpactCard impact={rec.impact} isAr={isAr} />}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Top Misconceptions + Export Buttons */}
                    <div
                      className="rounded-3xl border p-5 space-y-3 science-card"
                      style={{
                        backgroundColor: "var(--bg-surface)",
                        borderColor: "var(--border-hairline)",
                      }}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="font-display text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                          {isAr ? "أكثر التصورات الخاطئة شيوعاً" : "Top Detected Misconceptions"}
                        </h3>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => exportRadarExcel(snapshot, isAr)}
                            className="px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold flex items-center gap-1"
                            style={{
                              backgroundColor: "var(--bg-subtle)",
                              borderColor: "var(--border-hairline)",
                            }}
                          >
                            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
                            <span>Excel</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void exportRadarWordReport(snapshot, isAr)}
                            className="px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold flex items-center gap-1"
                            style={{
                              backgroundColor: "var(--bg-subtle)",
                              borderColor: "var(--border-hairline)",
                            }}
                          >
                            <FileText className="w-3.5 h-3.5" style={{ color: "var(--accent-primary)" }} />
                            <span>Word</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setPrintPreviewSnapshot(snapshot)}
                            className="px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold flex items-center gap-1"
                            style={{
                              backgroundColor: "var(--bg-subtle)",
                              borderColor: "var(--border-hairline)",
                            }}
                          >
                            <Printer className="w-3.5 h-3.5" />
                            <span>PDF</span>
                          </button>
                        </div>
                      </div>

                      {snapshot.topMisconceptions.length === 0 ? (
                        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                          {isAr
                            ? "لم تُسجل أخطاء متكررة أو تصورات خاطئة حتى الآن."
                            : "No repeated misconceptions recorded yet."}
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {snapshot.topMisconceptions.map((m, i) => (
                            <div
                              key={i}
                              className="p-2.5 rounded-xl border text-xs flex items-center justify-between gap-2"
                              style={{
                                backgroundColor: "var(--bg-subtle)",
                                borderColor: "var(--border-hairline)",
                              }}
                            >
                              <div>
                                <span className="font-bold block">{m.label}</span>
                                <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                                  {m.concept}
                                </span>
                              </div>
                              <span className="font-mono-num font-bold text-rose-700 dark:text-rose-300 shrink-0">
                                {m.count} ({m.pct}%)
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Individual Student Understanding Inspector */}
              {!projectorMode && snapshot.studentProfiles.length > 0 && (
                <div
                  className="rounded-3xl border p-5 space-y-3 science-card"
                  style={{
                    backgroundColor: "var(--bg-surface)",
                    borderColor: "var(--border-hairline)",
                  }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-display text-base font-bold" style={{ color: "var(--text-primary)" }}>
                      {isAr
                        ? "مستوى فهم كل طالب (اضغط لمقارنة الطالب على الرادار)"
                        : "Individual Student Mastery (Click to overlay on Radar)"}
                    </h3>
                    <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                      {privacyHideNames
                        ? isAr
                          ? "وضع إخفاء الأسماء مفعّل"
                          : "Privacy mode active"
                        : isAr
                          ? "إظهار الأسماء الكاملة للمعلم"
                          : "Teacher full view"}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {snapshot.studentProfiles.map((stu, idx) => {
                      const displayName = privacyHideNames
                        ? isAr
                          ? `طالب #${idx + 1}`
                          : `Student #${idx + 1}`
                        : stu.name;
                      const isSelected = selectedStudentId === stu.id;

                      return (
                        <button
                          key={stu.id}
                          type="button"
                          onClick={() => setSelectedStudentId(isSelected ? null : stu.id)}
                          className="text-start p-3.5 rounded-2xl border space-y-1.5 transition-all"
                          style={{
                            backgroundColor: isSelected
                              ? "rgba(217, 119, 6, 0.08)"
                              : "var(--bg-subtle)",
                            borderColor: isSelected ? "#d97706" : "var(--border-hairline)",
                          }}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>
                              {displayName}
                            </span>
                            <span
                              className="font-mono-num text-xs font-extrabold"
                              style={{
                                color:
                                  stu.understandingPct >= 75
                                    ? "#0f766e"
                                    : stu.understandingPct >= snapshot.interventionThresholdPct
                                      ? "#d97706"
                                      : "#be123c",
                              }}
                            >
                              {stu.understandingPct}% ({stu.correctCount}/{stu.answeredCount})
                            </span>
                          </div>
                          {stu.needsSupportConcepts.length > 0 && (
                            <p className="text-[11px] text-rose-700 dark:text-rose-300 line-clamp-1">
                              {isAr ? "يحتاج دعم:" : "Needs support:"} {stu.needsSupportConcepts.join("، ")}
                            </p>
                          )}
                          {stu.overcameConcepts.length > 0 && (
                            <p className="text-[11px] text-emerald-700 dark:text-emerald-300 line-clamp-1">
                              {isAr ? "تحسن بعد التدخل:" : "Improved:"} {stu.overcameConcepts.join("، ")}
                            </p>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ===================================================== */}
      {/* MODE 3: STUDENT JOIN & LIVE PARTICIPATION VIEW        */}
      {/* ===================================================== */}
      {mode === "student" && (
        <div className="max-w-2xl mx-auto space-y-4">
          {!joinedStudentId || !snapshot ? (
            <form
              onSubmit={handleStudentJoin}
              className="rounded-3xl border p-6 md:p-7 space-y-4 science-card"
              style={{
                backgroundColor: "var(--bg-surface)",
                borderColor: "var(--border-hairline)",
              }}
            >
              <div className="space-y-1">
                <h2 className="font-display text-lg font-bold" style={{ color: "var(--text-primary)" }}>
                  {isAr ? "الدخول المباشر إلى جلسة رادار الفهم" : "Join Live Understanding Radar"}
                </h2>
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {isAr
                    ? "أدخل رمز الجلسة الذي شاركه المعلم واسمك فقط — لا يتطلب إنشاء حساب."
                    : "Enter the room code shared by your teacher and your name — no account needed."}
                </p>
              </div>

              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="block text-xs font-bold" style={{ color: "var(--text-secondary)" }}>
                    {isAr ? "رمز الجلسة (Room Code)" : "Session Code"}
                  </label>
                  <input
                    type="text"
                    value={joinCodeInput}
                    onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                    placeholder="EX: A7K9P2"
                    className="w-full min-h-[46px] px-4 rounded-xl border text-base font-mono-num font-bold tracking-widest text-center uppercase"
                    style={{
                      backgroundColor: "var(--bg-subtle)",
                      borderColor: "var(--border-hairline)",
                      color: "var(--text-primary)",
                    }}
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-bold" style={{ color: "var(--text-secondary)" }}>
                    {isAr ? "اسم الطالب" : "Your Name"}
                  </label>
                  <input
                    type="text"
                    value={studentNameInput}
                    onChange={(e) => setStudentNameInput(e.target.value)}
                    placeholder={isAr ? "اكتب اسمك الثلاثي أو اللقب..." : "Enter your name..."}
                    className="w-full min-h-[46px] px-4 rounded-xl border text-sm font-semibold"
                    style={{
                      backgroundColor: "var(--bg-subtle)",
                      borderColor: "var(--border-hairline)",
                      color: "var(--text-primary)",
                    }}
                  />
                </div>
              </div>

              {wsError && (
                <div className="p-3 rounded-xl border border-rose-500/40 bg-rose-500/10 text-xs text-rose-700 dark:text-rose-300">
                  {wsError}
                </div>
              )}

              <button
                type="submit"
                className="w-full min-h-[48px] px-5 py-3 rounded-2xl text-sm font-bold flex items-center justify-center gap-2"
                style={{
                  backgroundColor: "var(--accent-primary)",
                  color: "var(--accent-contrast)",
                }}
              >
                <UserCheck className="w-4 h-4" />
                <span>{isAr ? "دخول الجلسة الآن" : "Join Session"}</span>
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              {/* Live Teacher Intervention Banner for Students */}
              {snapshot.activeInterventionBanner && (
                <div
                  className="rounded-3xl border p-5 space-y-2.5 science-card"
                  style={{
                    backgroundColor: "rgba(164, 203, 191, 0.2)",
                    borderColor: "var(--accent-primary)",
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold flex items-center gap-1.5" style={{ color: "var(--accent-primary)" }}>
                      <Sparkles className="w-4 h-4" />
                      <span>
                        {isAr
                          ? `توضيح مباشر من المعلم: ${snapshot.activeInterventionBanner.title}`
                          : snapshot.activeInterventionBanner.title}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        void speakTutorText(
                          `${snapshot.activeInterventionBanner?.explanation}. ${
                            snapshot.activeInterventionBanner?.example || ""
                          }`
                        )
                      }
                      className="px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1"
                      style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                      <span>{isAr ? "استماع" : "Listen"}</span>
                    </button>
                  </div>
                  <p className="text-xs md:text-sm leading-relaxed font-semibold" style={{ color: "var(--text-primary)" }}>
                    {snapshot.activeInterventionBanner.explanation}
                  </p>
                  {snapshot.activeInterventionBanner.example && (
                    <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                      <strong>{isAr ? "مثال توضيحي:" : "Example:"}</strong>{" "}
                      {snapshot.activeInterventionBanner.example}
                    </p>
                  )}
                </div>
              )}

              {/* Student Stage */}
              <div
                className="rounded-3xl border p-6 space-y-4 science-card"
                style={{
                  backgroundColor: "var(--bg-surface)",
                  borderColor: "var(--border-hairline)",
                }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
                  <span>
                    {studentNameInput} · {snapshot.lessonTopic}
                  </span>
                  {snapshot.status === "question" && (
                    <span className="font-mono-num font-bold text-sm" style={{ color: secondsLeft <= 10 ? "#be123c" : "var(--accent-primary)" }}>
                      {secondsLeft}s
                    </span>
                  )}
                </div>

                {snapshot.status === "lobby" && (
                  <div className="py-8 text-center space-y-2">
                    <Radar className="w-9 h-9 mx-auto animate-pulse" style={{ color: "var(--accent-primary)" }} />
                    <h3 className="font-display text-base font-bold">
                      {isAr ? "أنت داخل الجلسة! بانتظار بدء المعلم..." : "Joined! Waiting for teacher to start..."}
                    </h3>
                  </div>
                )}

                {(snapshot.status === "question" || snapshot.status === "reveal") && snapshot.currentQuestion && (
                  <div className="space-y-4">
                    <div className="text-xs font-bold" style={{ color: "var(--accent-primary)" }}>
                      {snapshot.currentQuestion.concept} ·{" "}
                      {isAr
                        ? `السؤال ${snapshot.currentQuestionIndex + 1} من ${snapshot.totalQuestions}`
                        : `Q${snapshot.currentQuestionIndex + 1}/${snapshot.totalQuestions}`}
                    </div>

                    <h3 className="font-display text-lg font-bold leading-relaxed" style={{ color: "var(--text-primary)" }}>
                      {snapshot.currentQuestion.question}
                    </h3>

                    {snapshot.currentQuestion.questionType === "short_answer" ? (
                      <div className="space-y-2.5">
                        <textarea
                          rows={3}
                          disabled={snapshot.status !== "question" || Boolean(studentFeedback)}
                          value={studentShortAnswer}
                          onChange={(e) => setStudentShortAnswer(e.target.value)}
                          placeholder={isAr ? "اكتب إجابتك القصيرة هنا..." : "Type your short answer..."}
                          className="w-full p-3 rounded-xl border text-sm"
                          style={{
                            backgroundColor: "var(--bg-subtle)",
                            borderColor: "var(--border-hairline)",
                            color: "var(--text-primary)",
                          }}
                        />
                        {snapshot.status === "question" && !studentFeedback && (
                          <button
                            type="button"
                            disabled={!studentShortAnswer.trim()}
                            onClick={() => handleSubmitStudentAnswer()}
                            className="min-h-[42px] px-5 py-2 rounded-xl text-xs font-bold disabled:opacity-50"
                            style={{
                              backgroundColor: "var(--accent-primary)",
                              color: "var(--accent-contrast)",
                            }}
                          >
                            {isAr ? "إرسال الإجابة" : "Submit Answer"}
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-2.5">
                        {snapshot.currentQuestion.options.map((opt, idx) => {
                          const isChosen = studentSelectedOption === idx;
                          const showCorrect =
                            snapshot.status === "reveal" && idx === snapshot.currentQuestion?.correctIndex;
                          return (
                            <button
                              key={idx}
                              type="button"
                              disabled={snapshot.status !== "question" || Boolean(studentFeedback)}
                              onClick={() => handleSubmitStudentAnswer(idx)}
                              className="w-full text-start p-3.5 rounded-2xl border text-sm font-semibold transition-all flex items-center justify-between gap-2"
                              style={{
                                backgroundColor: showCorrect
                                  ? "rgba(15, 118, 110, 0.14)"
                                  : isChosen
                                    ? "rgba(47, 107, 91, 0.14)"
                                    : "var(--bg-subtle)",
                                borderColor: showCorrect
                                  ? "#0f766e"
                                  : isChosen
                                    ? "var(--accent-primary)"
                                    : "var(--border-hairline)",
                                color: "var(--text-primary)",
                              }}
                            >
                              <span>{opt}</span>
                              {isChosen && <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: "var(--accent-primary)" }} />}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {studentFeedback && (
                      <div
                        className={`p-4 rounded-2xl border text-xs space-y-1.5 ${
                          studentFeedback.isCorrect
                            ? "bg-emerald-500/10 border-emerald-600/40"
                            : "bg-amber-500/10 border-amber-600/40"
                        }`}
                      >
                        <strong className="block text-sm">
                          {studentFeedback.isCorrect
                            ? isAr
                              ? "أحسنت! فهمك لهذا المفهوم دقيق"
                              : "Well done! Accurate understanding"
                            : isAr
                              ? "محاولة جيدة — لنراجع الفكرة معاً"
                              : "Good try — let's review this concept"}
                        </strong>
                        {snapshot.status === "reveal" && <p>{studentFeedback.explanation}</p>}
                        {!studentFeedback.isCorrect && (
                          <button
                            type="button"
                            onClick={() => {
                              setTutorOpen(true);
                              void handleAskTutor(
                                isAr
                                  ? `لم أستوعب سؤال "${snapshot.currentQuestion?.concept}" بالكامل، بسّط لي الفكرة بمثال يومي.`
                                  : `Explain "${snapshot.currentQuestion?.concept}" with a simple example.`,
                                "simplify"
                              );
                            }}
                            className="mt-1 px-3 py-1.5 rounded-xl text-[11px] font-bold inline-flex items-center gap-1"
                            style={{
                              backgroundColor: "var(--accent-primary)",
                              color: "var(--accent-contrast)",
                            }}
                          >
                            <Bot className="w-3.5 h-3.5" />
                            <span>{isAr ? "اسأل المساعد المتحدث عن المفهوم" : "Ask Talking AI Tutor"}</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {snapshot.status === "intervention" && (
                  <div className="py-6 text-center space-y-2">
                    <Sparkles className="w-8 h-8 mx-auto" style={{ color: "var(--accent-primary)" }} />
                    <h3 className="font-display text-base font-bold">
                      {isAr
                        ? "يشرح المعلم الآن مفهوماً مهماً — تابع الشرح أعلاه ثم استعد لسؤال التحقق"
                        : "Teacher explanation active — read above and prepare for verification"}
                    </h3>
                  </div>
                )}

                {snapshot.status === "finished" && (
                  <div className="py-6 text-center space-y-2">
                    <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-700" />
                    <h3 className="font-display text-lg font-bold">
                      {isAr ? "انتهت جلسة رادار الفهم بنجاح!" : "Radar Session Complete!"}
                    </h3>
                    <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                      {isAr
                        ? "شكراً لمشاركتك! تم إرسال نتائج الفهم إلى لوحة المعلم."
                        : "Thank you for participating! Results saved to the teacher dashboard."}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===================================================== */}
      {/* MODE 4: SESSION HISTORY, COMPARISON & EXPORTS         */}
      {/* ===================================================== */}
      {mode === "history" && (
        <div className="space-y-5">
          {/* Cross-Lesson Performance Comparison Bar Strip */}
          {savedSessions.length > 0 && (
            <div
              className="rounded-3xl border p-5 space-y-3 science-card"
              style={{
                backgroundColor: "var(--bg-surface)",
                borderColor: "var(--border-hairline)",
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-base font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
                  <BarChart3 className="w-5 h-5" style={{ color: "var(--accent-primary)" }} />
                  <span>{isAr ? "مقارنة الفهم عبر الدروس والجلسات" : "Cross-Lesson Mastery Comparison"}</span>
                </h2>
                <button
                  type="button"
                  onClick={fetchHistory}
                  className="px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1"
                  style={{ borderColor: "var(--border-hairline)" }}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>{isAr ? "تحديث" : "Refresh"}</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {savedSessions.slice(0, 6).map((s) => (
                  <div
                    key={s.id}
                    className="p-3.5 rounded-2xl border space-y-2"
                    style={{
                      backgroundColor: "var(--bg-subtle)",
                      borderColor: "var(--border-hairline)",
                    }}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-bold line-clamp-1" style={{ color: "var(--text-primary)" }}>
                        {s.lessonTopic}
                      </span>
                      <span className="font-mono-num font-bold" style={{ color: "var(--accent-primary)" }}>
                        {s.overallAccuracy}%
                      </span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden bg-slate-200/70 dark:bg-slate-800">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${s.overallAccuracy}%`,
                          backgroundColor:
                            s.overallAccuracy >= 75
                              ? "#0f766e"
                              : s.overallAccuracy >= 60
                                ? "#d97706"
                                : "#be123c",
                        }}
                      />
                    </div>
                    <div className="text-[11px] flex items-center justify-between" style={{ color: "var(--text-secondary)" }}>
                      <span>{s.subjectName} · {s.gradeLevel}</span>
                      <span className="font-mono-num">
                        {s.studentCount} {isAr ? "طالب" : "students"} · {s.interventionCount}{" "}
                        {isAr ? "تدخل" : "int."}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Saved Sessions Archive List */}
          <div
            className="rounded-3xl border p-5 space-y-3 science-card"
            style={{
              backgroundColor: "var(--bg-surface)",
              borderColor: "var(--border-hairline)",
            }}
          >
            <h2 className="font-display text-base font-bold" style={{ color: "var(--text-primary)" }}>
              {isAr ? "أرشيف جلسات رادار الفهم" : "Saved Radar Sessions Archive"}
            </h2>

            {isLoadingHistory ? (
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                {isAr ? "جارٍ تحميل السجل..." : "Loading history..."}
              </p>
            ) : savedSessions.length === 0 ? (
              <p className="text-xs py-6 text-center" style={{ color: "var(--text-secondary)" }}>
                {isAr
                  ? "لا توجد جلسات محفوظة بعد. ستظهر التقارير هنا تلقائياً عند إنهاء وحفظ أي جلسة رادار."
                  : "No saved sessions yet. Completed Radar sessions appear here automatically."}
              </p>
            ) : (
              <div className="space-y-2.5">
                {savedSessions.map((rep) => (
                  <div
                    key={rep.id}
                    className="p-3.5 rounded-2xl border flex flex-wrap items-center justify-between gap-3"
                    style={{
                      backgroundColor: "var(--bg-subtle)",
                      borderColor: "var(--border-hairline)",
                    }}
                  >
                    <div className="space-y-0.5">
                      <div className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                        {rep.lessonTopic}
                      </div>
                      <div className="text-xs font-mono-num" style={{ color: "var(--text-secondary)" }}>
                        {rep.subjectName} · {rep.gradeLevel} · {rep.roomCode} ·{" "}
                        {isAr ? `الفهم: ${rep.overallAccuracy}%` : `Mastery: ${rep.overallAccuracy}%`} ·{" "}
                        {new Date(rep.updatedAt).toLocaleDateString(isAr ? "ar-EG" : "en-US")}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setViewingReport(rep.snapshot)}
                        className="px-3 py-1.5 rounded-xl text-xs font-bold"
                        style={{
                          backgroundColor: "var(--accent-primary)",
                          color: "var(--accent-contrast)",
                        }}
                      >
                        {isAr ? "عرض التقرير" : "Open Report"}
                      </button>
                      <button
                        type="button"
                        onClick={() => exportRadarExcel(rep.snapshot, isAr)}
                        className="px-2.5 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1"
                        style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Excel</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void exportRadarWordReport(rep.snapshot, isAr)}
                        className="px-2.5 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1"
                        style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>Word</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setPrintPreviewSnapshot(rep.snapshot)}
                        className="px-2.5 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1"
                        style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>PDF</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {activeDataSnapshot && viewingReport && (
            <div
              className="rounded-3xl border p-5 space-y-4 science-card"
              style={{
                backgroundColor: "var(--bg-surface)",
                borderColor: "var(--accent-primary)",
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-base font-bold">
                  {isAr ? `معاينة التقرير التفصيلي — ${viewingReport.lessonTopic}` : viewingReport.lessonTopic}
                </h3>
                <button
                  type="button"
                  onClick={() => setViewingReport(null)}
                  className="p-1.5 rounded-lg border"
                  style={{ borderColor: "var(--border-hairline)" }}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-center">
                <ConceptRadarChart
                  concepts={viewingReport.conceptStats}
                  thresholdPct={viewingReport.interventionThresholdPct}
                  isAr={isAr}
                />
                <div className="space-y-3">
                  {viewingReport.interventionHistory.length > 0 ? (
                    viewingReport.interventionHistory.map((rec) =>
                      rec.impact ? (
                        <BeforeAfterImpactCard key={rec.id} impact={rec.impact} isAr={isAr} />
                      ) : null
                    )
                  ) : (
                    <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                      {isAr
                        ? "لم تُنفذ تدخلات علاجية في هذه الجلسة."
                        : "No interventions were triggered during this session."}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===================================================== */}
      {/* FLOATING TALKING AI TUTOR DRAWER INSIDE RADAR         */}
      {/* ===================================================== */}
      {tutorOpen && (
        <aside
          aria-label={isAr ? "المساعد التعليمي المتحدث" : "Talking AI Tutor"}
          className="fixed bottom-4 left-4 right-4 md:left-6 md:right-auto md:w-[410px] z-40 rounded-3xl border shadow-2xl overflow-hidden flex flex-col max-h-[75vh]"
          style={{
            backgroundColor: "var(--bg-surface)",
            borderColor: "var(--accent-primary)",
          }}
        >
          <div
            className="px-4 py-3 border-b flex items-center justify-between gap-2"
            style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}
          >
            <div className="flex items-center gap-2">
              <Bot className="w-5 h-5" style={{ color: "var(--accent-primary)" }} />
              <div>
                <div className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>
                  {isAr ? "المساعد الذكي المتحدث — رادار الفهم" : "Talking AI Tutor"}
                </div>
                <div className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                  {snapshot?.lessonTopic || lessonTopic || resolvedSubjectName}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {isTutorSpeaking && (
                <button
                  type="button"
                  onClick={() => {
                    stopAllSpeech();
                    setIsTutorSpeaking(false);
                  }}
                  className="px-2 py-1 rounded-lg bg-rose-600 text-white text-[11px] font-bold flex items-center gap-1"
                >
                  <Square className="w-3 h-3 fill-current" />
                  <span>{isAr ? "إيقاف الصوت" : "Stop"}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setTutorOpen(false)}
                className="p-1.5 rounded-lg border"
                style={{ borderColor: "var(--border-hairline)" }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="p-3.5 space-y-2.5 overflow-y-auto flex-1">
            {tutorMessages.length === 0 ? (
              <div className="text-xs space-y-2 py-2" style={{ color: "var(--text-secondary)" }}>
                <p>
                  {isAr
                    ? "مرحباً! أنا مساعدك الذكي المتحدث داخل رادار الفهم. يمكنني تبسيط المفاهيم، إعطاء تلميحات دون كشف الإجابة، أو توضيح أسباب الأخطاء."
                    : "Hi! Ask me to simplify any concept, give a hint without spoiling the answer, or clarify misconceptions."}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      void handleAskTutor(
                        isAr ? "اشرح لي المفهوم الأساسي للدرس بطريقة مبسطة." : "Simplify the core lesson concept.",
                        "simplify"
                      )
                    }
                    className="px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold"
                    style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}
                  >
                    {isAr ? "بسّط المفهوم" : "Simplify Concept"}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void handleAskTutor(
                        isAr ? "أعطني تلميحاً يساعدني على التفكير دون كشف الإجابة." : "Give me a hint without spoiling the answer.",
                        "hint"
                      )
                    }
                    className="px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold"
                    style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}
                  >
                    {isAr ? "تلميح تدريجي" : "Progressive Hint"}
                  </button>
                </div>
              </div>
            ) : (
              tutorMessages.map((m) => (
                <div
                  key={m.id}
                  className={`p-3 rounded-2xl text-xs space-y-1.5 ${
                    m.sender === "user" ? "ms-6 border" : "me-4 border"
                  }`}
                  style={{
                    backgroundColor:
                      m.sender === "user" ? "var(--bg-subtle)" : "rgba(164, 203, 191, 0.16)",
                    borderColor: "var(--border-hairline)",
                  }}
                >
                  <p className="leading-relaxed" style={{ color: "var(--text-primary)" }}>
                    {m.text}
                  </p>
                  {m.analogy && (
                    <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                      <strong>{isAr ? "تشبيه مقرب:" : "Analogy:"}</strong> {m.analogy}
                    </p>
                  )}
                  {m.sender === "assistant" && (
                    <button
                      type="button"
                      onClick={() => void speakTutorText(m.text)}
                      className="text-[11px] font-bold flex items-center gap-1"
                      style={{ color: "var(--accent-primary)" }}
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                      <span>{isAr ? "استماع صوتي" : "Read Aloud"}</span>
                    </button>
                  )}
                </div>
              ))
            )}
            {isTutorThinking && (
              <div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>{isAr ? "يفكر المساعد الذكي..." : "Thinking..."}</span>
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleAskTutor(tutorInput, "ask");
            }}
            className="p-3 border-t flex items-center gap-1.5"
            style={{ borderColor: "var(--border-hairline)" }}
          >
            <button
              type="button"
              onClick={handleTutorVoiceInput}
              aria-label={isAr ? "سؤال بالصوت" : "Voice question"}
              className="min-h-[38px] min-w-[38px] rounded-xl border flex items-center justify-center shrink-0"
              style={{
                backgroundColor: isListeningTutorMic ? "#e11d48" : "var(--bg-subtle)",
                borderColor: "var(--border-hairline)",
                color: isListeningTutorMic ? "#ffffff" : "var(--text-primary)",
              }}
            >
              {isListeningTutorMic ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
            <input
              type="text"
              value={tutorInput}
              onChange={(e) => setTutorInput(e.target.value)}
              placeholder={isAr ? "اسأل المساعد المتحدث عن الدرس..." : "Ask the talking tutor..."}
              className="flex-1 min-h-[38px] px-3 rounded-xl border text-xs"
              style={{
                backgroundColor: "var(--bg-subtle)",
                borderColor: "var(--border-hairline)",
                color: "var(--text-primary)",
              }}
            />
            <button
              type="submit"
              disabled={!tutorInput.trim() || isTutorThinking}
              className="min-h-[38px] px-3 rounded-xl text-xs font-bold flex items-center gap-1 disabled:opacity-50"
              style={{
                backgroundColor: "var(--accent-primary)",
                color: "var(--accent-contrast)",
              }}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>{isAr ? "إرسال" : "Ask"}</span>
            </button>
          </form>
        </aside>
      )}

      {/* ===================================================== */}
      {/* IN-APP PRINT / PDF REPORT OVERLAY (NO window.open)    */}
      {/* ===================================================== */}
      {printPreviewSnapshot && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-3xl max-h-[88vh] overflow-y-auto rounded-3xl border p-6 space-y-4 bg-white text-slate-900"
            style={{ borderColor: "#cbd5e1" }}
          >
            <div className="flex items-center justify-between gap-2 print:hidden border-b pb-3">
              <h3 className="font-display text-base font-bold">
                {isAr ? "معاينة طباعة / حفظ PDF للتقرير" : "Print / Save PDF Report"}
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-4 py-2 rounded-xl bg-[#2f6b5b] text-white text-xs font-bold flex items-center gap-1.5"
                >
                  <Printer className="w-4 h-4" />
                  <span>{isAr ? "طباعة / حفظ كـ PDF" : "Print / Save PDF"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPrintPreviewSnapshot(null)}
                  className="px-3 py-2 rounded-xl border text-xs font-semibold"
                >
                  {isAr ? "إغلاق" : "Close"}
                </button>
              </div>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <h2 className="text-xl font-bold">{printPreviewSnapshot.lessonTopic}</h2>
                <p className="text-slate-600">
                  {printPreviewSnapshot.subjectName} · {printPreviewSnapshot.gradeLevel} ·{" "}
                  {isAr ? "رمز الغرفة:" : "Room:"} {printPreviewSnapshot.roomCode} ·{" "}
                  {isAr ? "الفهم العام:" : "Overall:"} {printPreviewSnapshot.overallUnderstandingPct}%
                </p>
              </div>

              <div>
                <h4 className="font-bold text-sm mb-2">
                  {isAr ? "تفصيل إتقان المفاهيم:" : "Concept Mastery:"}
                </h4>
                <table className="w-full border-collapse border border-slate-300">
                  <thead>
                    <tr className="bg-slate-100">
                      <th className="border border-slate-300 p-2 text-start">{isAr ? "المفهوم" : "Concept"}</th>
                      <th className="border border-slate-300 p-2">{isAr ? "الفهم %" : "Mastery %"}</th>
                      <th className="border border-slate-300 p-2">{isAr ? "الصحيحة / الكل" : "Correct/Total"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {printPreviewSnapshot.conceptStats.map((c) => (
                      <tr key={c.concept}>
                        <td className="border border-slate-300 p-2 font-semibold">{c.concept}</td>
                        <td className="border border-slate-300 p-2 text-center font-mono-num">{c.understandingPct}%</td>
                        <td className="border border-slate-300 p-2 text-center font-mono-num">
                          {c.correctAnswers} / {c.totalAnswers}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {printPreviewSnapshot.interventionHistory.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-bold text-sm">
                    {isAr ? "قياس أثر التدخلات التعليمية:" : "Intervention Impact Summary:"}
                  </h4>
                  {printPreviewSnapshot.interventionHistory.map((rec) =>
                    rec.impact ? (
                      <div key={rec.id} className="p-3 rounded-xl border border-slate-300 bg-slate-50">
                        <p className="font-bold">{rec.concept}</p>
                        <p>{rec.impact.summaryText}</p>
                      </div>
                    ) : null
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

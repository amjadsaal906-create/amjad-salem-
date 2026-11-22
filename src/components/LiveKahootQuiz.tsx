import React, { useState, useEffect, useRef } from "react";
import {
  Trophy,
  Play,
  Users,
  Sparkles,
  Loader2,
  CheckCircle2,
  Clock,
  Copy,
  BarChart3,
  ArrowLeft,
  Zap,
} from "lucide-react";
import { CARTOON_AVATARS, CartoonAvatar } from "./CartoonAvatars.tsx";
import { QrCodeBox } from "./QrCodeBox.tsx";
import type {
  AccessibilitySettings,
  KahootQuizData,
  LessonData,
  QuizParticipant,
  QuizSessionReport,
  UILanguage,
} from "../types.ts";
import {
  fetchLessonArtifacts,
  fetchQuizReports,
  generateQuiz,
  saveLessonArtifact,
} from "../utils/aiApi.ts";

interface LiveKahootQuizProps {
  lesson: LessonData;
  uiLang: UILanguage;
  settings: AccessibilitySettings;
  onLaunchBuzzerMap?: () => void;
}

interface RoomStatePayload {
  type: string;
  roomCode: string;
  quizTitle: string;
  status: "lobby" | "question" | "reveal" | "finished";
  currentQuestionIndex: number;
  totalQuestions: number;
  questionStartedAt: number;
  question: {
    id: string;
    questionType: string;
    question: string;
    options: string[];
    timeLimitSec: number;
    points: number;
    correctIndex?: number;
    explanation?: string;
  } | null;
  leaderboard: QuizParticipant[];
}

export const LiveKahootQuiz: React.FC<LiveKahootQuizProps> = ({ lesson, uiLang, settings, onLaunchBuzzerMap }) => {
  const isAr = uiLang === "ar";
  const [mode, setMode] = useState<"host" | "student" | "reports">("host");

  // Quiz Draft (persisted in SQLite artifacts)
  const [quiz, setQuiz] = useState<KahootQuizData>(() => ({
    quizTitle: isAr ? `مسابقة ${lesson.title}` : `${lesson.title} Live Quiz`,
    lessonTitle: lesson.title,
    questions: lesson.quizQuestions.map((q) => ({
      id: q.id,
      questionType: "mcq",
      question: q.prompt,
      options: q.options,
      correctIndex: q.correctIndex,
      timeLimitSec: 20,
      points: 1000,
      explanation: q.explanation,
    })),
  }));

  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  // WebSocket Live State
  const wsRef = useRef<WebSocket | null>(null);
  const [roomState, setRoomState] = useState<RoomStatePayload | null>(null);
  const [wsError, setWsError] = useState<string | null>(null);
  const [timeLeftSec, setTimeLeftSec] = useState(0);

  // Student Join Inputs
  const [joinCode, setJoinCode] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("join")?.toUpperCase() || "";
  });
  const [studentName, setStudentName] = useState("");
  const [selectedAvatarId, setSelectedAvatarId] = useState<string>(
    () => CARTOON_AVATARS[Math.floor(Math.random() * CARTOON_AVATARS.length)].id
  );
  const [joinedAsStudent, setJoinedAsStudent] = useState(false);
  const [studentAnswered, setStudentAnswered] = useState<number | null>(null);
  const [studentFeedback, setStudentFeedback] = useState<{ correct: boolean; earned: number } | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // Saved Reports
  const [reports, setReports] = useState<QuizSessionReport[]>([]);

  // If URL has ?join=, switch straight to Student Join mode
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("join")) {
      setMode("student");
    }
  }, []);

  // Load saved quiz artifact for current lesson
  useEffect(() => {
    fetchLessonArtifacts(lesson.id)
      .then((artifacts) => {
        const found = artifacts.find((a) => a.artifactType === "kahoot_quiz");
        if (found?.data) {
          setQuiz(found.data as KahootQuizData);
        } else {
          setQuiz({
            quizTitle: isAr ? `مسابقة ${lesson.title}` : `${lesson.title} Live Quiz`,
            lessonTitle: lesson.title,
            questions: lesson.quizQuestions.map((q) => ({
              id: q.id,
              questionType: "mcq",
              question: q.prompt,
              options: q.options,
              correctIndex: q.correctIndex,
              timeLimitSec: 20,
              points: 1000,
              explanation: q.explanation,
            })),
          });
        }
      })
      .catch(() => {});
  }, [lesson, isAr]);

  const loadReports = () => {
    fetchQuizReports()
      .then((r) => setReports(r))
      .catch(() => {});
  };

  useEffect(() => {
    if (mode === "reports") loadReports();
  }, [mode]);

  // Countdown timer synced to server questionStartedAt
  useEffect(() => {
    if (!roomState || roomState.status !== "question" || !roomState.question) {
      setTimeLeftSec(0);
      return;
    }
    const update = () => {
      const elapsed = (Date.now() - roomState.questionStartedAt) / 1000;
      const left = Math.max(0, Math.ceil((roomState.question?.timeLimitSec || 20) - elapsed));
      setTimeLeftSec(left);
    };
    update();
    const timer = window.setInterval(update, 300);
    return () => window.clearInterval(timer);
  }, [roomState]);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  const openSocket = (onOpenSend: (ws: WebSocket) => void) => {
    wsRef.current?.close();
    setWsError(null);
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}/ws/quiz`);
    wsRef.current = ws;

    ws.onopen = () => onOpenSend(ws);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "room:state") {
          setRoomState((prev) => {
            if (prev?.currentQuestionIndex !== msg.currentQuestionIndex || prev?.status !== msg.status) {
              if (msg.status === "question") {
                setStudentAnswered(null);
                setStudentFeedback(null);
              }
            }
            return msg;
          });
        } else if (msg.type === "student:joined") {
          setJoinedAsStudent(true);
          if (msg.avatarId) {
            setSelectedAvatarId(msg.avatarId);
          }
        } else if (msg.type === "student:feedback") {
          setStudentFeedback({ correct: msg.correct, earned: msg.earned });
        } else if (msg.type === "room:error") {
          setWsError(msg.message);
        }
      } catch {
        // Ignore
      }
    };
    ws.onerror = () => setWsError(isAr ? "تعذر الاتصال بخادم المسابقة المباشرة." : "Live WebSocket connection failed.");
  };

  const handleGenerateQuiz = async () => {
    if (!settings.aiProcessingConsent) {
      setGenError(isAr ? "يرجى تفعيل موافقة المعالجة بالذكاء الاصطناعي أولاً." : "Please enable AI consent first.");
      return;
    }
    setGenerating(true);
    setGenError(null);
    try {
      const data = await generateQuiz({ lesson, questionCount: 6, language: uiLang });
      if (!data.quiz) {
        setGenError(data.message || (isAr ? "تعذر توليد الاختبار التنافسي." : "Error generating quiz."));
      } else {
        setQuiz(data.quiz);
        saveLessonArtifact({
          lessonId: lesson.id,
          artifactType: "kahoot_quiz",
          title: data.quiz.quizTitle,
          data: data.quiz,
        }).catch(() => {});
      }
    } catch (err) {
      setGenError(
        err instanceof Error
          ? err.message
          : isAr
            ? "تعذر توليد الاختبار التنافسي."
            : "Could not generate competitive quiz."
      );
    } finally {
      setGenerating(false);
    }
  };

  const handleHostCreateRoom = () => {
    if (quiz.questions.length === 0) {
      setWsError(isAr ? "أضف أسئلة أو ولّد اختباراً أولاً." : "Generate or add questions first.");
      return;
    }
    openSocket((ws) => {
      ws.send(
        JSON.stringify({
          type: "host:create",
          lessonId: lesson.id,
          quizTitle: quiz.quizTitle,
          questions: quiz.questions,
        })
      );
    });
  };

  const handleStudentJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCode.trim() || !studentName.trim()) return;
    openSocket((ws) => {
      ws.send(
        JSON.stringify({
          type: "student:join",
          roomCode: joinCode.trim().toUpperCase(),
          name: studentName.trim(),
          avatarId: selectedAvatarId,
        })
      );
    });
  };

  const OPTION_COLORS = ["#0284C7", "#059669", "#D97706", "#DC2626"];

  return (
    <div className="space-y-6">
      {/* Header + Mode Tabs */}
      <section
        className="science-card rounded-xl border p-6 space-y-4"
        style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Trophy className="w-6 h-6" style={{ color: "var(--accent-primary)" }} />
              <span>{isAr ? "المسابقات التفاعلية المباشرة" : "Live Competitive Quizzes"}</span>
            </h1>
            <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
              {isAr
                ? `الدرس المرتبط: ${lesson.title} · منافسة فورية عبر WebSocket مع مؤقت زمني وترتيب مباشر وتقارير`
                : `Linked Lesson: ${lesson.title} · Real-time WebSocket competition, timed scoring, leaderboard & analytics`}
            </p>
          </div>

            <div className="flex flex-wrap items-center gap-2">
              {onLaunchBuzzerMap && (
                <button
                  type="button"
                  onClick={onLaunchBuzzerMap}
                  className="min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0 shadow-sm"
                  style={{
                    background: "linear-gradient(135deg, #f97316 0%, #ec4899 100%)",
                    color: "#ffffff",
                  }}
                >
                  <Zap className="w-4 h-4 fill-current" />
                  <span>{isAr ? "خريطة المراحل والباز" : "Stages & Buzz Map"}</span>
                </button>
              )}

              <div
                className="flex items-center p-1 rounded-lg border text-xs"
                style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}
              >
                {[
                  { id: "host" as const, label: isAr ? "إدارة المعلم" : "Teacher Host" },
                  { id: "student" as const, label: isAr ? "انضمام طالب" : "Student Join" },
                  { id: "reports" as const, label: isAr ? "التقارير والتحليل" : "Reports" },
                ].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setMode(t.id)}
                    className="px-3 py-1.5 rounded-md font-semibold whitespace-nowrap"
                    style={{
                      backgroundColor: mode === t.id ? "var(--accent-primary)" : "transparent",
                      color: mode === t.id ? "var(--accent-contrast)" : "var(--text-secondary)",
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
        </div>
      </section>

      {wsError && (
        <div className="p-3 rounded-lg border text-xs text-red-600 dark:text-red-400" role="alert" style={{ borderColor: "#dc2626" }}>
          {wsError}
        </div>
      )}

      {/* TEACHER HOST MODE */}
      {mode === "host" && (
        <div className="space-y-6">
          {!roomState ? (
            <section
              className="science-card rounded-xl border p-6 space-y-5"
              style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold">{quiz.quizTitle}</h2>
                  <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    {quiz.questions.length} {isAr ? "أسئلة جاهزة (اختيار من متعدد، صح وخطأ، تفكير عليا)" : "questions ready"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleGenerateQuiz}
                    disabled={generating}
                    className="min-h-[42px] px-4 py-2 rounded-lg border text-xs font-semibold flex items-center gap-1.5"
                    style={{ borderColor: "var(--border-hairline)" }}
                  >
                    {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    <span>{isAr ? "توليد مسابقة من الدرس" : "Generate Quiz from Lesson"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleHostCreateRoom}
                    className="min-h-[42px] px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5"
                    style={{ backgroundColor: "var(--accent-primary)", color: "var(--accent-contrast)" }}
                  >
                    <Play className="w-4 h-4" />
                    <span>{isAr ? "إنشاء غرفة منافسة مباشرة" : "Launch Live Competition Room"}</span>
                  </button>
                </div>
              </div>

              {genError && <p className="text-xs text-red-600">{genError}</p>}

              <div className="space-y-3">
                {quiz.questions.map((q, idx) => (
                  <div
                    key={q.id || idx}
                    className="p-4 rounded-xl border space-y-2 text-sm"
                    style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}
                  >
                    <div className="flex items-center justify-between text-xs" style={{ color: "var(--text-secondary)" }}>
                      <span className="font-mono-num font-bold">
                        #{idx + 1} · {q.questionType === "true_false" ? (isAr ? "صح وخطأ" : "True/False") : q.questionType === "higher_order" ? (isAr ? "تفكير عليا" : "Higher-Order") : (isAr ? "اختيار من متعدد" : "MCQ")}
                      </span>
                      <span className="font-mono-num">
                        {q.timeLimitSec}s · {q.points} pts
                      </span>
                    </div>
                    <div className="font-bold">{q.question}</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs">
                      {q.options.map((opt, oi) => (
                        <div
                          key={oi}
                          className="p-2 rounded border flex items-center justify-between"
                          style={{
                            backgroundColor: "var(--bg-surface)",
                            borderColor: oi === q.correctIndex ? "#059669" : "var(--border-hairline)",
                          }}
                        >
                          <span>{opt}</span>
                          {oi === q.correctIndex && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : (
            <section
              className="science-card rounded-xl border p-6 space-y-5"
              style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--accent-primary)" }}
            >
              <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4" style={{ borderColor: "var(--border-hairline)" }}>
                <div className="flex flex-wrap items-center gap-4">
                  <QrCodeBox
                    value={`${window.location.origin}?join=${roomState.roomCode}`}
                    size={108}
                    label={isAr ? "امسح الباركود للدخول" : "Scan QR to Join"}
                  />
                  <div>
                    <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
                      {isAr ? "رمز الانضمام للمسابقة" : "Live Room PIN"}
                    </div>
                    <div className="text-3xl font-bold font-mono-num tracking-widest" style={{ color: "var(--accent-primary)" }}>
                      {roomState.roomCode}
                    </div>
                    <div className="text-[11px] font-mono-num mt-1 opacity-75" style={{ color: "var(--text-secondary)" }}>
                      {`${window.location.origin}?join=${roomState.roomCode}`}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const link = `${window.location.origin}?join=${roomState.roomCode}`;
                      navigator.clipboard?.writeText(link);
                      setCopiedLink(true);
                      setTimeout(() => setCopiedLink(false), 2000);
                    }}
                    className="min-h-[40px] px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5"
                    style={{ borderColor: "var(--border-hairline)" }}
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>{copiedLink ? (isAr ? "تم نسخ الرابط" : "Copied Link") : isAr ? "نسخ رابط الانضمام" : "Copy Join Link"}</span>
                  </button>

                  {roomState.status === "lobby" && (
                    <button
                      type="button"
                      onClick={() => wsRef.current?.send(JSON.stringify({ type: "host:start" }))}
                      className="min-h-[40px] px-4 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5"
                      style={{ backgroundColor: "var(--accent-primary)", color: "var(--accent-contrast)" }}
                    >
                      <Play className="w-4 h-4" />
                      <span>{isAr ? "بدء السؤال الأول" : "Start Question 1"}</span>
                    </button>
                  )}

                  {roomState.status === "question" && (
                    <button
                      type="button"
                      onClick={() => wsRef.current?.send(JSON.stringify({ type: "host:reveal" }))}
                      className="min-h-[40px] px-4 py-1.5 rounded-lg border text-xs font-semibold"
                      style={{ borderColor: "var(--border-hairline)" }}
                    >
                      {isAr ? "إظهار الإجابة الصحيحة" : "Reveal Answer"}
                    </button>
                  )}

                  {roomState.status === "reveal" && (
                    <button
                      type="button"
                      onClick={() => wsRef.current?.send(JSON.stringify({ type: "host:next" }))}
                      className="min-h-[40px] px-4 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5"
                      style={{ backgroundColor: "var(--accent-primary)", color: "var(--accent-contrast)" }}
                    >
                      <span>
                        {roomState.currentQuestionIndex + 1 < roomState.totalQuestions
                          ? isAr
                            ? "السؤال التالي"
                            : "Next Question"
                          : isAr
                          ? "إنهاء وحفظ التقرير"
                          : "Finish & Save Report"}
                      </span>
                      <ArrowLeft className="w-4 h-4" />
                    </button>
                  )}

                  {roomState.status === "finished" && (
                    <button
                      type="button"
                      onClick={() => {
                        wsRef.current?.close();
                        setRoomState(null);
                      }}
                      className="min-h-[40px] px-4 py-1.5 rounded-lg border text-xs font-semibold"
                      style={{ borderColor: "var(--border-hairline)" }}
                    >
                      {isAr ? "العودة لإعداد المسابقات" : "Back to Setup"}
                    </button>
                  )}
                </div>
              </div>

              {/* Active Question View for Host */}
              {roomState.question && (roomState.status === "question" || roomState.status === "reveal") && (
                <div className="p-5 rounded-xl border space-y-4" style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}>
                  <div className="flex items-center justify-between text-xs font-mono-num">
                    <span>
                      {isAr ? "السؤال" : "Question"} {roomState.currentQuestionIndex + 1} / {roomState.totalQuestions}
                    </span>
                    <span className="inline-flex items-center gap-1 font-bold text-sm" style={{ color: "var(--accent-primary)" }}>
                      <Clock className="w-4 h-4" />
                      <span>{timeLeftSec}s</span>
                    </span>
                  </div>
                  <h3 className="text-xl font-bold">{roomState.question.question}</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {roomState.question.options.map((opt, idx) => {
                      const isCorrect = roomState.status === "reveal" && idx === roomState.question?.correctIndex;
                      return (
                        <div
                          key={idx}
                          className="p-3.5 rounded-lg border font-semibold text-sm flex items-center justify-between"
                          style={{
                            backgroundColor: "var(--bg-surface)",
                            borderColor: isCorrect ? "#059669" : OPTION_COLORS[idx % 4],
                            borderWidth: isCorrect ? "3px" : "1px",
                          }}
                        >
                          <span>{opt}</span>
                          {isCorrect && <CheckCircle2 className="w-5 h-5 text-emerald-600" />}
                        </div>
                      );
                    })}
                  </div>
                  {roomState.status === "reveal" && roomState.question.explanation && (
                    <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                      {roomState.question.explanation}
                    </p>
                  )}
                </div>
              )}

              {/* Top-3 Winners Podium when finished */}
              {roomState.status === "finished" && roomState.leaderboard.length > 0 && (
                <div
                  className="p-5 rounded-2xl border space-y-3"
                  style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--accent-primary)" }}
                >
                  <div className="text-center font-bold text-base flex items-center justify-center gap-2">
                    <Trophy className="w-5 h-5 text-amber-500" />
                    <span>{isAr ? "منصة الأبطال — المتصدرون" : "Champions Podium"}</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {roomState.leaderboard.slice(0, 3).map((winner, wIdx) => (
                      <div
                        key={winner.id}
                        className="p-4 rounded-xl border flex flex-col items-center text-center gap-2"
                        style={{
                          backgroundColor: "var(--bg-surface)",
                          borderColor: wIdx === 0 ? "#D97706" : "var(--border-hairline)",
                          borderWidth: wIdx === 0 ? "2px" : "1px",
                        }}
                      >
                        <span className="font-mono-num text-xs font-extrabold" style={{ color: "var(--accent-primary)" }}>
                          #{wIdx + 1}
                        </span>
                        <CartoonAvatar avatarId={winner.avatarId} seed={winner.name} size="lg" />
                        <span className="font-bold text-sm truncate max-w-full">{winner.name}</span>
                        <span className="font-mono-num text-xs font-bold" style={{ color: "var(--accent-primary)" }}>
                          {winner.score} pts · {winner.correctCount}/{roomState.totalQuestions}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Live Participants & Real-Time Teacher Monitoring */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm font-bold">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    <span>
                      {isAr ? "لوحة الرصد اللحظي للمتسابقين" : "Live Participants & Real-Time Monitor"} ({roomState.leaderboard.length})
                    </span>
                  </div>
                  {roomState.status === "question" && roomState.leaderboard.length > 0 && (
                    <span className="font-mono-num text-xs font-semibold" style={{ color: "var(--accent-primary)" }}>
                      {isAr
                        ? `أجاب: ${roomState.leaderboard.filter((p) => p.answeredCurrent).length} / ${roomState.leaderboard.length}`
                        : `Answered: ${roomState.leaderboard.filter((p) => p.answeredCurrent).length} / ${roomState.leaderboard.length}`}
                    </span>
                  )}
                </div>
                {roomState.leaderboard.length === 0 ? (
                  <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    {isAr
                      ? "بانتظار انضمام الطلاب عبر رمز الغرفة أو رابط الانضمام (يمكنك الاختبار بفتح تبويب متصفح آخر على تبويب انضمام طالب)."
                      : "Waiting for students to join with the room PIN (test in a second browser tab via Student Join)."}
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {roomState.leaderboard.map((p, rank) => (
                      <div
                        key={p.id}
                        className="p-3 rounded-xl border flex items-center justify-between gap-2.5 text-sm"
                        style={{
                          backgroundColor: "var(--bg-subtle)",
                          borderColor:
                            roomState.status === "question" && p.answeredCurrent
                              ? "#059669"
                              : rank === 0 && p.score > 0
                              ? "var(--accent-primary)"
                              : "var(--border-hairline)",
                        }}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <CartoonAvatar avatarId={p.avatarId} seed={p.name} size="sm" />
                          <div className="min-w-0">
                            <span className="font-bold block truncate" style={{ color: "var(--text-primary)" }}>
                              <span className="font-mono-num opacity-70 mx-1">#{rank + 1}</span>
                              {p.name}
                            </span>
                            <span className="text-[11px] font-mono-num block" style={{ color: "var(--text-secondary)" }}>
                              {isAr ? `إجابات صحيحة: ${p.correctCount}` : `Correct: ${p.correctCount}`}
                              {roomState.status === "question" && (
                                <>
                                  {" · "}
                                  <span style={{ color: p.answeredCurrent ? "#059669" : "#D97706" }}>
                                    {p.answeredCurrent
                                      ? isAr
                                        ? "أجاب"
                                        : "Answered"
                                      : isAr
                                      ? "يفكّر..."
                                      : "Thinking..."}
                                  </span>
                                </>
                              )}
                            </span>
                          </div>
                        </div>
                        <span className="font-mono-num font-bold shrink-0" style={{ color: "var(--accent-primary)" }}>
                          {p.score} pts
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      )}

      {/* STUDENT JOIN MODE */}
      {mode === "student" && (
        <section
          className="science-card rounded-xl border p-6 space-y-5 max-w-2xl mx-auto"
          style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}
        >
          {!joinedAsStudent || !roomState ? (
            <form onSubmit={handleStudentJoinRoom} className="space-y-4">
              <h2 className="text-lg font-bold">{isAr ? "الانضمام إلى مسابقة مباشرة" : "Join Live Quiz"}</h2>
              <div>
                <label className="block text-xs font-semibold mb-1">{isAr ? "رمز المسابقة (PIN)" : "Room PIN"}</label>
                <input
                  type="text"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="مثال: AB12CD"
                  className="w-full min-h-[44px] px-3 rounded-lg border text-base font-mono-num uppercase"
                  style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">{isAr ? "اسم الطالب" : "Student Name"}</label>
                <div className="flex items-center gap-2.5">
                  <CartoonAvatar avatarId={selectedAvatarId} seed={studentName || "student"} size="md" />
                  <input
                    type="text"
                    value={studentName}
                    onChange={(e) => setStudentName(e.target.value)}
                    placeholder={isAr ? "اكتب اسمك ليظهر بجانب شخصيتك" : "Enter your name"}
                    className="flex-1 min-h-[44px] px-3 rounded-lg border text-sm"
                    style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-2">
                  {isAr ? "اختر شخصيتك الكرتونية اللطيفة" : "Choose Your Cartoon Character"}
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {CARTOON_AVATARS.map((av) => {
                    const active = selectedAvatarId === av.id;
                    return (
                      <button
                        key={av.id}
                        type="button"
                        onClick={() => setSelectedAvatarId(av.id)}
                        className="p-2 rounded-xl border flex flex-col items-center gap-1 transition-all"
                        style={{
                          backgroundColor: active ? "var(--bg-subtle)" : "var(--bg-surface)",
                          borderColor: active ? "var(--accent-primary)" : "var(--border-hairline)",
                          borderWidth: active ? "2px" : "1px",
                        }}
                      >
                        <CartoonAvatar avatarId={av.id} size="md" />
                        <span className="text-[11px] font-semibold truncate w-full text-center" style={{ color: "var(--text-primary)" }}>
                          {isAr ? av.nameAr : av.nameEn}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                type="submit"
                className="w-full min-h-[44px] rounded-lg text-sm font-bold"
                style={{ backgroundColor: "var(--accent-primary)", color: "var(--accent-contrast)" }}
              >
                {isAr ? "دخول المسابقة" : "Join Room"}
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              {(() => {
                const me = roomState.leaderboard.find((p) => p.name === studentName.trim());
                return (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-bold flex items-center gap-2">
                      <CartoonAvatar avatarId={me?.avatarId || selectedAvatarId} seed={studentName} size="sm" />
                      <span>
                        {studentName} · {roomState.quizTitle}
                      </span>
                    </span>
                    <span className="font-mono-num font-bold flex items-center gap-2" style={{ color: "var(--accent-primary)" }}>
                      {me && <span>{me.score} pts</span>}
                      <span>{roomState.status === "question" ? `${timeLeftSec}s` : roomState.roomCode}</span>
                    </span>
                  </div>
                );
              })()}

              {roomState.status === "lobby" && (
                <div className="p-6 text-center rounded-xl border space-y-4" style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}>
                  <div className="flex justify-center">
                    <CartoonAvatar avatarId={selectedAvatarId} seed={studentName} size="lg" />
                  </div>
                  <p className="font-bold">
                    {isAr
                      ? `أهلاً ${studentName}! تم انضمامك بنجاح، بانتظار بدء المعلم...`
                      : `Welcome ${studentName}! Joined successfully, waiting for teacher...`}
                  </p>
                  {roomState.leaderboard.length > 0 && (
                    <div className="pt-3 border-t space-y-2" style={{ borderColor: "var(--border-hairline)" }}>
                      <div className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
                        {isAr ? `الطلاب المتواجدون الآن (${roomState.leaderboard.length}):` : `Students in lobby (${roomState.leaderboard.length}):`}
                      </div>
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        {roomState.leaderboard.map((p) => (
                          <div
                            key={p.id}
                            className="px-2.5 py-1.5 rounded-xl border flex items-center gap-2 text-xs font-semibold"
                            style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}
                          >
                            <CartoonAvatar avatarId={p.avatarId} seed={p.name} size="xs" />
                            <span>{p.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {roomState.question && (roomState.status === "question" || roomState.status === "reveal") && (
                <div className="space-y-3">
                  <h3 className="text-lg font-bold">{roomState.question.question}</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {roomState.question.options.map((opt, idx) => (
                      <button
                        key={idx}
                        type="button"
                        disabled={roomState.status !== "question" || studentAnswered !== null}
                        onClick={() => {
                          setStudentAnswered(idx);
                          wsRef.current?.send(JSON.stringify({ type: "student:answer", optionIndex: idx }));
                        }}
                        className="min-h-[56px] p-4 rounded-xl text-white font-bold text-sm text-center transition-opacity disabled:opacity-75"
                        style={{
                          backgroundColor: OPTION_COLORS[idx % 4],
                          outline: studentAnswered === idx ? "4px solid var(--text-primary)" : "none",
                        }}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                  {studentFeedback && (
                    <div className="p-3 rounded-lg border text-sm font-bold text-center" style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}>
                      {studentFeedback.correct
                        ? `${isAr ? "إجابة صحيحة! +" : "Correct! +"}${studentFeedback.earned}`
                        : isAr
                        ? "إجابة غير صحيحة — راجع التفسير"
                        : "Incorrect — review explanation"}
                    </div>
                  )}

                  {roomState.status === "reveal" && roomState.leaderboard.length > 0 && (
                    <div className="pt-2 space-y-2">
                      <div className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>
                        {isAr ? "الترتيب الحالي:" : "Current Standings:"}
                      </div>
                      <div className="space-y-1.5">
                        {roomState.leaderboard.slice(0, 5).map((p, idx) => (
                          <div key={p.id} className="p-2.5 rounded-xl border flex items-center justify-between gap-2 text-xs" style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}>
                            <span className="flex items-center gap-2 font-bold">
                              <CartoonAvatar avatarId={p.avatarId} seed={p.name} size="xs" />
                              <span>#{idx + 1} {p.name}</span>
                            </span>
                            <span className="font-mono-num font-bold" style={{ color: "var(--accent-primary)" }}>{p.score} pts</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {roomState.status === "finished" && (
                <div className="space-y-3">
                  <h3 className="text-lg font-bold text-center">{isAr ? "انتهت المسابقة — النتائج النهائية" : "Quiz Finished — Final Standings"}</h3>
                  {roomState.leaderboard.map((p, idx) => (
                    <div key={p.id} className="p-3 rounded-xl border flex items-center justify-between gap-2 text-sm" style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}>
                      <span className="flex items-center gap-2.5 font-bold">
                        <CartoonAvatar avatarId={p.avatarId} seed={p.name} size="sm" />
                        <span>#{idx + 1} {p.name}</span>
                      </span>
                      <span className="font-mono-num font-bold" style={{ color: "var(--accent-primary)" }}>{p.score} pts</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* REPORTS & ANALYTICS */}
      {mode === "reports" && (
        <section
          className="science-card rounded-xl border p-6 space-y-4"
          style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}
        >
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5" style={{ color: "var(--accent-primary)" }} />
            <h2 className="text-lg font-bold">{isAr ? "تقارير نتائج الطلبة وتحليل الإجابات" : "Student Quiz Reports & Analytics"}</h2>
          </div>

          {reports.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              {isAr ? "لم تكتمل مسابقات مباشرة بعد. عند إنهاء أي مسابقة سيُحفظ تقريرها هنا تلقائياً." : "No completed live quizzes yet."}
            </p>
          ) : (
            <div className="space-y-4">
              {reports.map((rep, idx) => (
                <div
                  key={idx}
                  className="p-4 rounded-xl border space-y-3"
                  style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}
                >
                  <div className="flex flex-wrap justify-between gap-2 text-sm font-bold">
                    <span>{rep.quizTitle} ({rep.roomCode})</span>
                    <span className="font-mono-num text-xs" style={{ color: "var(--text-secondary)" }}>
                      {new Date(rep.finishedAt).toLocaleString(isAr ? "ar-EG" : "en-US")}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    <div>
                      <div className="font-bold mb-1.5">{isAr ? "ترتيب الطلاب:" : "Leaderboard:"}</div>
                      <div className="space-y-1.5">
                        {rep.participants.map((p, pi) => (
                          <div key={p.id} className="flex items-center gap-2">
                            <CartoonAvatar avatarId={p.avatarId} seed={p.name} size="xs" />
                            <span>
                              #{pi + 1} <strong>{p.name}</strong> — {p.score} pts ({p.correctCount}/{rep.totalQuestions})
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="font-bold mb-1">{isAr ? "دقة الإجابات لكل سؤال:" : "Question Accuracy:"}</div>
                      {rep.questionAccuracy.map((qa, qi) => (
                        <div key={qi}>
                          • {qa.question.slice(0, 48)}...: <strong className="font-mono-num">{qa.correctRate}%</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
};

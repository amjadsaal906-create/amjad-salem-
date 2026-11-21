import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  Copy,
  Crown,
  Flame,
  Heart,
  ListChecks,
  Loader2,
  Lock,
  Music,
  Pause,
  Play,
  QrCode,
  RotateCcw,
  Sparkles,
  Star,
  Trophy,
  Users,
  Volume2,
  VolumeX,
  X,
  Zap,
} from "lucide-react";
import { CARTOON_AVATARS, CartoonAvatar } from "./CartoonAvatars.tsx";
import { QrCodeBox } from "./QrCodeBox.tsx";
import { gameAudio } from "../utils/gameAudio.ts";
import type { AccessibilitySettings, LessonData, QuizParticipant, UILanguage } from "../types.ts";

interface QuizBuzzerMapGameProps {
  lesson: LessonData;
  allLessons?: LessonData[];
  uiLang: UILanguage;
  settings: AccessibilitySettings;
  userName?: string;
  initialJoinCode?: string;
  onClose: () => void;
}

type GamePhase = "TITLE_MENU" | "STAGE_MAP" | "BUZZER_CHALLENGE" | "PAUSED" | "VICTORY" | "GAME_OVER";
type GameMode = "solo_bot" | "duel_2p" | "live_room";
type LiveSubRole = "host" | "student";
type BotDifficulty = "calm" | "balanced" | "fast";
type ChallengeSubPhase = "BUZZ_RACE" | "ANSWERING" | "BOT_THINKING" | "STAGE_RESULT";

interface StageNodeQuestion {
  stageIndex: number;
  id: string;
  titleAr: string;
  titleEn: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  points: number;
  isBoss: boolean;
}

interface StageProgress {
  unlocked: boolean;
  completed: boolean;
  stars: number; // 0..3
  bestScore: number;
  winner?: "p1" | "p2" | "bot" | null;
}

interface LiveMapRoomState {
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
  buzzerMode?: boolean;
  buzzerWinner?: { participantId: string; name: string; avatarId: string; buzzedAt: number } | null;
}

const BACKDROP_URL = "/src/assets/images/quiz_map_backdrop_1795181373958.jpg";

const MAP_NODE_COORDS: Array<{ x: number; y: number; landmarkAr: string; landmarkEn: string }> = [
  { x: 16, y: 74, landmarkAr: "جزيرة الانطلاق", landmarkEn: "Harbor Gate" },
  { x: 34, y: 66, landmarkAr: "ممر الغابة", landmarkEn: "Forest Bridge" },
  { x: 40, y: 40, landmarkAr: "القباب العلمية", landmarkEn: "Bio-Science Domes" },
  { x: 60, y: 44, landmarkAr: "جسر البلورات", landmarkEn: "Crystal Bridge" },
  { x: 78, y: 62, landmarkAr: "معبد الطاقة", landmarkEn: "Crystal Citadel" },
  { x: 80, y: 27, landmarkAr: "قمة المرصد (الزعيم)", landmarkEn: "Observatory Boss" },
];

const BOT_TIMING_MS: Record<BotDifficulty, { min: number; max: number; accuracy: number }> = {
  calm: { min: 4200, max: 6200, accuracy: 0.62 },
  balanced: { min: 2600, max: 4200, accuracy: 0.76 },
  fast: { min: 1500, max: 2700, accuracy: 0.88 },
};

function buildStagePool(
  lesson: LessonData,
  allLessons: LessonData[],
  artifactQuestions?: Array<{
    id?: string;
    question?: string;
    options?: string[];
    correctIndex?: number;
    points?: number;
    explanation?: string;
  }>
): StageNodeQuestion[] {
  const pool: Array<{
    id: string;
    prompt: string;
    options: string[];
    correctIndex: number;
    explanation: string;
    points: number;
  }> = [];

  if (Array.isArray(artifactQuestions)) {
    artifactQuestions.forEach((aq, idx) => {
      if (aq && typeof aq.question === "string" && aq.question.trim() && Array.isArray(aq.options) && aq.options.length >= 2) {
        const opts = aq.options.slice(0, 4).map((o) => String(o));
        pool.push({
          id: aq.id || `art-q-${idx}`,
          prompt: aq.question.trim(),
          options: opts,
          correctIndex: Math.max(0, Math.min(Number(aq.correctIndex) || 0, opts.length - 1)),
          explanation: aq.explanation || lesson.summary,
          points: aq.points || 1000 + idx * 150,
        });
      }
    });
  }

  for (const q of lesson.quizQuestions || []) {
    if (q.prompt && Array.isArray(q.options) && q.options.length >= 2 && !pool.some((p) => p.prompt === q.prompt)) {
      const opts = q.options.slice(0, 4);
      pool.push({
        id: q.id,
        prompt: q.prompt,
        options: opts,
        correctIndex: Math.max(0, Math.min(q.correctIndex, opts.length - 1)),
        explanation: q.explanation || lesson.summary,
        points: 1000 + pool.length * 150,
      });
    }
  }

  const sameSubject = allLessons.filter((l) => l.id !== lesson.id && l.subjectId === lesson.subjectId);
  const otherLessons = allLessons.filter((l) => l.id !== lesson.id && l.subjectId !== lesson.subjectId);
  for (const extraLesson of [...sameSubject, ...otherLessons]) {
    if (pool.length >= 6) break;
    for (const q of extraLesson.quizQuestions || []) {
      if (pool.length >= 6) break;
      if (q.prompt && Array.isArray(q.options) && q.options.length >= 2 && !pool.some((p) => p.prompt === q.prompt)) {
        const opts = q.options.slice(0, 4);
        pool.push({
          id: `${extraLesson.id}-${q.id}`,
          prompt: q.prompt,
          options: opts,
          correctIndex: Math.max(0, Math.min(q.correctIndex, opts.length - 1)),
          explanation: q.explanation || extraLesson.summary,
          points: 1000 + pool.length * 150,
        });
      }
    }
  }

  const capped = pool.slice(0, 6);
  return capped.map((item, idx) => {
    const coord = MAP_NODE_COORDS[idx] || MAP_NODE_COORDS[MAP_NODE_COORDS.length - 1];
    const isLast = idx === capped.length - 1 && capped.length >= 4;
    return {
      stageIndex: idx,
      id: item.id,
      titleAr: coord.landmarkAr,
      titleEn: coord.landmarkEn,
      prompt: item.prompt,
      options: item.options,
      correctIndex: item.correctIndex,
      explanation: item.explanation,
      points: isLast ? 2000 : 1000 + idx * 200,
      isBoss: isLast,
    };
  });
}

export const QuizBuzzerMapGame: React.FC<QuizBuzzerMapGameProps> = ({
  lesson,
  allLessons = [],
  uiLang,
  settings,
  userName = "",
  initialJoinCode = "",
  onClose,
}) => {
  const isAr = uiLang === "ar";
  const [imgFailed, setImgFailed] = useState(false);

  // State machine
  const [phase, setPhase] = useState<GamePhase>("TITLE_MENU");
  const [pausedFrom, setPausedFrom] = useState<"STAGE_MAP" | "BUZZER_CHALLENGE">("STAGE_MAP");
  const [muted, setMuted] = useState(() => gameAudio.muted);
  const [musicOn, setMusicOn] = useState(() => gameAudio.musicEnabled);

  // Player & Mode config
  const [gameMode, setGameMode] = useState<GameMode>(() => (initialJoinCode ? "live_room" : "solo_bot"));
  const [liveRole, setLiveRole] = useState<LiveSubRole>(() => (initialJoinCode ? "student" : "host"));
  const [botDifficulty, setBotDifficulty] = useState<BotDifficulty>("balanced");
  const [p1Name, setP1Name] = useState(() => userName.trim() || (isAr ? "البطل الأول" : "Challenger 1"));
  const [p2Name, setP2Name] = useState(() => (isAr ? "البطل الثاني" : "Challenger 2"));
  const [p1Avatar, setP1Avatar] = useState(CARTOON_AVATARS[0].id);
  const [p2Avatar, setP2Avatar] = useState(CARTOON_AVATARS[1].id);

  // Stage Question Bank — initialized synchronously so stages & questions are ALWAYS present!
  const [stages, setStages] = useState<StageNodeQuestion[]>(() => buildStagePool(lesson, allLessons));
  const [generatingStages, setGeneratingStages] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [genStatus, setGenStatus] = useState<string | null>(null);
  const [questionsModalOpen, setQuestionsModalOpen] = useState(false);
  const [editingStageIdx, setEditingStageIdx] = useState<number | null>(null);
  const [editDraftPrompt, setEditDraftPrompt] = useState("");
  const [editDraftOptions, setEditDraftOptions] = useState<string[]>(["", "", "", ""]);
  const [editDraftCorrect, setEditDraftCorrect] = useState(0);

  // Active Campaign State
  const [progressByStage, setProgressByStage] = useState<Record<number, StageProgress>>({});
  const [p1Score, setP1Score] = useState(0);
  const [p2Score, setP2Score] = useState(0);
  const [hearts, setHearts] = useState(3);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);

  // Active Stage Challenge State (Solo / 2P)
  const [activeStageIdx, setActiveStageIdx] = useState<number>(0);
  const [subPhase, setSubPhase] = useState<ChallengeSubPhase>("BUZZ_RACE");
  const [buzzedBy, setBuzzedBy] = useState<"p1" | "p2" | "bot" | null>(null);
  const [stealChance, setStealChance] = useState(false);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [botChosenOption, setBotChosenOption] = useState<number | null>(null);
  const [stageResult, setStageResult] = useState<{
    correct: boolean;
    earned: number;
    stars: number;
    actor: "p1" | "p2" | "bot";
    message: string;
  } | null>(null);
  const [botChargePct, setBotChargePct] = useState(0);
  const [answerTimeLeftMs, setAnswerTimeLeftMs] = useState(8000);
  const [buzzerRipple, setBuzzerRipple] = useState<number>(0);
  const [shakeTrigger, setShakeTrigger] = useState<number>(0);

  // Live Multiplayer Classroom Room State (Code + QR Barcode + WebSocket)
  const wsRef = useRef<WebSocket | null>(null);
  const [liveRoom, setLiveRoom] = useState<LiveMapRoomState | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveJoinCodeInput, setLiveJoinCodeInput] = useState(() => initialJoinCode.toUpperCase());
  const [liveStudentJoined, setLiveStudentJoined] = useState(false);
  const [liveStudentAnswered, setLiveStudentAnswered] = useState<number | null>(null);
  const [liveStudentFeedback, setLiveStudentFeedback] = useState<{ correct: boolean; earned: number } | null>(null);
  const [liveTimeLeftSec, setLiveTimeLeftSec] = useState(0);
  const [copiedLiveLink, setCopiedLiveLink] = useState(false);
  const [qrInviteModalOpen, setQrInviteModalOpen] = useState(false);

  const botTimeoutRef = useRef<number | null>(null);
  const botIntervalRef = useRef<number | null>(null);
  const answerTimerRef = useRef<number | null>(null);
  const buzzTimestampRef = useRef<number>(0);

  const clearChallengeTimers = useCallback(() => {
    if (botTimeoutRef.current !== null) {
      window.clearTimeout(botTimeoutRef.current);
      botTimeoutRef.current = null;
    }
    if (botIntervalRef.current !== null) {
      window.clearInterval(botIntervalRef.current);
      botIntervalRef.current = null;
    }
    if (answerTimerRef.current !== null) {
      window.clearInterval(answerTimerRef.current);
      answerTimerRef.current = null;
    }
  }, []);

  // Stop timers & music on unmount
  useEffect(() => {
    return () => {
      clearChallengeTimers();
      gameAudio.stopMusic();
      wsRef.current?.close();
    };
  }, [clearChallengeTimers]);

  // Sync background challenge / map music with current phase
  useEffect(() => {
    if (!musicOn || muted) {
      gameAudio.stopMusic();
      return;
    }
    if (phase === "STAGE_MAP") {
      if (liveRoom?.status === "question") {
        gameAudio.startMusic("challenge");
      } else {
        gameAudio.startMusic("map");
      }
    } else if (phase === "BUZZER_CHALLENGE") {
      gameAudio.startMusic("challenge");
    } else if (phase === "PAUSED" || phase === "VICTORY" || phase === "GAME_OVER" || phase === "TITLE_MENU") {
      gameAudio.stopMusic();
    }
  }, [phase, musicOn, muted, liveRoom?.status]);

  // Load saved quiz artifact for current lesson without ever wiping initial stages
  useEffect(() => {
    let cancelled = false;
    setStages(buildStagePool(lesson, allLessons));

    fetch(`/api/artifacts?lessonId=${encodeURIComponent(lesson.id)}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const found = (d.artifacts || []).find(
          (a: { artifactType: string }) => a.artifactType === "kahoot_quiz"
        );
        if (found?.data?.questions) {
          const merged = buildStagePool(lesson, allLessons, found.data.questions);
          if (merged.length > 0) setStages(merged);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [lesson, allLessons]);

  const initFreshCampaign = useCallback(
    (targetStages: StageNodeQuestion[] = stages) => {
      const initialProgress: Record<number, StageProgress> = {};
      targetStages.forEach((_, idx) => {
        initialProgress[idx] = {
          unlocked: idx === 0,
          completed: false,
          stars: 0,
          bestScore: 0,
          winner: null,
        };
      });
      setProgressByStage(initialProgress);
      setP1Score(0);
      setP2Score(0);
      setHearts(3);
      setStreak(0);
      setBestStreak(0);
      setActiveStageIdx(0);
      setStageResult(null);
      setSelectedOption(null);
      setBotChosenOption(null);
      setBuzzedBy(null);
      setStealChance(false);
    },
    [stages]
  );

  // Live room countdown timer synced to server questionStartedAt
  useEffect(() => {
    if (!liveRoom || liveRoom.status !== "question" || !liveRoom.question) {
      setLiveTimeLeftSec(0);
      return;
    }
    const update = () => {
      const elapsed = (Date.now() - liveRoom.questionStartedAt) / 1000;
      const left = Math.max(0, Math.ceil((liveRoom.question?.timeLimitSec || 20) - elapsed));
      setLiveTimeLeftSec(left);
    };
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [liveRoom]);

  const openLiveSocket = useCallback(
    (onOpenSend: (ws: WebSocket) => void) => {
      wsRef.current?.close();
      setLiveError(null);
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${window.location.host}/ws/quiz`);
      wsRef.current = ws;

      ws.onopen = () => onOpenSend(ws);
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "room:state") {
            setLiveRoom((prev) => {
              if (
                prev?.currentQuestionIndex !== msg.currentQuestionIndex ||
                prev?.status !== msg.status
              ) {
                if (msg.status === "question") {
                  setLiveStudentAnswered(null);
                  setLiveStudentFeedback(null);
                  gameAudio.playStageSelect();
                } else if (msg.status === "finished") {
                  gameAudio.playVictoryFanfare();
                }
              }
              if (!prev?.buzzerWinner && msg.buzzerWinner) {
                gameAudio.playBuzzerSlam(1);
              }
              return msg;
            });
            if (typeof msg.currentQuestionIndex === "number") {
              setActiveStageIdx(msg.currentQuestionIndex);
              if (msg.status === "reveal" || msg.status === "finished") {
                setProgressByStage((prev) => {
                  const next = { ...prev };
                  const idx = msg.currentQuestionIndex;
                  const cur = next[idx] || { unlocked: true, completed: false, stars: 0, bestScore: 0 };
                  next[idx] = { ...cur, unlocked: true, completed: true, stars: Math.max(cur.stars, 3) };
                  if (idx + 1 < msg.totalQuestions) {
                    const nxt = next[idx + 1] || { unlocked: true, completed: false, stars: 0, bestScore: 0 };
                    next[idx + 1] = { ...nxt, unlocked: true };
                  }
                  return next;
                });
              }
            }
          } else if (msg.type === "student:joined") {
            setLiveStudentJoined(true);
            if (msg.avatarId) setP1Avatar(msg.avatarId);
            gameAudio.playCorrectChime(1);
          } else if (msg.type === "student:feedback") {
            setLiveStudentFeedback({ correct: msg.correct, earned: msg.earned });
            if (msg.correct) gameAudio.playCorrectChime(2);
            else gameAudio.playWrongBuzz();
          } else if (msg.type === "room:error") {
            setLiveError(msg.message);
          }
        } catch {
          // ignore
        }
      };
      ws.onerror = () => {
        setLiveError(isAr ? "تعذر الاتصال بغرفة المسابقة المباشرة." : "Live WebSocket connection failed.");
      };
    },
    [isAr]
  );

  const handleHostCreateLiveRoom = useCallback(
    (stageSet: StageNodeQuestion[] = stages) => {
      if (stageSet.length === 0) return;
      gameAudio.unlock();
      if (musicOn && !muted) gameAudio.startMusic("map");

      initFreshCampaign(stageSet);
      setGameMode("live_room");
      setLiveRole("host");
      setPhase("STAGE_MAP");

      const liveQuestions = stageSet.map((st) => ({
        id: st.id,
        questionType: "mcq",
        question: st.prompt,
        options: st.options,
        correctIndex: st.correctIndex,
        timeLimitSec: 25,
        points: st.points,
        explanation: st.explanation,
      }));

      openLiveSocket((ws) => {
        ws.send(
          JSON.stringify({
            type: "host:create",
            lessonId: lesson.id,
            quizTitle: isAr ? `خريطة مراحل: ${lesson.title}` : `Stage Map: ${lesson.title}`,
            questions: liveQuestions,
            buzzerMode: true,
          })
        );
      });
    },
    [initFreshCampaign, isAr, lesson.id, lesson.title, musicOn, muted, openLiveSocket, stages]
  );

  const handleStudentJoinLiveRoom = useCallback(
    (e?: React.FormEvent) => {
      if (e) e.preventDefault();
      const code = liveJoinCodeInput.trim().toUpperCase();
      const name = p1Name.trim();
      if (!code || !name) {
        setLiveError(isAr ? "أدخل رمز المسابقة واسمك أولاً." : "Enter room code and your name first.");
        return;
      }
      gameAudio.unlock();
      if (musicOn && !muted) gameAudio.startMusic("map");

      setGameMode("live_room");
      setLiveRole("student");
      initFreshCampaign(stages);
      setPhase("STAGE_MAP");

      openLiveSocket((ws) => {
        ws.send(
          JSON.stringify({
            type: "student:join",
            roomCode: code,
            name,
            avatarId: p1Avatar,
          })
        );
      });
    },
    [initFreshCampaign, isAr, liveJoinCodeInput, musicOn, muted, openLiveSocket, p1Avatar, p1Name, stages]
  );

  const handleGenerateAiStages = async () => {
    if (generatingStages) return;
    if (!settings.aiProcessingConsent) {
      setGenError(
        isAr
          ? "يرجى تفعيل موافقة المعالجة بالذكاء الاصطناعي من أدوات الوصول لتوليد مراحل مخصصة للدرس."
          : "Enable AI processing consent in Accessibility settings to generate lesson stages."
      );
      return;
    }

    setGeneratingStages(true);
    setGenError(null);
    setGenStatus(null);
    try {
      const res = await fetch("/api/generate/kahoot-quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lesson,
          questionCount: 6,
          language: uiLang,
        }),
      });
      const data = await res.json();
      if (!res.ok || !Array.isArray(data.quiz?.questions) || data.quiz.questions.length === 0) {
        throw new Error(
          data.message || (isAr ? "تعذر توليد مراحل الأسئلة للدرس." : "Could not generate lesson stages.")
        );
      }

      const rawQs = data.quiz.questions as Array<{
        id: string;
        question: string;
        options: string[];
        correctIndex: number;
        points?: number;
        explanation?: string;
      }>;

      const built: StageNodeQuestion[] = rawQs.slice(0, 6).map((q, idx) => {
        const coord = MAP_NODE_COORDS[idx] || MAP_NODE_COORDS[MAP_NODE_COORDS.length - 1];
        const isLast = idx === Math.min(rawQs.length, 6) - 1;
        return {
          stageIndex: idx,
          id: q.id || `ai-stage-${idx}`,
          titleAr: coord.landmarkAr,
          titleEn: coord.landmarkEn,
          prompt: q.question,
          options: q.options.slice(0, 4),
          correctIndex: Math.max(0, Math.min(q.correctIndex, Math.min(q.options.length, 4) - 1)),
          explanation: q.explanation || lesson.summary,
          points: isLast ? 2000 : 1000 + idx * 200,
          isBoss: isLast,
        };
      });

      await fetch("/api/artifacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lessonId: lesson.id,
          artifactType: "kahoot_quiz",
          title: data.quiz.quizTitle || lesson.title,
          data: data.quiz,
        }),
      });

      setStages(built);
      initFreshCampaign(built);
      setGenStatus(
        isAr
          ? `تم توليد خريطة ${built.length} مراحل تفاعلية من محتوى «${lesson.title}»!`
          : `Generated ${built.length} interactive stages from "${lesson.title}"!`
      );
    } catch (err) {
      setGenError(
        err instanceof Error
          ? err.message
          : isAr
            ? "تعذر الاتصال بالذكاء الاصطناعي لتوليد المراحل."
            : "Failed to generate AI stages."
      );
    } finally {
      setGeneratingStages(false);
    }
  };

  const handleSaveEditedStage = () => {
    if (editingStageIdx === null) return;
    const cleanPrompt = editDraftPrompt.trim();
    const cleanOptions = editDraftOptions.map((o) => o.trim()).filter(Boolean);
    if (!cleanPrompt || cleanOptions.length < 2) return;

    const updated = stages.map((st, idx) =>
      idx === editingStageIdx
        ? {
            ...st,
            prompt: cleanPrompt,
            options: cleanOptions.slice(0, 4),
            correctIndex: Math.max(0, Math.min(editDraftCorrect, cleanOptions.length - 1)),
          }
        : st
    );
    setStages(updated);
    setEditingStageIdx(null);
  };

  const handleStartCampaign = () => {
    if (stages.length === 0) return;
    gameAudio.unlock();
    gameAudio.playStageSelect();

    if (gameMode === "live_room") {
      if (liveRole === "host") {
        handleHostCreateLiveRoom(stages);
      } else {
        handleStudentJoinLiveRoom();
      }
      return;
    }

    initFreshCampaign(stages);
    setPhase("STAGE_MAP");
    if (musicOn && !muted) {
      gameAudio.startMusic("map");
    }
  };

  const currentStage = stages[activeStageIdx] || stages[0];

  const completeStageOutcome = useCallback(
    (outcome: {
      correct: boolean;
      actor: "p1" | "p2" | "bot";
      earned: number;
      stars: number;
      message: string;
    }) => {
      clearChallengeTimers();
      setSubPhase("STAGE_RESULT");
      setStageResult(outcome);

      if (outcome.actor === "p1") {
        if (outcome.correct) {
          setP1Score((s) => s + outcome.earned);
          setStreak((st) => {
            const nextSt = st + 1;
            setBestStreak((b) => Math.max(b, nextSt));
            gameAudio.playCorrectChime(nextSt);
            return nextSt;
          });
        } else {
          setStreak(0);
          gameAudio.playWrongBuzz();
          setShakeTrigger((v) => v + 1);
          if (gameMode === "solo_bot") {
            setHearts((h) => Math.max(0, h - 1));
          }
        }
      } else if (outcome.actor === "p2") {
        if (outcome.correct) {
          setP2Score((s) => s + outcome.earned);
          gameAudio.playCorrectChime(1);
        } else {
          gameAudio.playWrongBuzz();
          setShakeTrigger((v) => v + 1);
        }
      } else if (outcome.actor === "bot") {
        if (outcome.correct) {
          setP2Score((s) => s + outcome.earned);
          setStreak(0);
          gameAudio.playWrongBuzz();
          setShakeTrigger((v) => v + 1);
          setHearts((h) => Math.max(0, h - 1));
        }
      }

      const stageCleared =
        (gameMode === "solo_bot" && outcome.actor === "p1" && outcome.correct) ||
        (gameMode === "duel_2p" && outcome.correct);

      if (stageCleared) {
        setProgressByStage((prev) => {
          const next = { ...prev };
          const cur = next[activeStageIdx] || { unlocked: true, completed: false, stars: 0, bestScore: 0 };
          next[activeStageIdx] = {
            unlocked: true,
            completed: true,
            stars: Math.max(cur.stars, outcome.stars),
            bestScore: Math.max(cur.bestScore, outcome.earned),
            winner: outcome.actor,
          };
          if (activeStageIdx + 1 < stages.length) {
            const nextNode = next[activeStageIdx + 1] || { unlocked: true, completed: false, stars: 0, bestScore: 0 };
            next[activeStageIdx + 1] = { ...nextNode, unlocked: true };
          }
          return next;
        });
      }
    },
    [activeStageIdx, clearChallengeTimers, gameMode, stages.length]
  );

  const startAnswerCountdown = useCallback(
    (actor: "p1" | "p2", isSteal = false) => {
      clearChallengeTimers();
      setBuzzedBy(actor);
      setSubPhase("ANSWERING");
      setAnswerTimeLeftMs(8000);
      buzzTimestampRef.current = Date.now();

      const started = Date.now();
      answerTimerRef.current = window.setInterval(() => {
        const elapsed = Date.now() - started;
        const left = Math.max(0, 8000 - elapsed);
        setAnswerTimeLeftMs(left);
        if (left <= 0) {
          clearChallengeTimers();
          completeStageOutcome({
            correct: false,
            actor,
            earned: 0,
            stars: 0,
            message: isAr
              ? "انتهى وقت الإجابة بعد ضغط الباز!"
              : isSteal
                ? "Steal time ran out!"
                : "Answer time ran out!",
          });
        }
      }, 60);
    },
    [clearChallengeTimers, completeStageOutcome, isAr]
  );

  const startStageChallenge = useCallback(
    (stageIndex: number) => {
      // In Live Room host mode, clicking a stage jumps all students to that stage live!
      if (gameMode === "live_room") {
        if (liveRole === "host" && wsRef.current && liveRoom) {
          gameAudio.unlock();
          gameAudio.playStageSelect();
          setActiveStageIdx(stageIndex);
          wsRef.current.send(JSON.stringify({ type: "host:jump_stage", index: stageIndex }));
        }
        return;
      }

      const target = stages[stageIndex];
      if (!target) return;
      clearChallengeTimers();
      gameAudio.unlock();
      gameAudio.playStageSelect();

      setActiveStageIdx(stageIndex);
      setSubPhase("BUZZ_RACE");
      setBuzzedBy(null);
      setStealChance(false);
      setSelectedOption(null);
      setBotChosenOption(null);
      setStageResult(null);
      setBotChargePct(0);
      setAnswerTimeLeftMs(8000);
      setPhase("BUZZER_CHALLENGE");

      if (gameMode === "solo_bot") {
        const cfg = BOT_TIMING_MS[botDifficulty];
        const botDelay = cfg.min + Math.random() * (cfg.max - cfg.min);
        const startTime = Date.now();

        botIntervalRef.current = window.setInterval(() => {
          const pct = Math.min(100, Math.round(((Date.now() - startTime) / botDelay) * 100));
          setBotChargePct(pct);
        }, 50);

        botTimeoutRef.current = window.setTimeout(() => {
          clearChallengeTimers();
          gameAudio.playBotBuzz();
          setBuzzedBy("bot");
          setSubPhase("BOT_THINKING");
          setBotChargePct(100);

          window.setTimeout(() => {
            const botIsRight = Math.random() < cfg.accuracy;
            let botOpt = target.correctIndex;
            if (!botIsRight && target.options.length > 1) {
              const wrongIndices = target.options
                .map((_, i) => i)
                .filter((i) => i !== target.correctIndex);
              botOpt = wrongIndices[Math.floor(Math.random() * wrongIndices.length)];
            }
            setBotChosenOption(botOpt);

            if (botIsRight) {
              completeStageOutcome({
                correct: true,
                actor: "bot",
                earned: target.points,
                stars: 0,
                message: isAr
                  ? "الروبوت الذكي ضغط الباز أولاً وأجاب بشكل صحيح! فقدت قلباً واحداً."
                  : "AI Bot buzzed first and answered correctly! You lost 1 heart.",
              });
            } else {
              setStealChance(true);
              startAnswerCountdown("p1", true);
            }
          }, 950);
        }, botDelay);
      }
    },
    [botDifficulty, clearChallengeTimers, completeStageOutcome, gameMode, isAr, liveRole, liveRoom, stages, startAnswerCountdown]
  );

  const handleBuzzerPress = useCallback(
    (player: 1 | 2) => {
      if (phase !== "BUZZER_CHALLENGE" || subPhase !== "BUZZ_RACE") return;
      if (gameMode === "solo_bot" && player !== 1) return;

      clearChallengeTimers();
      setBuzzerRipple((r) => r + 1);
      gameAudio.playBuzzerSlam(player);
      startAnswerCountdown(player === 1 ? "p1" : "p2", false);
    },
    [clearChallengeTimers, gameMode, phase, startAnswerCountdown, subPhase]
  );

  const handleSelectAnswer = useCallback(
    (optionIdx: number) => {
      if (phase !== "BUZZER_CHALLENGE" || subPhase !== "ANSWERING" || !currentStage || !buzzedBy || buzzedBy === "bot") {
        return;
      }
      clearChallengeTimers();
      setSelectedOption(optionIdx);

      const isCorrect = optionIdx === currentStage.correctIndex;
      const responseMs = Math.max(200, Date.now() - buzzTimestampRef.current);
      const speedBonus = isCorrect ? Math.max(0, Math.round((8000 - responseMs) / 25)) : 0;
      const streakMult = buzzedBy === "p1" ? 1 + Math.min(streak, 4) * 0.1 : 1;
      const earned = isCorrect ? Math.round((currentStage.points + speedBonus) * streakMult) : 0;
      const stars = !isCorrect ? 0 : responseMs < 2600 ? 3 : responseMs < 5200 ? 2 : 1;

      completeStageOutcome({
        correct: isCorrect,
        actor: buzzedBy,
        earned,
        stars,
        message: isCorrect
          ? stealChance
            ? isAr
              ? `خطف رائع! أجبت بشكل صحيح وحصدت +${earned} نقطة!`
              : `Clutch steal! Correct answer for +${earned} pts!`
            : isAr
              ? `إجابة صحيحة سريعة! كسبت ${stars} نجوم و+${earned} نقطة!`
              : `Fast correct answer! Earned ${stars} stars & +${earned} pts!`
          : isAr
            ? "إجابة غير صحيحة! راجع التفسير العلمي ثم أعد المحاولة."
            : "Incorrect answer! Review the explanation and try again.",
      });
    },
    [buzzedBy, clearChallengeTimers, completeStageOutcome, currentStage, isAr, phase, stealChance, streak, subPhase]
  );

  const handleContinueAfterResult = useCallback(() => {
    if (phase !== "BUZZER_CHALLENGE" || subPhase !== "STAGE_RESULT") return;

    if (gameMode === "solo_bot" && hearts <= 0) {
      gameAudio.playWrongBuzz();
      setPhase("GAME_OVER");
      return;
    }

    const allStagesDone = stages.every((_, i) => progressByStage[i]?.completed);
    const bossDone = activeStageIdx === stages.length - 1 && progressByStage[activeStageIdx]?.completed;

    if (allStagesDone || bossDone) {
      gameAudio.playVictoryFanfare();
      setPhase("VICTORY");
      return;
    }

    gameAudio.playStageSelect();
    setPhase("STAGE_MAP");
  }, [activeStageIdx, gameMode, hearts, phase, progressByStage, stages, subPhase]);

  // Global keyboard handler
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        return;
      }

      if (e.code === "Escape") {
        e.preventDefault();
        if (questionsModalOpen) {
          setQuestionsModalOpen(false);
          return;
        }
        if (qrInviteModalOpen) {
          setQrInviteModalOpen(false);
          return;
        }
        if (phase === "STAGE_MAP" || phase === "BUZZER_CHALLENGE") {
          clearChallengeTimers();
          setPausedFrom(phase);
          setPhase("PAUSED");
        } else if (phase === "PAUSED") {
          if (pausedFrom === "BUZZER_CHALLENGE") {
            startStageChallenge(activeStageIdx);
          } else {
            setPhase("STAGE_MAP");
          }
        }
        return;
      }

      if (phase === "TITLE_MENU" && !questionsModalOpen) {
        if (e.code === "Enter" || e.code === "Space") {
          e.preventDefault();
          handleStartCampaign();
        }
        return;
      }

      if (phase === "STAGE_MAP" && !questionsModalOpen && gameMode !== "live_room") {
        if (e.code === "Enter" || e.code === "Space") {
          e.preventDefault();
          const nextPlayable =
            stages.findIndex((_, i) => progressByStage[i]?.unlocked && !progressByStage[i]?.completed);
          const idx = nextPlayable >= 0 ? nextPlayable : Math.max(0, stages.length - 1);
          startStageChallenge(idx);
        }
        return;
      }

      if (phase === "BUZZER_CHALLENGE") {
        if (subPhase === "BUZZ_RACE") {
          if (gameMode === "solo_bot" && e.code === "Space") {
            e.preventDefault();
            handleBuzzerPress(1);
          } else if (gameMode === "duel_2p") {
            if (e.code === "KeyA") {
              e.preventDefault();
              handleBuzzerPress(1);
            } else if (e.code === "KeyL") {
              e.preventDefault();
              handleBuzzerPress(2);
            }
          }
        } else if (subPhase === "ANSWERING") {
          const digitMap: Record<string, number> = {
            Digit1: 0,
            Digit2: 1,
            Digit3: 2,
            Digit4: 3,
            Numpad1: 0,
            Numpad2: 1,
            Numpad3: 2,
            Numpad4: 3,
          };
          if (e.code in digitMap) {
            e.preventDefault();
            const optIdx = digitMap[e.code];
            if (currentStage && optIdx < currentStage.options.length) {
              handleSelectAnswer(optIdx);
            }
          }
        } else if (subPhase === "STAGE_RESULT") {
          if (e.code === "Enter" || e.code === "Space") {
            e.preventDefault();
            handleContinueAfterResult();
          }
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    gameAudio.setMuted(next);
  };

  const toggleMusic = () => {
    gameAudio.unlock();
    const next = !musicOn;
    setMusicOn(next);
    const preferred = phase === "BUZZER_CHALLENGE" || liveRoom?.status === "question" ? "challenge" : "map";
    gameAudio.setMusicEnabled(next, preferred);
  };

  const totalStarsEarned = useMemo(
    () => Object.values(progressByStage).reduce((acc, p) => acc + (p.stars || 0), 0),
    [progressByStage]
  );
  const completedCount = useMemo(
    () => Object.values(progressByStage).filter((p) => p.completed).length,
    [progressByStage]
  );
  const currentActiveNodeIdx = useMemo(() => {
    if (gameMode === "live_room" && liveRoom) {
      return Math.min(liveRoom.currentQuestionIndex, Math.max(0, stages.length - 1));
    }
    const firstOpen = stages.findIndex((_, i) => progressByStage[i]?.unlocked && !progressByStage[i]?.completed);
    return firstOpen >= 0 ? firstOpen : Math.max(0, stages.length - 1);
  }, [gameMode, liveRoom, progressByStage, stages]);

  const liveJoinUrl = liveRoom ? `${window.location.origin}?mapjoin=${liveRoom.roomCode}` : "";
  const ExitArrow = isAr ? ArrowRight : ArrowLeft;
  const OPTION_COLORS = ["#0284C7", "#059669", "#D97706", "#DC2626"];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isAr ? "خريطة المراحل والباز" : "Science Quest Stages & Buzz Map"}
      className="fixed inset-0 z-50 flex flex-col overflow-hidden select-none"
      style={{ backgroundColor: "#0e2922", color: "#122620" }}
    >
      {/* Full-Viewport Illustrated World Backdrop */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {!imgFailed ? (
          <motion.img
            src={BACKDROP_URL}
            alt={isAr ? "خريطة جزر ومراحل مسابقة العلوم" : "Science Quest Adventure Map"}
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            animate={
              settings.reduceMotion
                ? undefined
                : {
                    scale: phase === "TITLE_MENU" ? [1.0, 1.04, 1.0] : 1.02,
                  }
            }
            transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
            className="w-full h-full object-cover"
          />
        ) : (
          <div
            className="w-full h-full"
            style={{
              background: "radial-gradient(circle at 22% 20%, #d9ede2 0%, #98c9b0 42%, #3a6b59 100%)",
            }}
          />
        )}
        <div
          className="absolute inset-0"
          style={{
            background:
              phase === "TITLE_MENU"
                ? "linear-gradient(180deg, rgba(246,244,237,0.74) 0%, rgba(246,244,237,0.22) 40%, rgba(13,44,36,0.62) 100%)"
                : phase === "STAGE_MAP"
                  ? "linear-gradient(180deg, rgba(16,47,39,0.36) 0%, rgba(16,47,39,0.08) 35%, rgba(16,47,39,0.34) 100%)"
                  : "rgba(11, 32, 26, 0.74)",
          }}
        />
      </div>

      {/* ==================== PERIMETER HUD ==================== */}
      {phase !== "TITLE_MENU" && (
        <header className="relative z-20 px-4 md:px-6 pt-3 pb-2 flex flex-wrap items-center justify-between gap-2.5 pointer-events-none">
          {/* Left Cluster: Player Status OR Live Room PIN */}
          <div
            className="pointer-events-auto flex flex-wrap items-center gap-3 px-4 py-2 rounded-2xl border shadow-sm"
            style={{
              backgroundColor: "rgba(252, 249, 242, 0.96)",
              borderColor: "#cbd9cf",
              color: "#153229",
            }}
          >
            {gameMode === "live_room" && liveRoom ? (
              <>
                <div className="flex items-center gap-2">
                  <QrCode className="w-4 h-4 text-[#0F766E]" />
                  <div className="text-xs leading-tight">
                    <div className="opacity-70">{isAr ? "كود المسابقة" : "Room Code"}</div>
                    <div className="font-mono-num text-sm font-extrabold tracking-widest text-[#0F766E]">
                      {liveRoom.roomCode}
                    </div>
                  </div>
                </div>
                <span aria-hidden="true" className="opacity-35">·</span>
                <div className="flex items-center gap-1.5 text-xs font-bold tabular-nums">
                  <Users className="w-4 h-4 text-[#0F766E]" />
                  <span>{liveRoom.leaderboard.length}</span>
                </div>
                <span aria-hidden="true" className="opacity-35">·</span>
                <button
                  type="button"
                  onClick={() => setQrInviteModalOpen(true)}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1 whitespace-nowrap"
                  style={{ backgroundColor: "#e6f4ee", color: "#0F766E" }}
                >
                  <QrCode className="w-3.5 h-3.5" />
                  <span>{isAr ? "عرض الكود والباركود" : "Show Code & QR"}</span>
                </button>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <CartoonAvatar avatarId={p1Avatar} size="sm" />
                  <div className="text-xs leading-tight">
                    <div className="font-bold truncate max-w-[110px]">{p1Name}</div>
                    <div className="font-mono-num font-bold tabular-nums text-[#0F766E]">
                      {p1Score.toLocaleString()} {isAr ? "نقطة" : "pts"}
                    </div>
                  </div>
                </div>

                {gameMode === "solo_bot" ? (
                  <>
                    <span aria-hidden="true" className="opacity-35">·</span>
                    <div className="flex items-center gap-1" aria-label={isAr ? `القلوب: ${hearts}` : `Hearts: ${hearts}`}>
                      {[0, 1, 2].map((i) => (
                        <Heart
                          key={i}
                          className={`w-4 h-4 ${i < hearts ? "text-rose-600 fill-rose-600" : "text-slate-300"}`}
                        />
                      ))}
                    </div>
                    <span aria-hidden="true" className="opacity-35">·</span>
                    <div className="flex items-center gap-1 text-xs font-bold tabular-nums text-amber-700">
                      <Flame className="w-4 h-4 text-amber-600" />
                      <span>×{streak}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="text-xs font-bold opacity-45">VS</span>
                    <div className="flex items-center gap-2">
                      <CartoonAvatar avatarId={p2Avatar} size="sm" />
                      <div className="text-xs leading-tight">
                        <div className="font-bold truncate max-w-[110px]">{p2Name}</div>
                        <div className="font-mono-num font-bold tabular-nums text-[#B45309]">
                          {p2Score.toLocaleString()} {isAr ? "نقطة" : "pts"}
                        </div>
                      </div>
                    </div>
                  </>
                )}

                <span aria-hidden="true" className="opacity-35">·</span>
                <div className="flex items-center gap-1 text-xs font-bold tabular-nums">
                  <Star className="w-4 h-4 text-amber-500 fill-amber-400" />
                  <span>
                    {totalStarsEarned} / {stages.length * 3}
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Right Cluster: Questions Drawer, Room QR Invite, Challenge Music, Mute, Pause, Exit */}
          <div className="pointer-events-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setQuestionsModalOpen(true)}
              className="min-h-[40px] px-3.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shadow-sm"
              style={{
                backgroundColor: "rgba(252, 249, 242, 0.96)",
                borderColor: "#cbd9cf",
                color: "#153229",
              }}
            >
              <ListChecks className="w-4 h-4 text-[#0F766E]" />
              <span>{isAr ? `الأسئلة (${stages.length})` : `Questions (${stages.length})`}</span>
            </button>

            {gameMode !== "live_room" && (
              <button
                type="button"
                onClick={() => handleHostCreateLiveRoom(stages)}
                className="min-h-[40px] px-3.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shadow-sm"
                style={{
                  backgroundColor: "#f59e0b",
                  borderColor: "#d97706",
                  color: "#153229",
                }}
              >
                <QrCode className="w-4 h-4" />
                <span>{isAr ? "غرفة بكود وباركود" : "Live Code & QR"}</span>
              </button>
            )}

            <button
              type="button"
              onClick={toggleMusic}
              className="min-h-[40px] px-3 rounded-xl border text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shadow-sm"
              style={{
                backgroundColor: musicOn && !muted ? "#0F766E" : "rgba(252, 249, 242, 0.96)",
                borderColor: musicOn && !muted ? "#0F766E" : "#cbd9cf",
                color: musicOn && !muted ? "#ffffff" : "#153229",
              }}
            >
              <Music className="w-4 h-4" />
              <span>{musicOn && !muted ? (isAr ? "موسيقى التحدي" : "Music On") : isAr ? "تشغيل الموسيقى" : "Music Off"}</span>
            </button>

            <button
              type="button"
              onClick={toggleMute}
              aria-label={muted ? (isAr ? "تشغيل الصوت" : "Unmute") : (isAr ? "كتم الصوت" : "Mute")}
              className="min-h-[40px] min-w-[40px] px-3 rounded-xl border flex items-center justify-center shadow-sm"
              style={{
                backgroundColor: "rgba(252, 249, 242, 0.96)",
                borderColor: "#cbd9cf",
                color: "#153229",
              }}
            >
              {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>

            {(phase === "STAGE_MAP" || phase === "BUZZER_CHALLENGE") && (
              <button
                type="button"
                onClick={() => {
                  clearChallengeTimers();
                  setPausedFrom(phase);
                  setPhase("PAUSED");
                }}
                className="min-h-[40px] px-3.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shadow-sm"
                style={{
                  backgroundColor: "rgba(252, 249, 242, 0.96)",
                  borderColor: "#cbd9cf",
                  color: "#153229",
                }}
              >
                <Pause className="w-3.5 h-3.5" />
                <span>{isAr ? "إيقاف مؤقت" : "Pause"}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                clearChallengeTimers();
                gameAudio.stopMusic();
                onClose();
              }}
              className="min-h-[40px] px-3.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shadow-sm"
              style={{
                backgroundColor: "#164e3f",
                borderColor: "#0f3a2e",
                color: "#fcf9f2",
              }}
            >
              <ExitArrow className="w-3.5 h-3.5" />
              <span>{isAr ? "العودة للمنصة" : "Exit"}</span>
            </button>
          </div>
        </header>
      )}

      {/* ==================== 1. TITLE SCREEN ==================== */}
      {phase === "TITLE_MENU" && (
        <div className="relative z-10 flex-1 flex flex-col justify-between p-4 md:p-6 max-w-6xl w-full mx-auto overflow-y-auto">
          {/* Top Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                gameAudio.stopMusic();
                onClose();
              }}
              className="min-h-[40px] px-4 py-2 rounded-xl border text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shadow-sm"
              style={{
                backgroundColor: "rgba(252, 249, 242, 0.95)",
                borderColor: "#cbd9cf",
                color: "#153229",
              }}
            >
              <ExitArrow className="w-4 h-4" />
              <span>{isAr ? "العودة إلى المنصة" : "Back to Platform"}</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setQuestionsModalOpen(true)}
                className="min-h-[40px] px-3.5 py-2 rounded-xl border text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shadow-sm"
                style={{
                  backgroundColor: "rgba(252, 249, 242, 0.95)",
                  borderColor: "#cbd9cf",
                  color: "#0F766E",
                }}
              >
                <ListChecks className="w-4 h-4" />
                <span>{isAr ? `استعراض أسئلة المراحل (${stages.length})` : `View Stages Questions (${stages.length})`}</span>
              </button>

              <button
                type="button"
                onClick={toggleMusic}
                className="min-h-[40px] px-3 rounded-xl border text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shadow-sm"
                style={{
                  backgroundColor: musicOn ? "#0F766E" : "rgba(252, 249, 242, 0.95)",
                  borderColor: musicOn ? "#0F766E" : "#cbd9cf",
                  color: musicOn ? "#ffffff" : "#153229",
                }}
              >
                <Music className="w-4 h-4" />
                <span>{musicOn ? (isAr ? "موسيقى التحدي: مفعّلة" : "Music: On") : isAr ? "موسيقى التحدي: متوقفة" : "Music: Off"}</span>
              </button>

              <button
                type="button"
                onClick={toggleMute}
                aria-label={muted ? "Unmute" : "Mute"}
                className="min-h-[40px] min-w-[40px] px-3 rounded-xl border flex items-center justify-center shadow-sm"
                style={{
                  backgroundColor: "rgba(252, 249, 242, 0.95)",
                  borderColor: "#cbd9cf",
                  color: "#153229",
                }}
              >
                {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Title Lockup over Upper Sky Negative Space */}
          <div className="flex flex-col items-center text-center space-y-1.5 my-auto py-2">
            <svg viewBox="0 0 180 60" className="w-40 h-14 drop-shadow-sm" aria-hidden="true">
              <path
                d="M16 44 Q 52 12, 90 34 T 164 18"
                fill="none"
                stroke="#0F766E"
                strokeWidth="4"
                strokeDasharray="7 6"
                strokeLinecap="round"
              />
              <ellipse cx="90" cy="40" rx="28" ry="10" fill="#163c32" />
              <path d="M68 36 C68 16, 112 16, 112 36 Z" fill="#dc2626" />
              <ellipse cx="84" cy="25" rx="9" ry="4" fill="#fca5a5" opacity="0.65" />
              <circle cx="16" cy="44" r="6" fill="#0F766E" stroke="#fcf9f2" strokeWidth="2.5" />
              <circle cx="164" cy="18" r="7" fill="#f59e0b" stroke="#fcf9f2" strokeWidth="2.5" />
            </svg>

            <h1
              className="font-display font-bold tracking-tight"
              style={{
                fontSize: "clamp(1.75rem, 3.4vw, 2.85rem)",
                color: "#0e2922",
                textWrap: "balance",
              }}
            >
              {isAr ? "خريطة المراحل والباز" : "Science Quest Stages & Buzz Map"}
            </h1>

            <div className="flex flex-wrap items-center justify-center gap-2 text-xs md:text-sm font-semibold" style={{ color: "#1b4338" }}>
              <span>{lesson.subject}</span>
              <span aria-hidden="true">·</span>
              <span>{lesson.title}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-num">
                {stages.length} {isAr ? "مراحل وأسئلة جاهزة" : "stages ready"}
              </span>
            </div>
          </div>

          {/* Setup Card */}
          <div
            className="rounded-3xl border p-5 md:p-6 shadow-xl space-y-4 max-w-4xl w-full mx-auto"
            style={{
              backgroundColor: "rgba(252, 249, 242, 0.97)",
              borderColor: "#cbd9cf",
              color: "#153229",
            }}
          >
            {/* 3 Game Modes: Solo vs Bot / 2P Duel / Live Classroom Code & QR */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div
                className="flex flex-wrap items-center gap-1 p-1 rounded-xl border"
                style={{ backgroundColor: "#edf3ee", borderColor: "#cbd9cf" }}
              >
                <button
                  type="button"
                  onClick={() => setGameMode("solo_bot")}
                  className="min-h-[40px] px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 whitespace-nowrap"
                  style={{
                    backgroundColor: gameMode === "solo_bot" ? "#0F766E" : "transparent",
                    color: gameMode === "solo_bot" ? "#ffffff" : "#27473d",
                  }}
                >
                  <Zap className="w-4 h-4" />
                  <span>{isAr ? "فردي ضد الروبوت" : "Solo vs Bot"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setGameMode("duel_2p")}
                  className="min-h-[40px] px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 whitespace-nowrap"
                  style={{
                    backgroundColor: gameMode === "duel_2p" ? "#0F766E" : "transparent",
                    color: gameMode === "duel_2p" ? "#ffffff" : "#27473d",
                  }}
                >
                  <Users className="w-4 h-4" />
                  <span>{isAr ? "تحدي لاعبين (نفس الشاشة)" : "2-Player Duel"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setGameMode("live_room")}
                  className="min-h-[40px] px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 whitespace-nowrap"
                  style={{
                    backgroundColor: gameMode === "live_room" ? "#d97706" : "transparent",
                    color: gameMode === "live_room" ? "#ffffff" : "#27473d",
                  }}
                >
                  <QrCode className="w-4 h-4" />
                  <span>{isAr ? "غرفة مسابقة (كود + باركود)" : "Live Room (Code + QR)"}</span>
                </button>
              </div>

              {gameMode === "solo_bot" && (
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="font-bold opacity-75">{isAr ? "سرعة المنافس:" : "Bot Speed:"}</span>
                  {(["calm", "balanced", "fast"] as BotDifficulty[]).map((spd) => (
                    <button
                      key={spd}
                      type="button"
                      onClick={() => setBotDifficulty(spd)}
                      className="min-h-[34px] px-3 py-1 rounded-lg border font-bold whitespace-nowrap"
                      style={{
                        backgroundColor: botDifficulty === spd ? "#0F766E" : "#ffffff",
                        borderColor: botDifficulty === spd ? "#0F766E" : "#cbd9cf",
                        color: botDifficulty === spd ? "#ffffff" : "#153229",
                      }}
                    >
                      {spd === "calm" ? (isAr ? "هادئ" : "Calm") : spd === "balanced" ? (isAr ? "متوازن" : "Balanced") : isAr ? "سريع" : "Fast"}
                    </button>
                  ))}
                </div>
              )}

              {gameMode === "live_room" && (
                <div className="flex items-center gap-1.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setLiveRole("host")}
                    className="min-h-[34px] px-3 py-1 rounded-lg border font-bold whitespace-nowrap"
                    style={{
                      backgroundColor: liveRole === "host" ? "#0F766E" : "#ffffff",
                      borderColor: liveRole === "host" ? "#0F766E" : "#cbd9cf",
                      color: liveRole === "host" ? "#ffffff" : "#153229",
                    }}
                  >
                    {isAr ? "المعلم (إنشاء كود وباركود)" : "Teacher Host (Create QR)"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setLiveRole("student")}
                    className="min-h-[34px] px-3 py-1 rounded-lg border font-bold whitespace-nowrap"
                    style={{
                      backgroundColor: liveRole === "student" ? "#0F766E" : "#ffffff",
                      borderColor: liveRole === "student" ? "#0F766E" : "#cbd9cf",
                      color: liveRole === "student" ? "#ffffff" : "#153229",
                    }}
                  >
                    {isAr ? "طالب (انضمام بالكود)" : "Student (Join with Code)"}
                  </button>
                </div>
              )}
            </div>

            {/* Live Room Student Join PIN Input OR Player Avatar Setup */}
            {gameMode === "live_room" && liveRole === "student" ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-2xl border" style={{ backgroundColor: "#ffffff", borderColor: "#d5e2d9" }}>
                <div className="space-y-2">
                  <label className="block text-xs font-bold">{isAr ? "رمز الدخول للمسابقة (Code)" : "Competition Room Code"}</label>
                  <input
                    type="text"
                    value={liveJoinCodeInput}
                    onChange={(e) => setLiveJoinCodeInput(e.target.value.toUpperCase())}
                    placeholder={isAr ? "مثال: A7K9M2" : "e.g. A7K9M2"}
                    maxLength={8}
                    className="w-full min-h-[44px] px-4 rounded-xl border font-mono-num text-base font-extrabold tracking-widest uppercase"
                    style={{ backgroundColor: "#f7faf8", borderColor: "#0F766E", color: "#153229" }}
                  />
                  <label className="block text-xs font-bold pt-1">{isAr ? "اسمك الكامل" : "Your Name"}</label>
                  <input
                    type="text"
                    value={p1Name}
                    onChange={(e) => setP1Name(e.target.value)}
                    placeholder={isAr ? "أدخل اسمك هنا" : "Enter your name"}
                    className="w-full min-h-[42px] px-3 rounded-xl border text-xs font-bold"
                    style={{ backgroundColor: "#f7faf8", borderColor: "#d5e2d9", color: "#153229" }}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs font-bold">
                    <CartoonAvatar avatarId={p1Avatar} size="sm" />
                    <span>{isAr ? "اختر شخصيتك الكرتونية:" : "Choose Your Cartoon Avatar:"}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {CARTOON_AVATARS.map((av) => {
                      const sel = p1Avatar === av.id;
                      return (
                        <button
                          key={av.id}
                          type="button"
                          onClick={() => setP1Avatar(av.id)}
                          aria-label={isAr ? av.nameAr : av.nameEn}
                          className="p-1.5 rounded-xl border transition-transform"
                          style={{
                            borderColor: sel ? "#0F766E" : "#e2ece5",
                            backgroundColor: sel ? "#e6f4ee" : "#ffffff",
                            transform: sel ? "scale(1.06)" : "scale(1)",
                          }}
                        >
                          <CartoonAvatar avatarId={av.id} size="xs" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : gameMode === "live_room" && liveRole === "host" ? (
              <div className="p-4 rounded-2xl border flex flex-wrap items-center justify-between gap-4" style={{ backgroundColor: "#ffffff", borderColor: "#d5e2d9" }}>
                <div className="space-y-1">
                  <div className="text-sm font-bold text-[#0F766E]">
                    {isAr ? "تشغيل غرفة مسابقة صفية مباشرة بالخريطة والباز" : "Launch Live Classroom Map & Buzz Room"}
                  </div>
                  <p className="text-xs opacity-80">
                    {isAr
                      ? `سيتم إنشاء كود دخول وباركود QR فوري لـ ${stages.length} مراحل من الدرس لتنضم الطالبات من أجهزتهن.`
                      : `Creates an instant room PIN + QR barcode for ${stages.length} lesson stages so students join from their devices.`}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-xl" style={{ backgroundColor: "#e6f4ee", color: "#0F766E" }}>
                  <QrCode className="w-5 h-5" />
                  <span>{isAr ? "كود + باركود جاهز" : "PIN + QR Ready"}</span>
                </div>
              </div>
            ) : (
              /* Solo / 2-Player Name & Cartoon Avatar Pickers */
              <div className={`grid grid-cols-1 ${gameMode === "duel_2p" ? "md:grid-cols-2" : ""} gap-4`}>
                <div className="p-3.5 rounded-2xl border space-y-2.5" style={{ backgroundColor: "#ffffff", borderColor: "#d5e2d9" }}>
                  <div className="flex items-center gap-2.5">
                    <CartoonAvatar avatarId={p1Avatar} size="sm" />
                    <input
                      type="text"
                      value={p1Name}
                      onChange={(e) => setP1Name(e.target.value)}
                      placeholder={isAr ? "اسم اللاعب الأول" : "Player 1 Name"}
                      className="flex-1 min-h-[38px] px-3 rounded-lg border text-xs font-bold"
                      style={{ backgroundColor: "#f7faf8", borderColor: "#d5e2d9", color: "#153229" }}
                    />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {CARTOON_AVATARS.map((av) => {
                      const sel = p1Avatar === av.id;
                      return (
                        <button
                          key={av.id}
                          type="button"
                          onClick={() => setP1Avatar(av.id)}
                          aria-label={isAr ? av.nameAr : av.nameEn}
                          className="p-1 rounded-lg border transition-transform"
                          style={{
                            borderColor: sel ? "#0F766E" : "transparent",
                            backgroundColor: sel ? "#e6f4ee" : "transparent",
                            transform: sel ? "scale(1.08)" : "scale(1)",
                          }}
                        >
                          <CartoonAvatar avatarId={av.id} size="xs" />
                        </button>
                      );
                    })}
                  </div>
                </div>

                {gameMode === "duel_2p" && (
                  <div className="p-3.5 rounded-2xl border space-y-2.5" style={{ backgroundColor: "#ffffff", borderColor: "#d5e2d9" }}>
                    <div className="flex items-center gap-2.5">
                      <CartoonAvatar avatarId={p2Avatar} size="sm" />
                      <input
                        type="text"
                        value={p2Name}
                        onChange={(e) => setP2Name(e.target.value)}
                        placeholder={isAr ? "اسم اللاعب الثاني" : "Player 2 Name"}
                        className="flex-1 min-h-[38px] px-3 rounded-lg border text-xs font-bold"
                        style={{ backgroundColor: "#f7faf8", borderColor: "#d5e2d9", color: "#153229" }}
                      />
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {CARTOON_AVATARS.map((av) => {
                        const sel = p2Avatar === av.id;
                        return (
                          <button
                            key={av.id}
                            type="button"
                            onClick={() => setP2Avatar(av.id)}
                            aria-label={isAr ? av.nameAr : av.nameEn}
                            className="p-1 rounded-lg border transition-transform"
                            style={{
                              borderColor: sel ? "#D97706" : "transparent",
                              backgroundColor: sel ? "#fef3c7" : "transparent",
                              transform: sel ? "scale(1.08)" : "scale(1)",
                            }}
                          >
                            <CartoonAvatar avatarId={av.id} size="xs" />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {genStatus && <p className="text-xs font-semibold text-emerald-800">{genStatus}</p>}
            {genError && <p className="text-xs font-semibold text-rose-700" role="alert">{genError}</p>}
            {liveError && <p className="text-xs font-semibold text-rose-700" role="alert">{liveError}</p>}

            {/* Actions */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleGenerateAiStages}
                  disabled={generatingStages}
                  className="min-h-[46px] px-4 py-2.5 rounded-xl border text-xs font-bold flex items-center gap-2 whitespace-nowrap disabled:opacity-60"
                  style={{ backgroundColor: "#ffffff", borderColor: "#0F766E", color: "#0F766E" }}
                >
                  {generatingStages ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  <span>
                    {generatingStages
                      ? isAr
                        ? "جارٍ توليد مراحل الدرس..."
                        : "Generating 6 Stages..."
                      : isAr
                        ? "توليد 6 مراحل جديدة من الدرس (AI)"
                        : "Generate 6 Lesson Stages (AI)"}
                  </span>
                </button>
              </div>

              <button
                type="button"
                onClick={handleStartCampaign}
                disabled={stages.length === 0}
                className="min-h-[48px] px-8 py-3 rounded-xl text-sm md:text-base font-bold flex items-center gap-2 whitespace-nowrap shadow-md"
                style={{ backgroundColor: gameMode === "live_room" ? "#d97706" : "#0F766E", color: "#ffffff" }}
              >
                {gameMode === "live_room" ? <QrCode className="w-5 h-5" /> : <Play className="w-5 h-5 fill-current" />}
                <span>
                  {gameMode === "live_room"
                    ? liveRole === "host"
                      ? isAr
                        ? "إنشاء غرفة بالكود والباركود"
                        : "Create Room with Code & QR"
                      : isAr
                        ? "دخول المسابقة الآن"
                        : "Join Live Competition"
                    : isAr
                      ? "ابدأ خريطة المراحل"
                      : "Start Quest Map"}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== 2. INTERACTIVE WINDING STAGE MAP ==================== */}
      {phase === "STAGE_MAP" && (
        <main className="relative z-10 flex-1 overflow-hidden flex flex-col justify-between p-4 md:p-6">
          {/* LIVE ROOM HOST / STUDENT DOCK OVERLAY ON MAP WHEN IN LIVE MODE */}
          {gameMode === "live_room" && liveRoom ? (
            <div className="relative z-20 flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 max-w-7xl w-full mx-auto overflow-y-auto">
              {/* Left 7 Cols: Live Winding Map + Active Stage Prompt */}
              <div className="lg:col-span-7 flex flex-col gap-3">
                {/* Interactive Mini-Map Canvas */}
                <div className="relative flex-1 min-h-[290px] rounded-3xl border overflow-hidden shadow-lg" style={{ backgroundColor: "rgba(15, 45, 36, 0.45)", borderColor: "rgba(255,255,255,0.28)" }}>
                  <svg viewBox="0 0 1000 600" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
                    {stages.slice(0, -1).map((st, idx) => {
                      const a = MAP_NODE_COORDS[idx] || MAP_NODE_COORDS[0];
                      const b = MAP_NODE_COORDS[idx + 1] || MAP_NODE_COORDS[MAP_NODE_COORDS.length - 1];
                      const unlocked = idx < liveRoom.currentQuestionIndex;
                      const x1 = a.x * 10;
                      const y1 = a.y * 6;
                      const x2 = b.x * 10;
                      const y2 = b.y * 6;
                      const cx = (x1 + x2) / 2;
                      const cy = (y1 + y2) / 2 - 48;
                      return (
                        <path
                          key={`live-trail-${st.id}`}
                          d={`M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`}
                          fill="none"
                          stroke={unlocked ? "#fbbf24" : "rgba(255,255,255,0.6)"}
                          strokeWidth={7}
                          strokeDasharray={unlocked ? undefined : "12 10"}
                          strokeLinecap="round"
                        />
                      );
                    })}
                  </svg>

                  {stages.map((st, idx) => {
                    const coord = MAP_NODE_COORDS[idx] || MAP_NODE_COORDS[MAP_NODE_COORDS.length - 1];
                    const isCurrent = idx === liveRoom.currentQuestionIndex;
                    const isCleared = idx < liveRoom.currentQuestionIndex || liveRoom.status === "finished";
                    return (
                      <div
                        key={`live-node-${st.id}`}
                        className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1"
                        style={{ left: `${coord.x}%`, top: `${coord.y}%` }}
                      >
                        <button
                          type="button"
                          disabled={liveRole !== "host"}
                          onClick={() => startStageChallenge(idx)}
                          className="w-14 h-14 md:w-16 md:h-16 rounded-full border-4 flex flex-col items-center justify-center shadow-lg transition-transform hover:scale-105"
                          style={{
                            backgroundColor: isCurrent ? "#f59e0b" : isCleared ? "#10b981" : "#0F766E",
                            borderColor: isCurrent ? "#ffffff" : "#fcf9f2",
                            color: isCurrent ? "#153229" : "#ffffff",
                          }}
                        >
                          <span className="font-mono-num text-xs font-extrabold">{String(idx + 1).padStart(2, "0")}</span>
                        </button>
                        <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold whitespace-nowrap shadow-sm" style={{ backgroundColor: "rgba(252,249,242,0.94)", color: "#153229" }}>
                          {isAr ? st.titleAr : st.titleEn}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Live Question + Buzzer Arena Card */}
                <div className="rounded-3xl border p-5 space-y-4 shadow-xl" style={{ backgroundColor: "#fcf9f2", borderColor: "#cbd9cf", color: "#153229" }}>
                  {liveRoom.status === "lobby" && (
                    <div className="text-center space-y-3 py-2">
                      <h3 className="text-lg font-bold">
                        {liveRole === "host"
                          ? isAr
                            ? "غرفة المسابقة جاهزة! اعرض الكود أو الباركود للطلاب ثم ابدأ المرحلة 1"
                            : "Live Room Ready! Share Code/QR then start Stage 1"
                          : isAr
                            ? "تم الانضمام! بانتظار المعلم لبدء المرحلة الأولى..."
                            : "Joined! Waiting for teacher to launch Stage 1..."}
                      </h3>
                      {liveRole === "host" && (
                        <button
                          type="button"
                          onClick={() => {
                            gameAudio.unlock();
                            wsRef.current?.send(JSON.stringify({ type: "host:start" }));
                          }}
                          className="min-h-[46px] px-6 py-2.5 rounded-xl text-sm font-bold inline-flex items-center gap-2 shadow-md"
                          style={{ backgroundColor: "#0F766E", color: "#ffffff" }}
                        >
                          <Play className="w-4 h-4 fill-current" />
                          <span>{isAr ? "ابدأ المرحلة 1 الآن" : "Start Stage 1 Now"}</span>
                        </button>
                      )}
                    </div>
                  )}

                  {(liveRoom.status === "question" || liveRoom.status === "reveal") && liveRoom.question && (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold">
                        <span className="text-[#0F766E]">
                          {isAr
                            ? `المرحلة ${liveRoom.currentQuestionIndex + 1} من ${liveRoom.totalQuestions}`
                            : `Stage ${liveRoom.currentQuestionIndex + 1} / ${liveRoom.totalQuestions}`}
                        </span>
                        <span className="inline-flex items-center gap-1 font-mono-num text-sm text-rose-700">
                          <Clock className="w-4 h-4" />
                          <span>{liveTimeLeftSec}s</span>
                        </span>
                      </div>

                      <h3 className="text-lg md:text-xl font-bold leading-snug">{liveRoom.question.question}</h3>

                      {/* First Buzzer Slam Banner */}
                      {liveRoom.buzzerWinner && (
                        <div className="p-2.5 rounded-xl border flex items-center justify-between gap-2 text-xs font-bold" style={{ backgroundColor: "#fef3c7", borderColor: "#f59e0b" }}>
                          <div className="flex items-center gap-2">
                            <Zap className="w-4 h-4 text-amber-600 fill-current" />
                            <CartoonAvatar avatarId={liveRoom.buzzerWinner.avatarId} size="xs" />
                            <span>
                              {isAr
                                ? `أسرع باز: ${liveRoom.buzzerWinner.name}!`
                                : `Fastest Buzzer: ${liveRoom.buzzerWinner.name}!`}
                            </span>
                          </div>
                          {liveRole === "host" && (
                            <button
                              type="button"
                              onClick={() => wsRef.current?.send(JSON.stringify({ type: "host:clear_buzz" }))}
                              className="underline text-[11px]"
                            >
                              {isAr ? "تصفير الباز" : "Reset Buzz"}
                            </button>
                          )}
                        </div>
                      )}

                      {/* Student Buzzer + Choices */}
                      {liveRole === "student" && liveRoom.status === "question" && !liveRoom.buzzerWinner && (
                        <div className="flex justify-center py-1">
                          <button
                            type="button"
                            onClick={() => {
                              gameAudio.playBuzzerSlam(1);
                              wsRef.current?.send(JSON.stringify({ type: "student:buzz" }));
                            }}
                            className="px-7 py-3 rounded-full border-4 font-bold text-sm flex items-center gap-2 shadow-lg"
                            style={{ backgroundColor: "#dc2626", borderColor: "#153229", color: "#ffffff" }}
                          >
                            <Zap className="w-5 h-5 fill-current" />
                            <span>{isAr ? "اضغط الباز الآن!" : "SLAM BUZZER!"}</span>
                          </button>
                        </div>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {liveRoom.question.options.map((opt, idx) => {
                          const isCorr = liveRoom.status === "reveal" && idx === liveRoom.question?.correctIndex;
                          const picked = liveStudentAnswered === idx;
                          return (
                            <button
                              key={idx}
                              type="button"
                              disabled={liveRole === "host" || liveRoom.status !== "question" || liveStudentAnswered !== null}
                              onClick={() => {
                                setLiveStudentAnswered(idx);
                                wsRef.current?.send(JSON.stringify({ type: "student:answer", optionIndex: idx }));
                              }}
                              className="min-h-[48px] p-3 rounded-xl border-2 text-start text-xs md:text-sm font-bold flex items-center justify-between gap-2 disabled:opacity-90"
                              style={{
                                backgroundColor: isCorr ? "#ecfdf5" : picked ? "#e0f2fe" : "#ffffff",
                                borderColor: isCorr ? "#10b981" : picked ? "#0284C7" : OPTION_COLORS[idx % 4],
                              }}
                            >
                              <span>{opt}</span>
                              {isCorr && <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />}
                            </button>
                          );
                        })}
                      </div>

                      {liveRole === "student" && liveStudentFeedback && (
                        <div
                          className="p-2.5 rounded-xl text-xs font-bold text-center"
                          style={{
                            backgroundColor: liveStudentFeedback.correct ? "#ecfdf5" : "#fff1f2",
                            color: liveStudentFeedback.correct ? "#065f46" : "#9f1239",
                          }}
                        >
                          {liveStudentFeedback.correct
                            ? isAr
                              ? `إجابة صحيحة! +${liveStudentFeedback.earned} نقطة`
                              : `Correct! +${liveStudentFeedback.earned} pts`
                            : isAr
                              ? "إجابة خاطئة هذه المرة!"
                              : "Incorrect answer!"}
                        </div>
                      )}

                      {liveRoom.status === "reveal" && liveRoom.question.explanation && (
                        <p className="text-xs opacity-80">{liveRoom.question.explanation}</p>
                      )}

                      {liveRole === "host" && (
                        <div className="flex flex-wrap justify-end gap-2 pt-1">
                          {liveRoom.status === "question" ? (
                            <button
                              type="button"
                              onClick={() => wsRef.current?.send(JSON.stringify({ type: "host:reveal" }))}
                              className="min-h-[40px] px-4 py-1.5 rounded-xl border text-xs font-bold"
                              style={{ borderColor: "#0F766E", color: "#0F766E" }}
                            >
                              {isAr ? "كشف الإجابة الصحيحة" : "Reveal Answer"}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => wsRef.current?.send(JSON.stringify({ type: "host:next" }))}
                              className="min-h-[40px] px-5 py-1.5 rounded-xl text-xs font-bold"
                              style={{ backgroundColor: "#0F766E", color: "#ffffff" }}
                            >
                              {liveRoom.currentQuestionIndex + 1 < liveRoom.totalQuestions
                                ? isAr
                                  ? "الانتقال للمرحلة التالية"
                                  : "Next Stage"
                                : isAr
                                  ? "إنهاء وإعلان الفائزين"
                                  : "Finish & Show Winners"}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {liveRoom.status === "finished" && (
                    <div className="text-center space-y-3 py-2">
                      <Trophy className="w-10 h-10 mx-auto text-amber-500" />
                      <h3 className="text-lg font-bold">{isAr ? "انتهت مسابقة الخريطة المباشرة!" : "Live Stage Competition Finished!"}</h3>
                    </div>
                  )}
                </div>
              </div>

              {/* Right 5 Cols: Join Code + QR Barcode + Live Leaderboard */}
              <div className="lg:col-span-5 rounded-3xl border p-5 space-y-4 shadow-xl flex flex-col" style={{ backgroundColor: "rgba(252, 249, 242, 0.97)", borderColor: "#cbd9cf", color: "#153229" }}>
                <div className="flex flex-wrap items-center gap-4 border-b pb-4" style={{ borderColor: "#dbe6de" }}>
                  <QrCodeBox
                    value={liveJoinUrl}
                    size={124}
                    label={isAr ? "امسح الباركود للدخول" : "Scan QR to Enter"}
                  />
                  <div className="flex-1 min-w-[150px] space-y-1.5">
                    <div className="text-xs opacity-75">{isAr ? "كود دخول المسابقة" : "Competition Join Code"}</div>
                    <div className="font-mono-num text-3xl font-extrabold tracking-widest text-[#0F766E]">
                      {liveRoom.roomCode}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(liveJoinUrl);
                        setCopiedLiveLink(true);
                        setTimeout(() => setCopiedLiveLink(false), 2000);
                      }}
                      className="min-h-[36px] px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1.5"
                      style={{ backgroundColor: "#ffffff", borderColor: "#cbd9cf" }}
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>{copiedLiveLink ? (isAr ? "تم نسخ الرابط!" : "Copied!") : isAr ? "نسخ رابط الانضمام" : "Copy Join Link"}</span>
                    </button>
                  </div>
                </div>

                <div className="flex-1 space-y-2 overflow-y-auto">
                  <div className="flex items-center justify-between text-xs font-bold">
                    <span className="flex items-center gap-1.5">
                      <Users className="w-4 h-4 text-[#0F766E]" />
                      {isAr ? `المتسابقون المنضمون (${liveRoom.leaderboard.length})` : `Participants (${liveRoom.leaderboard.length})`}
                    </span>
                  </div>
                  {liveRoom.leaderboard.length === 0 ? (
                    <p className="text-xs opacity-75 py-4 text-center">
                      {isAr
                        ? "بانتظار دخول الطلاب عبر الكود أو مسح الباركود أعلاه..."
                        : "Waiting for students to join via code or QR barcode above..."}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {liveRoom.leaderboard.map((p, idx) => (
                        <div
                          key={p.id}
                          className="p-2.5 rounded-xl border flex items-center justify-between gap-2 text-xs"
                          style={{ backgroundColor: "#ffffff", borderColor: p.answeredCurrent ? "#10b981" : "#dbe6de" }}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-mono-num font-bold opacity-60">#{idx + 1}</span>
                            <CartoonAvatar avatarId={p.avatarId} seed={p.name} size="xs" />
                            <span className="font-bold truncate">{p.name}</span>
                          </div>
                          <span className="font-mono-num font-bold text-[#0F766E]">{p.score} pts</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* OFFLINE SOLO / 2P STAGE MAP WITH LIVE STAGE QUESTION PREVIEW */
            <>
              <div className="relative flex-1 w-full max-w-6xl mx-auto">
                <svg
                  viewBox="0 0 1000 600"
                  preserveAspectRatio="none"
                  className="absolute inset-0 w-full h-full pointer-events-none"
                >
                  {stages.slice(0, -1).map((st, idx) => {
                    const a = MAP_NODE_COORDS[idx] || MAP_NODE_COORDS[0];
                    const b = MAP_NODE_COORDS[idx + 1] || MAP_NODE_COORDS[MAP_NODE_COORDS.length - 1];
                    const nextUnlocked = Boolean(progressByStage[idx + 1]?.unlocked);
                    const x1 = a.x * 10;
                    const y1 = a.y * 6;
                    const x2 = b.x * 10;
                    const y2 = b.y * 6;
                    const cx = (x1 + x2) / 2;
                    const cy = (y1 + y2) / 2 - 48;
                    return (
                      <path
                        key={`trail-${st.id}`}
                        d={`M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`}
                        fill="none"
                        stroke={nextUnlocked ? "#f59e0b" : "rgba(255,255,255,0.6)"}
                        strokeWidth={nextUnlocked ? 7 : 5}
                        strokeDasharray={nextUnlocked ? undefined : "12 10"}
                        strokeLinecap="round"
                      />
                    );
                  })}
                </svg>

                {stages.map((st, idx) => {
                  const coord = MAP_NODE_COORDS[idx] || MAP_NODE_COORDS[MAP_NODE_COORDS.length - 1];
                  const prog = progressByStage[idx] || { unlocked: idx === 0, completed: false, stars: 0 };
                  const isCurrent = idx === currentActiveNodeIdx;
                  const isBoss = st.isBoss;

                  return (
                    <div
                      key={st.id}
                      className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1.5"
                      style={{ left: `${coord.x}%`, top: `${coord.y}%` }}
                    >
                      {isCurrent && (
                        <motion.div
                          animate={settings.reduceMotion ? undefined : { y: [0, -7, 0] }}
                          transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                          className="px-2 py-1 rounded-full border shadow-md flex items-center gap-1.5"
                          style={{ backgroundColor: "#fcf9f2", borderColor: "#0F766E" }}
                        >
                          <CartoonAvatar avatarId={p1Avatar} size="xs" />
                          <span className="text-[11px] font-bold whitespace-nowrap text-[#0F766E]">
                            {isAr ? "المرحلة الحالية" : "Ready"}
                          </span>
                        </motion.div>
                      )}

                      <motion.button
                        type="button"
                        disabled={!prog.unlocked}
                        whileHover={prog.unlocked && !settings.reduceMotion ? { scale: 1.1 } : undefined}
                        whileTap={prog.unlocked && !settings.reduceMotion ? { scale: 0.94 } : undefined}
                        onClick={() => startStageChallenge(idx)}
                        aria-label={`${isAr ? "المرحلة" : "Stage"} ${idx + 1}: ${st.prompt}`}
                        className="relative w-16 h-16 md:w-20 md:h-20 rounded-full border-4 flex flex-col items-center justify-center shadow-lg transition-transform disabled:opacity-65 disabled:cursor-not-allowed"
                        style={{
                          backgroundColor: prog.completed
                            ? "#10b981"
                            : prog.unlocked
                              ? isBoss
                                ? "#b45309"
                                : "#0F766E"
                              : "#475569",
                          borderColor: isCurrent ? "#fbbf24" : "#fcf9f2",
                          color: "#ffffff",
                        }}
                      >
                        {!prog.unlocked ? (
                          <Lock className="w-6 h-6 opacity-85" />
                        ) : prog.completed ? (
                          <CheckCircle2 className="w-6 h-6" />
                        ) : isBoss ? (
                          <Crown className="w-6 h-6 text-amber-200" />
                        ) : (
                          <Zap className="w-5 h-5 text-amber-200" />
                        )}
                        <span className="font-mono-num text-xs font-bold">
                          {String(idx + 1).padStart(2, "0")}
                        </span>
                      </motion.button>

                      {/* Landmark + Question Snippet */}
                      <div
                        className="px-2.5 py-1 rounded-xl border text-center shadow-sm max-w-[180px]"
                        style={{
                          backgroundColor: "rgba(252, 249, 242, 0.96)",
                          borderColor: isCurrent ? "#f59e0b" : "#cbd9cf",
                          color: "#153229",
                        }}
                      >
                        <div className="text-[11px] font-bold truncate">
                          {isAr ? st.titleAr : st.titleEn}
                        </div>
                        {prog.unlocked && (
                          <div className="text-[10px] opacity-80 truncate">{st.prompt}</div>
                        )}
                        {prog.completed ? (
                          <div className="flex items-center justify-center gap-0.5 mt-0.5">
                            {[1, 2, 3].map((s) => (
                              <Star
                                key={s}
                                className={`w-3 h-3 ${
                                  s <= prog.stars ? "text-amber-500 fill-amber-400" : "text-slate-300"
                                }`}
                              />
                            ))}
                          </div>
                        ) : (
                          <div className="text-[10px] font-mono-num opacity-75">
                            {st.points} {isAr ? "نقطة" : "pts"}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Bottom Map Action Strip Showing Active Stage Question & Launch Button */}
              <div className="flex flex-wrap items-center justify-between gap-3 max-w-5xl w-full mx-auto pt-2">
                <div
                  className="flex-1 min-w-[260px] px-4 py-2.5 rounded-2xl border text-xs"
                  style={{
                    backgroundColor: "rgba(252, 249, 242, 0.96)",
                    borderColor: "#cbd9cf",
                    color: "#153229",
                  }}
                >
                  <div className="font-bold text-[#0F766E]">
                    {isAr
                      ? `سؤال المرحلة ${currentActiveNodeIdx + 1} (${completedCount}/${stages.length} مكتملة):`
                      : `Stage ${currentActiveNodeIdx + 1} Question (${completedCount}/${stages.length} cleared):`}
                  </div>
                  <div className="font-semibold truncate mt-0.5">
                    {stages[currentActiveNodeIdx]?.prompt || ""}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => startStageChallenge(currentActiveNodeIdx)}
                  className="min-h-[46px] px-6 py-2.5 rounded-xl text-xs md:text-sm font-bold flex items-center gap-2 whitespace-nowrap shadow-md"
                  style={{ backgroundColor: "#f59e0b", color: "#153229" }}
                >
                  <Zap className="w-4 h-4 fill-current" />
                  <span>
                    {isAr
                      ? `دخول المرحلة ${currentActiveNodeIdx + 1}`
                      : `Enter Stage ${currentActiveNodeIdx + 1}`}
                  </span>
                </button>
              </div>
            </>
          )}
        </main>
      )}

      {/* ==================== 3. BUZZER CHALLENGE ARENA ==================== */}
      {phase === "BUZZER_CHALLENGE" && currentStage && (
        <main className="relative z-20 flex-1 flex items-center justify-center p-4 md:p-6 overflow-y-auto">
          <motion.div
            key={`stage-card-${currentStage.id}-${shakeTrigger}`}
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={
              shakeTrigger > 0 && !settings.reduceMotion
                ? { opacity: 1, scale: 1, y: 0, x: [-8, 8, -5, 5, 0] }
                : { opacity: 1, scale: 1, y: 0 }
            }
            transition={{ duration: 0.22 }}
            className="w-full max-w-4xl rounded-3xl border p-5 md:p-7 space-y-5 shadow-2xl"
            style={{
              backgroundColor: "#fcf9f2",
              borderColor: currentStage.isBoss ? "#d97706" : "#0F766E",
              borderWidth: "2px",
              color: "#153229",
            }}
          >
            {/* Stage Top Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3" style={{ borderColor: "#dbe6de" }}>
              <div className="flex items-center gap-2 text-xs font-bold">
                {currentStage.isBoss && <Crown className="w-4 h-4 text-amber-600" />}
                <span style={{ color: currentStage.isBoss ? "#b45309" : "#0F766E" }}>
                  {isAr
                    ? `المرحلة ${currentStage.stageIndex + 1} من ${stages.length}: ${currentStage.titleAr}`
                    : `Stage ${currentStage.stageIndex + 1} of ${stages.length}: ${currentStage.titleEn}`}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono-num tabular-nums">{currentStage.points} {isAr ? "نقطة" : "pts"}</span>
              </div>

              <button
                type="button"
                onClick={() => {
                  clearChallengeTimers();
                  setPhase("STAGE_MAP");
                }}
                className="text-xs font-bold underline"
                style={{ color: "#3d5e54" }}
              >
                {isAr ? "العودة للخريطة" : "Back to Map"}
              </button>
            </div>

            {/* Question Prompt — ALWAYS Visible */}
            <div className="p-4 md:p-5 rounded-2xl border text-center" style={{ backgroundColor: "#ffffff", borderColor: "#d5e2d9" }}>
              <h2 className="text-lg md:text-2xl font-bold leading-snug" style={{ textWrap: "balance" }}>
                {currentStage.prompt}
              </h2>
            </div>

            {/* SUB-PHASE A: BUZZ_RACE (Show readable preview options + Giant Buzzer!) */}
            {subPhase === "BUZZ_RACE" && (
              <div className="space-y-4">
                {/* Visible Options Preview during Buzz Race */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 opacity-85">
                  {currentStage.options.map((opt, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-xl border text-xs md:text-sm font-bold flex items-center gap-2.5"
                      style={{ backgroundColor: "#ffffff", borderColor: "#d5e2d9" }}
                    >
                      <span className="w-7 h-7 rounded-lg font-mono-num text-xs font-bold flex items-center justify-center shrink-0" style={{ backgroundColor: "#edf3ee", color: "#0F766E" }}>
                        {idx + 1}
                      </span>
                      <span className="flex-1">{opt}</span>
                    </div>
                  ))}
                </div>

                {gameMode === "solo_bot" ? (
                  <div className="flex flex-col items-center gap-3 py-1">
                    <div className="w-full max-w-md space-y-1">
                      <div className="flex items-center justify-between text-xs font-bold">
                        <span>{isAr ? "استعداد الروبوت للضغط على الباز" : "AI Bot Buzz Charge"}</span>
                        <span className="font-mono-num tabular-nums">{botChargePct}%</span>
                      </div>
                      <div className="h-2.5 w-full rounded-full overflow-hidden bg-slate-200">
                        <div
                          className="h-full transition-all duration-75"
                          style={{
                            width: `${botChargePct}%`,
                            backgroundColor: botChargePct > 75 ? "#dc2626" : "#f59e0b",
                          }}
                        />
                      </div>
                    </div>

                    <div className="relative flex items-center justify-center py-2">
                      {buzzerRipple > 0 && !settings.reduceMotion && (
                        <motion.span
                          key={buzzerRipple}
                          initial={{ scale: 0.9, opacity: 0.75 }}
                          animate={{ scale: 1.55, opacity: 0 }}
                          transition={{ duration: 0.45 }}
                          className="absolute w-36 h-36 rounded-full border-4 border-rose-500 pointer-events-none"
                        />
                      )}
                      <motion.button
                        type="button"
                        whileHover={settings.reduceMotion ? undefined : { scale: 1.05 }}
                        whileTap={settings.reduceMotion ? undefined : { scale: 0.9, y: 6 }}
                        onClick={() => handleBuzzerPress(1)}
                        className="w-40 h-40 rounded-full border-8 flex flex-col items-center justify-center gap-1 shadow-xl cursor-pointer"
                        style={{
                          background: "radial-gradient(circle at 35% 30%, #f87171, #dc2626 65%, #991b1b 100%)",
                          borderColor: "#163c32",
                          color: "#ffffff",
                          boxShadow: "0 12px 0 #7f1d1d, 0 20px 30px rgba(0,0,0,0.25)",
                        }}
                      >
                        <Zap className="w-8 h-8 fill-current" />
                        <span className="text-base font-bold">{isAr ? "اضغط الباز!" : "BUZZ IN!"}</span>
                        <span className="text-[11px] font-mono-num opacity-90">SPACE</span>
                      </motion.button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-1">
                    <motion.button
                      type="button"
                      whileHover={settings.reduceMotion ? undefined : { scale: 1.03 }}
                      whileTap={settings.reduceMotion ? undefined : { scale: 0.92, y: 5 }}
                      onClick={() => handleBuzzerPress(1)}
                      className="min-h-[130px] p-4 rounded-3xl border-4 flex flex-col items-center justify-center gap-2 shadow-lg cursor-pointer"
                      style={{
                        background: "radial-gradient(circle at 35% 25%, #34d399, #059669 70%, #065f46 100%)",
                        borderColor: "#153229",
                        color: "#ffffff",
                      }}
                    >
                      <CartoonAvatar avatarId={p1Avatar} size="md" />
                      <span className="text-base font-bold">{p1Name}</span>
                      <span className="text-xs font-mono-num opacity-95">
                        {isAr ? "اضغط هنا أو مفتاح (A)" : "Tap or Key (A)"}
                      </span>
                    </motion.button>

                    <motion.button
                      type="button"
                      whileHover={settings.reduceMotion ? undefined : { scale: 1.03 }}
                      whileTap={settings.reduceMotion ? undefined : { scale: 0.92, y: 5 }}
                      onClick={() => handleBuzzerPress(2)}
                      className="min-h-[130px] p-4 rounded-3xl border-4 flex flex-col items-center justify-center gap-2 shadow-lg cursor-pointer"
                      style={{
                        background: "radial-gradient(circle at 35% 25%, #fbbf24, #d97706 70%, #92400e 100%)",
                        borderColor: "#153229",
                        color: "#ffffff",
                      }}
                    >
                      <CartoonAvatar avatarId={p2Avatar} size="md" />
                      <span className="text-base font-bold">{p2Name}</span>
                      <span className="text-xs font-mono-num opacity-95">
                        {isAr ? "اضغط هنا أو مفتاح (L)" : "Tap or Key (L)"}
                      </span>
                    </motion.button>
                  </div>
                )}

                <p className="text-center text-xs font-semibold opacity-75">
                  {isAr
                    ? "اقرأ السؤال والخيارات أعلاه واضغط الباز أولاً لفتح الإجابة!"
                    : "Read the question & choices above, then slam the buzzer first to answer!"}
                </p>
              </div>
            )}

            {/* SUB-PHASE B: BOT_THINKING */}
            {subPhase === "BOT_THINKING" && (
              <div className="p-6 rounded-2xl border text-center space-y-3" style={{ backgroundColor: "#fef3c7", borderColor: "#f59e0b" }}>
                <Loader2 className="w-8 h-8 animate-spin mx-auto text-amber-700" />
                <p className="text-base font-bold text-amber-900">
                  {isAr
                    ? "الروبوت الذكي ضغط الباز أولاً وجارٍ اختيار إجابته..."
                    : "AI Bot buzzed first and is locking its answer..."}
                </p>
              </div>
            )}

            {/* SUB-PHASE C: ANSWERING */}
            {subPhase === "ANSWERING" && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold">
                  <span style={{ color: "#0F766E" }}>
                    {stealChance
                      ? isAr
                        ? "أخطأ الروبوت! لديك فرصة خطف النقاط الآن — اختر الإجابة!"
                        : "Bot missed! Steal chance active — choose your answer!"
                      : buzzedBy === "p2"
                        ? isAr
                          ? `الدور الآن لـ ${p2Name} — اختر الإجابة!`
                          : `${p2Name}'s turn — choose the answer!`
                        : isAr
                          ? `دور ${p1Name} — اختر الإجابة بسرعة!`
                          : `${p1Name}'s turn — answer quickly!`}
                  </span>
                  <span className="font-mono-num tabular-nums text-rose-700">
                    {(answerTimeLeftMs / 1000).toFixed(1)}s
                  </span>
                </div>

                <div className="h-2 w-full rounded-full overflow-hidden bg-slate-200">
                  <div
                    className="h-full transition-all duration-75"
                    style={{
                      width: `${Math.round((answerTimeLeftMs / 8000) * 100)}%`,
                      backgroundColor: answerTimeLeftMs < 2500 ? "#dc2626" : "#0F766E",
                    }}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {currentStage.options.map((opt, idx) => (
                    <motion.button
                      key={idx}
                      type="button"
                      whileHover={settings.reduceMotion ? undefined : { scale: 1.015 }}
                      whileTap={settings.reduceMotion ? undefined : { scale: 0.97 }}
                      onClick={() => handleSelectAnswer(idx)}
                      className="min-h-[56px] p-4 rounded-2xl border-2 text-start text-sm font-bold flex items-center gap-3 cursor-pointer transition-colors"
                      style={{
                        backgroundColor: "#ffffff",
                        borderColor: OPTION_COLORS[idx % 4],
                        color: "#153229",
                      }}
                    >
                      <span
                        className="w-8 h-8 rounded-lg font-mono-num text-xs font-bold flex items-center justify-center shrink-0"
                        style={{ backgroundColor: "#edf3ee", color: "#0F766E" }}
                      >
                        {idx + 1}
                      </span>
                      <span className="flex-1">{opt}</span>
                    </motion.button>
                  ))}
                </div>
              </div>
            )}

            {/* SUB-PHASE D: STAGE_RESULT */}
            {subPhase === "STAGE_RESULT" && stageResult && (
              <div className="space-y-4">
                <div
                  className="p-4 rounded-2xl border flex flex-wrap items-center justify-between gap-3"
                  style={{
                    backgroundColor: stageResult.correct && stageResult.actor !== "bot" ? "#ecfdf5" : "#fff1f2",
                    borderColor: stageResult.correct && stageResult.actor !== "bot" ? "#10b981" : "#f43f5e",
                  }}
                >
                  <div className="space-y-1">
                    <div className="text-base font-bold">{stageResult.message}</div>
                    {stageResult.earned > 0 && stageResult.actor !== "bot" && (
                      <div className="text-xs font-mono-num font-bold text-emerald-700">
                        +{stageResult.earned} {isAr ? "نقطة" : "pts"}
                      </div>
                    )}
                  </div>

                  {stageResult.stars > 0 && (
                    <div className="flex items-center gap-1">
                      {[1, 2, 3].map((s) => (
                        <Star
                          key={s}
                          className={`w-6 h-6 ${
                            s <= stageResult.stars ? "text-amber-500 fill-amber-400" : "text-slate-300"
                          }`}
                        />
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                  {currentStage.options.map((opt, idx) => {
                    const isCorr = idx === currentStage.correctIndex;
                    const isPicked = idx === selectedOption || idx === botChosenOption;
                    return (
                      <div
                        key={idx}
                        className="p-3 rounded-xl border font-bold flex items-center justify-between gap-2"
                        style={{
                          backgroundColor: isCorr ? "#ecfdf5" : isPicked ? "#fff1f2" : "#ffffff",
                          borderColor: isCorr ? "#10b981" : isPicked ? "#f43f5e" : "#dbe6de",
                        }}
                      >
                        <span>{opt}</span>
                        {isCorr && <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />}
                        {!isCorr && isPicked && <X className="w-4 h-4 text-rose-600 shrink-0" />}
                      </div>
                    );
                  })}
                </div>

                <div className="p-3.5 rounded-xl border text-xs leading-relaxed" style={{ backgroundColor: "#ffffff", borderColor: "#d5e2d9" }}>
                  <strong className="text-[#0F766E]">{isAr ? "التفسير العلمي:" : "Explanation:"} </strong>
                  <span>{currentStage.explanation}</span>
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleContinueAfterResult}
                    className="min-h-[46px] px-6 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 whitespace-nowrap shadow-md"
                    style={{ backgroundColor: "#0F766E", color: "#ffffff" }}
                  >
                    <span>
                      {gameMode === "solo_bot" && hearts <= 0
                        ? isAr
                          ? "عرض النتيجة النهائية"
                          : "View Results"
                        : activeStageIdx === stages.length - 1 && progressByStage[activeStageIdx]?.completed
                          ? isAr
                            ? "إعلان النصر النهائي!"
                            : "Claim Final Victory!"
                          : isAr
                            ? "متابعة خريطة المراحل"
                            : "Continue to Stage Map"}
                    </span>
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </main>
      )}

      {/* ==================== 4. PAUSE MODAL ==================== */}
      <AnimatePresence>
        {phase === "PAUSED" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 flex items-center justify-center p-4"
            style={{ backgroundColor: "rgba(10, 30, 24, 0.72)" }}
          >
            <div
              className="w-full max-w-md rounded-3xl border p-6 space-y-4 text-center shadow-2xl"
              style={{ backgroundColor: "#fcf9f2", borderColor: "#cbd9cf", color: "#153229" }}
            >
              <h2 className="text-xl font-bold">{isAr ? "اللعبة متوقفة مؤقتاً" : "Game Paused"}</h2>
              <p className="text-xs opacity-75">
                {lesson.subject} · {lesson.title}
              </p>
              <div className="flex flex-col gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    if (pausedFrom === "BUZZER_CHALLENGE") {
                      startStageChallenge(activeStageIdx);
                    } else {
                      setPhase("STAGE_MAP");
                    }
                  }}
                  className="min-h-[44px] px-4 py-2 rounded-xl text-sm font-bold whitespace-nowrap"
                  style={{ backgroundColor: "#0F766E", color: "#ffffff" }}
                >
                  {isAr ? "استئناف اللعب" : "Resume Game"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    initFreshCampaign(stages);
                    setPhase("STAGE_MAP");
                  }}
                  className="min-h-[44px] px-4 py-2 rounded-xl border text-sm font-bold flex items-center justify-center gap-2 whitespace-nowrap"
                  style={{ backgroundColor: "#ffffff", borderColor: "#cbd9cf" }}
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>{isAr ? "إعادة الخريطة من البداية" : "Restart Campaign"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    gameAudio.stopMusic();
                    onClose();
                  }}
                  className="min-h-[44px] px-4 py-2 rounded-xl border text-sm font-bold whitespace-nowrap"
                  style={{ backgroundColor: "transparent", borderColor: "#cbd9cf" }}
                >
                  {isAr ? "الخروج إلى المنصة" : "Exit to Platform"}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ==================== 5. QUESTIONS & STAGE EDITOR MODAL ==================== */}
      <AnimatePresence>
        {questionsModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 flex items-center justify-center p-4"
            style={{ backgroundColor: "rgba(10, 30, 24, 0.76)" }}
          >
            <div
              className="w-full max-w-3xl max-h-[88vh] rounded-3xl border p-5 md:p-6 flex flex-col gap-4 shadow-2xl"
              style={{ backgroundColor: "#fcf9f2", borderColor: "#cbd9cf", color: "#153229" }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3" style={{ borderColor: "#dbe6de" }}>
                <div>
                  <h2 className="text-lg font-bold flex items-center gap-2">
                    <ListChecks className="w-5 h-5 text-[#0F766E]" />
                    <span>{isAr ? `أسئلة مراحل الخريطة (${stages.length})` : `Map Stage Questions (${stages.length})`}</span>
                  </h2>
                  <p className="text-xs opacity-75">{lesson.title}</p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleGenerateAiStages}
                    disabled={generatingStages}
                    className="min-h-[38px] px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1.5"
                    style={{ backgroundColor: "#ffffff", borderColor: "#0F766E", color: "#0F766E" }}
                  >
                    {generatingStages ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    <span>{isAr ? "توليد بالذكاء الاصطناعي" : "AI Regenerate"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setQuestionsModalOpen(false)}
                    aria-label={isAr ? "إغلاق" : "Close"}
                    className="min-h-[38px] min-w-[38px] rounded-xl border flex items-center justify-center"
                    style={{ backgroundColor: "#ffffff", borderColor: "#cbd9cf" }}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto space-y-3 pe-1">
                {stages.map((st, idx) => (
                  <div
                    key={st.id}
                    className="p-4 rounded-2xl border space-y-2"
                    style={{ backgroundColor: "#ffffff", borderColor: "#d5e2d9" }}
                  >
                    {editingStageIdx === idx ? (
                      <div className="space-y-2.5">
                        <input
                          type="text"
                          value={editDraftPrompt}
                          onChange={(e) => setEditDraftPrompt(e.target.value)}
                          className="w-full min-h-[40px] px-3 rounded-xl border text-xs font-bold"
                          style={{ borderColor: "#0F766E" }}
                        />
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {editDraftOptions.map((opt, oi) => (
                            <div key={oi} className="flex items-center gap-1.5">
                              <input
                                type="radio"
                                name={`corr-${idx}`}
                                checked={editDraftCorrect === oi}
                                onChange={() => setEditDraftCorrect(oi)}
                              />
                              <input
                                type="text"
                                value={opt}
                                onChange={(e) => {
                                  const next = [...editDraftOptions];
                                  next[oi] = e.target.value;
                                  setEditDraftOptions(next);
                                }}
                                className="flex-1 min-h-[36px] px-2.5 rounded-lg border text-xs"
                                style={{ borderColor: "#cbd9cf" }}
                              />
                            </div>
                          ))}
                        </div>
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingStageIdx(null)}
                            className="px-3 py-1.5 rounded-lg border text-xs font-bold"
                          >
                            {isAr ? "إلغاء" : "Cancel"}
                          </button>
                          <button
                            type="button"
                            onClick={handleSaveEditedStage}
                            className="px-4 py-1.5 rounded-lg text-xs font-bold"
                            style={{ backgroundColor: "#0F766E", color: "#ffffff" }}
                          >
                            {isAr ? "حفظ التعديل" : "Save"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between gap-2 text-xs font-bold">
                          <span className="text-[#0F766E]">
                            {isAr ? `المرحلة ${idx + 1}: ${st.titleAr}` : `Stage ${idx + 1}: ${st.titleEn}`}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingStageIdx(idx);
                              setEditDraftPrompt(st.prompt);
                              setEditDraftOptions([...st.options, "", "", "", ""].slice(0, 4));
                              setEditDraftCorrect(st.correctIndex);
                            }}
                            className="underline text-[#0F766E]"
                          >
                            {isAr ? "تعديل السؤال" : "Edit"}
                          </button>
                        </div>
                        <div className="text-sm font-bold">{st.prompt}</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs">
                          {st.options.map((opt, oi) => (
                            <div
                              key={oi}
                              className="p-2 rounded-lg border flex items-center justify-between"
                              style={{
                                backgroundColor: oi === st.correctIndex ? "#ecfdf5" : "#f7faf8",
                                borderColor: oi === st.correctIndex ? "#10b981" : "#dbe6de",
                              }}
                            >
                              <span>{opt}</span>
                              {oi === st.correctIndex && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ==================== 6. LIVE CODE & QR BARCODE MODAL ==================== */}
      <AnimatePresence>
        {qrInviteModalOpen && liveRoom && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 flex items-center justify-center p-4"
            style={{ backgroundColor: "rgba(10, 30, 24, 0.76)" }}
          >
            <div
              className="w-full max-w-md rounded-3xl border p-6 text-center space-y-4 shadow-2xl"
              style={{ backgroundColor: "#fcf9f2", borderColor: "#cbd9cf", color: "#153229" }}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold">{isAr ? "دخول المسابقة بالكود أو الباركود" : "Join Competition via Code or QR"}</h2>
                <button
                  type="button"
                  onClick={() => setQrInviteModalOpen(false)}
                  className="p-1.5 rounded-lg border"
                  style={{ borderColor: "#cbd9cf" }}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex justify-center">
                <QrCodeBox
                  value={liveJoinUrl}
                  size={200}
                  label={isAr ? "امسح الباركود بكاميرا الجوال" : "Scan QR with Phone Camera"}
                />
              </div>
              <div className="p-3 rounded-2xl border bg-white" style={{ borderColor: "#d5e2d9" }}>
                <div className="text-xs opacity-75">{isAr ? "رمز الدخول المباشر" : "Room PIN"}</div>
                <div className="font-mono-num text-4xl font-extrabold tracking-widest text-[#0F766E]">
                  {liveRoom.roomCode}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(liveJoinUrl);
                  setCopiedLiveLink(true);
                  setTimeout(() => setCopiedLiveLink(false), 2000);
                }}
                className="w-full min-h-[44px] px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-2"
                style={{ backgroundColor: "#0F766E", color: "#ffffff" }}
              >
                <Copy className="w-4 h-4" />
                <span>{copiedLiveLink ? (isAr ? "تم نسخ رابط الدخول!" : "Join Link Copied!") : isAr ? "نسخ رابط الانضمام المباشر" : "Copy Direct Join Link"}</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ==================== 7. VICTORY / GAME OVER MODAL ==================== */}
      {(phase === "VICTORY" || phase === "GAME_OVER") && (
        <div className="relative z-30 flex-1 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-lg rounded-3xl border p-6 md:p-8 text-center space-y-5 shadow-2xl"
            style={{
              backgroundColor: "#fcf9f2",
              borderColor: phase === "VICTORY" ? "#f59e0b" : "#f43f5e",
              borderWidth: "2px",
              color: "#153229",
            }}
          >
            <div className="flex justify-center">
              {phase === "VICTORY" ? (
                <div className="w-16 h-16 rounded-full bg-amber-100 border-2 border-amber-400 flex items-center justify-center">
                  <Trophy className="w-8 h-8 text-amber-600" />
                </div>
              ) : (
                <div className="w-16 h-16 rounded-full bg-rose-100 border-2 border-rose-400 flex items-center justify-center">
                  <Heart className="w-8 h-8 text-rose-600" />
                </div>
              )}
            </div>

            <div className="space-y-1">
              <h2 className="text-2xl font-bold">
                {phase === "VICTORY"
                  ? gameMode === "duel_2p"
                    ? p1Score >= p2Score
                      ? isAr
                        ? `فاز ${p1Name} بالبطولة!`
                        : `${p1Name} Wins!`
                      : isAr
                        ? `فاز ${p2Name} بالبطولة!`
                        : `${p2Name} Wins!`
                    : isAr
                      ? "مبارك! أتممت خريطة التحدي!"
                      : "Victory! Stage Map Cleared!"
                  : isAr
                    ? "انتهت القلوب — حاول مجدداً!"
                    : "Out of Hearts — Try Again!"}
              </h2>
              <p className="text-xs opacity-75">
                {lesson.subject} · {lesson.title}
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="p-3 rounded-2xl border" style={{ backgroundColor: "#ffffff", borderColor: "#d5e2d9" }}>
                <div className="text-[11px] opacity-70">{isAr ? "النقاط" : "Score"}</div>
                <div className="text-lg font-bold font-mono-num tabular-nums text-[#0F766E]">
                  {p1Score.toLocaleString()}
                </div>
              </div>
              <div className="p-3 rounded-2xl border" style={{ backgroundColor: "#ffffff", borderColor: "#d5e2d9" }}>
                <div className="text-[11px] opacity-70">{isAr ? "النجوم" : "Stars"}</div>
                <div className="text-lg font-bold font-mono-num tabular-nums text-amber-600">
                  {totalStarsEarned} / {stages.length * 3}
                </div>
              </div>
              <div className="p-3 rounded-2xl border" style={{ backgroundColor: "#ffffff", borderColor: "#d5e2d9" }}>
                <div className="text-[11px] opacity-70">
                  {gameMode === "duel_2p" ? p2Name : isAr ? "أفضل سلسلة" : "Best Streak"}
                </div>
                <div className="text-lg font-bold font-mono-num tabular-nums">
                  {gameMode === "duel_2p" ? p2Score.toLocaleString() : `×${bestStreak}`}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
              <button
                type="button"
                onClick={handleStartCampaign}
                className="min-h-[46px] px-6 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 whitespace-nowrap shadow-md"
                style={{ backgroundColor: "#0F766E", color: "#ffffff" }}
              >
                <RotateCcw className="w-4 h-4" />
                <span>{isAr ? "العب مرة أخرى" : "Play Again"}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  gameAudio.stopMusic();
                  onClose();
                }}
                className="min-h-[46px] px-5 py-2.5 rounded-xl border text-sm font-bold whitespace-nowrap"
                style={{ backgroundColor: "#ffffff", borderColor: "#cbd9cf" }}
              >
                {isAr ? "العودة للمنصة" : "Return to Platform"}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

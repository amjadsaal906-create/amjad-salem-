import React, { useState, useEffect, useCallback } from "react";
import { motion } from "motion/react";
import {
  AlertCircle,
  BookOpen,
  Bot,
  RefreshCw,
  Volume2,
} from "lucide-react";
import type {
  AccessibilitySettings,
  DailyScienceFact as DailyScienceFactData,
  UILanguage,
} from "../types.ts";

import { buildDemoDailyFact } from "../utils/demoSamples.ts";
import { fetchDailyScienceFact } from "../utils/aiApi.ts";

interface DailyScienceFactProps {
  uiLang: UILanguage;
  settings: AccessibilitySettings;
  onRobotReadFact: (speechText: string) => void;
  onAskRobotAboutFact: (question: string) => void;
  demoMode?: boolean;
}

const STREAK_STORAGE_KEY = "smart_science_daily_streak_v1";

function getLocalDateKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getPreviousDateKey(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() - 1);
  const py = dt.getFullYear();
  const pm = String(dt.getMonth() + 1).padStart(2, "0");
  const pd = String(dt.getDate()).padStart(2, "0");
  return `${py}-${pm}-${pd}`;
}

function recordAndGetDailyStreak(todayKey: string): number {
  try {
    const raw = localStorage.getItem(STREAK_STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(
        STREAK_STORAGE_KEY,
        JSON.stringify({ lastVisitDate: todayKey, streak: 1 })
      );
      return 1;
    }
    const parsed = JSON.parse(raw) as { lastVisitDate?: string; streak?: number };
    const last = parsed.lastVisitDate || "";
    const prevStreak = Number(parsed.streak) || 1;
    if (last === todayKey) {
      return prevStreak;
    }
    const yesterday = getPreviousDateKey(todayKey);
    const nextStreak = last === yesterday ? prevStreak + 1 : 1;
    localStorage.setItem(
      STREAK_STORAGE_KEY,
      JSON.stringify({ lastVisitDate: todayKey, streak: nextStreak })
    );
    return nextStreak;
  } catch {
    return 1;
  }
}

export const DailyScienceFact: React.FC<DailyScienceFactProps> = ({
  uiLang,
  settings,
  onRobotReadFact,
  onAskRobotAboutFact,
  demoMode = false,
}) => {
  const isAr = uiLang === "ar";
  const todayKey = getLocalDateKey();

  const [fact, setFact] = useState<DailyScienceFactData | null>(null);
  const [isDemoFact, setIsDemoFact] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [streakDays, setStreakDays] = useState<number>(() =>
    recordAndGetDailyStreak(todayKey)
  );

  useEffect(() => {
    setStreakDays(recordAndGetDailyStreak(todayKey));
  }, [todayKey]);

  const fetchDailyFact = useCallback(
    async (forceRefresh = false) => {
      if (forceRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      if (demoMode) {
        setFact(buildDemoDailyFact(uiLang, todayKey));
        setIsDemoFact(true);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      try {
        const liveFact = await fetchDailyScienceFact({
          lang: uiLang,
          date: todayKey,
          refresh: forceRefresh,
        });
        setFact(liveFact);
        setIsDemoFact(false);
      } catch (err) {
        setFact(null);
        setIsDemoFact(false);
        setError(
          err instanceof Error
            ? err.message
            : isAr
              ? "تعذر الاتصال بخادم الذكاء الاصطناعي لجلب حقيقة اليوم."
              : "Failed to connect to AI server for today's science fact."
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [uiLang, todayKey, isAr, demoMode]
  );

  useEffect(() => {
    void fetchDailyFact(false);
  }, [fetchDailyFact]);

  return (
    <motion.section
      aria-label={isAr ? "الحقيقة العلمية اليومية" : "Daily Science Fact"}
      initial={settings.reduceMotion ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.42, delay: 0.09, ease: [0.16, 1, 0.3, 1] }}
      className="rounded-3xl border p-6 md:p-7 science-card backdrop-blur-md space-y-4"
      style={{
        backgroundColor: "var(--bg-surface)",
        borderColor: "var(--border-hairline)",
      }}
    >
      {/* Clean Unboxed Metadata Header (Zero-Pill Discipline) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className="flex flex-wrap items-center gap-2 text-xs font-medium"
          style={{ color: "var(--text-secondary)" }}
        >
          <span className="font-semibold" style={{ color: "var(--accent-primary)" }}>
            {isAr ? "حقيقة اليوم العلمية" : "Daily Science Fact"}
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-mono-num" dir="ltr">
            {todayKey}
          </span>
          {fact?.discipline && (
            <>
              <span aria-hidden="true">·</span>
              <span>{fact.discipline}</span>
            </>
          )}
          <span aria-hidden="true">·</span>
          <span className="font-mono-num">
            {isAr
              ? `سلسلة الدخول اليومي: ${streakDays} ${streakDays === 1 ? "يوم" : "أيام"}`
              : `Daily streak: ${streakDays} ${streakDays === 1 ? "day" : "days"}`}
          </span>
          <span aria-hidden="true">·</span>
          <span
            className="font-bold"
            style={{ color: isDemoFact ? "#b45309" : "var(--accent-primary)" }}
          >
            {isDemoFact
              ? isAr
                ? "محتوى تجريبي مسبق (Demo)"
                : "Preset Demo Sample"
              : isAr
                ? "مولّد بالذكاء الاصطناعي"
                : "Live AI Generated"}
          </span>
        </div>

        <button
          type="button"
          onClick={() => void fetchDailyFact(true)}
          disabled={loading || refreshing}
          className="min-h-[36px] px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
          style={{
            backgroundColor: "var(--bg-subtle)",
            borderColor: "var(--border-hairline)",
            color: "var(--text-primary)",
          }}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
          {isAr ? "حقيقة إضافية" : "Another Fact"}
        </button>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="space-y-3 py-2" aria-busy="true">
          <div
            className="h-6 w-2/3 rounded-lg animate-pulse"
            style={{ backgroundColor: "var(--bg-subtle)" }}
          />
          <div
            className="h-4 w-full rounded-lg animate-pulse"
            style={{ backgroundColor: "var(--bg-subtle)" }}
          />
          <div
            className="h-4 w-5/6 rounded-lg animate-pulse"
            style={{ backgroundColor: "var(--bg-subtle)" }}
          />
        </div>
      )}

      {/* Honest Error State + Retry */}
      {!loading && error && (
        <div
          role="alert"
          className="p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          style={{
            backgroundColor: "var(--bg-subtle)",
            borderColor: "var(--border-hairline)",
          }}
        >
          <div className="flex items-start gap-2.5 text-xs" style={{ color: "var(--text-primary)" }}>
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => void fetchDailyFact(false)}
            className="min-h-[38px] px-4 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0"
            style={{
              backgroundColor: "var(--accent-primary)",
              color: "var(--accent-contrast)",
            }}
          >
            {isAr ? "إعادة المحاولة" : "Retry"}
          </button>
        </div>
      )}

      {/* Loaded Daily Science Fact Content */}
      {!loading && !error && fact && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-center">
          <div className="lg:col-span-8 space-y-2.5">
            <h2
              className="font-display text-lg md:text-xl font-bold leading-snug"
              style={{ color: "var(--text-primary)" }}
            >
              {fact.headline}
            </h2>
            <p
              className="text-sm md:text-base leading-relaxed"
              style={{ color: "var(--text-primary)" }}
            >
              {fact.fact}
            </p>
            {!settings.simplifiedMode && fact.whyItMatters && (
              <p
                className="text-xs md:text-sm leading-relaxed flex items-start gap-2 pt-1"
                style={{ color: "var(--text-secondary)" }}
              >
                <BookOpen className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "var(--accent-primary)" }} />
                <span>{fact.whyItMatters}</span>
              </p>
            )}
          </div>

          <div
            className="lg:col-span-4 flex flex-col sm:flex-row lg:flex-col gap-2.5 pt-3 lg:pt-0 lg:border-s lg:ps-5"
            style={{ borderColor: "var(--border-hairline)" }}
          >
            <button
              type="button"
              onClick={() =>
                onRobotReadFact(
                  isAr
                    ? `حقيقة اليوم في ${fact.discipline}: ${fact.headline}. ${fact.fact} ${fact.whyItMatters}`
                    : `Today's ${fact.discipline} fact: ${fact.headline}. ${fact.fact} ${fact.whyItMatters}`
                )
              }
              className="min-h-[42px] px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-2 whitespace-nowrap"
              style={{
                backgroundColor: "var(--accent-primary)",
                color: "var(--accent-contrast)",
              }}
            >
              <Volume2 className="w-4 h-4" />
              {isAr ? "استمع للحقيقة بصوت الروبوت" : "Hear Robot Read Fact"}
            </button>

            <button
              type="button"
              onClick={() => onAskRobotAboutFact(fact.quickPrompt)}
              className="min-h-[42px] px-4 py-2 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 whitespace-nowrap"
              style={{
                backgroundColor: "var(--bg-subtle)",
                borderColor: "var(--border-hairline)",
                color: "var(--text-primary)",
              }}
            >
              <Bot className="w-4 h-4" style={{ color: "var(--accent-primary)" }} />
              {isAr ? "اسأل الروبوت عن التفاصيل" : "Ask Robot About This"}
            </button>
          </div>
        </div>
      )}
    </motion.section>
  );
};

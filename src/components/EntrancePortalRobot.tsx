import React, { useRef, useState } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { Bot, Mic, MicOff, Send, Square, Volume2 } from "lucide-react";
import type { UILanguage } from "../types.ts";

export interface RobotPromptOption {
  id: string;
  labelAr: string;
  labelEn: string;
  speechAr: string;
  speechEn: string;
}

interface EntrancePortalRobotProps {
  uiLang: UILanguage;
  reducedMotion: boolean;
  captionsEnabled: boolean;
  isSpeaking: boolean;
  isThinking: boolean;
  isListeningMic: boolean;
  voiceMode: "neural" | "browser";
  onVoiceModeChange: (mode: "neural" | "browser") => void;
  spokenCaption: string;
  speechNotice: string | null;
  greetingOptions: RobotPromptOption[];
  selectedPromptId: string;
  onSelectGreeting: (option: RobotPromptOption) => void;
  onSpeakCurrent: () => void;
  onStopVoice: () => void;
  customInput: string;
  onCustomInputChange: (val: string) => void;
  onAskRobot: (e?: React.FormEvent) => void;
  onToggleVoiceMic: () => void;
}

const ROBOT_PORTRAIT_URL = "/src/assets/images/talking_robot_portal_1794945306878.jpg";
const WAVE_HEIGHTS = [14, 28, 20, 36, 24, 40, 18, 34, 22, 30, 16, 26];

export const EntrancePortalRobot: React.FC<EntrancePortalRobotProps> = ({
  uiLang,
  reducedMotion,
  captionsEnabled,
  isSpeaking,
  isThinking,
  isListeningMic,
  voiceMode,
  onVoiceModeChange,
  spokenCaption,
  speechNotice,
  greetingOptions,
  selectedPromptId,
  onSelectGreeting,
  onSpeakCurrent,
  onStopVoice,
  customInput,
  onCustomInputChange,
  onAskRobot,
  onToggleVoiceMic,
}) => {
  const isAr = uiLang === "ar";
  const stageRef = useRef<HTMLDivElement>(null);
  const [imageError, setImageError] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  // Subtle 3D Mouse Parallax Tilt & Specular Sheen
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const smoothX = useSpring(pointerX, { stiffness: 150, damping: 22, mass: 0.6 });
  const smoothY = useSpring(pointerY, { stiffness: 150, damping: 22, mass: 0.6 });

  const rotateY = useTransform(smoothX, [-0.5, 0.5], [-5.5, 5.5]);
  const rotateX = useTransform(smoothY, [-0.5, 0.5], [5.5, -5.5]);
  const portraitShiftX = useTransform(smoothX, [-0.5, 0.5], [-8, 8]);
  const portraitShiftY = useTransform(smoothY, [-0.5, 0.5], [-6, 6]);
  const sheenX = useTransform(smoothX, [-0.5, 0.5], ["20%", "80%"]);
  const sheenY = useTransform(smoothY, [-0.5, 0.5], ["15%", "65%"]);
  const sheenBg = useTransform(
    [sheenX, sheenY],
    ([x, y]) =>
      `radial-gradient(circle 280px at ${x} ${y}, rgba(255, 255, 255, 0.18), transparent 72%)`
  );

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (reducedMotion || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width - 0.5;
    const ny = (e.clientY - rect.top) / rect.height - 0.5;
    pointerX.set(nx);
    pointerY.set(ny);
  };

  const handleMouseEnter = () => {
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    pointerX.set(0);
    pointerY.set(0);
  };

  return (
    <div
      ref={stageRef}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="relative h-full flex flex-col"
      style={{ perspective: "1200px" }}
    >
      {/* Gentle Floating 3D Container with Responsive Hover Lift */}
      <motion.div
        initial={reducedMotion ? false : { opacity: 0, y: 18 }}
        animate={
          reducedMotion
            ? { opacity: 1, y: 0, scale: 1 }
            : isHovered
              ? {
                  opacity: 1,
                  y: [-9, -3, -9],
                  scale: 1.014,
                }
              : {
                  opacity: 1,
                  y: [-5, 5, -5],
                  scale: 1,
                }
        }
        transition={
          reducedMotion
            ? { duration: 0.25 }
            : {
                opacity: { duration: 0.45, ease: [0.16, 1, 0.3, 1] },
                scale: { duration: 0.24, ease: [0.16, 1, 0.3, 1] },
                y: {
                  duration: isHovered ? 3.8 : 5.4,
                  repeat: Infinity,
                  ease: "easeInOut",
                },
              }
        }
        style={{
          rotateX: reducedMotion ? 0 : rotateX,
          rotateY: reducedMotion ? 0 : rotateY,
          transformStyle: "preserve-3d",
          backgroundColor: "var(--bg-surface)",
          borderColor: isSpeaking || isHovered ? "var(--accent-primary)" : "var(--border-hairline)",
          boxShadow: isSpeaking
            ? "0 26px 54px -14px rgba(15, 118, 110, 0.32), 0 10px 24px -8px rgba(15, 23, 42, 0.16)"
            : isHovered
              ? "0 28px 56px -14px rgba(15, 118, 110, 0.24), 0 12px 26px -10px rgba(15, 23, 42, 0.16)"
              : "0 22px 46px -16px rgba(15, 23, 42, 0.16), 0 6px 18px -6px rgba(15, 118, 110, 0.12)",
        }}
        className="relative flex-1 rounded-3xl overflow-hidden border min-h-[460px] lg:min-h-[600px] flex flex-col justify-end transition-colors duration-200"
      >
        {/* Subtle 3D Specular Sheen Reacting to Mouse */}
        {!reducedMotion && (
          <motion.div
            aria-hidden="true"
            className="absolute inset-0 pointer-events-none z-10"
            style={{ background: sheenBg }}
          />
        )}

        {/* Ambient Speaking Resonance Aura */}
        {isSpeaking && !reducedMotion && (
          <motion.div
            aria-hidden="true"
            className="absolute inset-0 pointer-events-none z-10 rounded-3xl"
            animate={{ opacity: [0.35, 0.78, 0.35] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
            style={{
              boxShadow:
                "inset 0 0 0 2px var(--accent-primary), inset 0 0 44px rgba(15, 118, 110, 0.3)",
            }}
          />
        )}

        {/* 3D Robot Portrait with Parallax Depth, Talking Cadence Shake & Mouth Pulse */}
        {!imageError ? (
          <motion.div
            aria-hidden="false"
            className="absolute inset-0 overflow-hidden"
            style={{
              x: reducedMotion ? 0 : portraitShiftX,
              y: reducedMotion ? 0 : portraitShiftY,
              scale: 1.04,
            }}
          >
            <motion.div
              animate={
                isSpeaking && !reducedMotion
                  ? {
                      rotate: [0, -0.65, 0.65, -0.4, 0.4, 0],
                      y: [0, -2.5, 0.5, -1.5, 0],
                      scale: [1, 1.018, 1.008, 1.022, 1],
                    }
                  : isHovered && !reducedMotion
                    ? { scale: 1.018, rotate: 0, y: 0 }
                    : { scale: 1, rotate: 0, y: 0 }
              }
              transition={
                isSpeaking && !reducedMotion
                  ? {
                      duration: 0.92,
                      repeat: Infinity,
                      ease: "easeInOut",
                    }
                  : { duration: 0.25, ease: [0.16, 1, 0.3, 1] }
              }
              className="relative w-full h-full"
            >
              <img
                src={ROBOT_PORTRAIT_URL}
                alt={
                  isAr
                    ? "روبوت تعليمي ذكي متحدث بتصميم فخم ثلاثي الأبعاد يستقبل الطلاب والمعلمين في بوابة Smart Science AI"
                    : "Luxury 3D intelligent talking science robot greeting students and teachers at Smart Science AI portal"
                }
                referrerPolicy="no-referrer"
                onError={() => setImageError(true)}
                className="w-full h-full object-cover object-top select-none"
              />

              {/* Subtle Talking Mouth Acoustic Pulse Centered on Speaker Grille */}
              {isSpeaking && !reducedMotion && (
                <div
                  aria-hidden="true"
                  className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none flex items-center justify-center"
                  style={{ left: "58.2%", top: "34.6%" }}
                >
                  <motion.span
                    className="absolute w-12 h-7 rounded-full"
                    animate={{
                      scale: [0.85, 1.28, 0.94, 1.32, 0.85],
                      opacity: [0.28, 0.72, 0.36, 0.78, 0.28],
                    }}
                    transition={{
                      duration: 0.65,
                      repeat: Infinity,
                      ease: "easeInOut",
                    }}
                    style={{
                      background:
                        "radial-gradient(circle, rgba(52, 211, 153, 0.58) 0%, rgba(16, 185, 129, 0.12) 65%, transparent 100%)",
                    }}
                  />
                  <div className="relative flex items-center gap-0.5">
                    {[6, 12, 16, 12, 6].map((peak, idx) => (
                      <motion.span
                        key={idx}
                        className="w-0.5 rounded-full bg-emerald-200/90"
                        animate={{ height: [3, peak, 4, Math.max(5, peak - 4), 3] }}
                        transition={{
                          duration: 0.42 + idx * 0.05,
                          repeat: Infinity,
                          ease: "easeInOut",
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        ) : (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center"
            style={{
              background:
                "radial-gradient(circle at 50% 30%, rgba(16, 185, 129, 0.28), rgba(15, 23, 42, 0.94))",
            }}
          >
            <Bot className="w-24 h-24 text-emerald-300 mb-4" />
            <p className="text-base font-bold text-white">
              {isAr
                ? "المساعد الروبوتي المتحدث — Smart Science AI"
                : "Talking AI Robot Companion"}
            </p>
          </div>
        )}

        {/* Top Bar: Acoustic Voice Engine Selector & Play/Stop Trigger */}
        <div className="relative z-20 flex items-center justify-between gap-2 p-4 mb-auto">
          <div
            className="flex items-center gap-1 p-1 rounded-xl border backdrop-blur-md"
            style={{
              backgroundColor: "rgba(15, 23, 42, 0.74)",
              borderColor: "rgba(255, 255, 255, 0.16)",
            }}
          >
            <button
              type="button"
              onClick={() => onVoiceModeChange("browser")}
              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap transition-colors"
              style={{
                backgroundColor: voiceMode === "browser" ? "#0f766e" : "transparent",
                color: "#ffffff",
              }}
            >
              {isAr ? "صوت فوري" : "Instant Voice"}
            </button>
            <button
              type="button"
              onClick={() => onVoiceModeChange("neural")}
              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap transition-colors"
              style={{
                backgroundColor: voiceMode === "neural" ? "#0f766e" : "transparent",
                color: "#ffffff",
              }}
            >
              {isAr ? "صوت عصبي AI" : "Neural AI Voice"}
            </button>
          </div>

          {isSpeaking ? (
            <button
              type="button"
              onClick={onStopVoice}
              aria-label={isAr ? "إيقاف صوت الروبوت" : "Stop robot speech"}
              className="min-h-[38px] px-3 py-1.5 rounded-xl bg-rose-600 text-white text-xs font-semibold flex items-center gap-1.5 shadow-md whitespace-nowrap"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              {isAr ? "إيقاف" : "Stop"}
            </button>
          ) : (
            <button
              type="button"
              onClick={onSpeakCurrent}
              className="min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-md whitespace-nowrap"
              style={{
                backgroundColor: "#0f766e",
                color: "#ffffff",
              }}
            >
              <Volume2 className="w-4 h-4" />
              {isAr ? "استمع للروبوت" : "Hear Robot"}
            </button>
          )}
        </div>

        {/* Measured Gradient Scrim + Live Speech Transcript & Equalizer */}
        <div className="relative z-20 p-5 md:p-6 pt-20 bg-gradient-to-t from-slate-950/95 via-slate-950/82 to-transparent text-white space-y-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-emerald-300">
                {isSpeaking
                  ? isAr
                    ? "الروبوت يتحدث الآن..."
                    : "Robot Speaking Now..."
                  : isThinking
                    ? isAr
                      ? "جارٍ صياغة الرد العلمي..."
                      : "Preparing response..."
                    : isAr
                      ? "المرشد العلمي المتحدث"
                      : "Talking Science Concierge"}
              </p>
            </div>

            {/* Live Acoustic Equalizer (Active Strictly While Speaking) */}
            <div aria-hidden="true" className="flex items-end gap-1 h-8 shrink-0">
              {WAVE_HEIGHTS.map((maxH, idx) => (
                <motion.span
                  key={idx}
                  className="w-1 rounded-full bg-emerald-400"
                  animate={
                    isSpeaking && !reducedMotion
                      ? { height: [6, maxH, 8, Math.max(10, maxH - 10), 6] }
                      : { height: 6 }
                  }
                  transition={{
                    duration: 0.75 + (idx % 4) * 0.14,
                    repeat: isSpeaking ? Infinity : 0,
                    ease: "easeInOut",
                    delay: idx * 0.04,
                  }}
                  style={{ opacity: isSpeaking ? 0.95 : 0.35 }}
                />
              ))}
            </div>
          </div>

          {captionsEnabled && (
            <p className="text-sm leading-relaxed text-slate-100 font-normal">
              “{spokenCaption}”
            </p>
          )}

          {speechNotice && (
            <p className="text-xs text-amber-300" role="status">
              {speechNotice}
            </p>
          )}

          {/* Quick Greeting Topics */}
          <div className="flex flex-wrap gap-1.5">
            {greetingOptions.map((opt) => {
              const active = selectedPromptId === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onSelectGreeting(opt)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap"
                  style={{
                    backgroundColor: active ? "#10b981" : "rgba(255, 255, 255, 0.12)",
                    color: active ? "#052e16" : "#f8fafc",
                  }}
                >
                  {isAr ? opt.labelAr : opt.labelEn}
                </button>
              );
            })}
          </div>

          {/* Direct Voice / Text Gate Q&A Input */}
          <form onSubmit={onAskRobot} className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={onToggleVoiceMic}
              aria-label={isAr ? "تحدث إلى الروبوت" : "Speak to robot"}
              className="min-h-[42px] min-w-[42px] rounded-xl flex items-center justify-center shrink-0 transition-colors"
              style={{
                backgroundColor: isListeningMic ? "#e11d48" : "rgba(255, 255, 255, 0.14)",
                color: "#ffffff",
              }}
            >
              {isListeningMic ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
            <input
              type="text"
              value={customInput}
              onChange={(e) => onCustomInputChange(e.target.value)}
              placeholder={
                isAr ? "اسأل الروبوت عند البوابة..." : "Ask the gate robot a question..."
              }
              className="flex-1 min-h-[42px] px-3.5 rounded-xl text-xs bg-white/10 border border-white/20 text-white placeholder:text-slate-300 focus:bg-white/15"
            />
            <button
              type="submit"
              disabled={!customInput.trim() || isThinking}
              aria-label={isAr ? "إرسال السؤال" : "Send question"}
              className="min-h-[42px] px-3.5 rounded-xl bg-emerald-500 text-slate-950 font-semibold text-xs flex items-center gap-1.5 disabled:opacity-50 shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
              {isAr ? "تحدث" : "Ask"}
            </button>
          </form>
        </div>
      </motion.div>

      {/* Subtle Suspended Shadow Under Floating 3D Robot Frame */}
      {!reducedMotion && (
        <motion.div
          aria-hidden="true"
          animate={{ scaleX: [0.92, 0.86, 0.92], opacity: [0.22, 0.14, 0.22] }}
          transition={{ duration: 5.4, repeat: Infinity, ease: "easeInOut" }}
          className="mx-10 -mt-2 h-3 rounded-full blur-md pointer-events-none"
          style={{ backgroundColor: "rgba(15, 118, 110, 0.35)" }}
        />
      )}
    </div>
  );
};

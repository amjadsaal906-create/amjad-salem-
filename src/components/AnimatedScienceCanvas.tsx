import React from "react";
import { motion } from "motion/react";

interface AnimatedScienceCanvasProps {
  reducedMotion: boolean;
  theme: "light" | "dark" | "high-contrast" | "sepia";
}

const PARTICLES = [
  { x: "8%", size: 11, dur: 14, delay: 0, color: "rgba(16, 185, 129, 0.35)" },
  { x: "19%", size: 16, dur: 18, delay: 2, color: "rgba(14, 165, 233, 0.32)" },
  { x: "31%", size: 9, dur: 12, delay: 4, color: "rgba(245, 158, 11, 0.32)" },
  { x: "45%", size: 14, dur: 16, delay: 1, color: "rgba(139, 92, 246, 0.28)" },
  { x: "58%", size: 18, dur: 20, delay: 3, color: "rgba(244, 63, 94, 0.26)" },
  { x: "71%", size: 10, dur: 13, delay: 5, color: "rgba(6, 182, 212, 0.34)" },
  { x: "84%", size: 15, dur: 17, delay: 2.5, color: "rgba(245, 158, 11, 0.30)" },
  { x: "93%", size: 11, dur: 15, delay: 0.8, color: "rgba(16, 185, 129, 0.32)" },
];

export const AnimatedScienceCanvas: React.FC<AnimatedScienceCanvasProps> = ({
  reducedMotion,
  theme,
}) => {
  // Keep High-Contrast and Sepia crystal-clean without visual clutter
  if (theme === "high-contrast") {
    return null;
  }

  const isDark = theme === "dark";
  const isSepia = theme === "sepia";

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 pointer-events-none overflow-hidden z-0"
    >
      {/* 1. Joyful Multi-Pastel Flowing Gradient Background Layer */}
      {!isDark && !isSepia && (
        <div className="absolute inset-0 mint-animated-bg opacity-95" />
      )}
      {isDark && (
        <div
          className="absolute inset-0 opacity-45"
          style={{
            background:
              "radial-gradient(circle at 18% 20%, rgba(16, 185, 129, 0.18), transparent 45%), radial-gradient(circle at 82% 75%, rgba(14, 165, 233, 0.16), transparent 50%), radial-gradient(circle at 50% 45%, rgba(139, 92, 246, 0.12), transparent 55%)",
          }}
        />
      )}

      {/* 2. Drifting Luminous Multi-Color Bubbles & Micro-Particles */}
      {PARTICLES.map((p, idx) => (
        <motion.div
          key={idx}
          className="absolute rounded-full"
          style={{
            left: p.x,
            bottom: "-30px",
            width: p.size,
            height: p.size,
            background: isSepia
              ? "radial-gradient(circle, rgba(15,118,110,0.16), transparent)"
              : `radial-gradient(circle, ${p.color}, transparent 75%)`,
            boxShadow: isSepia ? "none" : `0 0 14px ${p.color}`,
          }}
          animate={
            reducedMotion
              ? { y: -220, opacity: 0.35 }
              : {
                  y: [0, -950],
                  x: [0, idx % 2 === 0 ? 28 : -28, 0],
                  opacity: [0, 0.8, 0.65, 0],
                  scale: [0.8, 1.15, 0.9],
                }
          }
          transition={
            reducedMotion
              ? undefined
              : {
                  duration: p.dur,
                  delay: p.delay,
                  repeat: Infinity,
                  ease: "easeInOut",
                }
          }
        />
      ))}

      {/* 3. Ambient Floating & Rotating 3D-style Scientific Geometry */}
      {/* Top-right 3D Orbital Atom */}
      <motion.svg
        viewBox="0 0 140 140"
        className="hidden md:block absolute top-24 right-8 w-36 h-36 opacity-25"
        animate={
          reducedMotion
            ? undefined
            : {
                y: [0, -14, 0],
                rotate: [0, 360],
              }
        }
        transition={{
          y: { duration: 7, repeat: Infinity, ease: "easeInOut" },
          rotate: { duration: 44, repeat: Infinity, ease: "linear" },
        }}
      >
        <ellipse cx="70" cy="70" rx="52" ry="20" fill="none" stroke="#059669" strokeWidth="2.2" />
        <ellipse cx="70" cy="70" rx="52" ry="20" transform="rotate(60 70 70)" fill="none" stroke="#0284C7" strokeWidth="2.2" />
        <ellipse cx="70" cy="70" rx="52" ry="20" transform="rotate(-60 70 70)" fill="none" stroke="#8B5CF6" strokeWidth="2.2" />
        <circle cx="70" cy="70" r="8" fill="#F59E0B" />
      </motion.svg>

      {/* Bottom-left Floating Isometric Polyhedron */}
      <motion.svg
        viewBox="0 0 140 140"
        className="hidden md:block absolute bottom-14 left-10 w-32 h-32 opacity-22"
        animate={
          reducedMotion
            ? undefined
            : {
                y: [0, 16, 0],
                rotate: [-12, 12, -12],
                scale: [0.95, 1.05, 0.95],
              }
        }
        transition={{ duration: 11, repeat: Infinity, ease: "easeInOut" }}
      >
        <polygon
          points="70,12 120,42 120,98 70,128 20,98 20,42"
          fill="rgba(14,165,233,0.12)"
          stroke="#0284C7"
          strokeWidth="2"
        />
        <line x1="70" y1="12" x2="70" y2="70" stroke="#10B981" strokeWidth="1.8" />
        <line x1="120" y1="42" x2="70" y2="70" stroke="#F59E0B" strokeWidth="1.8" />
        <line x1="20" y1="42" x2="70" y2="70" stroke="#8B5CF6" strokeWidth="1.8" />
        <line x1="70" y1="128" x2="70" y2="70" stroke="#EC4899" strokeWidth="1.8" />
      </motion.svg>

      {/* Mid-left Floating Hexagon Molecule */}
      <motion.svg
        viewBox="0 0 100 100"
        className="hidden lg:block absolute top-1/2 left-6 w-24 h-24 opacity-22"
        animate={
          reducedMotion
            ? undefined
            : {
                y: [-10, 12, -10],
                rotate: [0, -360],
              }
        }
        transition={{
          y: { duration: 8.5, repeat: Infinity, ease: "easeInOut" },
          rotate: { duration: 38, repeat: Infinity, ease: "linear" },
        }}
      >
        <polygon
          points="50,10 85,30 85,70 50,90 15,70 15,30"
          fill="none"
          stroke="#EC4899"
          strokeWidth="2.2"
        />
        <circle cx="50" cy="10" r="4.5" fill="#10B981" />
        <circle cx="85" cy="70" r="4.5" fill="#0284C7" />
        <circle cx="15" cy="70" r="4.5" fill="#F59E0B" />
      </motion.svg>
    </div>
  );
};

import React from "react";
import { motion } from "motion/react";
import type { SubjectId } from "../types.ts";

interface SubjectSculptureProps {
  subjectId: SubjectId;
  size?: "sm" | "md" | "lg";
  reducedMotion?: boolean;
}

export const SubjectSculpture: React.FC<SubjectSculptureProps> = ({
  subjectId,
  size = "md",
  reducedMotion = false,
}) => {
  const dims =
    size === "lg" ? "w-24 h-24" : size === "sm" ? "w-12 h-12" : "w-16 h-16";

  if (subjectId === "chemistry") {
    return (
      <div className={`${dims} relative shrink-0 select-none`} aria-hidden="true">
        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible">
          <defs>
            <linearGradient id="chemFlaskGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#10B981" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#0284C7" stopOpacity="0.65" />
            </linearGradient>
          </defs>

          {/* Spinning Atomic Orbitals */}
          <motion.g
            style={{ originX: "60px", originY: "52px" }}
            animate={reducedMotion ? undefined : { rotate: 360 }}
            transition={{ duration: 11, repeat: Infinity, ease: "linear" }}
          >
            <ellipse
              cx="60"
              cy="52"
              rx="42"
              ry="16"
              fill="none"
              stroke="#0D9488"
              strokeWidth="1.6"
              strokeDasharray="4 3"
              opacity="0.7"
            />
            <circle cx="102" cy="52" r="3.5" fill="#14B8A6" />
            <circle cx="18" cy="52" r="3.5" fill="#0284C7" />
          </motion.g>

          <motion.g
            style={{ originX: "60px", originY: "52px" }}
            animate={reducedMotion ? undefined : { rotate: -360 }}
            transition={{ duration: 14, repeat: Infinity, ease: "linear" }}
          >
            <ellipse
              cx="60"
              cy="52"
              rx="16"
              ry="42"
              transform="rotate(35 60 52)"
              fill="none"
              stroke="#0284C7"
              strokeWidth="1.4"
              opacity="0.55"
            />
          </motion.g>

          {/* Erlenmeyer Flask Body */}
          <path
            d="M48 26 H72 V42 L94 86 C96 91 92 96 86 96 H34 C28 96 24 91 26 86 L48 42 Z"
            fill="url(#chemFlaskGrad)"
            stroke="#0F766E"
            strokeWidth="2.4"
            strokeLinejoin="round"
          />
          <rect x="44" y="22" width="32" height="5" rx="2.5" fill="#0F766E" />

          {/* Liquid Wave Inside Flask */}
          <motion.path
            d="M32 76 Q46 71 60 76 T88 76 L91 86 C93 90 89 93 85 93 H35 C31 93 27 90 29 86 Z"
            fill="#10B981"
            opacity="0.7"
            animate={
              reducedMotion
                ? undefined
                : {
                    d: [
                      "M32 76 Q46 71 60 76 T88 76 L91 86 C93 90 89 93 85 93 H35 C31 93 27 90 29 86 Z",
                      "M32 76 Q46 81 60 76 T88 76 L91 86 C93 90 89 93 85 93 H35 C31 93 27 90 29 86 Z",
                      "M32 76 Q46 71 60 76 T88 76 L91 86 C93 90 89 93 85 93 H35 C31 93 27 90 29 86 Z",
                    ],
                  }
            }
            transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
          />

          {/* Rising Reaction Bubbles */}
          {[
            { cx: 52, r: 3.2, delay: 0 },
            { cx: 64, r: 4, delay: 0.7 },
            { cx: 58, r: 2.6, delay: 1.4 },
          ].map((b, i) => (
            <motion.circle
              key={i}
              cx={b.cx}
              cy={82}
              r={b.r}
              fill="#ECFDF5"
              stroke="#059669"
              strokeWidth="1"
              animate={
                reducedMotion
                  ? undefined
                  : {
                      cy: [82, 34, 14],
                      opacity: [0, 1, 0],
                      scale: [0.6, 1.1, 0.7],
                    }
              }
              transition={{
                duration: 2.6,
                delay: b.delay,
                repeat: Infinity,
                ease: "easeOut",
              }}
            />
          ))}

          {/* Bonding & Detaching Molecule Pair */}
          <motion.g
            animate={reducedMotion ? undefined : { x: [-3, 4, -3] }}
            transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
          >
            <line x1="20" y1="28" x2="34" y2="28" stroke="#0284C7" strokeWidth="2.2" strokeDasharray="3 2" />
            <circle cx="18" cy="28" r="5" fill="#38BDF8" stroke="#0369A1" strokeWidth="1.5" />
            <circle cx="36" cy="28" r="5" fill="#34D399" stroke="#047857" strokeWidth="1.5" />
          </motion.g>
        </svg>
      </div>
    );
  }

  if (subjectId === "physics") {
    return (
      <div className={`${dims} relative shrink-0 select-none`} aria-hidden="true">
        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible">
          {/* Multi-axis Rotating Atom */}
          <motion.g
            style={{ originX: "58px", originY: "52px" }}
            animate={reducedMotion ? undefined : { rotate: 360 }}
            transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
          >
            <ellipse cx="58" cy="52" rx="40" ry="15" fill="none" stroke="#0284C7" strokeWidth="2" opacity="0.85" />
            <circle cx="98" cy="52" r="4" fill="#38BDF8" />
          </motion.g>

          <motion.g
            style={{ originX: "58px", originY: "52px" }}
            animate={reducedMotion ? undefined : { rotate: -360 }}
            transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
          >
            <ellipse
              cx="58"
              cy="52"
              rx="40"
              ry="15"
              transform="rotate(60 58 52)"
              fill="none"
              stroke="#0EA5E9"
              strokeWidth="1.8"
              opacity="0.7"
            />
            <ellipse
              cx="58"
              cy="52"
              rx="40"
              ry="15"
              transform="rotate(-60 58 52)"
              fill="none"
              stroke="#10B981"
              strokeWidth="1.8"
              opacity="0.7"
            />
          </motion.g>

          {/* Atom Nucleus */}
          <motion.circle
            cx="58"
            cy="52"
            r="8"
            fill="#0284C7"
            animate={reducedMotion ? undefined : { scale: [1, 1.18, 1] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
          />

          {/* U-Magnet & Magnetic Field Pulse */}
          <motion.g
            transform="translate(76, 70) scale(0.65)"
            animate={reducedMotion ? undefined : { y: [-2, 3, -2], rotate: [-5, 5, -5] }}
            transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
          >
            <path
              d="M10 10 V28 C10 40 34 40 34 28 V10"
              fill="none"
              stroke="#DC2626"
              strokeWidth="9"
              strokeLinecap="round"
            />
            <rect x="5" y="4" width="10" height="8" rx="1.5" fill="#E2E8F0" stroke="#475569" strokeWidth="1" />
            <rect x="29" y="4" width="10" height="8" rx="1.5" fill="#38BDF8" stroke="#0369A1" strokeWidth="1" />
          </motion.g>

          {/* Moving Sine Wave */}
          <motion.path
            d="M12 98 Q27 84 42 98 T72 98 T102 98"
            fill="none"
            stroke="#059669"
            strokeWidth="2.6"
            strokeLinecap="round"
            animate={
              reducedMotion
                ? undefined
                : {
                    d: [
                      "M12 98 Q27 84 42 98 T72 98 T102 98",
                      "M12 98 Q27 112 42 98 T72 98 T102 98",
                      "M12 98 Q27 84 42 98 T72 98 T102 98",
                    ],
                  }
            }
            transition={{ duration: 2.1, repeat: Infinity, ease: "easeInOut" }}
          />
        </svg>
      </div>
    );
  }

  if (subjectId === "biology") {
    return (
      <div className={`${dims} relative shrink-0 select-none`} aria-hidden="true">
        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible">
          {/* Pulsing Living Cell */}
          <motion.g
            style={{ originX: "34px", originY: "64px" }}
            animate={reducedMotion ? undefined : { scale: [1, 1.08, 1] }}
            transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
          >
            <circle cx="34" cy="64" r="22" fill="#D1FAE5" stroke="#059669" strokeWidth="2.2" />
            <circle cx="34" cy="64" r="9" fill="#10B981" opacity="0.85" />
            <circle cx="24" cy="54" r="2.5" fill="#047857" />
            <circle cx="44" cy="72" r="2.5" fill="#047857" />
          </motion.g>

          {/* Twisting DNA Double Helix */}
          <motion.g
            style={{ originX: "78px", originY: "58px" }}
            animate={reducedMotion ? undefined : { rotateY: [0, 25, 0, -25, 0], y: [-2, 2, -2] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          >
            <path
              d="M66 18 C92 32, 64 52, 90 66 C112 78, 66 94, 88 106"
              fill="none"
              stroke="#059669"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <path
              d="M90 18 C64 32, 92 52, 66 66 C44 78, 90 94, 68 106"
              fill="none"
              stroke="#0284C7"
              strokeWidth="3"
              strokeLinecap="round"
            />
            {[28, 44, 60, 76, 92].map((y, idx) => (
              <motion.line
                key={idx}
                x1="70"
                y1={y}
                x2="86"
                y2={y}
                stroke="#14B8A6"
                strokeWidth="2.2"
                strokeLinecap="round"
                animate={reducedMotion ? undefined : { opacity: [0.4, 1, 0.4] }}
                transition={{ duration: 1.8, delay: idx * 0.25, repeat: Infinity }}
              />
            ))}
          </motion.g>

          {/* Swaying Botanical Leaf */}
          <motion.g
            style={{ originX: "32px", originY: "34px" }}
            animate={reducedMotion ? undefined : { rotate: [-6, 8, -6] }}
            transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
          >
            <path
              d="M22 34 C22 18, 40 12, 48 20 C44 34, 32 38, 22 34 Z"
              fill="#34D399"
              stroke="#047857"
              strokeWidth="1.8"
            />
            <line x1="23" y1="33" x2="43" y2="22" stroke="#065F46" strokeWidth="1.4" />
          </motion.g>
        </svg>
      </div>
    );
  }

  if (subjectId === "geology") {
    return (
      <div className={`${dims} relative shrink-0 select-none`} aria-hidden="true">
        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible">
          {/* Rotating Planet / Earth Globe */}
          <motion.g
            style={{ originX: "58px", originY: "52px" }}
            animate={reducedMotion ? undefined : { rotate: 360 }}
            transition={{ duration: 22, repeat: Infinity, ease: "linear" }}
          >
            <circle cx="58" cy="52" r="32" fill="#BAE6FD" stroke="#0369A1" strokeWidth="2.4" />
            <path
              d="M36 42 C46 34, 58 46, 68 38 C76 34, 82 44, 76 58 C68 68, 52 72, 42 62 Z"
              fill="#10B981"
              opacity="0.78"
            />
            <ellipse cx="58" cy="52" rx="14" ry="32" fill="none" stroke="#0369A1" strokeWidth="1.2" opacity="0.5" />
            <line x1="26" y1="52" x2="90" y2="52" stroke="#0369A1" strokeWidth="1.2" opacity="0.5" />
          </motion.g>

          {/* Tectonic Strata Layers */}
          <motion.g
            animate={reducedMotion ? undefined : { y: [-1.5, 1.5, -1.5] }}
            transition={{ duration: 3.6, repeat: Infinity, ease: "easeInOut" }}
          >
            <path d="M18 92 Q45 86 68 92 T102 90 L102 98 L18 98 Z" fill="#D97706" opacity="0.85" />
            <path d="M18 98 L102 98 L102 106 L18 106 Z" fill="#92400E" opacity="0.9" />
          </motion.g>

          {/* Gleaming Mineral Crystal */}
          <motion.polygon
            points="88,48 98,62 94,82 82,82 78,62"
            fill="#6EE7B7"
            stroke="#047857"
            strokeWidth="2"
            animate={reducedMotion ? undefined : { scale: [1, 1.12, 1], opacity: [0.85, 1, 0.85] }}
            transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
          />
        </svg>
      </div>
    );
  }

  // Mathematics: rotating & scaling geometric shapes + orbiting formulas/symbols
  return (
    <div className={`${dims} relative shrink-0 select-none`} aria-hidden="true">
      <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible">
        {/* Rotating Geometric Wireframe Cube/Hexagon */}
        <motion.g
          style={{ originX: "60px", originY: "58px" }}
          animate={reducedMotion ? undefined : { rotate: 360, scale: [0.95, 1.07, 0.95] }}
          transition={{ duration: 12, repeat: Infinity, ease: "linear" }}
        >
          <polygon
            points="60,20 94,40 94,78 60,98 26,78 26,40"
            fill="#EDE9FE"
            fillOpacity="0.45"
            stroke="#7C3AED"
            strokeWidth="2.2"
          />
          <polygon
            points="60,32 82,74 38,74"
            fill="#10B981"
            fillOpacity="0.28"
            stroke="#059669"
            strokeWidth="2"
          />
        </motion.g>

        {/* Orbiting Math Symbols (π, ∑, √) */}
        <motion.text
          x="16"
          y="30"
          fontSize="16"
          fontWeight="700"
          fill="#7C3AED"
          animate={reducedMotion ? undefined : { y: [28, 22, 28], scale: [1, 1.15, 1] }}
          transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
        >
          π
        </motion.text>
        <motion.text
          x="92"
          y="34"
          fontSize="15"
          fontWeight="700"
          fill="#0284C7"
          animate={reducedMotion ? undefined : { y: [32, 38, 32], scale: [1, 1.15, 1] }}
          transition={{ duration: 3.1, delay: 0.4, repeat: Infinity, ease: "easeInOut" }}
        >
          ∑
        </motion.text>
        <motion.text
          x="88"
          y="102"
          fontSize="15"
          fontWeight="700"
          fill="#059669"
          animate={reducedMotion ? undefined : { x: [88, 93, 88] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
        >
          √x
        </motion.text>
      </svg>
    </div>
  );
};

import React from "react";

export interface CartoonAvatarDef {
  id: string;
  nameAr: string;
  nameEn: string;
  bgColor: string;
  ringColor: string;
}

export const CARTOON_AVATARS: CartoonAvatarDef[] = [
  {
    id: "robo_sprout",
    nameAr: "روبوت النبتة",
    nameEn: "Sprout Bot",
    bgColor: "#E4F2EC",
    ringColor: "#2F6B5B",
  },
  {
    id: "kitty_chemist",
    nameAr: "قطة المختبر",
    nameEn: "Lab Kitty",
    bgColor: "#FCE8EF",
    ringColor: "#DB2777",
  },
  {
    id: "bunny_star",
    nameAr: "أرنوب النجمة",
    nameEn: "Star Bunny",
    bgColor: "#EDE9FE",
    ringColor: "#7C3AED",
  },
  {
    id: "panda_genius",
    nameAr: "باندا الذكية",
    nameEn: "Smart Panda",
    bgColor: "#E6F4EA",
    ringColor: "#15803D",
  },
  {
    id: "fox_explorer",
    nameAr: "ثعلب المستكشف",
    nameEn: "Explorer Fox",
    bgColor: "#FFEDD5",
    ringColor: "#EA580C",
  },
  {
    id: "owl_professor",
    nameAr: "بومة العلماء",
    nameEn: "Prof. Owl",
    bgColor: "#E0F2FE",
    ringColor: "#0284C7",
  },
  {
    id: "bear_honey",
    nameAr: "دبدوب العسل",
    nameEn: "Honey Bear",
    bgColor: "#FEF3C7",
    ringColor: "#D97706",
  },
  {
    id: "astro_duck",
    nameAr: "بطة الفضاء",
    nameEn: "Astro Duck",
    bgColor: "#FEF9C3",
    ringColor: "#CA8A04",
  },
];

export const VALID_AVATAR_IDS = CARTOON_AVATARS.map((a) => a.id);

export function pickDeterministicAvatarId(seed: string): string {
  const s = String(seed || "student");
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  }
  return CARTOON_AVATARS[hash % CARTOON_AVATARS.length].id;
}

interface CartoonAvatarProps {
  avatarId?: string;
  seed?: string;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<CartoonAvatarProps["size"]>, string> = {
  xs: "w-7 h-7",
  sm: "w-10 h-10",
  md: "w-12 h-12",
  lg: "w-16 h-16",
};

export const CartoonAvatar: React.FC<CartoonAvatarProps> = ({
  avatarId,
  seed = "",
  size = "sm",
  className = "",
}) => {
  const resolvedId =
    avatarId && VALID_AVATAR_IDS.includes(avatarId)
      ? avatarId
      : pickDeterministicAvatarId(seed);
  const def = CARTOON_AVATARS.find((a) => a.id === resolvedId) || CARTOON_AVATARS[0];

  return (
    <div
      className={`${SIZE_CLASSES[size]} rounded-full shrink-0 overflow-hidden flex items-center justify-center border-2 shadow-sm ${className}`}
      style={{
        backgroundColor: def.bgColor,
        borderColor: def.ringColor,
      }}
      title={def.nameAr}
      aria-label={def.nameAr}
    >
      <svg viewBox="0 0 64 64" className="w-full h-full">
        {resolvedId === "robo_sprout" && (
          <g>
            {/* Sprout */}
            <path d="M32 14 L32 8" stroke="#2F6B5B" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M32 10 C27 5, 22 8, 25 12 C28 14, 31 12, 32 10 Z" fill="#5CA37A" />
            <path d="M32 10 C37 5, 42 8, 39 12 C36 14, 33 12, 32 10 Z" fill="#89A185" />
            {/* Ear pods */}
            <rect x="11" y="28" width="6" height="12" rx="3" fill="#89A185" />
            <rect x="47" y="28" width="6" height="12" rx="3" fill="#89A185" />
            {/* Head */}
            <rect x="16" y="16" width="32" height="32" rx="11" fill="#FFFFFF" stroke="#2F6B5B" strokeWidth="2.2" />
            {/* Visor */}
            <rect x="20" y="23" width="24" height="13" rx="6" fill="#172823" />
            {/* Cute eyes */}
            <circle cx="27" cy="29.5" r="2.6" fill="#A4CBBF" />
            <circle cx="37" cy="29.5" r="2.6" fill="#A4CBBF" />
            <circle cx="27.8" cy="28.7" r="0.9" fill="#FFFFFF" />
            <circle cx="37.8" cy="28.7" r="0.9" fill="#FFFFFF" />
            {/* Cheeks & smile */}
            <circle cx="22" cy="39" r="2.5" fill="#FDA4AF" opacity="0.7" />
            <circle cx="42" cy="39" r="2.5" fill="#FDA4AF" opacity="0.7" />
            <path d="M27 40 Q32 44 37 40" fill="none" stroke="#2F6B5B" strokeWidth="2.2" strokeLinecap="round" />
          </g>
        )}

        {resolvedId === "kitty_chemist" && (
          <g>
            {/* Cat ears */}
            <path d="M16 26 L18 11 L29 19 Z" fill="#FFFFFF" stroke="#DB2777" strokeWidth="2" strokeLinejoin="round" />
            <path d="M48 26 L46 11 L35 19 Z" fill="#FFFFFF" stroke="#DB2777" strokeWidth="2" strokeLinejoin="round" />
            <path d="M19 22 L20 14 L26 19 Z" fill="#FBCFE8" />
            <path d="M45 22 L44 14 L38 19 Z" fill="#FBCFE8" />
            {/* Face */}
            <circle cx="32" cy="35" r="17" fill="#FFFFFF" stroke="#DB2777" strokeWidth="2" />
            {/* Round lab glasses */}
            <circle cx="25" cy="32" r="5.5" fill="#E0F2FE" stroke="#475569" strokeWidth="1.8" />
            <circle cx="39" cy="32" r="5.5" fill="#E0F2FE" stroke="#475569" strokeWidth="1.8" />
            <line x1="30.5" y1="32" x2="33.5" y2="32" stroke="#475569" strokeWidth="1.8" />
            {/* Eyes */}
            <circle cx="25" cy="32.5" r="2.2" fill="#1E293B" />
            <circle cx="39" cy="32.5" r="2.2" fill="#1E293B" />
            <circle cx="25.7" cy="31.7" r="0.8" fill="#FFFFFF" />
            <circle cx="39.7" cy="31.7" r="0.8" fill="#FFFFFF" />
            {/* Nose & mouth */}
            <polygon points="32,37 30,39.5 34,39.5" fill="#F472B6" />
            <path d="M28 41.5 Q30 43.5 32 41 Q34 43.5 36 41.5" fill="none" stroke="#9D174D" strokeWidth="1.8" strokeLinecap="round" />
            {/* Cheeks */}
            <circle cx="19" cy="39" r="2.6" fill="#F9A8D4" opacity="0.7" />
            <circle cx="45" cy="39" r="2.6" fill="#F9A8D4" opacity="0.7" />
          </g>
        )}

        {resolvedId === "bunny_star" && (
          <g>
            {/* Long ears */}
            <ellipse cx="23" cy="17" rx="5.5" ry="12" transform="rotate(-10 23 17)" fill="#FFFFFF" stroke="#7C3AED" strokeWidth="2" />
            <ellipse cx="41" cy="17" rx="5.5" ry="12" transform="rotate(10 41 17)" fill="#FFFFFF" stroke="#7C3AED" strokeWidth="2" />
            <ellipse cx="23" cy="17" rx="2.7" ry="8" transform="rotate(-10 23 17)" fill="#DDD6FE" />
            <ellipse cx="41" cy="17" rx="2.7" ry="8" transform="rotate(10 41 17)" fill="#DDD6FE" />
            {/* Face */}
            <circle cx="32" cy="38" r="16" fill="#FFFFFF" stroke="#7C3AED" strokeWidth="2" />
            {/* Eyes */}
            <circle cx="26" cy="36" r="2.6" fill="#1E293B" />
            <circle cx="38" cy="36" r="2.6" fill="#1E293B" />
            <circle cx="26.8" cy="35.1" r="0.9" fill="#FFFFFF" />
            <circle cx="38.8" cy="35.1" r="0.9" fill="#FFFFFF" />
            {/* Cheeks & smile */}
            <circle cx="21" cy="40" r="2.8" fill="#FDA4AF" opacity="0.75" />
            <circle cx="43" cy="40" r="2.8" fill="#FDA4AF" opacity="0.75" />
            <path d="M29 42 Q32 45 35 42" fill="none" stroke="#6D28D9" strokeWidth="2" strokeLinecap="round" />
            {/* Cute Star sticker */}
            <polygon points="48,14 49.5,17.5 53,17.8 50.2,20 51,23.5 48,21.5 45,23.5 45.8,20 43,17.8 46.5,17.5" fill="#FBBF24" />
          </g>
        )}

        {resolvedId === "panda_genius" && (
          <g>
            {/* Round ears */}
            <circle cx="17" cy="20" r="6.5" fill="#1E293B" />
            <circle cx="47" cy="20" r="6.5" fill="#1E293B" />
            {/* Head */}
            <circle cx="32" cy="35" r="17" fill="#FFFFFF" stroke="#15803D" strokeWidth="2" />
            {/* Eye patches */}
            <ellipse cx="25" cy="33" rx="5" ry="6" transform="rotate(-15 25 33)" fill="#1E293B" />
            <ellipse cx="39" cy="33" rx="5" ry="6" transform="rotate(15 39 33)" fill="#1E293B" />
            {/* Eyes */}
            <circle cx="25.5" cy="32.5" r="2" fill="#FFFFFF" />
            <circle cx="38.5" cy="32.5" r="2" fill="#FFFFFF" />
            <circle cx="25.8" cy="32.5" r="1" fill="#0F172A" />
            <circle cx="38.2" cy="32.5" r="1" fill="#0F172A" />
            {/* Nose & cheeks */}
            <ellipse cx="32" cy="39" rx="3" ry="2" fill="#1E293B" />
            <path d="M28.5 43 Q32 45.5 35.5 43" fill="none" stroke="#1E293B" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="20" cy="40" r="2.5" fill="#FDA4AF" opacity="0.7" />
            <circle cx="44" cy="40" r="2.5" fill="#FDA4AF" opacity="0.7" />
            {/* Tiny leaf headband */}
            <path d="M28 17 C31 12, 36 12, 37 17 C34 19, 30 19, 28 17 Z" fill="#22C55E" />
          </g>
        )}

        {resolvedId === "fox_explorer" && (
          <g>
            {/* Pointy ears */}
            <path d="M14 28 L17 10 L29 20 Z" fill="#F97316" stroke="#C2410C" strokeWidth="1.8" strokeLinejoin="round" />
            <path d="M50 28 L47 10 L35 20 Z" fill="#F97316" stroke="#C2410C" strokeWidth="1.8" strokeLinejoin="round" />
            <path d="M17 24 L19 14 L25 20 Z" fill="#FED7AA" />
            <path d="M47 24 L45 14 L39 20 Z" fill="#FED7AA" />
            {/* Face */}
            <circle cx="32" cy="36" r="16.5" fill="#F97316" stroke="#C2410C" strokeWidth="1.8" />
            {/* Cream cheek fur */}
            <path d="M16 37 Q24 33 32 43 Q40 33 48 37 Q46 51 32 52 Q18 51 16 37 Z" fill="#FFF7ED" />
            {/* Eyes */}
            <circle cx="25.5" cy="33" r="2.5" fill="#1E293B" />
            <circle cx="38.5" cy="33" r="2.5" fill="#1E293B" />
            <circle cx="26.2" cy="32.2" r="0.9" fill="#FFFFFF" />
            <circle cx="39.2" cy="32.2" r="0.9" fill="#FFFFFF" />
            {/* Nose & happy smile */}
            <circle cx="32" cy="40.5" r="2.3" fill="#1E293B" />
            <path d="M28.5 44 Q32 47 35.5 44" fill="none" stroke="#9A3412" strokeWidth="1.8" strokeLinecap="round" />
          </g>
        )}

        {resolvedId === "owl_professor" && (
          <g>
            {/* Ear tufts */}
            <path d="M17 23 L14 13 L25 18 Z" fill="#0284C7" />
            <path d="M47 23 L50 13 L39 18 Z" fill="#0284C7" />
            {/* Body/Head */}
            <circle cx="32" cy="36" r="17" fill="#38BDF8" stroke="#0369A1" strokeWidth="2" />
            {/* Big Owl Eye Circles */}
            <circle cx="25" cy="34" r="7.5" fill="#FFFFFF" stroke="#0369A1" strokeWidth="1.5" />
            <circle cx="39" cy="34" r="7.5" fill="#FFFFFF" stroke="#0369A1" strokeWidth="1.5" />
            <circle cx="25.5" cy="34" r="3" fill="#0F172A" />
            <circle cx="38.5" cy="34" r="3" fill="#0F172A" />
            <circle cx="26.3" cy="33" r="1" fill="#FFFFFF" />
            <circle cx="39.3" cy="33" r="1" fill="#FFFFFF" />
            {/* Cute orange beak */}
            <polygon points="32,37 29,42 35,42" fill="#F59E0B" stroke="#B45309" strokeWidth="1" />
            {/* Cheeks */}
            <circle cx="19" cy="41" r="2.4" fill="#FDA4AF" opacity="0.7" />
            <circle cx="45" cy="41" r="2.4" fill="#FDA4AF" opacity="0.7" />
          </g>
        )}

        {resolvedId === "bear_honey" && (
          <g>
            {/* Bear ears */}
            <circle cx="17" cy="20" r="6.5" fill="#D97706" stroke="#92400E" strokeWidth="1.8" />
            <circle cx="47" cy="20" r="6.5" fill="#D97706" stroke="#92400E" strokeWidth="1.8" />
            <circle cx="17" cy="20" r="3.2" fill="#FDE68A" />
            <circle cx="47" cy="20" r="3.2" fill="#FDE68A" />
            {/* Head */}
            <circle cx="32" cy="35" r="17" fill="#F59E0B" stroke="#92400E" strokeWidth="1.8" />
            {/* Snout */}
            <ellipse cx="32" cy="40" rx="8" ry="6.2" fill="#FEF3C7" />
            {/* Eyes */}
            <circle cx="25" cy="32" r="2.5" fill="#1E293B" />
            <circle cx="39" cy="32" r="2.5" fill="#1E293B" />
            <circle cx="25.7" cy="31.2" r="0.8" fill="#FFFFFF" />
            <circle cx="39.7" cy="31.2" r="0.8" fill="#FFFFFF" />
            {/* Nose & smile */}
            <ellipse cx="32" cy="38.5" rx="2.8" ry="2" fill="#78350F" />
            <path d="M29 42 Q32 44.5 35 42" fill="none" stroke="#78350F" strokeWidth="1.8" strokeLinecap="round" />
            {/* Mint bow tie */}
            <polygon points="32,51 25,47 25,55" fill="#2F6B5B" />
            <polygon points="32,51 39,47 39,55" fill="#2F6B5B" />
            <circle cx="32" cy="51" r="2" fill="#A4CBBF" />
          </g>
        )}

        {resolvedId === "astro_duck" && (
          <g>
            {/* Helmet outer */}
            <circle cx="32" cy="34" r="20" fill="#E0F2FE" opacity="0.55" stroke="#CA8A04" strokeWidth="2" />
            {/* Cute tuft */}
            <path d="M31 17 Q33 11 36 16 Q39 12 38 18" fill="none" stroke="#FACC15" strokeWidth="2.5" strokeLinecap="round" />
            {/* Duck face */}
            <circle cx="32" cy="36" r="15" fill="#FDE047" stroke="#CA8A04" strokeWidth="1.8" />
            {/* Eyes */}
            <circle cx="26" cy="33" r="2.5" fill="#1E293B" />
            <circle cx="38" cy="33" r="2.5" fill="#1E293B" />
            <circle cx="26.7" cy="32.2" r="0.8" fill="#FFFFFF" />
            <circle cx="38.7" cy="32.2" r="0.8" fill="#FFFFFF" />
            {/* Orange duck bill */}
            <ellipse cx="32" cy="40" rx="6.5" ry="3.6" fill="#FB923C" stroke="#C2410C" strokeWidth="1.3" />
            {/* Cheeks */}
            <circle cx="21" cy="38" r="2.5" fill="#FDA4AF" opacity="0.7" />
            <circle cx="43" cy="38" r="2.5" fill="#FDA4AF" opacity="0.7" />
          </g>
        )}
      </svg>
    </div>
  );
};

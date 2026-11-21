import React from "react";
import {
  X,
  Volume2,
  Eye,
  Ear,
  Brain,
  Keyboard,
  RotateCcw,
  Mic,
} from "lucide-react";
import type { AccessibilitySettings, LearningAccommodation, ThemeMode } from "../types.ts";

interface AccessibilityDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AccessibilitySettings;
  onUpdate: (patch: Partial<AccessibilitySettings>) => void;
  onReset: () => void;
  onReadCurrentPage: () => void;
  onToggleVoiceCommand: () => void;
  isListeningCommand: boolean;
}

const ACCOMMODATION_OPTIONS: Array<{
  id: LearningAccommodation;
  label: string;
  desc: string;
  icon: React.ReactNode;
}> = [
  {
    id: "visual_impairment",
    label: "دعم المكفوفين وضعاف البصر",
    desc: "تفعيل القارئ الصوتي التلقائي ووصف الرسوم العلمية",
    icon: <Eye className="w-4 h-4 shrink-0" />,
  },
  {
    id: "hearing_impairment",
    label: "دعم الصم وضعاف السمع",
    desc: "تفعيل الترجمة المكتوبة [CC] ومصطلحات لغة الإشارة",
    icon: <Ear className="w-4 h-4 shrink-0" />,
  },
  {
    id: "learning_difficulty",
    label: "دعم صعوبات التعلم وعسر القراءة",
    desc: "خطوات مبسطة قصيرة وتباعد مريح ومسطرة قراءة",
    icon: <Brain className="w-4 h-4 shrink-0" />,
  },
  {
    id: "motor_keyboard",
    label: "دعم التنقل بلوحة المفاتيح والصوت",
    desc: "إبراز اختصارات المفاتيح والأوامر الصوتية المباشرة",
    icon: <Keyboard className="w-4 h-4 shrink-0" />,
  },
];

const THEME_OPTIONS: Array<{ id: ThemeMode; label: string }> = [
  { id: "light", label: "نهاري واضح" },
  { id: "dark", label: "داكن مريح" },
  { id: "high-contrast", label: "تباين عالٍ AAA" },
  { id: "sepia", label: "ورق دافئ" },
];

export const AccessibilityDrawer: React.FC<AccessibilityDrawerProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdate,
  onReset,
  onReadCurrentPage,
  onToggleVoiceCommand,
  isListeningCommand,
}) => {
  if (!isOpen) return null;

  const toggleAccommodation = (id: LearningAccommodation) => {
    const exists = settings.accommodations.includes(id);
    const next = exists
      ? settings.accommodations.filter((item) => item !== id)
      : [...settings.accommodations, id];

    const patch: Partial<AccessibilitySettings> = { accommodations: next };
    if (!exists) {
      if (id === "visual_impairment") {
        patch.autoReadResponses = true;
        patch.fontScale = Math.max(settings.fontScale, 1.15);
      } else if (id === "hearing_impairment") {
        patch.captionsEnabled = true;
      } else if (id === "learning_difficulty") {
        patch.simplifiedMode = true;
        patch.lineHeight = Math.max(settings.lineHeight, 1.9);
        patch.readingRuler = true;
      } else if (id === "motor_keyboard") {
        patch.keyboardHintsVisible = true;
      }
    }
    onUpdate(patch);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/45"
      role="dialog"
      aria-modal="true"
      aria-labelledby="a11y-drawer-title"
    >
      <div
        className="w-full max-w-md h-full overflow-y-auto p-6 shadow-2xl border-r"
        style={{
          backgroundColor: "var(--bg-surface)",
          color: "var(--text-primary)",
          borderColor: "var(--border-hairline)",
        }}
      >
        <div className="flex items-center justify-between gap-4 pb-4 border-b" style={{ borderColor: "var(--border-hairline)" }}>
          <div>
            <h2 id="a11y-drawer-title" className="text-lg font-bold">
              إعدادات الوصول الشامل
            </h2>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
              تُطبق التغييرات فوراً على جميع صفحات المنصة
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق لوحة إعدادات الوصول"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border transition-colors hover:opacity-80"
            style={{ borderColor: "var(--border-hairline)" }}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-6 mt-5">
          {/* Quick Voice & Read actions */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={onReadCurrentPage}
              className="min-h-[44px] px-3 py-2.5 rounded-lg font-medium text-sm flex items-center justify-center gap-2 transition-colors"
              style={{
                backgroundColor: "var(--accent-primary)",
                color: "var(--accent-contrast)",
              }}
            >
              <Volume2 className="w-4 h-4 shrink-0" />
              <span className="whitespace-nowrap">اقرأ القسم الحالي</span>
            </button>
            <button
              type="button"
              onClick={onToggleVoiceCommand}
              className="min-h-[44px] px-3 py-2.5 rounded-lg font-medium text-sm flex items-center justify-center gap-2 border transition-colors"
              style={{
                borderColor: isListeningCommand ? "var(--accent-primary)" : "var(--border-hairline)",
                backgroundColor: isListeningCommand ? "var(--bg-subtle)" : "transparent",
              }}
            >
              <Mic className="w-4 h-4 shrink-0" />
              <span className="whitespace-nowrap">
                {isListeningCommand ? "إيقاف الاستماع" : "أمر صوتي"}
              </span>
            </button>
          </div>

          {/* Learning Profiles */}
          <div>
            <h3 className="text-sm font-semibold mb-2.5">ملفات الدعم المخصصة</h3>
            <div className="space-y-2">
              {ACCOMMODATION_OPTIONS.map((opt) => {
                const active = settings.accommodations.includes(opt.id);
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => toggleAccommodation(opt.id)}
                    aria-pressed={active}
                    className="w-full text-right p-3 rounded-lg border transition-colors flex items-start gap-3"
                    style={{
                      borderColor: active ? "var(--accent-primary)" : "var(--border-hairline)",
                      backgroundColor: active ? "var(--bg-subtle)" : "transparent",
                    }}
                  >
                    <span className="mt-0.5" style={{ color: active ? "var(--accent-primary)" : "var(--text-secondary)" }}>
                      {opt.icon}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold flex items-center justify-between gap-2">
                        <span>{opt.label}</span>
                        <span className="text-xs font-mono-num">
                          {active ? "مفعّل" : "متوقف"}
                        </span>
                      </div>
                      <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                        {opt.desc}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Contrast & Color Theme */}
          <div>
            <h3 className="text-sm font-semibold mb-2.5">نمط الألوان والتباين</h3>
            <div className="grid grid-cols-2 gap-2">
              {THEME_OPTIONS.map((theme) => {
                const active = settings.theme === theme.id;
                return (
                  <button
                    key={theme.id}
                    type="button"
                    onClick={() => onUpdate({ theme: theme.id })}
                    aria-pressed={active}
                    className="min-h-[44px] px-3 py-2 rounded-lg border text-sm font-medium transition-colors whitespace-nowrap"
                    style={{
                      borderColor: active ? "var(--accent-primary)" : "var(--border-hairline)",
                      backgroundColor: active ? "var(--accent-primary)" : "transparent",
                      color: active ? "var(--accent-contrast)" : "var(--text-primary)",
                    }}
                  >
                    {theme.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Font & Spacing */}
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between text-sm mb-1.5">
                <label htmlFor="drawer-font-scale" className="font-semibold">
                  حجم الخط العام
                </label>
                <span className="font-mono-num text-xs" style={{ color: "var(--text-secondary)" }}>
                  {Math.round(settings.fontScale * 100)}%
                </span>
              </div>
              <input
                id="drawer-font-scale"
                type="range"
                min={1}
                max={1.55}
                step={0.05}
                value={settings.fontScale}
                onChange={(e) => onUpdate({ fontScale: Number(e.target.value) })}
                className="w-full accent-sky-600"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-sm mb-1.5">
                <label htmlFor="drawer-line-height" className="font-semibold">
                  تباعد الأسطر
                </label>
                <span className="font-mono-num text-xs" style={{ color: "var(--text-secondary)" }}>
                  {settings.lineHeight.toFixed(2)}×
                </span>
              </div>
              <input
                id="drawer-line-height"
                type="range"
                min={1.45}
                max={2.2}
                step={0.05}
                value={settings.lineHeight}
                onChange={(e) => onUpdate({ lineHeight: Number(e.target.value) })}
                className="w-full accent-sky-600"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-sm mb-1.5">
                <label htmlFor="drawer-speech-rate" className="font-semibold">
                  سرعة القارئ الصوتي
                </label>
                <span className="font-mono-num text-xs" style={{ color: "var(--text-secondary)" }}>
                  {settings.speechRate.toFixed(2)}×
                </span>
              </div>
              <input
                id="drawer-speech-rate"
                type="range"
                min={0.75}
                max={1.5}
                step={0.05}
                value={settings.speechRate}
                onChange={(e) => onUpdate({ speechRate: Number(e.target.value) })}
                className="w-full accent-sky-600"
              />
            </div>
          </div>

          {/* Toggles */}
          <div className="space-y-2.5">
            {[
              {
                key: "simplifiedMode" as const,
                label: "تبسيط المحتوى لخطوات قصيرة",
                checked: settings.simplifiedMode,
              },
              {
                key: "captionsEnabled" as const,
                label: "إظهار الترجمة المكتوبة للمقاطع الصوتية [CC]",
                checked: settings.captionsEnabled,
              },
              {
                key: "autoReadResponses" as const,
                label: "قراءة ردود المساعد الذكي صوتياً تلقائياً",
                checked: settings.autoReadResponses,
              },
              {
                key: "readingRuler" as const,
                label: "تفعيل مسطرة القراءة البصرية",
                checked: settings.readingRuler,
              },
              {
                key: "reduceMotion" as const,
                label: "تقليل الحركة والانتقالات",
                checked: settings.reduceMotion,
              },
              {
                key: "keyboardHintsVisible" as const,
                label: "عرض تلميحات التنقل بلوحة المفاتيح",
                checked: settings.keyboardHintsVisible,
              },
            ].map((item) => (
              <label
                key={item.key}
                className="flex items-center justify-between gap-3 p-3 rounded-lg border cursor-pointer"
                style={{ borderColor: "var(--border-hairline)" }}
              >
                <span className="text-sm font-medium">{item.label}</span>
                <input
                  type="checkbox"
                  checked={item.checked}
                  onChange={(e) => onUpdate({ [item.key]: e.target.checked })}
                  className="w-5 h-5 accent-sky-600 shrink-0"
                />
              </label>
            ))}
          </div>

          <button
            type="button"
            onClick={onReset}
            className="w-full min-h-[44px] px-4 py-2 rounded-lg border text-sm font-medium flex items-center justify-center gap-2 hover:opacity-80"
            style={{ borderColor: "var(--border-hairline)" }}
          >
            <RotateCcw className="w-4 h-4" />
            <span>استعادة الإعدادات الافتراضية</span>
          </button>
        </div>
      </div>
    </div>
  );
};

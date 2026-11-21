import React, { useState } from "react";
import {
  ShieldCheck,
  BookOpen,
  Plus,
  Trash2,
  Download,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import type {
  AccessibilitySettings,
  LessonData,
  PlatformCapabilities,
  SourcePolicy,
  UILanguage,
  WeakSpot,
} from "../types.ts";

interface TeacherAndPrivacyPanelProps {
  lesson: LessonData;
  sourcePolicy: SourcePolicy;
  onSourcePolicyChange: (policy: SourcePolicy) => void;
  onToggleSourceEnabled: (lessonId: string, sourceId: string) => void;
  onAddLessonSource: (lessonId: string, title: string, category: string, content: string) => void;
  weakSpots: WeakSpot[];
  settings: AccessibilitySettings;
  onUpdateSettings: (patch: Partial<AccessibilitySettings>) => void;
  onClearAllStudentData: () => void;
  onExportStudentData: () => void;
  capabilities: PlatformCapabilities | null;
  uiLang?: UILanguage;
}

export const TeacherAndPrivacyPanel: React.FC<TeacherAndPrivacyPanelProps> = ({
  lesson,
  sourcePolicy,
  onSourcePolicyChange,
  onToggleSourceEnabled,
  onAddLessonSource,
  weakSpots,
  settings,
  onUpdateSettings,
  onClearAllStudentData,
  onExportStudentData,
  capabilities,
  uiLang = "ar",
}) => {
  const isAr = uiLang === "ar";
  const [newTitle, setNewTitle] = useState("");
  const [newCategory, setNewCategory] = useState("ملاحظات المعلم المضافة");
  const [newContent, setNewContent] = useState("");
  const [clearConfirm, setClearConfirm] = useState(false);

  const handleAddSource = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim()) return;
    onAddLessonSource(lesson.id, newTitle.trim(), newCategory.trim(), newContent.trim());
    setNewTitle("");
    setNewContent("");
  };

  return (
    <div className="space-y-6">
      {/* Teacher Source Governance */}
      <section
        className="rounded-xl border p-6 space-y-5"
        style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}
      >
        <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-4" style={{ borderColor: "var(--border-hairline)" }}>
          <div>
            <div className="flex items-center gap-2">
              <BookOpen className="w-5 h-5" style={{ color: "var(--accent-primary)" }} />
              <h1 className="text-xl font-bold">إدارة مصادر الدرس وحوكمة البوت (للمعلم)</h1>
            </div>
            <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
              تتحكم هذه الإعدادات مباشرة في قاعدة المعرفة التي يعتمد عليها البوت التعليمي الذكي في درس "{lesson.title}".
            </p>
          </div>
        </div>

        {/* Policy Selector */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {(
            [
              {
                id: "lesson_only",
                title: "مصادر الدرس المعتمدة فقط",
                desc: "التزام صارم: يمتنع البوت عن الإجابة من خارج النصوص المفعّلة أدناه.",
              },
              {
                id: "lesson_plus_curriculum",
                title: "مصادر الدرس + المنهج المعتمد",
                desc: "يستند للدرس أولاً مع السماح بتوضيحات علمية منهجية مساندة.",
              },
              {
                id: "open_scientific",
                title: "توسع علمي مفتوح مرتبط بالدرس",
                desc: "يسمح بأمثلة إثرائية وتطبيقات حديثة مع الاستمرار في ربطها بالدرس.",
              },
            ] as Array<{ id: SourcePolicy; title: string; desc: string }>
          ).map((policy) => {
            const active = sourcePolicy === policy.id;
            return (
              <button
                key={policy.id}
                type="button"
                onClick={() => onSourcePolicyChange(policy.id)}
                className="text-right p-4 rounded-xl border space-y-1 transition-colors"
                style={{
                  borderColor: active ? "var(--accent-primary)" : "var(--border-hairline)",
                  backgroundColor: active ? "var(--bg-subtle)" : "transparent",
                }}
              >
                <div className="text-sm font-bold flex items-center justify-between gap-2">
                  <span>{policy.title}</span>
                  {active && <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: "var(--accent-primary)" }} />}
                </div>
                <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                  {policy.desc}
                </p>
              </button>
            );
          })}
        </div>

        {/* Active Knowledge Base Sources */}
        <div className="space-y-3">
          <h2 className="text-base font-bold">مصادر المعرفة الحالية للدرس</h2>
          <div className="space-y-2.5">
            {lesson.sources.map((src) => (
              <label
                key={src.id}
                className="p-4 rounded-lg border flex items-start justify-between gap-4 cursor-pointer"
                style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}
              >
                <div className="space-y-1">
                  <div className="text-sm font-bold">
                    {src.title} <span className="text-xs font-normal" style={{ color: "var(--text-secondary)" }}>({src.category})</span>
                  </div>
                  <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                    {src.content}
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={src.enabled}
                  onChange={() => onToggleSourceEnabled(lesson.id, src.id)}
                  className="w-5 h-5 accent-sky-600 mt-1 shrink-0"
                />
              </label>
            ))}
          </div>
        </div>

        {/* Add Custom Teacher Source */}
        <form onSubmit={handleAddSource} className="p-4 rounded-lg border space-y-3" style={{ borderColor: "var(--border-hairline)" }}>
          <h3 className="text-sm font-bold">إضافة مصدر جديد إلى قاعدة معرفة الدرس</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="عنوان المصدر (مثال: ورقة عمل إثرائية)"
              className="min-h-[42px] px-3 rounded-lg border text-sm"
              style={{
                backgroundColor: "var(--bg-subtle)",
                borderColor: "var(--border-hairline)",
                color: "var(--text-primary)",
              }}
            />
            <input
              type="text"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="التصنيف"
              className="min-h-[42px] px-3 rounded-lg border text-sm"
              style={{
                backgroundColor: "var(--bg-subtle)",
                borderColor: "var(--border-hairline)",
                color: "var(--text-primary)",
              }}
            />
          </div>
          <textarea
            rows={3}
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="أدخل النص العلمي المعتمد الذي سيلتزم به البوت..."
            className="w-full p-3 rounded-lg border text-sm"
            style={{
              backgroundColor: "var(--bg-subtle)",
              borderColor: "var(--border-hairline)",
              color: "var(--text-primary)",
            }}
          />
          <button
            type="submit"
            className="min-h-[42px] px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5"
            style={{ backgroundColor: "var(--accent-primary)", color: "var(--accent-contrast)" }}
          >
            <Plus className="w-4 h-4" />
            <span>إضافة المصدر لقاعدة المعرفة</span>
          </button>
        </form>
      </section>

      {/* Weak Spots Report + Privacy Protection */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section
          className="rounded-xl border p-6 space-y-4"
          style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}
        >
          <h2 className="text-lg font-bold">تقرير مواطن ضعف الفهم المرصودة</h2>
          {weakSpots.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              لم تُسجل مواطن ضعف بعد في هذه الجلسة. يتم رصدها تلقائياً عند تفاعل الطالب مع البوت أو الاختبارات المرنة.
            </p>
          ) : (
            <div className="space-y-3">
              {weakSpots.map((spot, idx) => (
                <div
                  key={idx}
                  className="p-3.5 rounded-lg border space-y-1 text-xs"
                  style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}
                >
                  <div className="flex items-center justify-between font-bold">
                    <span>{spot.concept}</span>
                    <span className="font-mono-num" style={{ color: "var(--text-secondary)" }}>
                      {spot.detectedAt}
                    </span>
                  </div>
                  <p style={{ color: "var(--text-secondary)" }}>{spot.observation}</p>
                  <p>
                    <strong>المعالجة المقترحة: </strong>
                    {spot.suggestedRemediation}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section
          className="rounded-xl border p-6 space-y-4"
          style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}
        >
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5" style={{ color: "var(--accent-primary)" }} />
            <h2 className="text-lg font-bold">حماية بيانات الطالب والخصوصية</h2>
          </div>

          <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            تُحفظ تفضيلات الوصول وتقدم الجلسة محلياً على جهاز الطالب فقط دون إنشاء ملفات تتبع إعلانية أو تخزين بصمة صوتية دائمة.
          </p>

          <label
            className="p-3.5 rounded-lg border flex items-start justify-between gap-3 cursor-pointer"
            style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}
          >
            <div>
              <div className="text-sm font-bold">الموافقة الصريحة على معالجة الذكاء الاصطناعي</div>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                عند إيقاف هذا الخيار، تتوقف جميع طلبات الشبكة نحو نماذج المحادثة والصوت والرؤية، مع بقاء أدوات العرض والقارئ المحلي فعّالة.
              </p>
            </div>
            <input
              type="checkbox"
              checked={settings.aiProcessingConsent}
              onChange={(e) => onUpdateSettings({ aiProcessingConsent: e.target.checked })}
              className="w-5 h-5 accent-sky-600 mt-1 shrink-0"
            />
          </label>

          {/* Service Configuration Readiness Summary */}
          <div
            className="p-3.5 rounded-lg border space-y-1.5 text-xs"
            style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}
          >
            <div className="font-bold">
              {isAr ? "جاهزية الخدمات والربط التقني" : "Technical Services & API Readiness"}
            </div>
            <div className="flex items-center gap-2">
              {capabilities?.geminiConfigured ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              )}
              <span>
                {isAr ? "محرك الذكاء الاصطناعي (Gemini API):" : "Gemini AI Engine:"}{" "}
                {capabilities?.geminiConfigured
                  ? isAr ? "مهيأ ويعمل عبر الخادم" : "Configured on server"
                  : isAr ? "غير مهيأ (يتطلب GEMINI_API_KEY على الخادم)" : "Not configured (requires GEMINI_API_KEY)"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>
                {isAr
                  ? `قاعدة بيانات الدروس والنتاجات (${capabilities?.databaseEngine || "SQLite"}) والبث المباشر (${capabilities?.realtimeEngine || "WebSocket"}): نشطة`
                  : `Database (${capabilities?.databaseEngine || "SQLite"}) & Live Quiz (${capabilities?.realtimeEngine || "WebSocket"}): Active`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                {isAr
                  ? "توليد الفيديو عبر Veo API (gemini-omni-1.2-flash): يتطلب مفتاح فوترة مدفوع (البديل المدمج WebM يعمل مجاناً في المتصفح)"
                  : "Veo Video API: requires a paid billing key (built-in Canvas/WebM assembler works locally)"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {capabilities?.signLanguageExternalService.configured ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              )}
              <span>
                {isAr ? "خدمة فيديو لغة الإشارة الآلية:" : "Automated Sign Language Video API:"}{" "}
                {capabilities?.signLanguageExternalService.configured
                  ? isAr ? "مهيأة" : "Configured"
                  : isAr
                  ? "غير مهيأة (تعمل عبر القاموس الإشاري المحلي فقط حالياً؛ تتطلب SIGN_LANGUAGE_API_URL و SIGN_LANGUAGE_API_KEY)"
                  : "Not configured (local glossary active; requires SIGN_LANGUAGE_API_URL & SIGN_LANGUAGE_API_KEY)"}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <button
              type="button"
              onClick={onExportStudentData}
              className="min-h-[42px] px-4 py-2 rounded-lg border text-xs font-semibold flex items-center gap-1.5"
              style={{ borderColor: "var(--border-hairline)" }}
            >
              <Download className="w-4 h-4" />
              <span>تصدير بيانات التقدم (JSON)</span>
            </button>

            {!clearConfirm ? (
              <button
                type="button"
                onClick={() => setClearConfirm(true)}
                className="min-h-[42px] px-4 py-2 rounded-lg border text-xs font-semibold flex items-center gap-1.5 text-red-600 dark:text-red-400"
                style={{ borderColor: "var(--border-hairline)" }}
              >
                <Trash2 className="w-4 h-4" />
                <span>مسح جميع بيانات الجلسة</span>
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onClearAllStudentData();
                    setClearConfirm(false);
                  }}
                  className="min-h-[42px] px-3 py-2 rounded-lg text-xs font-semibold bg-red-600 text-white"
                >
                  تأكيد المسح النهائي
                </button>
                <button
                  type="button"
                  onClick={() => setClearConfirm(false)}
                  className="min-h-[42px] px-3 py-2 rounded-lg border text-xs"
                  style={{ borderColor: "var(--border-hairline)" }}
                >
                  إلغاء
                </button>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

import React, { useState, useEffect } from "react";
import {
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileCheck2,
  Loader2,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import { SUBJECTS } from "../data/lessons.ts";
import type {
  AccessibilitySettings,
  PreparationTemplate,
  SubjectId,
  UILanguage,
} from "../types.ts";
import { blobToBase64 } from "../utils/speech.ts";
import {
  deletePrepTemplate,
  extractPrepTemplate,
  updatePrepTemplate,
} from "../utils/aiApi.ts";

interface PreparationFormCardProps {
  uiLang: UILanguage;
  selectedSubject: SubjectId;
  settings: AccessibilitySettings;
  prepTemplates: PreparationTemplate[];
  activePrepTemplate: PreparationTemplate | null;
  onSelectPrepTemplate: (templateId: string | null) => void;
  onTemplateSaved: (tpl: PreparationTemplate) => void;
  onTemplateDeleted: (templateId: string) => void;
}

export const PreparationFormCard: React.FC<PreparationFormCardProps> = ({
  uiLang,
  selectedSubject,
  settings,
  prepTemplates,
  activePrepTemplate,
  onSelectPrepTemplate,
  onTemplateSaved,
  onTemplateDeleted,
}) => {
  const isAr = uiLang === "ar";
  const subjectMeta = SUBJECTS.find((s) => s.id === selectedSubject) || SUBJECTS[0];
  const [uploadExpanded, setUploadExpanded] = useState(prepTemplates.length === 0);
  const [editorExpanded, setEditorExpanded] = useState(false);

  const [newTemplateName, setNewTemplateName] = useState("");
  const [newSubjectScope, setNewSubjectScope] = useState<SubjectId | "all">("all");
  const [newCustomInstructions, setNewCustomInstructions] = useState("");
  const [uploading, setUploading] = useState(false);
  const [savingEdits, setSavingEdits] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Local editable mirror of activePrepTemplate
  const [editName, setEditName] = useState("");
  const [editScope, setEditScope] = useState<SubjectId | "all">("all");
  const [editSectionsText, setEditSectionsText] = useState("");
  const [editPptRules, setEditPptRules] = useState("");
  const [editNotes, setEditNotes] = useState("");

  useEffect(() => {
    if (activePrepTemplate) {
      setEditName(activePrepTemplate.templateName);
      setEditScope(activePrepTemplate.subjectScope);
      setEditSectionsText(activePrepTemplate.requiredSections.join("\n"));
      setEditPptRules(activePrepTemplate.presentationMappingGuidelines);
      setEditNotes(activePrepTemplate.customInstructions);
    }
  }, [activePrepTemplate]);

  const handleUploadTemplateFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (
      !settings.aiProcessingConsent &&
      (file.name.toLowerCase().endsWith(".pdf") || file.type.startsWith("image/"))
    ) {
      setErrorMsg(
        isAr
          ? "يرجى تفعيل موافقة المعالجة بالذكاء الاصطناعي في الخصوصية لتحليل صورة أو ملف PDF لفورمة التحضير."
          : "Enable AI processing consent in Privacy settings to analyze PDF or image templates."
      );
      return;
    }

    setUploading(true);
    setErrorMsg(null);
    setStatusMsg(null);

    try {
      const fileBase64 = await blobToBase64(file);
      const data = await extractPrepTemplate({
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        fileBase64,
        subjectScope: newSubjectScope,
        templateName: newTemplateName,
        customInstructions: newCustomInstructions,
      });
      if (!data.template) {
        throw new Error(
          data.message ||
            (isAr ? "تعذر تحليل وحفظ فورمة التحضير." : "Failed to extract and save template.")
        );
      }

      const saved = data.template as PreparationTemplate;
      onTemplateSaved(saved);
      onSelectPrepTemplate(saved.id);
      setNewTemplateName("");
      setNewCustomInstructions("");
      setUploadExpanded(false);
      setEditorExpanded(true);
      setStatusMsg(
        isAr
          ? `تم تحليل وحفظ فورمة التحضير «${saved.templateName}» في المنصة؛ وسيُبنى عليها كل درس مصوّر والتحضير وعرض PowerPoint تلقائياً.`
          : `Saved preparation form "${saved.templateName}". Photographed lessons, lesson plans, and PowerPoint decks will now build upon it.`
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : isAr
            ? "تعذر قراءة فورمة التحضير."
            : "Failed to read preparation form."
      );
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleSaveTemplateEdits = async () => {
    if (!activePrepTemplate) return;
    setSavingEdits(true);
    setErrorMsg(null);
    setStatusMsg(null);

    try {
      const updatedBody = {
        templateName: editName.trim() || activePrepTemplate.templateName,
        subjectScope: editScope,
        requiredSections: editSectionsText
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        presentationMappingGuidelines: editPptRules.trim(),
        customInstructions: editNotes.trim(),
      };
      const data = await updatePrepTemplate(activePrepTemplate.id, updatedBody);
      if (!data.template) {
        throw new Error(data.message || "Failed to update template.");
      }
      onTemplateSaved(data.template as PreparationTemplate);
      setStatusMsg(
        isAr
          ? "تم حفظ تعديلات فورمة التحضير في قاعدة بيانات المنصة."
          : "Preparation form edits saved to the platform."
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : isAr
            ? "تعذر حفظ التعديلات."
            : "Could not save edits."
      );
    } finally {
      setSavingEdits(false);
    }
  };

  const handleDeleteTemplate = async (templateId: string) => {
    try {
      await deletePrepTemplate(templateId);
      onTemplateDeleted(templateId);
    } catch {
      // Ignore
    }
  };

  const scopeLabel = (scope: SubjectId | "all") => {
    if (scope === "all") {
      return isAr ? "جميع المواد العلمية (عام)" : "All Science Subjects";
    }
    const found = SUBJECTS.find((s) => s.id === scope);
    return found ? (isAr ? found.nameAr : found.nameEn) : scope;
  };

  return (
    <section
      aria-label={isAr ? "فورمة التحضير المعتمدة" : "Attached Preparation Form"}
      className="science-card rounded-2xl border p-5 md:p-6 space-y-4 backdrop-blur-sm"
      style={{
        backgroundColor: "var(--bg-surface)",
        borderColor: activePrepTemplate ? "var(--accent-primary)" : "var(--border-hairline)",
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <FileCheck2 className="w-5 h-5" style={{ color: "var(--accent-primary)" }} />
            <h2 className="text-base md:text-lg font-bold">
              {isAr
                ? `فورمة التحضير المعتمدة — قسم ${subjectMeta.nameAr}`
                : `${subjectMeta.nameEn} Official Lesson Preparation Form`}
            </h2>
          </div>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            {activePrepTemplate
              ? isAr
                ? `الفورمة النشطة: «${activePrepTemplate.templateName}» · النطاق: ${scopeLabel(activePrepTemplate.subjectScope)} · ${activePrepTemplate.requiredSections.length} بنود محفوظة بالمنصة`
                : `Active Form: "${activePrepTemplate.templateName}" · Scope: ${scopeLabel(activePrepTemplate.subjectScope)} · ${activePrepTemplate.requiredSections.length} sections saved`
              : isAr
                ? "أرفق صورة أو ملف فورمة التحضير الخاصة بك (Word / PDF / صورة) ليُبنى عليها تحليل الدروس المصوّرة والتحضير وعرض PowerPoint وتُحفظ جميعها في المنصة."
                : "Attach your official Preparation Form (Photo, PDF, or Word) so photographed lessons, lesson plans, and PowerPoint decks build upon it and save to the platform."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {prepTemplates.length > 0 && (
            <button
              type="button"
              onClick={() => setEditorExpanded((v) => !v)}
              className="min-h-[40px] px-3.5 py-2 rounded-xl border text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
              style={{
                backgroundColor: "var(--bg-subtle)",
                borderColor: "var(--border-hairline)",
                color: "var(--text-primary)",
              }}
            >
              <span>{isAr ? "مراجعة / تعديل بنود الفورمة" : "Review / Edit Form"}</span>
              {editorExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          )}
          <button
            type="button"
            onClick={() => setUploadExpanded((v) => !v)}
            className="min-h-[40px] px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 whitespace-nowrap"
            style={{
              backgroundColor: "var(--accent-primary)",
              color: "var(--accent-contrast)",
            }}
          >
            <Upload className="w-4 h-4" />
            <span>
              {activePrepTemplate
                ? isAr
                  ? "إرفاق فورمة جديدة / بديلة"
                  : "Attach Another Form"
                : isAr
                  ? "إرفاق فورمة التحضير الآن"
                  : "Attach Preparation Form"}
            </span>
          </button>
        </div>
      </div>

      {/* Saved Templates Switcher Strip */}
      {prepTemplates.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold" style={{ color: "var(--text-secondary)" }}>
            {isAr ? "الفورمات المحفوظة:" : "Saved Forms:"}
          </span>
          {prepTemplates.map((tpl) => {
            const active = activePrepTemplate?.id === tpl.id;
            return (
              <div key={tpl.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onSelectPrepTemplate(tpl.id)}
                  className="min-h-[34px] px-3 py-1 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap"
                  style={{
                    backgroundColor: active ? "var(--accent-primary)" : "var(--bg-subtle)",
                    borderColor: active ? "var(--accent-primary)" : "var(--border-hairline)",
                    color: active ? "var(--accent-contrast)" : "var(--text-primary)",
                  }}
                >
                  {tpl.templateName} ({scopeLabel(tpl.subjectScope)})
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeleteTemplate(tpl.id)}
                  aria-label={isAr ? `حذف ${tpl.templateName}` : `Delete ${tpl.templateName}`}
                  className="p-1.5 rounded-lg border text-rose-600 hover:opacity-80"
                  style={{ borderColor: "var(--border-hairline)" }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {statusMsg && (
        <div
          className="p-3.5 rounded-xl border flex items-center gap-2 text-xs font-medium"
          style={{
            backgroundColor: "var(--bg-subtle)",
            borderColor: "var(--accent-primary)",
            color: "var(--text-primary)",
          }}
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{statusMsg}</span>
        </div>
      )}

      {errorMsg && (
        <p className="text-xs text-rose-600 dark:text-rose-400" role="alert">
          {errorMsg}
        </p>
      )}

      {/* Upload / Photograph Preparation Form Drawer */}
      {uploadExpanded && (
        <div
          className="p-4 rounded-2xl border space-y-4"
          style={{
            backgroundColor: "var(--bg-subtle)",
            borderColor: "var(--border-hairline)",
          }}
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div>
              <label className="block font-bold mb-1">
                {isAr ? "اسم الفورمة (اختياري)" : "Form Name (optional)"}
              </label>
              <input
                type="text"
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
                placeholder={
                  isAr ? "مثلاً: فورمة التحضير المعتمدة للمرحلة المتوسطة" : "e.g., Official Science Prep Form"
                }
                className="w-full min-h-[40px] px-3 rounded-lg border"
                style={{
                  backgroundColor: "var(--bg-surface)",
                  borderColor: "var(--border-hairline)",
                  color: "var(--text-primary)",
                }}
              />
            </div>

            <div>
              <label className="block font-bold mb-1">
                {isAr ? "نطاق التطبيق على المواد" : "Subject Scope"}
              </label>
              <select
                value={newSubjectScope}
                onChange={(e) => setNewSubjectScope(e.target.value as SubjectId | "all")}
                className="w-full min-h-[40px] px-3 rounded-lg border"
                style={{
                  backgroundColor: "var(--bg-surface)",
                  borderColor: "var(--border-hairline)",
                  color: "var(--text-primary)",
                }}
              >
                <option value="all">
                  {isAr ? "جميع المواد العلمية الخمس" : "All 5 Science Subjects"}
                </option>
                {SUBJECTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {isAr ? `مادة ${s.nameAr} فقط` : `${s.nameEn} only`}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-bold mb-1">
                {isAr ? "تعليمات إضافية لبناء التحضير والعرض" : "Extra Building Rules"}
              </label>
              <input
                type="text"
                value={newCustomInstructions}
                onChange={(e) => setNewCustomInstructions(e.target.value)}
                placeholder={
                  isAr ? "مثلاً: إبراز أهداف التفكير الناقد والربط بالحياة" : "e.g., Include critical thinking goals"
                }
                className="w-full min-h-[40px] px-3 rounded-lg border"
                style={{
                  backgroundColor: "var(--bg-surface)",
                  borderColor: "var(--border-hairline)",
                  color: "var(--text-primary)",
                }}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label
              className="p-4 rounded-xl border border-dashed flex flex-col items-center justify-center gap-2 cursor-pointer text-center hover:opacity-90"
              style={{
                backgroundColor: "var(--bg-surface)",
                borderColor: "var(--accent-primary)",
              }}
            >
              {uploading ? (
                <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--accent-primary)" }} />
              ) : (
                <Upload className="w-6 h-6" style={{ color: "var(--accent-primary)" }} />
              )}
              <span className="text-xs font-bold">
                {uploading
                  ? isAr
                    ? "جارٍ قراءة الفورمة واستخراج بنودها..."
                    : "Reading preparation form sections..."
                  : isAr
                    ? "رفع ملف فورمة التحضير (Word .docx / PDF / صورة / TXT)"
                    : "Upload Preparation Form (Word .docx, PDF, Image, TXT)"}
              </span>
              <input
                type="file"
                accept=".pdf,.docx,.pptx,.txt,.md,image/*"
                onChange={handleUploadTemplateFile}
                disabled={uploading}
                className="sr-only"
              />
            </label>

            <label
              className="p-4 rounded-xl border border-dashed flex flex-col items-center justify-center gap-2 cursor-pointer text-center hover:opacity-90"
              style={{
                backgroundColor: "var(--bg-surface)",
                borderColor: "var(--border-hairline)",
              }}
            >
              {uploading ? (
                <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--accent-primary)" }} />
              ) : (
                <Camera className="w-6 h-6" style={{ color: "var(--accent-primary)" }} />
              )}
              <span className="text-xs font-bold">
                {isAr
                  ? "تصوير فورمة التحضير مباشرة بالكاميرا"
                  : "Photograph Preparation Form with Camera"}
              </span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleUploadTemplateFile}
                disabled={uploading}
                className="sr-only"
              />
            </label>
          </div>
        </div>
      )}

      {/* Active Preparation Form Editor */}
      {editorExpanded && activePrepTemplate && (
        <div
          className="p-4 rounded-2xl border space-y-3 text-xs"
          style={{
            backgroundColor: "var(--bg-subtle)",
            borderColor: "var(--border-hairline)",
          }}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold mb-1">
                {isAr ? "اسم الفورمة المعتمدة" : "Template Name"}
              </label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full min-h-[38px] px-3 rounded-lg border"
                style={{
                  backgroundColor: "var(--bg-surface)",
                  borderColor: "var(--border-hairline)",
                  color: "var(--text-primary)",
                }}
              />
            </div>
            <div>
              <label className="block font-bold mb-1">
                {isAr ? "تطبيق على" : "Subject Scope"}
              </label>
              <select
                value={editScope}
                onChange={(e) => setEditScope(e.target.value as SubjectId | "all")}
                className="w-full min-h-[38px] px-3 rounded-lg border"
                style={{
                  backgroundColor: "var(--bg-surface)",
                  borderColor: "var(--border-hairline)",
                  color: "var(--text-primary)",
                }}
              >
                <option value="all">
                  {isAr ? "جميع المواد العلمية الخمس" : "All 5 Science Subjects"}
                </option>
                {SUBJECTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {isAr ? s.nameAr : s.nameEn}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold mb-1">
                {isAr ? "بنود وحقول فورمة التحضير المستخرجة (بند في كل سطر)" : "Extracted Form Sections (one per line)"}
              </label>
              <textarea
                rows={5}
                value={editSectionsText}
                onChange={(e) => setEditSectionsText(e.target.value)}
                className="w-full p-3 rounded-lg border"
                style={{
                  backgroundColor: "var(--bg-surface)",
                  borderColor: "var(--border-hairline)",
                  color: "var(--text-primary)",
                }}
              />
            </div>
            <div className="space-y-3">
              <div>
                <label className="block font-bold mb-1">
                  {isAr ? "خطة بناء عروض PowerPoint وفق الفورمة" : "PowerPoint Mapping Guidelines"}
                </label>
                <textarea
                  rows={2}
                  value={editPptRules}
                  onChange={(e) => setEditPptRules(e.target.value)}
                  className="w-full p-2.5 rounded-lg border"
                  style={{
                    backgroundColor: "var(--bg-surface)",
                    borderColor: "var(--border-hairline)",
                    color: "var(--text-primary)",
                  }}
                />
              </div>
              <div>
                <label className="block font-bold mb-1">
                  {isAr ? "توصيات المعلم الإضافية" : "Custom Teacher Instructions"}
                </label>
                <textarea
                  rows={2}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="w-full p-2.5 rounded-lg border"
                  style={{
                    backgroundColor: "var(--bg-surface)",
                    borderColor: "var(--border-hairline)",
                    color: "var(--text-primary)",
                  }}
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleSaveTemplateEdits}
              disabled={savingEdits}
              className="min-h-[38px] px-4 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5"
              style={{
                backgroundColor: "var(--accent-primary)",
                color: "var(--accent-contrast)",
              }}
            >
              {savingEdits ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              <span>{isAr ? "حفظ تعديلات الفورمة في المنصة" : "Save Form Updates"}</span>
            </button>
          </div>
        </div>
      )}
    </section>
  );
};

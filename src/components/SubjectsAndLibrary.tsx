import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Upload,
  BookOpen,
  BookMarked,
  FileText,
  FileCheck2,
  Sparkles,
  Loader2,
  Trash2,
  Presentation,
  Video,
  Trophy,
  ClipboardList,
  MessageSquare,
  CheckCircle2,
  Camera,
  ArrowRight,
  ArrowLeft,
  Radar,
  Layers,
  Zap,
} from "lucide-react";
import type {
  AccessibilitySettings,
  BookRecord,
  EducationStage,
  LessonData,
  PreparationTemplate,
  SourcePolicy,
  SubjectId,
  UILanguage,
  UserRole,
} from "../types.ts";
import { SUBJECTS } from "../data/lessons.ts";
import { prepareUploadPayload, inferUploadMimeType } from "../utils/chunkUpload.ts";
import { SubjectSculpture } from "./SubjectSculptures.tsx";
import { PreparationFormCard } from "./PreparationFormCard.tsx";
import { BooksLibrarySection } from "./BooksLibrarySection.tsx";

export type SectionLibraryTab = "lessons" | "books" | "prep_form";

interface SubjectsAndLibraryProps {
  lessons: LessonData[];
  selectedSubject: SubjectId;
  onSelectSubject: (subjectId: SubjectId) => void;
  activeLessonId: string;
  onSelectLesson: (lessonId: string) => void;
  onSaveNewLesson: (lesson: LessonData) => Promise<void>;
  onDeleteLesson: (lessonId: string) => Promise<void>;
  onOpenTool: (
    tab: "studio" | "radar" | "kahoot" | "chatbot" | "inclusive",
    studioSubTab?: "lesson_plan" | "pptx" | "video" | "worksheet" | "adaptive_quiz"
  ) => void;
  uiLang: UILanguage;
  userRole?: UserRole;
  settings: AccessibilitySettings;
  sourcePolicy: SourcePolicy;
  prepTemplates: PreparationTemplate[];
  activePrepTemplate: PreparationTemplate | null;
  onSelectPrepTemplate: (templateId: string | null) => void;
  onSavePrepTemplate: (tpl: PreparationTemplate) => void;
  onDeletePrepTemplate: (templateId: string) => void;
  insideDepartment?: boolean;
  onInsideDepartmentChange?: (inside: boolean) => void;
  activeSectionTab?: SectionLibraryTab;
  onActiveSectionTabChange?: (tab: SectionLibraryTab) => void;
  onLaunchBuzzerMap?: () => void;
}

const STAGE_OPTIONS: Array<{ id: EducationStage; labelAr: string; labelEn: string }> = [
  { id: "elementary", labelAr: "المرحلة الابتدائية", labelEn: "Elementary" },
  { id: "middle", labelAr: "المرحلة المتوسطة", labelEn: "Middle School" },
  { id: "high", labelAr: "المرحلة الثانوية", labelEn: "High School" },
];

export const SubjectsAndLibrary: React.FC<SubjectsAndLibraryProps> = ({
  lessons,
  selectedSubject,
  onSelectSubject,
  activeLessonId,
  onSelectLesson,
  onSaveNewLesson,
  onDeleteLesson,
  onOpenTool,
  uiLang,
  userRole = "teacher",
  settings,
  sourcePolicy,
  prepTemplates,
  activePrepTemplate,
  onSelectPrepTemplate,
  onSavePrepTemplate,
  onDeletePrepTemplate,
  insideDepartment: controlledInsideDept,
  onInsideDepartmentChange,
  activeSectionTab: controlledSectionTab,
  onActiveSectionTabChange,
  onLaunchBuzzerMap,
}) => {
  const isAr = uiLang === "ar";
  const [localInsideDepartment, setLocalInsideDepartment] = useState(false);
  const [localSectionTab, setLocalSectionTab] = useState<SectionLibraryTab>("lessons");

  const insideDepartment =
    controlledInsideDept !== undefined ? controlledInsideDept : localInsideDepartment;
  const setInsideDepartment = (next: boolean) => {
    setLocalInsideDepartment(next);
    onInsideDepartmentChange?.(next);
  };

  const sectionTab =
    controlledSectionTab !== undefined ? controlledSectionTab : localSectionTab;
  const setSectionTab = (next: SectionLibraryTab) => {
    setLocalSectionTab(next);
    onActiveSectionTabChange?.(next);
  };
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [stage, setStage] = useState<EducationStage>("middle");
  const [gradeLevel, setGradeLevel] = useState(isAr ? "الصف الثالث المتوسط" : "Grade 9");
  const [manualTitle, setManualTitle] = useState("");
  const [autoPrepareOnUpload, setAutoPrepareOnUpload] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [autoBuilding, setAutoBuilding] = useState(false);
  const [uploadStepText, setUploadStepText] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/books")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.books)) {
          setBooks(data.books);
        }
      })
      .catch(() => {});
  }, []);

  const subjectMeta = SUBJECTS.find((s) => s.id === selectedSubject) || SUBJECTS[0];
  const filteredLessons = lessons.filter((l) => l.subjectId === selectedSubject);
  const activeLesson =
    filteredLessons.find((l) => l.id === activeLessonId) ||
    lessons.find((l) => l.id === activeLessonId) ||
    filteredLessons[0] ||
    lessons[0];
  const subjectBooksCount = books.filter((b) => b.subjectId === selectedSubject).length;

  const buildAndSavePlanAndDeck = async (targetLesson: LessonData): Promise<{ planOk: boolean; deckOk: boolean }> => {
    let generatedPlan = null;
    let planOk = false;
    let deckOk = false;

    setUploadStepText(
      isAr
        ? "جارٍ بناء وحفظ تحضير الدرس وفق الفورمة المعتمدة..."
        : "Building & saving lesson plan from Preparation Form..."
    );

    const planRes = await fetch("/api/generate/lesson-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lesson: targetLesson,
        language: uiLang,
        sourcePolicy,
        prepTemplateId: activePrepTemplate?.id || targetLesson.prepTemplateId || "",
        prepTemplate: activePrepTemplate,
      }),
    });
    const planData = await planRes.json();
    if (planRes.ok && planData.lessonPlan) {
      generatedPlan = planData.lessonPlan;
      await fetch("/api/artifacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lessonId: targetLesson.id,
          artifactType: "lesson_plan",
          title: generatedPlan.lessonTitle || targetLesson.title,
          data: generatedPlan,
        }),
      });
      planOk = true;
    }

    setUploadStepText(
      isAr
        ? "جارٍ بناء وحفظ عرض PowerPoint وفق نفس الفورمة..."
        : "Building & saving PowerPoint deck from Preparation Form..."
    );

    const pptRes = await fetch("/api/generate/presentation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lesson: targetLesson,
        slideCount: 7,
        language: uiLang,
        prepTemplateId: activePrepTemplate?.id || targetLesson.prepTemplateId || "",
        prepTemplate: activePrepTemplate,
        lessonPlan: generatedPlan,
      }),
    });
    const pptData = await pptRes.json();
    if (pptRes.ok && pptData.deck) {
      await fetch("/api/artifacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lessonId: targetLesson.id,
          artifactType: "presentation",
          title: pptData.deck.deckTitle || targetLesson.title,
          data: pptData.deck,
        }),
      });
      deckOk = true;
    }

    return { planOk, deckOk };
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 75 * 1024 * 1024) {
      setUploadError(
        isAr
          ? "حجم الملف يتجاوز الحد الأقصى المسموح به (75 ميجابايت)."
          : "File size exceeds the 75 MB limit."
      );
      e.target.value = "";
      return;
    }

    const detectedMime = inferUploadMimeType(file);
    const isPdfOrImage =
      file.name.toLowerCase().endsWith(".pdf") ||
      detectedMime === "application/pdf" ||
      detectedMime.startsWith("image/");

    if (!settings.aiProcessingConsent && isPdfOrImage) {
      setUploadError(
        isAr
          ? "يرجى تفعيل موافقة المعالجة بالذكاء الاصطناعي في الخصوصية لتحليل PDF والصور."
          : "Please enable AI processing consent in Privacy settings to analyze PDF and image files."
      );
      e.target.value = "";
      return;
    }

    setUploading(true);
    setUploadError(null);
    setUploadSuccess(null);
    setUploadStepText(
      isAr
        ? `جارٍ تجهيز ورفع «${file.name}» إلى قسم ${subjectMeta.nameAr}...`
        : `Uploading "${file.name}" to ${subjectMeta.nameEn}...`
    );

    try {
      const prepared = await prepareUploadPayload(file, (pct) => {
        if (file.size > 4 * 1024 * 1024) {
          setUploadStepText(
            isAr
              ? `جارٍ رفع أجزاء الملف إلى الخادم (${pct}%)...`
              : `Uploading file chunks (${pct}%)...`
          );
        }
      });

      setUploadStepText(
        isAr
          ? "جارٍ قراءة الملف واستخراج المفاهيم والأهداف بالذكاء الاصطناعي (قد يستغرق الكتاب الكبير بضع ثوانٍ)..."
          : "Analyzing lesson file and extracting concepts & objectives..."
      );

      const res = await fetch("/api/extract-lesson", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: detectedMime,
          ...prepared,
          subjectName: isAr ? subjectMeta.nameAr : subjectMeta.nameEn,
          gradeLevel,
          prepTemplateId: activePrepTemplate?.id || "",
          prepTemplate: activePrepTemplate,
        }),
      });

      const rawText = await res.text();
      let data: {
        title?: string;
        summary?: string;
        simplifiedSummary?: string;
        content?: string;
        category?: string;
        extractedAnalysis?: LessonData["extractedAnalysis"];
        message?: string;
      } = {};
      try {
        data = JSON.parse(rawText);
      } catch {
        // Non-JSON proxy or HTML error response
      }

      if (!res.ok) {
        setUploadError(
          data.message ||
            (isAr
              ? `تعذر تحليل ملف الدرس (رمز الاستجابة ${res.status}).`
              : `Failed to extract lesson file (${res.status}).`)
        );
        return;
      }

      const title = manualTitle.trim() || data.title || file.name.replace(/\.[^.]+$/, "");
      const newLesson: LessonData = {
        id: `lesson-${Date.now()}`,
        subjectId: selectedSubject,
        title,
        subject: isAr ? subjectMeta.nameAr : subjectMeta.nameEn,
        stage,
        gradeLevel,
        estimatedMinutes: 15,
        summary: data.summary || data.content?.slice(0, 300) || title,
        simplifiedSummary: data.simplifiedSummary || data.summary || title,
        diagramUrl: subjectMeta.defaultDiagramUrl,
        diagramTitle: title,
        diagramBaselineAlt: data.extractedAnalysis?.tablesAndFiguresSummary?.[0] || data.summary || title,
        audioLessonScript: data.summary || data.content?.slice(0, 800) || title,
        keySignTerms: data.extractedAnalysis?.concepts?.slice(0, 3) || ["طاقة", "خلية", "ذرة"],
        extractedAnalysis: data.extractedAnalysis,
        prepTemplateId: activePrepTemplate?.id,
        sources: [
          {
            id: `src-${Date.now()}`,
            title,
            category: data.category || file.name,
            content: data.content || data.summary || "",
            enabled: true,
            sourceFileName: file.name,
          },
        ],
        simulationControls: [],
        quizQuestions: [],
        isCustom: true,
      };

      await onSaveNewLesson(newLesson);
      onSelectLesson(newLesson.id);

      let extraStatus = "";
      if (autoPrepareOnUpload && settings.aiProcessingConsent) {
        try {
          const { planOk, deckOk } = await buildAndSavePlanAndDeck(newLesson);
          if (planOk && deckOk) {
            extraStatus = isAr
              ? " وتم بناء وحفظ التحضير وعرض PowerPoint في المنصة تلقائياً."
              : " Lesson Plan & PowerPoint deck were automatically built and saved.";
          } else if (planOk || deckOk) {
            extraStatus = isAr
              ? " وتم حفظ الجزء المتاح في استوديو المحتوى."
              : " Partial studio outputs were saved.";
          }
        } catch {
          extraStatus = isAr
            ? " (تم حفظ الدرس بنجاح، ويمكنك بناء التحضير والعرض لاحقاً من استوديو المحتوى)."
            : " (Lesson saved; you can build Plan & PPTX from Content Studio).";
        }
      }

      setManualTitle("");
      setUploadOpen(false);
      setSectionTab("lessons");
      setUploadSuccess(
        isAr
          ? `تم تحليل «${title}» وحفظه في مكتبة قسم ${subjectMeta.nameAr}.${extraStatus}`
          : `"${title}" was analyzed and saved to ${subjectMeta.nameEn}.${extraStatus}`
      );
    } catch (err) {
      const errMsg = err instanceof Error && err.message ? err.message : "";
      setUploadError(
        errMsg || (isAr ? "تعذر رفع الملف وتحليله." : "Could not upload and analyze the file.")
      );
    } finally {
      setUploading(false);
      setUploadStepText(null);
      e.target.value = "";
    }
  };

  const handleAutoBuildForActiveLesson = async () => {
    if (!activeLesson || autoBuilding) return;
    if (!settings.aiProcessingConsent) {
      setUploadError(isAr ? "يرجى تفعيل موافقة المعالجة بالذكاء الاصطناعي أولاً." : "Enable AI consent first.");
      return;
    }
    setAutoBuilding(true);
    setUploadError(null);
    setUploadSuccess(null);
    try {
      const { planOk, deckOk } = await buildAndSavePlanAndDeck(activeLesson);
      if (planOk && deckOk) {
        setUploadSuccess(
          isAr
            ? `تم بناء وحفظ التحضير وعرض PowerPoint لدرس «${activeLesson.title}» وفق الفورمة المعتمدة.`
            : `Built & saved Lesson Plan and PowerPoint for "${activeLesson.title}".`
        );
      } else {
        setUploadError(
          isAr
            ? "تعذر إكمال بناء التحضير أو العرض حالياً؛ تحقق من استوديو الإنتاج."
            : "Could not complete auto-building plan/presentation right now."
        );
      }
    } catch {
      setUploadError(isAr ? "تعذر بناء التحضير والعرض." : "Auto-build failed.");
    } finally {
      setAutoBuilding(false);
      setUploadStepText(null);
    }
  };

  return (
    <AnimatePresence mode="wait">
      {!insideDepartment ? (
        /* Screen 1: Subject Sections Entry Directory Only (Not Stacked) */
        <motion.section
          key="subjects-directory"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          className="science-card rounded-2xl border p-6 md:p-8 space-y-6 backdrop-blur-sm"
          style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}
        >
          <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4" style={{ borderColor: "var(--border-hairline)" }}>
            <div>
              <h1 className="text-2xl font-bold">
                {isAr ? "أقسام المواد الدراسية" : "Academic Subject Sections"}
              </h1>
              <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
                {isAr
                  ? "اضغط على أي قسم للدخول إلى صفحته المستقلة والمكتبة الذكية الخاصة به (الدروس، الكتب الدائمة، وفورمة التحضير)."
                  : "Click any subject department to enter its dedicated page and Smart Library (lessons, persistent textbooks, and preparation form)."}
              </p>
            </div>
            <div className="text-xs font-semibold tabular-nums" style={{ color: "var(--text-secondary)" }}>
              {isAr
                ? `${SUBJECTS.length} أقسام · ${lessons.length} دروس · ${books.length} كتب محفوظة`
                : `${SUBJECTS.length} departments · ${lessons.length} lessons · ${books.length} books`}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {SUBJECTS.map((subj, idx) => {
              const active = subj.id === selectedSubject;
              const lessonCount = lessons.filter((l) => l.subjectId === subj.id).length;
              const bookCount = books.filter((b) => b.subjectId === subj.id).length;
              return (
                <motion.button
                  key={subj.id}
                  type="button"
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.32,
                    delay: idx * 0.05,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                  whileHover={
                    settings.reduceMotion
                      ? undefined
                      : {
                          y: -5,
                          scale: 1.02,
                          boxShadow: `0 18px 34px -12px ${subj.accentHex}44`,
                        }
                  }
                  whileTap={settings.reduceMotion ? undefined : { scale: 0.97 }}
                  onClick={() => {
                    onSelectSubject(subj.id);
                    const first = lessons.find((l) => l.subjectId === subj.id);
                    if (first) onSelectLesson(first.id);
                    setSectionTab("lessons");
                    setUploadOpen(false);
                    setInsideDepartment(true);
                  }}
                  className="relative overflow-hidden text-start p-5 min-h-[205px] rounded-2xl border flex flex-col justify-between gap-3 cursor-pointer"
                  style={{
                    backgroundColor: active ? "var(--bg-subtle)" : "var(--bg-surface)",
                    borderColor: active ? subj.accentHex : "var(--border-hairline)",
                    borderWidth: active ? "2px" : "1px",
                  }}
                >
                  {active && (
                    <div
                      className="absolute inset-0 pointer-events-none opacity-15"
                      style={{
                        background: `radial-gradient(circle at top left, ${subj.accentHex}, transparent 70%)`,
                      }}
                    />
                  )}

                  <div className="relative z-10 flex items-start justify-between gap-2">
                    <SubjectSculpture
                      subjectId={subj.id}
                      size="sm"
                      reducedMotion={settings.reduceMotion}
                    />
                    <span className="font-mono-num text-[11px] font-bold text-end" style={{ color: "var(--text-secondary)" }}>
                      {lessonCount} {isAr ? "دروس" : "lessons"} · {bookCount} {isAr ? "كتب" : "books"}
                    </span>
                  </div>

                  <div className="relative z-10">
                    <div
                      className="text-lg font-bold"
                      style={{ color: active ? subj.accentHex : "var(--text-primary)" }}
                    >
                      {isAr ? subj.nameAr : subj.nameEn}
                    </div>
                    <p className="text-xs mt-1.5 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                      {isAr ? subj.descriptionAr : subj.descriptionEn}
                    </p>
                  </div>

                  <span className="relative z-10 text-xs font-bold pt-1" style={{ color: subj.accentHex }}>
                    {isAr ? "دخول القسم والمكتبة ←" : "Enter Department →"}
                  </span>
                </motion.button>
              );
            })}
          </div>
        </motion.section>
      ) : (
        /* Screen 2: Inside Selected Subject Department Page + Back Arrow */
        <motion.div
          key={`department-${selectedSubject}`}
          initial={{ opacity: 0, x: isAr ? -24 : 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: isAr ? 24 : -24 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="science-card rounded-2xl border p-5 md:p-6 space-y-5 backdrop-blur-sm"
          style={{
            backgroundColor: "var(--bg-surface)",
            borderColor: subjectMeta.accentHex,
          }}
        >
          {/* Department Top Bar with Back Arrow + Quick Lesson Upload Trigger */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4" style={{ borderColor: "var(--border-hairline)" }}>
            <div className="flex flex-wrap items-center gap-3.5">
              <button
                type="button"
                onClick={() => {
                  setInsideDepartment(false);
                  setUploadOpen(false);
                }}
                aria-label={isAr ? "تراجع إلى أقسام المواد الدراسية" : "Back to Subject Sections"}
                className="min-h-[42px] px-3.5 py-2 rounded-xl border text-xs font-bold flex items-center gap-2 whitespace-nowrap shrink-0 transition-opacity hover:opacity-85"
                style={{
                  backgroundColor: "var(--bg-subtle)",
                  borderColor: "var(--border-hairline)",
                  color: "var(--text-primary)",
                }}
              >
                {isAr ? (
                  <ArrowRight className="w-4 h-4 shrink-0" style={{ color: subjectMeta.accentHex }} />
                ) : (
                  <ArrowLeft className="w-4 h-4 shrink-0" style={{ color: subjectMeta.accentHex }} />
                )}
                <span>{isAr ? "أقسام المواد" : "Back to Subjects"}</span>
              </button>

              <SubjectSculpture
                subjectId={selectedSubject}
                size="md"
                reducedMotion={settings.reduceMotion}
              />

              <div>
                <h1 className="text-xl font-bold" style={{ color: subjectMeta.accentHex }}>
                  {isAr
                    ? `قسم مادة ${subjectMeta.nameAr} — البوابة والمكتبة الذكية`
                    : `${subjectMeta.nameEn} Department — Hub & Smart Library`}
                </h1>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                  {userRole === "teacher"
                    ? isAr
                      ? `مساحة المعلمة · ${filteredLessons.length} دروس · ${subjectBooksCount} كتب محفوظة`
                      : `Teacher Space · ${filteredLessons.length} lessons · ${subjectBooksCount} books`
                    : isAr
                      ? `مساحة الطالبة · ${filteredLessons.length} دروس · ${subjectBooksCount} كتب متاحة`
                      : `Student Space · ${filteredLessons.length} lessons · ${subjectBooksCount} books`}
                  {activePrepTemplate
                    ? isAr
                      ? ` · الفورمة النشطة: «${activePrepTemplate.templateName}»`
                      : ` · Active Form: "${activePrepTemplate.templateName}"`
                    : ""}
                </p>
              </div>
            </div>

            <motion.button
              type="button"
              whileHover={settings.reduceMotion ? undefined : { scale: 1.03 }}
              whileTap={settings.reduceMotion ? undefined : { scale: 0.96 }}
              onClick={() => setUploadOpen((o) => !o)}
              className="min-h-[42px] px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 whitespace-nowrap shrink-0 shadow-sm"
              style={{ backgroundColor: "var(--accent-primary)", color: "var(--accent-contrast)" }}
            >
              <Upload className="w-4 h-4" />
              <span>
                {isAr
                  ? `رفع درس جديد لقسم ${subjectMeta.nameAr}`
                  : `Upload ${subjectMeta.nameEn} Lesson`}
              </span>
            </motion.button>
          </div>

          {/* Complete Subject Options & Platform Division Inside Every Science Subject */}
          <div
            className="rounded-2xl border p-4 space-y-3"
            style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>
                {isAr
                  ? `خيارات وأقسام مادة ${subjectMeta.nameAr} للمعلمة والطالبة:`
                  : `${subjectMeta.nameEn} Options & Tools for Teacher & Student:`}
              </div>
              {activeLesson && (
                <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {isAr ? "الدرس النشط الآن:" : "Active lesson:"}{" "}
                  <strong style={{ color: "var(--text-primary)" }}>{activeLesson.title}</strong>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-9 gap-2">
              {[
                {
                  label: isAr ? "رادار الفهم" : "Understanding Radar",
                  icon: <Radar className="w-4 h-4 shrink-0" />,
                  active: false,
                  onClick: () => onOpenTool("radar"),
                },
                {
                  label: isAr ? `الدروس (${filteredLessons.length})` : `Lessons (${filteredLessons.length})`,
                  icon: <BookOpen className="w-4 h-4 shrink-0" />,
                  active: sectionTab === "lessons",
                  onClick: () => setSectionTab("lessons"),
                },
                {
                  label: isAr ? `الكتب الدائمة (${subjectBooksCount})` : `Textbooks (${subjectBooksCount})`,
                  icon: <BookMarked className="w-4 h-4 shrink-0" />,
                  active: sectionTab === "books",
                  onClick: () => setSectionTab("books"),
                },
                {
                  label: isAr ? `فورمة التحضير (${prepTemplates.length})` : `Prep Form (${prepTemplates.length})`,
                  icon: <FileCheck2 className="w-4 h-4 shrink-0" />,
                  active: sectionTab === "prep_form",
                  onClick: () => setSectionTab("prep_form"),
                },
                {
                  label: isAr ? "إنتاج المحتوى" : "Content Studio",
                  icon: <Layers className="w-4 h-4 shrink-0" />,
                  active: false,
                  onClick: () => onOpenTool("studio", "lesson_plan"),
                },
                {
                  label: isAr ? "خريطة المراحل والباز" : "Stages & Buzz Map",
                  icon: <Zap className="w-4 h-4 shrink-0" />,
                  active: false,
                  onClick: () => (onLaunchBuzzerMap ? onLaunchBuzzerMap() : onOpenTool("kahoot")),
                },
                {
                  label: isAr ? "المسابقات المباشرة" : "Live Quiz",
                  icon: <Trophy className="w-4 h-4 shrink-0" />,
                  active: false,
                  onClick: () => onOpenTool("kahoot"),
                },
                {
                  label: isAr ? "المساعد الذكي" : "AI Tutor",
                  icon: <MessageSquare className="w-4 h-4 shrink-0" />,
                  active: false,
                  onClick: () => onOpenTool("chatbot"),
                },
                {
                  label: isAr ? "التعلم الشامل" : "Inclusive Hub",
                  icon: <Sparkles className="w-4 h-4 shrink-0" />,
                  active: false,
                  onClick: () => onOpenTool("inclusive"),
                },
              ].map((opt, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={opt.onClick}
                  className="min-h-[42px] px-2.5 py-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors"
                  style={{
                    backgroundColor: opt.active ? "var(--accent-primary)" : "var(--bg-surface)",
                    borderColor: opt.active ? "var(--accent-primary)" : "var(--border-hairline)",
                    color: opt.active ? "var(--accent-contrast)" : "var(--text-primary)",
                  }}
                >
                  <span style={{ color: opt.active ? "var(--accent-contrast)" : subjectMeta.accentHex }}>
                    {opt.icon}
                  </span>
                  <span className="truncate">{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Animated Upload Drawer Inside Active Subject Section */}
          <AnimatePresence>
            {uploadOpen && (
              <motion.section
                key="upload-drawer"
                initial={{ opacity: 0, y: -10, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.99 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="rounded-2xl border p-5 space-y-4"
                style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--accent-primary)" }}
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-base font-bold">
                    {isAr
                      ? `رفع درس جديد في مادة ${subjectMeta.nameAr}`
                      : `Upload New Lesson in ${subjectMeta.nameEn}`}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setUploadOpen(false)}
                    className="text-xs underline"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {isAr ? "إغلاق" : "Close"}
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1">
                      {isAr ? "عنوان الدرس (اختياري)" : "Lesson Title (optional)"}
                    </label>
                    <input
                      type="text"
                      value={manualTitle}
                      onChange={(e) => setManualTitle(e.target.value)}
                      placeholder={isAr ? "يُستخرج تلقائياً إذا تُرك فارغاً" : "Auto-extracted if left blank"}
                      className="w-full min-h-[42px] px-3 rounded-lg border text-sm"
                      style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">
                      {isAr ? "المرحلة الدراسية" : "Educational Stage"}
                    </label>
                    <select
                      value={stage}
                      onChange={(e) => setStage(e.target.value as EducationStage)}
                      className="w-full min-h-[42px] px-3 rounded-lg border text-sm"
                      style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}
                    >
                      {STAGE_OPTIONS.map((st) => (
                        <option key={st.id} value={st.id}>
                          {isAr ? st.labelAr : st.labelEn}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">
                      {isAr ? "الصف الدراسي" : "Grade Level"}
                    </label>
                    <input
                      type="text"
                      value={gradeLevel}
                      onChange={(e) => setGradeLevel(e.target.value)}
                      className="w-full min-h-[42px] px-3 rounded-lg border text-sm"
                      style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}
                    />
                  </div>
                </div>

                <div className="p-3 rounded-xl border text-xs flex flex-wrap items-center justify-between gap-2" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}>
                  <span>
                    {activePrepTemplate
                      ? isAr
                        ? `سيُبنى هذا الدرس والتحضير والبوربوينت وفق فورمة: «${activePrepTemplate.templateName}»`
                        : `Lesson, Plan & PowerPoint will follow template: "${activePrepTemplate.templateName}"`
                      : isAr
                        ? "لم تُرفق فورمة تحضير خاصة بعد — يمكنك إرفاقها من تبويب «فورمة التحضير المعتمدة» داخل القسم."
                        : "No custom Preparation Form attached yet — attach one inside this department's Prep Form tab."}
                  </span>
                  <label className="flex items-center gap-2 font-semibold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoPrepareOnUpload}
                      onChange={(e) => setAutoPrepareOnUpload(e.target.checked)}
                    />
                    <span>
                      {isAr
                        ? "بناء وحفظ التحضير + البوربوينت تلقائياً عند الرفع"
                        : "Auto-build & save Lesson Plan + PowerPoint on upload"}
                    </span>
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label
                    className="p-5 rounded-xl border border-dashed flex flex-col items-center justify-center gap-2 cursor-pointer text-center hover:opacity-90"
                    style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--accent-primary)" }}
                  >
                    {uploading ? (
                      <Loader2 className="w-7 h-7 animate-spin" style={{ color: "var(--accent-primary)" }} />
                    ) : (
                      <Upload className="w-7 h-7" style={{ color: "var(--accent-primary)" }} />
                    )}
                    <span className="text-sm font-bold">
                      {uploading
                        ? uploadStepText ||
                          (isAr
                            ? "جارٍ قراءة الملف وتحليل المفاهيم والأهداف..."
                            : "Analyzing file, concepts, objectives, and tables...")
                        : isAr
                        ? "رفع ملف الدرس (PDF / Word / PowerPoint / صورة / TXT)"
                        : "Upload Lesson File (PDF, Word, PPTX, Image, TXT)"}
                    </span>
                    <input
                      type="file"
                      accept=".pdf,.docx,.pptx,.txt,.md,.csv,image/*"
                      onChange={handleFileUpload}
                      disabled={uploading}
                      className="sr-only"
                    />
                  </label>

                  <label
                    className="p-5 rounded-xl border border-dashed flex flex-col items-center justify-center gap-2 cursor-pointer text-center hover:opacity-90"
                    style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}
                  >
                    {uploading ? (
                      <Loader2 className="w-7 h-7 animate-spin" style={{ color: "var(--accent-primary)" }} />
                    ) : (
                      <Camera className="w-7 h-7" style={{ color: "var(--accent-primary)" }} />
                    )}
                    <span className="text-sm font-bold">
                      {isAr
                        ? "تصوير صفحة الدرس مباشرة بالكاميرا"
                        : "Photograph Lesson Page with Camera"}
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handleFileUpload}
                      disabled={uploading}
                      className="sr-only"
                    />
                  </label>
                </div>

                <div
                  className="p-3 rounded-xl border text-xs flex flex-wrap items-center justify-between gap-2"
                  style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}
                >
                  <span style={{ color: "var(--text-secondary)" }}>
                    {isAr
                      ? "يدعم الملفات الكبيرة حتى 75 ميجابايت تلقائياً. وإذا كنتِ ترفعين كتاباً مدرسياً كاملاً وتريدين فهرسة كل وحداته ودروسه بالصفحات:"
                      : "Large PDFs up to 75 MB are supported automatically. Uploading a full textbook with multiple units?"}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setUploadOpen(false);
                      setSectionTab("books");
                    }}
                    className="px-3 py-1.5 rounded-lg border font-bold whitespace-nowrap"
                    style={{ borderColor: subjectMeta.accentHex, color: subjectMeta.accentHex }}
                  >
                    {isAr ? "رفع الكتاب وفهرسته في «الكتب الدائمة»" : "Upload to Full Textbooks"}
                  </button>
                </div>

                {uploadError && (
                  <p className="text-xs font-semibold text-red-600 dark:text-red-400" role="alert">
                    {uploadError}
                  </p>
                )}
              </motion.section>
            )}
          </AnimatePresence>

          {uploadSuccess && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 rounded-xl border flex items-center gap-2 text-sm font-medium"
              style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--accent-primary)" }}
            >
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <span>{uploadSuccess}</span>
            </motion.div>
          )}

          {/* Smart Library Tab 1: Lessons & Connected Tools */}
          {sectionTab === "lessons" && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Subject Lessons List */}
              <section
                className="lg:col-span-5 rounded-2xl border p-4 space-y-3"
                style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}
              >
                <div className="flex items-center justify-between gap-2 pb-2 border-b" style={{ borderColor: "var(--border-hairline)" }}>
                  <h3 className="text-sm font-bold">
                    {isAr ? `دروس قسم ${subjectMeta.nameAr}` : `${subjectMeta.nameEn} Lessons`}
                  </h3>
                  <span className="text-xs font-mono-num" style={{ color: "var(--text-secondary)" }}>
                    {filteredLessons.length} {isAr ? "درس" : "lessons"}
                  </span>
                </div>

                {filteredLessons.length === 0 ? (
                  <div className="p-5 rounded-xl border text-center space-y-2" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}>
                    <p className="text-xs font-semibold">
                      {isAr
                        ? `لا توجد دروس مضافة في قسم ${subjectMeta.nameAr} بعد.`
                        : `No lessons in ${subjectMeta.nameEn} yet.`}
                    </p>
                    <button
                      type="button"
                      onClick={() => setUploadOpen(true)}
                      className="min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-bold"
                      style={{ backgroundColor: "var(--accent-primary)", color: "var(--accent-contrast)" }}
                    >
                      {isAr ? "رفع أول درس للقسم" : "Upload First Lesson"}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-[540px] overflow-y-auto pe-1">
                    {filteredLessons.map((lesson) => {
                      const active = lesson.id === activeLesson?.id;
                      return (
                        <motion.div
                          key={lesson.id}
                          whileHover={settings.reduceMotion ? undefined : { x: isAr ? -3 : 3 }}
                          className="p-3.5 rounded-xl border transition-colors space-y-2"
                          style={{
                            backgroundColor: active ? "var(--bg-surface)" : "transparent",
                            borderColor: active ? subjectMeta.accentHex : "var(--border-hairline)",
                            borderWidth: active ? "2px" : "1px",
                          }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => onSelectLesson(lesson.id)}
                              className="text-start flex-1"
                            >
                              <div className="text-sm font-bold">{lesson.title}</div>
                              <div className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                                {lesson.gradeLevel} · {lesson.sources.length} {isAr ? "مصادر" : "sources"}
                              </div>
                            </button>
                            {lesson.isCustom && (
                              <button
                                type="button"
                                onClick={() => onDeleteLesson(lesson.id)}
                                aria-label={isAr ? "حذف الدرس" : "Delete lesson"}
                                className="p-1.5 rounded border text-red-600 hover:opacity-80"
                                style={{ borderColor: "var(--border-hairline)" }}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Active Lesson Extracted Knowledge & Direct Tool Links */}
              {activeLesson && (
                <section
                  className="lg:col-span-7 rounded-2xl border p-5 space-y-5"
                  style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}
                >
                  <div className="border-b pb-4" style={{ borderColor: "var(--border-hairline)" }}>
                    <div className="text-xs mb-1" style={{ color: "var(--text-secondary)" }}>
                      {activeLesson.subject} · {activeLesson.gradeLevel}
                    </div>
                    <h3 className="text-xl font-bold">{activeLesson.title}</h3>
                    <p className="text-sm mt-2 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                      {activeLesson.summary}
                    </p>
                  </div>

                  {activeLesson.extractedAnalysis && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                      <div className="p-3.5 rounded-xl border space-y-1.5" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}>
                        <div className="font-bold" style={{ color: "var(--accent-primary)" }}>
                          {isAr ? "المفاهيم المستخرجة" : "Extracted Concepts"}
                        </div>
                        <p>{activeLesson.extractedAnalysis.concepts.join(" · ")}</p>
                      </div>
                      <div className="p-3.5 rounded-xl border space-y-1.5" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}>
                        <div className="font-bold" style={{ color: "var(--accent-primary)" }}>
                          {isAr ? "الأهداف التعليمية" : "Learning Objectives"}
                        </div>
                        <ul className="list-disc list-inside space-y-0.5">
                          {activeLesson.extractedAnalysis.objectives.map((o, i) => (
                            <li key={i}>{o}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}

                  {/* Unified Connected Tools Launcher */}
                  <div className="space-y-2.5">
                    <div className="text-sm font-bold">
                      {isAr
                        ? "تشغيل الأدوات المترابطة مباشرة على هذا الدرس (دون إعادة رفع الملف):"
                        : "Launch Connected Tools Directly on This Lesson:"}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                      {[
                        {
                          label: isAr ? "تحضير الدرس (Word/PDF)" : "Lesson Plan (Word/PDF)",
                          icon: <FileText className="w-4 h-4" />,
                          action: () => onOpenTool("studio", "lesson_plan"),
                        },
                        {
                          label: isAr ? "عرض PowerPoint (.pptx)" : "PowerPoint (.pptx)",
                          icon: <Presentation className="w-4 h-4" />,
                          action: () => onOpenTool("studio", "pptx"),
                        },
                        {
                          label: isAr ? "الفيديو التعليمي" : "Educational Video",
                          icon: <Video className="w-4 h-4" />,
                          action: () => onOpenTool("studio", "video"),
                        },
                        {
                          label: isAr ? "ورقة العمل (طالب/معلم)" : "Worksheet (Word/PDF)",
                          icon: <ClipboardList className="w-4 h-4" />,
                          action: () => onOpenTool("studio", "worksheet"),
                        },
                        {
                          label: isAr ? "مسابقة مباشرة" : "Live Quiz",
                          icon: <Trophy className="w-4 h-4" />,
                          action: () => onOpenTool("kahoot"),
                        },
                        {
                          label: isAr ? "المساعد الذكي والتعلم الشامل" : "AI Tutor & Inclusive",
                          icon: <MessageSquare className="w-4 h-4" />,
                          action: () => onOpenTool("chatbot"),
                        },
                      ].map((btn, i) => (
                        <motion.button
                          key={i}
                          type="button"
                          whileHover={settings.reduceMotion ? undefined : { y: -2, scale: 1.02 }}
                          whileTap={settings.reduceMotion ? undefined : { scale: 0.96 }}
                          onClick={btn.action}
                          className="min-h-[44px] px-3 py-2 rounded-xl border text-xs font-semibold flex items-center gap-2 transition-colors"
                          style={{
                            backgroundColor: "var(--bg-surface)",
                            borderColor: "var(--border-hairline)",
                          }}
                        >
                          <span style={{ color: "var(--accent-primary)" }}>{btn.icon}</span>
                          <span className="truncate">{btn.label}</span>
                        </motion.button>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 pt-1">
                    <motion.button
                      type="button"
                      whileHover={settings.reduceMotion ? undefined : { scale: 1.02 }}
                      whileTap={settings.reduceMotion ? undefined : { scale: 0.96 }}
                      onClick={() => void handleAutoBuildForActiveLesson()}
                      disabled={autoBuilding}
                      className="min-h-[40px] px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 disabled:opacity-60"
                      style={{ backgroundColor: "var(--accent-primary)", color: "var(--accent-contrast)" }}
                    >
                      {autoBuilding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                      <span>
                        {autoBuilding
                          ? uploadStepText || (isAr ? "جارٍ البناء والحفظ..." : "Building & Saving...")
                          : isAr
                            ? "بناء وحفظ التحضير + البوربوينت وفق الفورمة"
                            : "Build & Save Plan + PPTX from Form"}
                      </span>
                    </motion.button>
                    <motion.button
                      type="button"
                      whileHover={settings.reduceMotion ? undefined : { scale: 1.02 }}
                      whileTap={settings.reduceMotion ? undefined : { scale: 0.96 }}
                      onClick={() => onOpenTool("inclusive")}
                      className="min-h-[40px] px-4 py-2 rounded-xl border text-xs font-semibold flex items-center gap-1.5"
                      style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}
                    >
                      <BookOpen className="w-4 h-4" />
                      <span>{isAr ? "الدرس والمحاكاة والتعلم الشامل" : "Lesson & Inclusive Hub"}</span>
                    </motion.button>
                    <motion.button
                      type="button"
                      whileHover={settings.reduceMotion ? undefined : { scale: 1.02 }}
                      whileTap={settings.reduceMotion ? undefined : { scale: 0.96 }}
                      onClick={() => onOpenTool("studio", "lesson_plan")}
                      className="min-h-[40px] px-4 py-2 rounded-xl border text-xs font-semibold flex items-center gap-1.5"
                      style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}
                    >
                      <FileText className="w-4 h-4" />
                      <span>{isAr ? "فتح استوديو التحضير والعرض" : "Open Content Studio"}</span>
                    </motion.button>
                  </div>
                </section>
              )}
            </div>
          )}

          {/* Smart Library Tab 2: Persistent Textbook Library Inside Selected Subject */}
          {sectionTab === "books" && (
            <BooksLibrarySection
              uiLang={uiLang}
              selectedSubject={selectedSubject}
              settings={settings}
              activePrepTemplate={activePrepTemplate}
              onSaveNewLesson={onSaveNewLesson}
              onSelectLesson={onSelectLesson}
              onOpenTool={onOpenTool}
              defaultFilterBySubject={true}
              onBooksChange={setBooks}
            />
          )}

          {/* Smart Library Tab 3: Official Preparation Form Inside Selected Subject */}
          {sectionTab === "prep_form" && (
            <PreparationFormCard
              uiLang={uiLang}
              selectedSubject={selectedSubject}
              settings={settings}
              prepTemplates={prepTemplates}
              activePrepTemplate={activePrepTemplate}
              onSelectPrepTemplate={onSelectPrepTemplate}
              onTemplateSaved={onSavePrepTemplate}
              onTemplateDeleted={onDeletePrepTemplate}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

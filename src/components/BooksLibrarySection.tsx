import React, { useState, useEffect, useMemo } from "react";
import {
  BookOpen,
  BookMarked,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileText,
  Gamepad2,
  Loader2,
  Presentation,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Trophy,
  Upload,
} from "lucide-react";
import { SUBJECTS } from "../data/lessons.ts";
import type {
  AccessibilitySettings,
  BookChapter,
  BookLessonEntry,
  BookRecord,
  BookUnit,
  EducationStage,
  LessonData,
  PreparationTemplate,
  SubjectId,
  UILanguage,
} from "../types.ts";
import { prepareUploadPayload, inferUploadMimeType } from "../utils/chunkUpload.ts";

interface BooksLibrarySectionProps {
  uiLang: UILanguage;
  selectedSubject: SubjectId;
  settings: AccessibilitySettings;
  activePrepTemplate: PreparationTemplate | null;
  onSaveNewLesson: (lesson: LessonData) => Promise<void>;
  onSelectLesson: (lessonId: string) => void;
  onOpenTool: (
    tab: "studio" | "kahoot" | "chatbot" | "inclusive",
    subTab?: "lesson_plan" | "pptx" | "video" | "worksheet" | "adaptive_quiz"
  ) => void;
  defaultFilterBySubject?: boolean;
  onBooksChange?: (books: BookRecord[]) => void;
}

const STAGE_LABELS: Array<{ id: EducationStage; labelAr: string; labelEn: string }> = [
  { id: "elementary", labelAr: "المرحلة الابتدائية", labelEn: "Elementary" },
  { id: "middle", labelAr: "المرحلة المتوسطة", labelEn: "Middle School" },
  { id: "high", labelAr: "المرحلة الثانوية", labelEn: "High School" },
];

export const BooksLibrarySection: React.FC<BooksLibrarySectionProps> = ({
  uiLang,
  selectedSubject,
  settings,
  activePrepTemplate,
  onSaveNewLesson,
  onSelectLesson,
  onOpenTool,
  defaultFilterBySubject = true,
  onBooksChange,
}) => {
  const isAr = uiLang === "ar";
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [activeBookId, setActiveBookId] = useState<string | null>(null);
  const [filterBySubject, setFilterBySubject] = useState(defaultFilterBySubject);

  const currentSubjectMeta = SUBJECTS.find((s) => s.id === selectedSubject) || SUBJECTS[0];

  // Upload drawer state
  const [uploadOpen, setUploadOpen] = useState(false);
  const [bookSubject, setBookSubject] = useState<SubjectId>(selectedSubject);
  const [bookStage, setBookStage] = useState<EducationStage>("high");
  const [bookGrade, setBookGrade] = useState(isAr ? "الصف العاشر" : "Grade 10");
  const [bookTitle, setBookTitle] = useState("");
  const [uploadingBook, setUploadingBook] = useState(false);
  const [analyzingBookId, setAnalyzingBookId] = useState<string | null>(null);
  const [extractingLessonId, setExtractingLessonId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Structured Index Explorer state
  const [expandedUnitIds, setExpandedUnitIds] = useState<Record<string, boolean>>({});
  const [selectedEntry, setSelectedEntry] = useState<{
    unit: BookUnit;
    chapter: BookChapter;
    lesson: BookLessonEntry;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    setBookSubject(selectedSubject);
  }, [selectedSubject]);

  useEffect(() => {
    fetch("/api/books")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.books)) {
          setBooks(data.books);
          onBooksChange?.(data.books);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    onBooksChange?.(books);
  }, [books]);

  const displayedBooks = useMemo(() => {
    if (!filterBySubject) return books;
    return books.filter((b) => b.subjectId === selectedSubject);
  }, [books, filterBySubject, selectedSubject]);

  const activeBook = useMemo(
    () => displayedBooks.find((b) => b.id === activeBookId) || displayedBooks[0] || null,
    [displayedBooks, activeBookId]
  );

  // Auto-select first unit & lesson when activeBook changes
  useEffect(() => {
    if (!activeBook) {
      setSelectedEntry(null);
      return;
    }
    const firstUnit = activeBook.units?.[0];
    if (firstUnit) {
      setExpandedUnitIds((prev) => ({ ...prev, [firstUnit.id]: true }));
      const firstChapter = firstUnit.chapters?.[0];
      const firstLesson = firstChapter?.lessons?.[0];
      if (firstChapter && firstLesson) {
        setSelectedEntry({ unit: firstUnit, chapter: firstChapter, lesson: firstLesson });
        return;
      }
    }
    setSelectedEntry(null);
  }, [activeBook?.id]);

  /**
   * Triggers a Gemini API analysis on an uploaded book stored in the platform
   * to extract units, chapters, lesson titles, and page mappings into a structured index.
   */
  const analyzeBookStructure = async (bookId: string): Promise<BookRecord | null> => {
    if (!settings.aiProcessingConsent) {
      setErrorMessage(
        isAr
          ? "يرجى تفعيل موافقة المعالجة بالذكاء الاصطناعي في الخصوصية لتحليل فهرس الكتاب."
          : "Enable AI processing consent in Privacy settings to analyze this book."
      );
      return null;
    }

    setAnalyzingBookId(bookId);
    setErrorMessage(null);
    setStatusMessage(
      isAr
        ? "جارٍ تحليل الكتاب عبر Gemini API لاستخراج الوحدات والفصول وعناوين الدروس وأرقام الصفحات..."
        : "Analyzing uploaded textbook via Gemini API to extract units, chapters, and lessons..."
    );

    try {
      const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: uiLang }),
      });
      const data = await res.json();
      if (!res.ok || !data.book) {
        throw new Error(
          data.message ||
            (isAr ? "تعذر استخراج فهرس الكتاب بالذكاء الاصطناعي." : "Failed to index book.")
        );
      }

      const indexed = data.book as BookRecord;
      setBooks((prev) => [indexed, ...prev.filter((b) => b.id !== indexed.id)]);
      setActiveBookId(indexed.id);

      const firstUnit = indexed.units?.[0];
      const firstChapter = firstUnit?.chapters?.[0];
      const firstLesson = firstChapter?.lessons?.[0];
      if (firstUnit) {
        setExpandedUnitIds({ [firstUnit.id]: true });
      }
      if (firstUnit && firstChapter && firstLesson) {
        setSelectedEntry({ unit: firstUnit, chapter: firstChapter, lesson: firstLesson });
      }

      const lessonCount = indexed.units.reduce(
        (acc, u) => acc + u.chapters.reduce((cAcc, c) => cAcc + c.lessons.length, 0),
        0
      );

      setStatusMessage(
        isAr
          ? `تم تحليل «${indexed.title}» وبناء الفهرس الدائم: ${indexed.units.length} وحدة · ${lessonCount} درس مرتبط بأرقام الصفحات.`
          : `Indexed "${indexed.title}": ${indexed.units.length} units · ${lessonCount} lessons linked to textbook pages.`
      );
      return indexed;
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : isAr
            ? "تعذر تحليل فهرس الكتاب."
            : "Book indexing failed."
      );
      return null;
    } finally {
      setAnalyzingBookId(null);
    }
  };

  const handleUploadBookFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 75 * 1024 * 1024) {
      setErrorMessage(
        isAr
          ? "حجم الملف يتجاوز الحد الأقصى المسموح به (75 ميجابايت)."
          : "File size exceeds the 75 MB limit."
      );
      e.target.value = "";
      return;
    }

    setUploadingBook(true);
    setErrorMessage(null);
    setStatusMessage(
      isAr
        ? `جارٍ رفع وحفظ كتاب «${file.name}» بشكل دائم في مكتبة المنصة...`
        : `Saving "${file.name}" persistently to the platform library...`
    );

    try {
      const prepared = await prepareUploadPayload(file, (pct) => {
        if (file.size > 4 * 1024 * 1024) {
          setStatusMessage(
            isAr
              ? `جارٍ رفع أجزاء كتاب «${file.name}» إلى مكتبة المنصة (${pct}%)...`
              : `Uploading "${file.name}" chunks (${pct}%)...`
          );
        }
      });

      const subjMeta = SUBJECTS.find((s) => s.id === bookSubject) || SUBJECTS[0];

      const saveRes = await fetch("/api/books", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectId: bookSubject,
          subjectName: isAr ? subjMeta.nameAr : subjMeta.nameEn,
          stage: bookStage,
          gradeLevel: bookGrade.trim() || (isAr ? "الصف العاشر" : "Grade 10"),
          title: bookTitle.trim() || file.name.replace(/\.[^.]+$/, ""),
          fileName: file.name,
          mimeType: inferUploadMimeType(file),
          ...prepared,
          autoAnalyze: false,
          language: uiLang,
        }),
      });

      const saveRaw = await saveRes.text();
      let saveData: { book?: BookRecord; message?: string } = {};
      try {
        saveData = JSON.parse(saveRaw);
      } catch {
        // Ignore parse error
      }
      if (!saveRes.ok || !saveData.book) {
        throw new Error(
          saveData.message || (isAr ? `تعذر حفظ الكتاب في المنصة (${saveRes.status}).` : "Failed to store book.")
        );
      }

      const savedBook = saveData.book as BookRecord;
      setBooks((prev) => [savedBook, ...prev.filter((b) => b.id !== savedBook.id)]);
      setActiveBookId(savedBook.id);
      setBookTitle("");
      setUploadOpen(false);
      setUploadingBook(false);

      // Immediately run Gemini structured index extraction on the newly stored book
      await analyzeBookStructure(savedBook.id);
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : isAr
            ? "تعذر رفع الكتاب."
            : "Upload failed."
      );
      setUploadingBook(false);
    } finally {
      e.target.value = "";
    }
  };

  const handleDeepExtractBookLesson = async () => {
    if (!activeBook || !selectedEntry) return;
    if (!settings.aiProcessingConsent) {
      setErrorMessage(
        isAr ? "يرجى تفعيل موافقة الذكاء الاصطناعي أولاً." : "Enable AI consent first."
      );
      return;
    }

    const { unit, chapter, lesson } = selectedEntry;
    setExtractingLessonId(lesson.id);
    setErrorMessage(null);
    setStatusMessage(
      isAr
        ? `جارٍ استخراج النص الكامل والتفاصيل للدرس «${lesson.title}» من صفحات (${lesson.startPage}–${lesson.endPage})...`
        : `Extracting full content for "${lesson.title}" from pages ${lesson.startPage}–${lesson.endPage}...`
    );

    try {
      const res = await fetch(`/api/books/${encodeURIComponent(activeBook.id)}/extract-lesson`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          unitId: unit.id,
          chapterId: chapter.id,
          lessonEntryId: lesson.id,
          lessonTitle: lesson.title,
          startPage: lesson.startPage,
          endPage: lesson.endPage,
          language: uiLang,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.extracted) {
        throw new Error(
          data.message || (isAr ? "تعذر استخراج محتوى الدرس من صفحات الكتاب." : "Failed page extraction.")
        );
      }

      const ext = data.extracted;
      const updatedLesson: BookLessonEntry = {
        ...lesson,
        summary: ext.summary || lesson.summary,
        objectives: Array.isArray(ext.objectives) ? ext.objectives : lesson.objectives,
        keyConcepts: Array.isArray(ext.keyConcepts) ? ext.keyConcepts : lesson.keyConcepts,
        contentExcerpt: ext.fullLessonText || lesson.contentExcerpt,
      };

      setBooks((prev) =>
        prev.map((b) => {
          if (b.id !== activeBook.id) return b;
          return {
            ...b,
            units: b.units.map((u) =>
              u.id !== unit.id
                ? u
                : {
                    ...u,
                    chapters: u.chapters.map((c) =>
                      c.id !== chapter.id
                        ? c
                        : {
                            ...c,
                            lessons: c.lessons.map((l) => (l.id === lesson.id ? updatedLesson : l)),
                          }
                    ),
                  }
            ),
          };
        })
      );
      setSelectedEntry({ unit, chapter, lesson: updatedLesson });
      setStatusMessage(
        isAr
          ? `تم استخراج وحفظ محتوى الدرس «${updatedLesson.title}» من صفحات (${updatedLesson.startPage}–${updatedLesson.endPage}) بنجاح.`
          : `Extracted and saved full content for "${updatedLesson.title}" (pp. ${updatedLesson.startPage}–${updatedLesson.endPage}).`
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : isAr
            ? "تعذر استخراج تفاصيل الدرس."
            : "Lesson extraction error."
      );
    } finally {
      setExtractingLessonId(null);
    }
  };

  const handleDeleteBook = async (bookId: string) => {
    try {
      const res = await fetch(`/api/books/${encodeURIComponent(bookId)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setBooks((prev) => prev.filter((b) => b.id !== bookId));
        if (activeBookId === bookId) {
          setActiveBookId(null);
          setSelectedEntry(null);
        }
      }
    } catch {
      // Ignore
    }
  };

  const activateSelectedBookLesson = async (
    destination?: {
      tab: "studio" | "kahoot" | "chatbot" | "inclusive";
      subTab?: "lesson_plan" | "pptx" | "video" | "worksheet" | "adaptive_quiz";
    }
  ) => {
    if (!activeBook || !selectedEntry) return;
    const { unit, chapter, lesson } = selectedEntry;
    const subjMeta = SUBJECTS.find((s) => s.id === activeBook.subjectId) || SUBJECTS[0];
    const stableLessonId = `book-lesson-${lesson.id}`;
    const pageSpanLabel = `${isAr ? "صفحات" : "Pages"} ${lesson.startPage}–${lesson.endPage}`;

    const lessonPayload: LessonData = {
      id: stableLessonId,
      subjectId: activeBook.subjectId,
      title: lesson.title,
      subject: activeBook.subjectName,
      stage: activeBook.stage,
      gradeLevel: activeBook.gradeLevel,
      estimatedMinutes: 45,
      summary: lesson.summary || lesson.title,
      simplifiedSummary: lesson.summary || lesson.title,
      diagramUrl: subjMeta.defaultDiagramUrl,
      diagramTitle: `${lesson.title} (${pageSpanLabel})`,
      diagramBaselineAlt: lesson.summary || lesson.title,
      audioLessonScript: `${lesson.title}. ${lesson.summary}. ${lesson.contentExcerpt}`,
      keySignTerms: lesson.keyConcepts.slice(0, 4),
      extractedAnalysis: {
        concepts: lesson.keyConcepts,
        objectives: lesson.objectives,
        tablesAndFiguresSummary: [`${activeBook.title} — ${pageSpanLabel}`],
        keyFormulasOrRules: [],
      },
      prepTemplateId: activePrepTemplate?.id,
      bookId: activeBook.id,
      pageRange: pageSpanLabel,
      sources: [
        {
          id: `src-${lesson.id}`,
          title: `${activeBook.title} · ${unit.unitTitle} · ${chapter.chapterTitle} (${pageSpanLabel})`,
          category: isAr ? "محتوى الكتاب المدرسي" : "Textbook Source",
          content: `${lesson.title}\n${pageSpanLabel}\n\n${lesson.summary}\n\n${
            lesson.objectives.length > 0
              ? `${isAr ? "الأهداف:" : "Objectives:"}\n- ${lesson.objectives.join("\n- ")}\n\n`
              : ""
          }${lesson.contentExcerpt}`,
          enabled: true,
          sourceFileName: activeBook.fileName,
        },
      ],
      simulationControls: [],
      quizQuestions: [],
      isCustom: true,
    };

    await onSaveNewLesson(lessonPayload);
    onSelectLesson(lessonPayload.id);
    setStatusMessage(
      isAr
        ? `تم تفعيل درس «${lesson.title}» (${pageSpanLabel}) من كتاب «${activeBook.title}» كمصدر نشط للمنصة.`
        : `Activated "${lesson.title}" (${pageSpanLabel}) from "${activeBook.title}".`
    );

    if (destination) {
      onOpenTool(destination.tab, destination.subTab);
    }
  };

  const formatBytes = (bytes: number) => {
    if (!bytes) return "—";
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const countBookLessons = (b: BookRecord) =>
    (b.units || []).reduce(
      (sum, u) => sum + (u.chapters || []).reduce((cs, c) => cs + (c.lessons || []).length, 0),
      0
    );

  const normalizedQuery = searchQuery.trim().toLowerCase();

  return (
    <section
      aria-label={isAr ? "مكتبة الكتب الدراسية الدائمة" : "Persistent Textbook Library"}
      className="science-card rounded-2xl border p-5 md:p-6 space-y-5 backdrop-blur-sm"
      style={{
        backgroundColor: "var(--bg-surface)",
        borderColor: "var(--border-hairline)",
      }}
    >
      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4" style={{ borderColor: "var(--border-hairline)" }}>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <BookMarked className="w-5 h-5" style={{ color: "var(--accent-primary)" }} />
            <h2 className="text-lg font-bold">
              {filterBySubject
                ? isAr
                  ? `مكتبة الكتب الدائمة — قسم ${currentSubjectMeta.nameAr}`
                  : `${currentSubjectMeta.nameEn} Textbook Library & Index`
                : isAr
                  ? "مكتبة الكتب الدراسية الدائمة وفهرسة الدروس (جميع الأقسام)"
                  : "All-Subjects Textbook Library & Structured Index"}
            </h2>
          </div>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            {isAr
              ? "ارفع كتب المادة مرة واحدة لتُحفظ بشكل دائم طوال العام، ويستخرج Gemini الوحدات والفصول والدروس المرتبطة بصفحاتها لتبني منها التحضير والبوربوينت والأسئلة والألعاب."
              : "Upload subject textbooks once to store them permanently, automatically index units, chapters, and page-bound lessons via Gemini, and build lesson plans, slides, and quizzes directly."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setFilterBySubject((v) => !v)}
            className="min-h-[40px] px-3.5 py-2 rounded-xl border text-xs font-semibold whitespace-nowrap shrink-0"
            style={{
              backgroundColor: filterBySubject ? "var(--bg-subtle)" : "transparent",
              borderColor: filterBySubject ? "var(--accent-primary)" : "var(--border-hairline)",
              color: filterBySubject ? "var(--accent-primary)" : "var(--text-secondary)",
            }}
          >
            {filterBySubject
              ? isAr
                ? `كتب جميع الأقسام (${books.length})`
                : `All Subjects (${books.length})`
              : isAr
                ? `الاقتصار على كتب ${currentSubjectMeta.nameAr}`
                : `${currentSubjectMeta.nameEn} Only`}
          </button>

          <button
            type="button"
            onClick={() => setUploadOpen((v) => !v)}
            className="min-h-[40px] px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0"
            style={{
              backgroundColor: "var(--accent-primary)",
              color: "var(--accent-contrast)",
            }}
          >
            <Upload className="w-4 h-4" />
            <span>{isAr ? "رفع وحفظ كتاب دراسي جديد" : "Upload & Save Textbook"}</span>
          </button>
        </div>
      </div>

      {/* Upload Book Panel */}
      {uploadOpen && (
        <div
          className="p-4 rounded-2xl border space-y-4"
          style={{
            backgroundColor: "var(--bg-subtle)",
            borderColor: "var(--accent-primary)",
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold">
              {isAr ? "إضافة كتاب جديد إلى مكتبة المنصة الدائمة" : "Upload New Textbook to Permanent Library"}
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

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div>
              <label className="block font-bold mb-1">{isAr ? "المادة الدراسية" : "Subject"}</label>
              <select
                value={bookSubject}
                onChange={(e) => setBookSubject(e.target.value as SubjectId)}
                className="w-full min-h-[40px] px-3 rounded-lg border"
                style={{
                  backgroundColor: "var(--bg-surface)",
                  borderColor: "var(--border-hairline)",
                  color: "var(--text-primary)",
                }}
              >
                {SUBJECTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {isAr ? s.nameAr : s.nameEn}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-bold mb-1">{isAr ? "المرحلة" : "Stage"}</label>
              <select
                value={bookStage}
                onChange={(e) => setBookStage(e.target.value as EducationStage)}
                className="w-full min-h-[40px] px-3 rounded-lg border"
                style={{
                  backgroundColor: "var(--bg-surface)",
                  borderColor: "var(--border-hairline)",
                  color: "var(--text-primary)",
                }}
              >
                {STAGE_LABELS.map((st) => (
                  <option key={st.id} value={st.id}>
                    {isAr ? st.labelAr : st.labelEn}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-bold mb-1">{isAr ? "الصف الدراسي" : "Grade Level"}</label>
              <input
                type="text"
                value={bookGrade}
                onChange={(e) => setBookGrade(e.target.value)}
                placeholder={isAr ? "مثلاً: الصف العاشر" : "e.g., Grade 10"}
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
                {isAr ? "عنوان الكتاب (اختياري)" : "Book Title (optional)"}
              </label>
              <input
                type="text"
                value={bookTitle}
                onChange={(e) => setBookTitle(e.target.value)}
                placeholder={isAr ? "مثلاً: كتاب الكيمياء — الفصل الأول" : "e.g., Chemistry Grade 10"}
                className="w-full min-h-[40px] px-3 rounded-lg border"
                style={{
                  backgroundColor: "var(--bg-surface)",
                  borderColor: "var(--border-hairline)",
                  color: "var(--text-primary)",
                }}
              />
            </div>
          </div>

          <label
            className="p-5 rounded-xl border border-dashed flex flex-col items-center justify-center gap-2 cursor-pointer text-center hover:opacity-90"
            style={{
              backgroundColor: "var(--bg-surface)",
              borderColor: "var(--accent-primary)",
            }}
          >
            {uploadingBook || analyzingBookId ? (
              <Loader2 className="w-7 h-7 animate-spin" style={{ color: "var(--accent-primary)" }} />
            ) : (
              <Upload className="w-7 h-7" style={{ color: "var(--accent-primary)" }} />
            )}
            <span className="text-sm font-bold">
              {uploadingBook
                ? isAr
                  ? "جارٍ رفع الكتاب وحفظه بشكل دائم..."
                  : "Saving textbook permanently..."
                : analyzingBookId
                  ? isAr
                    ? "جارٍ تحليل الفهرس واستخراج الوحدات والدروس عبر Gemini..."
                    : "Extracting units & lessons via Gemini..."
                  : isAr
                    ? "اختر ملف الكتاب المدرسي (PDF / Word .docx / PowerPoint .pptx / نص)"
                    : "Select Textbook File (PDF, Word .docx, PowerPoint .pptx, TXT)"}
            </span>
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
              {isAr
                ? "سيتم حفظ الملف تلقائياً في خادم المنصة ثم تحليله فوراً لبناء شجرة الوحدات والدروس المرتبطة بصفحاته."
                : "Stored permanently on the platform and immediately analyzed via Gemini to index every unit and lesson."}
            </span>
            <input
              type="file"
              accept=".pdf,.docx,.pptx,.txt,.md,application/pdf"
              onChange={handleUploadBookFile}
              disabled={uploadingBook || Boolean(analyzingBookId)}
              className="sr-only"
            />
          </label>
        </div>
      )}

      {/* Status & Error Alerts */}
      {statusMessage && (
        <div
          role="status"
          className="p-3.5 rounded-xl border flex items-center gap-2 text-xs font-medium"
          style={{
            backgroundColor: "var(--bg-subtle)",
            borderColor: "var(--accent-primary)",
            color: "var(--text-primary)",
          }}
        >
          {(uploadingBook || analyzingBookId || extractingLessonId) ? (
            <Loader2 className="w-4 h-4 animate-spin shrink-0" style={{ color: "var(--accent-primary)" }} />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          )}
          <span>{statusMessage}</span>
        </div>
      )}

      {errorMessage && (
        <p className="text-xs text-rose-600 dark:text-rose-400" role="alert">
          {errorMessage}
        </p>
      )}

      {/* Saved Books Shelf */}
      {displayedBooks.length === 0 ? (
        <div
          className="p-6 rounded-xl border text-center space-y-2"
          style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}
        >
          <p className="text-sm font-semibold">
            {filterBySubject
              ? isAr
                ? `لا توجد كتب مدرسية محفوظة في قسم ${currentSubjectMeta.nameAr} بعد.`
                : `No textbooks saved in ${currentSubjectMeta.nameEn} yet.`
              : isAr
                ? "لا توجد كتب مدرسية محفوظة في مكتبة المنصة بعد."
                : "No textbooks saved in the library yet."}
          </p>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            {isAr
              ? `اضغط «رفع وحفظ كتاب دراسي جديد» لإضافة كتاب في مادة ${currentSubjectMeta.nameAr} وفهرسة وحداته ودروسه طوال العام.`
              : `Click Upload & Save Textbook to permanently store a ${currentSubjectMeta.nameEn} textbook and index its units and lessons.`}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {displayedBooks.map((bk) => {
              const selected = activeBook?.id === bk.id;
              const isAnalyzingThis = analyzingBookId === bk.id;
              const totalLessons = countBookLessons(bk);

              return (
                <div
                  key={bk.id}
                  onClick={() => setActiveBookId(bk.id)}
                  className="p-4 rounded-xl border cursor-pointer transition-colors flex flex-col justify-between gap-3"
                  style={{
                    backgroundColor: selected ? "var(--bg-subtle)" : "var(--bg-surface)",
                    borderColor: selected ? "var(--accent-primary)" : "var(--border-hairline)",
                    borderWidth: selected ? "2px" : "1px",
                  }}
                >
                  <div className="space-y-1.5">
                    <div className="text-[11px] tabular-nums" style={{ color: "var(--text-secondary)" }}>
                      {bk.subjectName} · {bk.gradeLevel} · {formatBytes(bk.fileSizeBytes)}
                    </div>
                    <h3 className="text-sm font-bold leading-snug">{bk.title}</h3>
                    <div className="text-xs tabular-nums" style={{ color: "var(--text-secondary)" }}>
                      {bk.analysisStatus === "indexed"
                        ? isAr
                          ? `${bk.units.length} وحدات · ${totalLessons} درس${bk.totalPagesEstimated ? ` · ${bk.totalPagesEstimated} ص` : ""}`
                          : `${bk.units.length} units · ${totalLessons} lessons${bk.totalPagesEstimated ? ` · ${bk.totalPagesEstimated} pp.` : ""}`
                        : bk.analysisStatus === "analyzing" || isAnalyzingThis
                          ? isAr
                            ? "جارٍ تحليل الفهرس عبر Gemini..."
                            : "Analyzing via Gemini..."
                          : bk.analysisStatus === "error"
                            ? isAr
                              ? "بانتظار إعادة التحليل"
                              : "Needs re-analysis"
                            : isAr
                              ? "محفوظ · اضغط لتحليل الفهرس"
                              : "Stored · Ready to analyze"}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t" style={{ borderColor: "var(--border-hairline)" }}>
                    <button
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        void analyzeBookStructure(bk.id);
                      }}
                      disabled={Boolean(analyzingBookId)}
                      className="min-h-[34px] px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap"
                      style={{
                        backgroundColor: "var(--bg-surface)",
                        borderColor: "var(--border-hairline)",
                        color: "var(--accent-primary)",
                      }}
                    >
                      {isAnalyzingThis ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {bk.analysisStatus === "indexed"
                          ? isAr
                            ? "تحديث الفهرس"
                            : "Re-index"
                          : isAr
                            ? "تحليل الفهرس (Gemini)"
                            : "Analyze Index"}
                      </span>
                    </button>

                    <a
                      href={`/api/books/${encodeURIComponent(bk.id)}/file`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(ev) => ev.stopPropagation()}
                      className="min-h-[34px] px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap"
                      style={{
                        borderColor: "var(--border-hairline)",
                        color: "var(--text-primary)",
                      }}
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>{isAr ? "فتح الكتاب" : "Open File"}</span>
                    </a>

                    <button
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        void handleDeleteBook(bk.id);
                      }}
                      aria-label={isAr ? `حذف ${bk.title}` : `Delete ${bk.title}`}
                      className="min-h-[34px] p-1.5 rounded-lg border text-rose-600 hover:opacity-80"
                      style={{ borderColor: "var(--border-hairline)" }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Active Book Structured Index & Lesson Action Workbench */}
          {activeBook && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 pt-2 border-t" style={{ borderColor: "var(--border-hairline)" }}>
              {/* Left 5 cols: Search + Units -> Chapters -> Lessons Tree */}
              <div className="lg:col-span-5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-bold flex items-center gap-1.5">
                    <BookOpen className="w-4 h-4" style={{ color: "var(--accent-primary)" }} />
                    <span>{isAr ? "فهرس الوحدات والدروس" : "Structured Units & Lessons"}</span>
                  </h3>
                  <span className="text-xs tabular-nums" style={{ color: "var(--text-secondary)" }}>
                    {countBookLessons(activeBook)} {isAr ? "درس" : "lessons"}
                  </span>
                </div>

                <div className="relative">
                  <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 start-3 opacity-60" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={
                      isAr
                        ? "ابحث باسم الدرس أو الوحدة أو رقم الصفحة..."
                        : "Search by lesson, unit, or page..."
                    }
                    className="w-full min-h-[38px] ps-9 pe-3 rounded-lg border text-xs"
                    style={{
                      backgroundColor: "var(--bg-subtle)",
                      borderColor: "var(--border-hairline)",
                      color: "var(--text-primary)",
                    }}
                  />
                </div>

                {activeBook.units.length === 0 ? (
                  <div
                    className="p-4 rounded-xl border text-xs space-y-2.5"
                    style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}
                  >
                    <p style={{ color: "var(--text-secondary)" }}>
                      {activeBook.analysisError ||
                        (isAr
                          ? "لم يُنشأ فهرس لهذا الكتاب بعد. اضغط على الزر أدناه لتحليل الكتاب عبر Gemini API."
                          : "This book has not been indexed yet. Click below to run Gemini structure analysis.")}
                    </p>
                    <button
                      type="button"
                      onClick={() => void analyzeBookStructure(activeBook.id)}
                      disabled={Boolean(analyzingBookId)}
                      className="min-h-[38px] px-3.5 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5"
                      style={{ backgroundColor: "var(--accent-primary)", color: "var(--accent-contrast)" }}
                    >
                      {analyzingBookId === activeBook.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Sparkles className="w-4 h-4" />
                      )}
                      <span>{isAr ? "تحليل الكتاب واستخراج الفهرس الآن" : "Analyze Book Index Now"}</span>
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-[520px] overflow-y-auto pe-1">
                    {activeBook.units.map((unit) => {
                      const isExpanded = expandedUnitIds[unit.id] ?? true;
                      const matchingChapters = unit.chapters
                        .map((chap) => {
                          const filteredLessons = chap.lessons.filter((les) => {
                            if (!normalizedQuery) return true;
                            const haystack = `${unit.unitTitle} ${chap.chapterTitle} ${les.title} ${les.startPage} ${les.endPage}`.toLowerCase();
                            return haystack.includes(normalizedQuery);
                          });
                          return { ...chap, lessons: filteredLessons };
                        })
                        .filter((chap) => chap.lessons.length > 0 || !normalizedQuery);

                      if (matchingChapters.length === 0 && normalizedQuery) return null;

                      return (
                        <div
                          key={unit.id}
                          className="rounded-xl border overflow-hidden"
                          style={{
                            backgroundColor: "var(--bg-subtle)",
                            borderColor: "var(--border-hairline)",
                          }}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedUnitIds((prev) => ({ ...prev, [unit.id]: !isExpanded }))
                            }
                            className="w-full p-3 flex items-center justify-between gap-2 text-start text-xs font-bold"
                          >
                            <div className="min-w-0">
                              <div className="truncate">
                                {isAr ? `الوحدة ${unit.unitNumber}:` : `Unit ${unit.unitNumber}:`} {unit.unitTitle}
                              </div>
                              <div className="text-[11px] font-normal tabular-nums mt-0.5" style={{ color: "var(--text-secondary)" }}>
                                {isAr ? `ص ${unit.startPage}–${unit.endPage}` : `pp. ${unit.startPage}–${unit.endPage}`} · {unit.chapters.length} {isAr ? "فصول" : "chapters"}
                              </div>
                            </div>
                            {isExpanded ? <ChevronUp className="w-4 h-4 shrink-0" /> : <ChevronDown className="w-4 h-4 shrink-0" />}
                          </button>

                          {isExpanded && (
                            <div className="px-3 pb-3 space-y-2.5 border-t pt-2.5" style={{ borderColor: "var(--border-hairline)" }}>
                              {matchingChapters.map((chap) => (
                                <div key={chap.id} className="space-y-1.5">
                                  <div className="text-[11px] font-bold" style={{ color: "var(--text-secondary)" }}>
                                    {chap.chapterTitle} ({isAr ? `ص ${chap.startPage}–${chap.endPage}` : `pp. ${chap.startPage}–${chap.endPage}`})
                                  </div>
                                  <div className="space-y-1">
                                    {chap.lessons.map((les) => {
                                      const isSel = selectedEntry?.lesson.id === les.id;
                                      return (
                                        <button
                                          key={les.id}
                                          type="button"
                                          onClick={() =>
                                            setSelectedEntry({ unit, chapter: chap, lesson: les })
                                          }
                                          className="w-full text-start p-2.5 rounded-lg border text-xs transition-colors flex items-center justify-between gap-2"
                                          style={{
                                            backgroundColor: isSel ? "var(--bg-surface)" : "transparent",
                                            borderColor: isSel ? "var(--accent-primary)" : "var(--border-hairline)",
                                          }}
                                        >
                                          <span className="font-semibold truncate">
                                            {les.lessonNumber}. {les.title}
                                          </span>
                                          <span
                                            className="text-[11px] font-mono-num shrink-0"
                                            style={{ color: "var(--accent-primary)" }}
                                          >
                                            {isAr ? `ص ${les.startPage}–${les.endPage}` : `p.${les.startPage}-${les.endPage}`}
                                          </span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Right 7 cols: Linked Lesson Detail, Page Content & Direct Tool Actions */}
              <div className="lg:col-span-7">
                {!selectedEntry ? (
                  <div
                    className="h-full min-h-[260px] rounded-2xl border p-6 flex items-center justify-center text-center text-xs"
                    style={{
                      backgroundColor: "var(--bg-subtle)",
                      borderColor: "var(--border-hairline)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {isAr
                      ? "اختر أي درس من شجرة الوحدات والفصول لعرض محتواه المرتبط بصفحات الكتاب وتوليد التحضير والبوربوينت والأسئلة والألعاب."
                      : "Select any lesson from the unit tree to inspect its textbook pages, summary, and build plans, slides, or quizzes."}
                  </div>
                ) : (
                  <div
                    className="rounded-2xl border p-5 space-y-4"
                    style={{
                      backgroundColor: "var(--bg-subtle)",
                      borderColor: "var(--border-hairline)",
                    }}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-3" style={{ borderColor: "var(--border-hairline)" }}>
                      <div className="space-y-1">
                        <div className="text-xs tabular-nums" style={{ color: "var(--text-secondary)" }}>
                          {selectedEntry.unit.unitTitle} · {selectedEntry.chapter.chapterTitle} ·{" "}
                          <strong style={{ color: "var(--accent-primary)" }}>
                            {isAr
                              ? `الصفحات ${selectedEntry.lesson.startPage}–${selectedEntry.lesson.endPage}`
                              : `Pages ${selectedEntry.lesson.startPage}–${selectedEntry.lesson.endPage}`}
                          </strong>
                        </div>
                        <h4 className="text-base md:text-lg font-bold">
                          {selectedEntry.lesson.title}
                        </h4>
                      </div>

                      <button
                        type="button"
                        onClick={handleDeepExtractBookLesson}
                        disabled={Boolean(extractingLessonId)}
                        className="min-h-[38px] px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
                        style={{
                          backgroundColor: "var(--bg-surface)",
                          borderColor: "var(--border-hairline)",
                          color: "var(--accent-primary)",
                        }}
                      >
                        {extractingLessonId === selectedEntry.lesson.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="w-3.5 h-3.5" />
                        )}
                        <span>
                          {isAr
                            ? `استخراج تفاصيل ص ${selectedEntry.lesson.startPage}–${selectedEntry.lesson.endPage}`
                            : `Extract Deep Content (pp.${selectedEntry.lesson.startPage}-${selectedEntry.lesson.endPage})`}
                        </span>
                      </button>
                    </div>

                    <div className="space-y-3 text-xs leading-relaxed">
                      <div>
                        <div className="font-bold mb-1">{isAr ? "ملخص الدرس:" : "Lesson Summary:"}</div>
                        <p style={{ color: "var(--text-secondary)" }}>
                          {selectedEntry.lesson.summary || selectedEntry.lesson.title}
                        </p>
                      </div>

                      {selectedEntry.lesson.objectives.length > 0 && (
                        <div>
                          <div className="font-bold mb-1">{isAr ? "الأهداف المستخرجة:" : "Objectives:"}</div>
                          <ul className="list-disc list-inside space-y-0.5" style={{ color: "var(--text-secondary)" }}>
                            {selectedEntry.lesson.objectives.map((obj, idx) => (
                              <li key={idx}>{obj}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {selectedEntry.lesson.keyConcepts.length > 0 && (
                        <div>
                          <span className="font-bold">{isAr ? "المفاهيم العلمية:" : "Key Concepts:"} </span>
                          <span style={{ color: "var(--text-secondary)" }}>
                            {selectedEntry.lesson.keyConcepts.join(" · ")}
                          </span>
                        </div>
                      )}

                      <div>
                        <div className="font-bold mb-1">
                          {isAr ? "المحتوى المستخرج والمرتبط بالكتاب:" : "Linked Textbook Excerpt:"}
                        </div>
                        <div
                          className="p-3.5 rounded-xl border max-h-44 overflow-y-auto whitespace-pre-wrap"
                          style={{
                            backgroundColor: "var(--bg-surface)",
                            borderColor: "var(--border-hairline)",
                            color: "var(--text-primary)",
                          }}
                        >
                          {selectedEntry.lesson.contentExcerpt}
                        </div>
                      </div>
                    </div>

                    {/* One-Click Platform Creation Actions from Selected Textbook Lesson */}
                    <div className="pt-3 border-t flex flex-wrap gap-2" style={{ borderColor: "var(--border-hairline)" }}>
                      <button
                        type="button"
                        onClick={() => void activateSelectedBookLesson()}
                        className="min-h-[40px] px-3.5 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0"
                        style={{
                          backgroundColor: "var(--accent-primary)",
                          color: "var(--accent-contrast)",
                        }}
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>{isAr ? "اعتماد الدرس في المنصة" : "Activate Book Lesson"}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          void activateSelectedBookLesson({ tab: "studio", subTab: "lesson_plan" })
                        }
                        className="min-h-[40px] px-3.5 py-2 rounded-lg border text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
                        style={{
                          backgroundColor: "var(--bg-surface)",
                          borderColor: "var(--border-hairline)",
                        }}
                      >
                        <FileText className="w-4 h-4" style={{ color: "var(--accent-primary)" }} />
                        <span>{isAr ? "إنشاء تحضير الدرس" : "Create Lesson Plan"}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          void activateSelectedBookLesson({ tab: "studio", subTab: "pptx" })
                        }
                        className="min-h-[40px] px-3.5 py-2 rounded-lg border text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
                        style={{
                          backgroundColor: "var(--bg-surface)",
                          borderColor: "var(--border-hairline)",
                        }}
                      >
                        <Presentation className="w-4 h-4" style={{ color: "var(--accent-primary)" }} />
                        <span>{isAr ? "إنشاء عرض PowerPoint" : "Build PowerPoint"}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => void activateSelectedBookLesson({ tab: "kahoot" })}
                        className="min-h-[40px] px-3.5 py-2 rounded-lg border text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
                        style={{
                          backgroundColor: "var(--bg-surface)",
                          borderColor: "var(--border-hairline)",
                        }}
                      >
                        <Trophy className="w-4 h-4" style={{ color: "var(--accent-primary)" }} />
                        <span>{isAr ? "إنشاء لعبة / مسابقة مباشرة" : "Create Quiz Game"}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          void activateSelectedBookLesson({
                            tab: "inclusive",
                            subTab: "adaptive_quiz",
                          })
                        }
                        className="min-h-[40px] px-3.5 py-2 rounded-lg border text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
                        style={{
                          backgroundColor: "var(--bg-surface)",
                          borderColor: "var(--border-hairline)",
                        }}
                      >
                        <Gamepad2 className="w-4 h-4" style={{ color: "var(--accent-primary)" }} />
                        <span>{isAr ? "إنشاء أسئلة وتدريبات تفاعلية" : "Create Adaptive Quiz"}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

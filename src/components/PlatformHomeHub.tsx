import React from "react";
import { motion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  BookMarked,
  BookOpen,
  Bot,
  Compass,
  FileCheck2,
  FlaskConical,
  GraduationCap,
  Layers,
  LogOut,
  MessageSquare,
  Radar,
  Sparkles,
  Trophy,
  UserCheck,
  Zap,
} from "lucide-react";
import { SUBJECTS } from "../data/lessons.ts";
import type {
  AccessibilitySettings,
  LessonData,
  PlatformCapabilities,
  SubjectId,
  UILanguage,
  UserRole,
} from "../types.ts";
import type { SectionLibraryTab } from "./SubjectsAndLibrary.tsx";
import { SubjectSculpture } from "./SubjectSculptures.tsx";
import { DailyScienceFact } from "./DailyScienceFact.tsx";
import { speakWithBrowser } from "../utils/speech.ts";

export type WorkspaceDestination =
  | "home"
  | "library"
  | "studio"
  | "radar"
  | "kahoot"
  | "chatbot"
  | "inclusive";

interface PlatformHomeHubProps {
  uiLang: UILanguage;
  userRole: UserRole;
  userName: string;
  activeLesson: LessonData;
  lessons: LessonData[];
  settings: AccessibilitySettings;
  capabilities: PlatformCapabilities | null;
  demoMode: boolean;
  onToggleDemoMode: (enabled: boolean) => void;
  onNavigate: (destination: WorkspaceDestination, subjectId?: SubjectId) => void;
  onOpenStudentDestination: (destination: "library" | "discover" | "radar" | "chatbot") => void;
  onOpenTeacherSubjectTool: (
    subjectId: SubjectId,
    tool:
      | { type: "library"; tab: SectionLibraryTab }
      | { type: "destination"; dest: Exclude<WorkspaceDestination, "home" | "library"> }
      | { type: "buzzer" }
  ) => void;
  onBackToEntry: () => void;
  onLaunchBuzzerMap?: () => void;
}

export const PlatformHomeHub: React.FC<PlatformHomeHubProps> = ({
  uiLang,
  userRole,
  userName,
  activeLesson,
  lessons,
  settings,
  capabilities,
  demoMode,
  onToggleDemoMode,
  onNavigate,
  onOpenStudentDestination,
  onOpenTeacherSubjectTool,
  onBackToEntry,
  onLaunchBuzzerMap,
}) => {
  const isAr = uiLang === "ar";
  const EnterArrow = isAr ? ArrowLeft : ArrowRight;
  const isSpecialTheme = settings.theme === "high-contrast" || settings.theme === "dark";

  // The 4 core Science Subjects for the Teacher Portal (Chemistry, Physics, Biology, Geology)
  const fourScienceSubjects = SUBJECTS.filter((s) => s.id !== "mathematics");
  const mathSubject = SUBJECTS.find((s) => s.id === "mathematics");

  const studentPortalItems: Array<{
    id: "library" | "discover" | "radar" | "chatbot";
    num: string;
    titleAr: string;
    titleEn: string;
    descAr: string;
    descEn: string;
    actionAr: string;
    actionEn: string;
    icon: React.ComponentType<{ className?: string }>;
    accent: string;
    softBg: string;
    gradient: string;
  }> = [
    {
      id: "library",
      num: "01",
      titleAr: "مكتبتي العلمية",
      titleEn: "My Scientific Library",
      descAr: "الدخول إلى المواد العلمية، الكتب الدائمة، والدروس والمصادر المعتمدة.",
      descEn: "Access science subjects, textbooks, and approved lessons.",
      actionAr: "فتح مكتبتي",
      actionEn: "Open Library",
      icon: BookOpen,
      accent: "#0284c7",
      softBg: "rgba(14, 165, 233, 0.11)",
      gradient: "linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)",
    },
    {
      id: "discover",
      num: "02",
      titleAr: "اكتشف العالم من حولك",
      titleEn: "Discover the World Around You",
      descAr: "صوّر أي شيء حولك بالكاميرا ليتعرف عليه ويشرح لك المعلومات العلمية والحقائق المرتبطة به فوراً.",
      descEn: "Snap a photo of anything around you for instant AI scientific identification and facts.",
      actionAr: "افتح عدسة الاستكشاف",
      actionEn: "Open Science Lens",
      icon: Compass,
      accent: "#059669",
      softBg: "rgba(16, 185, 129, 0.11)",
      gradient: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
    },
    {
      id: "radar",
      num: "03",
      titleAr: "رادار الفهم",
      titleEn: "Understanding Radar",
      descAr: "الانضمام الفوري لجلسة المعلم بالرمز، وحل الأسئلة التفاعلية وتتبع الفهم.",
      descEn: "Join live classroom radar sessions with PIN and track mastery.",
      actionAr: "دخول الجلسة",
      actionEn: "Join Radar",
      icon: Radar,
      accent: "#ea580c",
      softBg: "rgba(249, 115, 22, 0.11)",
      gradient: "linear-gradient(135deg, #fb923c 0%, #ea580c 100%)",
    },
    {
      id: "chatbot",
      num: "04",
      titleAr: "المساعد الذكي",
      titleEn: "Smart Assistant",
      descAr: "معلم علمي ذكي بالصوت والنص يشرح الدروس ويكشف مواطن الصعوبة ويبسطها.",
      descEn: "Voice & text science tutor for explanations, examples, and remediation.",
      icon: Bot,
      actionAr: "تحدث مع المساعد",
      actionEn: "Ask Assistant",
      accent: "#7c3aed",
      softBg: "rgba(139, 92, 246, 0.11)",
      gradient: "linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)",
    },
  ];

  const getTeacherSubjectTools = (subjectId: SubjectId, subjectLessonsCount: number) => [
    {
      key: "radar",
      labelAr: "رادار الفهم",
      labelEn: "Understanding Radar",
      icon: Radar,
      color: "#0284c7",
      onClick: () => onOpenTeacherSubjectTool(subjectId, { type: "destination", dest: "radar" }),
    },
    {
      key: "lessons",
      labelAr: `الدروس (${subjectLessonsCount})`,
      labelEn: `Lessons (${subjectLessonsCount})`,
      icon: BookOpen,
      color: "#059669",
      onClick: () => onOpenTeacherSubjectTool(subjectId, { type: "library", tab: "lessons" }),
    },
    {
      key: "books",
      labelAr: "الكتب الدائمة",
      labelEn: "Textbooks",
      icon: BookMarked,
      color: "#0d9488",
      onClick: () => onOpenTeacherSubjectTool(subjectId, { type: "library", tab: "books" }),
    },
    {
      key: "prep_form",
      labelAr: "فورمة التحضير",
      labelEn: "Prep Form",
      icon: FileCheck2,
      color: "#4f46e5",
      onClick: () => onOpenTeacherSubjectTool(subjectId, { type: "library", tab: "prep_form" }),
    },
    {
      key: "studio",
      labelAr: "إنتاج المحتوى",
      labelEn: "Content Studio",
      icon: Layers,
      color: "#7c3aed",
      onClick: () => onOpenTeacherSubjectTool(subjectId, { type: "destination", dest: "studio" }),
    },
    {
      key: "buzzer",
      labelAr: "خريطة المراحل والباز",
      labelEn: "Stages & Buzz Map",
      icon: Zap,
      color: "#ea580c",
      onClick: () => onOpenTeacherSubjectTool(subjectId, { type: "buzzer" }),
    },
    {
      key: "kahoot",
      labelAr: "المسابقات المباشرة",
      labelEn: "Live Quiz",
      icon: Trophy,
      color: "#db2777",
      onClick: () => onOpenTeacherSubjectTool(subjectId, { type: "destination", dest: "kahoot" }),
    },
    {
      key: "chatbot",
      labelAr: "المساعد الذكي",
      labelEn: "AI Tutor",
      icon: MessageSquare,
      color: "#9333ea",
      onClick: () => onOpenTeacherSubjectTool(subjectId, { type: "destination", dest: "chatbot" }),
    },
    {
      key: "inclusive",
      labelAr: "التعلم الشامل",
      labelEn: "Inclusive Hub",
      icon: Sparkles,
      color: "#16a34a",
      onClick: () => onOpenTeacherSubjectTool(subjectId, { type: "destination", dest: "inclusive" }),
    },
  ];

  return (
    <div className="space-y-8 pb-10">
      {/* ================================================================= */}
      {/* DISTINCTIVE MULTI-COLOR PLATFORM HERO & CONTROL BAR               */}
      {/* ================================================================= */}
      <motion.section
        initial={settings.reduceMotion ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        className="science-card rounded-3xl border overflow-hidden relative"
        style={{
          backgroundColor: "var(--bg-surface)",
          borderColor: "var(--border-hairline)",
        }}
      >
        <div className="prism-top-bar" aria-hidden="true" />
        <div className="p-5 sm:p-6 md:p-7 space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
            <div className="space-y-2 max-w-2xl">
              <div
                className="flex flex-wrap items-center gap-2 text-xs font-semibold"
                style={{ color: "var(--text-secondary)" }}
              >
                <span style={{ color: "#0284c7" }}>smart science ai</span>
                <span aria-hidden="true">·</span>
                <span style={{ color: userRole === "teacher" ? "#7c3aed" : "#059669" }}>
                  {userRole === "teacher"
                    ? isAr
                      ? "بوابة المعلم النشطة"
                      : "Teacher Portal Active"
                    : isAr
                      ? "بوابة الطالب النشطة"
                      : "Student Portal Active"}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono-num" style={{ color: "#ea580c" }}>
                  {isAr ? `${lessons.length} دروس علمية` : `${lessons.length} Lessons`}
                </span>
                <span aria-hidden="true">·</span>
                <span
                  className="font-bold"
                  style={{ color: demoMode ? "#d97706" : capabilities?.geminiConfigured ? "#059669" : "#d97706" }}
                >
                  {demoMode
                    ? isAr
                      ? "الوضع التجريبي (Demo Mode)"
                      : "Demo Mode Active"
                    : capabilities?.geminiConfigured
                      ? isAr
                        ? "الذكاء الاصطناعي المباشر جاهز"
                        : "Live AI Ready"
                      : isAr
                        ? "يعمل بالأدوات المحلية + Demo Mode"
                        : "Local Tools + Demo Mode"}
                </span>
              </div>

              <h1
                className="font-display text-2xl sm:text-3xl font-bold leading-tight"
                style={{ color: "var(--text-primary)" }}
              >
                {userName.trim()
                  ? isAr
                    ? `مرحباً ${userName.trim()} في منصة العلوم الذكية`
                    : `Welcome, ${userName.trim()}, to Smart Science AI`
                  : isAr
                    ? "منصة العلوم الذكية المتكاملة للتعليم والابتكار"
                    : "Smart Science AI — Integrated Science Learning Platform"}
              </h1>

              <p className="text-xs sm:text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                {isAr
                  ? `الدرس النشط حالياً: «${activeLesson.title}» (${activeLesson.subject}) — استمتع بالتعلم التفاعلي بين بوابة الطالب الاستكشافية وبوابة المعلم والأقسام العلمية الأربع.`
                  : `Active lesson: "${activeLesson.title}" (${activeLesson.subject}) — navigate seamlessly between the Student Portal and the 4 Teacher Science Departments.`}
              </p>
            </div>

            {/* Control Actions: Demo Mode Switch + Quick Map + 3D Portal */}
            <div className="flex flex-col sm:flex-row lg:flex-col items-stretch sm:items-center lg:items-end gap-2.5 shrink-0">
              <div
                className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl border"
                style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}
              >
                <button
                  type="button"
                  onClick={() => onToggleDemoMode(false)}
                  className="min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap"
                  style={{
                    background: !demoMode
                      ? "linear-gradient(135deg, #059669 0%, #0284c7 100%)"
                      : "transparent",
                    color: !demoMode ? "#ffffff" : "var(--text-secondary)",
                  }}
                >
                  {isAr ? "الذكاء الاصطناعي المباشر" : "Live AI Mode"}
                </button>
                <button
                  type="button"
                  onClick={() => onToggleDemoMode(true)}
                  className="min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap"
                  style={{
                    background: demoMode
                      ? "linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)"
                      : "transparent",
                    color: demoMode ? "#ffffff" : "var(--text-secondary)",
                  }}
                >
                  {isAr ? "الوضع التجريبي (Demo)" : "Demo Mode"}
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {onLaunchBuzzerMap && (
                  <button
                    type="button"
                    onClick={onLaunchBuzzerMap}
                    className="min-h-[42px] px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 whitespace-nowrap shadow-md"
                    style={{
                      background: "linear-gradient(135deg, #f97316 0%, #ec4899 100%)",
                      color: "#ffffff",
                    }}
                  >
                    <Zap className="w-4 h-4 fill-current" />
                    <span>{isAr ? "خريطة المراحل والباز" : "Stages & Buzz Map"}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={onBackToEntry}
                  className="min-h-[42px] px-3.5 py-2 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap"
                  style={{
                    backgroundColor: "var(--bg-subtle)",
                    borderColor: "var(--border-hairline)",
                    color: "var(--text-primary)",
                  }}
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>{isAr ? "بوابة الدخول 3D" : "3D Entry Gate"}</span>
                </button>
              </div>
            </div>
          </div>

          {demoMode && (
            <div
              className="px-4 py-2.5 rounded-2xl border text-xs font-semibold flex flex-wrap items-center justify-between gap-2"
              style={{
                backgroundColor: "#fef3c7",
                borderColor: "#f59e0b",
                color: "#92400e",
              }}
            >
              <span>
                {isAr
                  ? "الوضع التجريبي مفعّل: الأدوات الذكية ستعرض نماذج تجريبية مسبقة ومُعلّمة بوضوح أنها غير مولّدة بالذكاء الاصطناعي المباشر، بينما تعمل الغرف المباشرة والتصدير والمحاكاة محلياً بالكامل."
                  : "Demo Mode active: AI tools display clearly labeled preset sample outputs (not live AI), while live rooms, file exports & simulations run locally."}
              </span>
            </div>
          )}
        </div>
      </motion.section>

      {/* ================================================================= */}
      {/* SECTION 1: STUDENT PORTAL (بوابة الطالب بألوان مبهجة ومتنوعة)      */}
      {/* ================================================================= */}
      <motion.section
        aria-labelledby="student-portal-heading"
        initial={settings.reduceMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, delay: 0.04, ease: [0.16, 1, 0.3, 1] }}
        className="rounded-3xl border overflow-hidden science-card"
        style={{
          backgroundColor: "var(--bg-surface)",
          borderColor: "var(--border-hairline)",
        }}
      >
        <div
          className="h-1.5 w-full"
          style={{ background: "linear-gradient(90deg, #0ea5e9 0%, #10b981 36%, #f97316 70%, #8b5cf6 100%)" }}
          aria-hidden="true"
        />
        <div className="p-5 sm:p-6 md:p-7 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4" style={{ borderColor: "var(--border-hairline)" }}>
            <div className="flex items-center gap-3.5">
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-sm"
                style={{
                  background: "linear-gradient(135deg, #0ea5e9 0%, #10b981 100%)",
                  color: "#ffffff",
                }}
              >
                <GraduationCap className="w-6 h-6" />
              </div>
              <div>
                <h2
                  id="student-portal-heading"
                  className="font-display text-lg sm:text-xl font-bold"
                  style={{ color: "var(--text-primary)" }}
                >
                  {isAr ? "بوابة الطالب" : "Student Portal"}
                </h2>
                <p className="text-xs sm:text-sm" style={{ color: "var(--text-secondary)" }}>
                  {isAr
                    ? "مساحة الطالب للتعلم التفاعلي، الاستكشاف العلمي، والانضمام الفوري للحصص الذكية."
                    : "Student space for interactive learning, science discovery, and live classroom participation."}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onOpenStudentDestination("library")}
              className="min-h-[42px] px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shadow-sm"
              style={{
                background: "linear-gradient(135deg, #0284c7 0%, #0d9488 100%)",
                color: "#ffffff",
              }}
            >
              <span>{isAr ? "عرض جميع الدروس المتاحة" : "Browse All Lessons"}</span>
              <EnterArrow className="w-4 h-4" />
            </button>
          </div>

          {/* 4 Distinct Colorful Student Portal Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {studentPortalItems.map((item, idx) => {
              const Icon = item.icon;
              return (
                <motion.button
                  key={item.id}
                  type="button"
                  initial={settings.reduceMotion ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, delay: 0.04 * idx }}
                  whileHover={settings.reduceMotion ? undefined : { y: -4 }}
                  whileTap={settings.reduceMotion ? undefined : { scale: 0.98 }}
                  onClick={() => onOpenStudentDestination(item.id)}
                  className="group text-start rounded-2xl border overflow-hidden transition-all flex flex-col justify-between min-h-[200px] shadow-sm hover:shadow-md"
                  style={{
                    backgroundColor: isSpecialTheme ? "var(--bg-subtle)" : item.softBg,
                    borderColor: `${item.accent}45`,
                  }}
                >
                  <div className="h-1.5 w-full" style={{ background: item.gradient }} aria-hidden="true" />
                  <div className="p-5 flex-1 flex flex-col justify-between gap-4">
                    <div className="flex items-start justify-between gap-3">
                      <div
                        className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-sm transition-transform group-hover:scale-105"
                        style={{
                          background: item.gradient,
                          color: "#ffffff",
                        }}
                      >
                        <Icon className="w-6 h-6" />
                      </div>
                      <span
                        className="font-mono-num text-xs font-bold"
                        style={{ color: item.accent }}
                      >
                        {item.num}
                      </span>
                    </div>

                    <div className="space-y-1.5">
                      <h3 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>
                        {isAr ? item.titleAr : item.titleEn}
                      </h3>
                      <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                        {isAr ? item.descAr : item.descEn}
                      </p>
                    </div>

                    <div
                      className="pt-2.5 border-t flex items-center justify-between text-xs font-bold"
                      style={{ borderColor: `${item.accent}30`, color: item.accent }}
                    >
                      <span>{isAr ? item.actionAr : item.actionEn}</span>
                      <EnterArrow className="w-4 h-4 transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" />
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </div>

          {/* Daily Science Fact Embedded in "Discover the World Around You" */}
          <DailyScienceFact
            uiLang={uiLang}
            settings={settings}
            demoMode={demoMode}
            onRobotReadFact={(speechText) => {
              speakWithBrowser(speechText, settings.speechRate, undefined, undefined, uiLang);
            }}
            onAskRobotAboutFact={() => {
              onOpenStudentDestination("chatbot");
            }}
          />
        </div>
      </motion.section>

      {/* ================================================================= */}
      {/* SECTION 2: TEACHER PORTAL & THE 4 SCIENCE SUBJECTS + INSIDE TOOLS */}
      {/* ================================================================= */}
      <motion.section
        aria-labelledby="teacher-portal-heading"
        initial={settings.reduceMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.34, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
        className="rounded-3xl border overflow-hidden science-card"
        style={{
          backgroundColor: "var(--bg-surface)",
          borderColor: "var(--border-hairline)",
        }}
      >
        <div
          className="h-1.5 w-full"
          style={{ background: "linear-gradient(90deg, #0891b2 0%, #6d28d9 34%, #059669 68%, #ea580c 100%)" }}
          aria-hidden="true"
        />
        <div className="p-5 sm:p-6 md:p-7 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4" style={{ borderColor: "var(--border-hairline)" }}>
            <div className="flex items-center gap-3.5">
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-sm"
                style={{
                  background: "linear-gradient(135deg, #6d28d9 0%, #ec4899 100%)",
                  color: "#ffffff",
                }}
              >
                <UserCheck className="w-6 h-6" />
              </div>
              <div>
                <h2
                  id="teacher-portal-heading"
                  className="font-display text-lg sm:text-xl font-bold"
                  style={{ color: "var(--text-primary)" }}
                >
                  {isAr ? "بوابة المعلم — المواد العلمية الأربع" : "Teacher Portal — 4 Science Departments"}
                </h2>
                <p className="text-xs sm:text-sm" style={{ color: "var(--text-secondary)" }}>
                  {isAr
                    ? "اختر المادة العلمية لفتح قسمها المتكامل أو شغّل أي أداة من أدوات المعلم داخل المادة مباشرة."
                    : "Select any of the 4 science subjects to enter its department or launch any Teacher Tool directly inside it."}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onNavigate("studio")}
              className="min-h-[42px] px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shadow-sm"
              style={{
                background: "linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)",
                color: "#ffffff",
              }}
            >
              <FlaskConical className="w-4 h-4" />
              <span>{isAr ? "إنتاج المحتوى للدرس النشط" : "Open Content Studio"}</span>
            </button>
          </div>

          {/* 4 Science Subjects Cards with Distinctive Chromatic Top Accent & Varied Tool Colors */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {fourScienceSubjects.map((subj) => {
              const subjLessons = lessons.filter((l) => l.subjectId === subj.id);
              const tools = getTeacherSubjectTools(subj.id, subjLessons.length);
              return (
                <article
                  key={subj.id}
                  className="rounded-3xl border overflow-hidden flex flex-col justify-between transition-all shadow-sm hover:shadow-md"
                  style={{
                    backgroundColor: isSpecialTheme ? "var(--bg-subtle)" : `${subj.accentHex}0D`,
                    borderColor: `${subj.accentHex}44`,
                  }}
                >
                  <div
                    className="h-1.5 w-full"
                    style={{ backgroundColor: subj.accentHex }}
                    aria-hidden="true"
                  />

                  <div className="p-5 space-y-4 flex-1 flex flex-col justify-between">
                    {/* Subject Header & Enter Department Button */}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3.5">
                        <SubjectSculpture
                          subjectId={subj.id}
                          size="sm"
                          reducedMotion={settings.reduceMotion}
                        />
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <h3 className="font-display text-lg font-bold" style={{ color: "var(--text-primary)" }}>
                              {isAr ? subj.nameAr : subj.nameEn}
                            </h3>
                            <span
                              className="text-[11px] font-mono-num font-bold"
                              style={{ color: subj.accentHex }}
                            >
                              ({subjLessons.length} {isAr ? "دروس" : "lessons"})
                            </span>
                          </div>
                          <p className="text-xs leading-relaxed line-clamp-2" style={{ color: "var(--text-secondary)" }}>
                            {isAr ? subj.descriptionAr : subj.descriptionEn}
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          onOpenTeacherSubjectTool(subj.id, { type: "library", tab: "lessons" })
                        }
                        className="min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-opacity hover:opacity-90 shadow-sm"
                        style={{
                          backgroundColor: subj.accentHex,
                          color: "#ffffff",
                        }}
                      >
                        <span>{isAr ? `دخول قسم ${subj.nameAr}` : `Enter ${subj.nameEn}`}</span>
                        <EnterArrow className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Teacher Tools Inside This Subject — Joyful Varied Tool Colors */}
                    <div className="pt-3 border-t space-y-2.5" style={{ borderColor: `${subj.accentHex}28` }}>
                      <div
                        className="text-[11px] font-bold flex items-center justify-between"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        <span>
                          {isAr
                            ? `أدوات المعلم داخل قسم ${subj.nameAr}:`
                            : `Teacher Tools inside ${subj.nameEn}:`}
                        </span>
                        <span className="font-mono-num font-bold" style={{ color: subj.accentHex }}>
                          {tools.length} {isAr ? "أدوات" : "tools"}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {tools.map((tool) => {
                          const ToolIcon = tool.icon;
                          return (
                            <button
                              key={tool.key}
                              type="button"
                              onClick={tool.onClick}
                              className="min-h-[42px] px-2.5 py-2 rounded-xl border text-xs font-semibold flex items-center gap-2 text-start transition-all hover:-translate-y-0.5 hover:shadow-sm"
                              style={{
                                backgroundColor: "var(--bg-surface)",
                                borderColor: `${tool.color}38`,
                                color: "var(--text-primary)",
                              }}
                            >
                              <span
                                className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0"
                                style={{
                                  backgroundColor: `${tool.color}18`,
                                  color: tool.color,
                                }}
                              >
                                <ToolIcon className="w-3.5 h-3.5" />
                              </span>
                              <span className="truncate">{isAr ? tool.labelAr : tool.labelEn}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          {/* Preserved Mathematics Department Access */}
          {mathSubject && (
            <div
              className="p-4 rounded-2xl border flex flex-wrap items-center justify-between gap-3"
              style={{
                backgroundColor: isSpecialTheme ? "var(--bg-subtle)" : `${mathSubject.accentHex}0D`,
                borderColor: `${mathSubject.accentHex}44`,
              }}
            >
              <div className="flex items-center gap-3">
                <SubjectSculpture
                  subjectId={mathSubject.id}
                  size="sm"
                  reducedMotion={settings.reduceMotion}
                />
                <div>
                  <div className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                    {isAr ? `قسم مساند: ${mathSubject.nameAr}` : `Supporting Department: ${mathSubject.nameEn}`}
                  </div>
                  <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    {isAr ? mathSubject.descriptionAr : mathSubject.descriptionEn}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  onOpenTeacherSubjectTool("mathematics", { type: "library", tab: "lessons" })
                }
                className="min-h-[40px] px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shadow-sm"
                style={{
                  backgroundColor: mathSubject.accentHex,
                  color: "#ffffff",
                }}
              >
                <span>{isAr ? "فتح قسم الرياضيات" : "Open Mathematics"}</span>
                <EnterArrow className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </motion.section>
    </div>
  );
};

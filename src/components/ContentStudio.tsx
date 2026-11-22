import React, { useState, useEffect } from "react";
import {
  FileText,
  Presentation,
  Video,
  ClipboardList,
  Sparkles,
  Download,
  Printer,
  Save,
  Loader2,
  Volume2,
  Play,
  AlertTriangle,
  FileCheck2,
  Layers,
  Upload,
  Paperclip,
  X,
} from "lucide-react";
import type {
  AccessibilitySettings,
  LessonData,
  LessonPlanData,
  PreparationTemplate,
  PresentationDeckData,
  SourcePolicy,
  UILanguage,
  VideoProjectData,
  WorksheetData,
} from "../types.ts";
import {
  assembleVideoWebm,
  exportLessonPlanDocx,
  exportPresentationPptx,
  exportWorksheetDocx,
  printHtmlAsPdf,
} from "../utils/exporters.ts";
import { speakWithBrowser, speakWithGeminiTTS } from "../utils/speech.ts";
import {
  buildDemoLessonPlan,
  buildDemoPresentationDeck,
  buildDemoVideoProject,
  buildDemoWorksheet,
} from "../utils/demoSamples.ts";
import {
  ApiResponseError,
  getAiPhaseMessage,
  type AiRequestPhase,
} from "../utils/apiClient.ts";
import {
  exportPowerPointFile,
  fetchLessonArtifacts,
  generateAutoPowerPointFile,
  generateLessonPlan,
  generatePowerPointDeck,
  generateVeoVideo,
  generateVideoScript,
  generateWorksheet,
  saveLessonArtifact,
} from "../utils/aiApi.ts";
import { inferUploadMimeType, prepareUploadPayload } from "../utils/chunkUpload.ts";

export type StudioSubTab = "lesson_plan" | "pptx" | "video" | "worksheet";

interface ContentStudioProps {
  lesson: LessonData;
  activeSubTab: StudioSubTab;
  onSubTabChange: (tab: StudioSubTab) => void;
  sourcePolicy: SourcePolicy;
  prepTemplates: PreparationTemplate[];
  activePrepTemplate: PreparationTemplate | null;
  onSelectPrepTemplate: (templateId: string | null) => void;
  onOpenPrepForm?: () => void;
  uiLang: UILanguage;
  settings: AccessibilitySettings;
  demoMode?: boolean;
  onToggleDemoMode?: (enabled: boolean) => void;
}

export const ContentStudio: React.FC<ContentStudioProps> = ({
  lesson,
  activeSubTab,
  onSubTabChange,
  sourcePolicy,
  prepTemplates,
  activePrepTemplate,
  onSelectPrepTemplate,
  onOpenPrepForm,
  uiLang,
  settings,
  demoMode = false,
  onToggleDemoMode,
}) => {
  const isAr = uiLang === "ar";
  const [contentSource, setContentSource] = useState<"ai" | "demo" | null>(null);
  const [loading, setLoading] = useState(false);
  const [requestPhase, setRequestPhase] = useState<AiRequestPhase>("idle");
  const [autoGeneratingPptx, setAutoGeneratingPptx] = useState(false);
  const [pptxAutoStatus, setPptxAutoStatus] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  // Artifact states
  const [lessonPlan, setLessonPlan] = useState<LessonPlanData | null>(null);
  const [deck, setDeck] = useState<PresentationDeckData | null>(null);
  const [activeSlideIdx, setActiveSlideIdx] = useState(0);

  const [videoProject, setVideoProject] = useState<VideoProjectData | null>(null);
  const [videoStyle, setVideoStyle] = useState<VideoProjectData["style"]>("educational_explainer");
  const [videoPersona, setVideoPersona] = useState<VideoProjectData["presenterPersona"]>("science_mentor");
  const [videoLang, setVideoLang] = useState<"ar" | "en">(uiLang);
  const [assemblingVideo, setAssemblingVideo] = useState(false);
  const [assembleProgress, setAssembleProgress] = useState(0);
  const [assembledVideoUrl, setAssembledVideoUrl] = useState<string | null>(null);
  const [veoStatusMsg, setVeoStatusMsg] = useState<string | null>(null);
  const [veoLoading, setVeoLoading] = useState(false);
  const [previewSceneIdx, setPreviewSceneIdx] = useState(0);

  // Lesson Plan Teacher Inputs & Attached Sources
  const [planCustomTopic, setPlanCustomTopic] = useState("");
  const [planDurationMinutes, setPlanDurationMinutes] = useState<number>(lesson.estimatedMinutes || 45);
  const [planTargetGroup, setPlanTargetGroup] = useState("");
  const [planFocusObjectives, setPlanFocusObjectives] = useState("");
  const [planExtraInstructions, setPlanExtraInstructions] = useState("");
  const [planAttachedNotes, setPlanAttachedNotes] = useState("");
  const [planAttachedFiles, setPlanAttachedFiles] = useState<File[]>([]);
  const [planInputsOpen, setPlanInputsOpen] = useState(true);

  const [worksheet, setWorksheet] = useState<WorksheetData | null>(null);
  const [worksheetViewMode, setWorksheetViewMode] = useState<"student" | "teacher">("student");

  // Load persisted artifacts from SQLite when lesson changes
  useEffect(() => {
    setErrorMsg(null);
    setSaveNotice(null);
    setLessonPlan(null);
    setDeck(null);
    setVideoProject(null);
    setWorksheet(null);
    setAssembledVideoUrl(null);
    setVeoStatusMsg(null);
    setPlanDurationMinutes(lesson.estimatedMinutes || 45);

    fetchLessonArtifacts(lesson.id)
      .then((list) => {
        for (const item of list) {
          if (item.artifactType === "lesson_plan") setLessonPlan(item.data as LessonPlanData);
          if (item.artifactType === "presentation") setDeck(item.data as PresentationDeckData);
          if (item.artifactType === "video_project") setVideoProject(item.data as VideoProjectData);
          if (item.artifactType === "worksheet") setWorksheet(item.data as WorksheetData);
        }
      })
      .catch(() => {});
  }, [lesson.id]);

  const persistArtifact = async (
    artifactType: "lesson_plan" | "presentation" | "video_project" | "worksheet",
    title: string,
    data: unknown
  ) => {
    try {
      await saveLessonArtifact({ lessonId: lesson.id, artifactType, title, data });
      setSaveNotice(isAr ? "تم الحفظ في قاعدة بيانات الدرس بنجاح." : "Saved to lesson database.");
      setTimeout(() => setSaveNotice(null), 2500);
    } catch {
      // Do not falsely report DB save success when backend isn't reachable
    }
  };

  const guardConsent = () => {
    if (!settings.aiProcessingConsent) {
      setErrorMsg(isAr ? "يرجى تفعيل موافقة المعالجة بالذكاء الاصطناعي أولاً." : "Enable AI consent first.");
      return false;
    }
    return true;
  };

  // Generators
  const loadDemoForActiveTab = async () => {
    setErrorMsg(null);
    if (activeSubTab === "lesson_plan") {
      const sample = buildDemoLessonPlan(lesson, uiLang, activePrepTemplate?.templateName);
      setLessonPlan(sample);
      setContentSource("demo");
      await persistArtifact("lesson_plan", sample.lessonTitle, sample);
    } else if (activeSubTab === "pptx") {
      const sampleDeck = buildDemoPresentationDeck(lesson, uiLang, activePrepTemplate?.templateName);
      setDeck(sampleDeck);
      setActiveSlideIdx(0);
      setContentSource("demo");
      await persistArtifact("presentation", sampleDeck.deckTitle, sampleDeck);
    } else if (activeSubTab === "video") {
      const sampleVid = buildDemoVideoProject(lesson, videoStyle, videoPersona, videoLang);
      setVideoProject(sampleVid);
      setPreviewSceneIdx(0);
      setContentSource("demo");
      await persistArtifact("video_project", sampleVid.videoTitle, sampleVid);
    } else if (activeSubTab === "worksheet") {
      const sampleWs = buildDemoWorksheet(lesson, uiLang);
      setWorksheet(sampleWs);
      setContentSource("demo");
      await persistArtifact("worksheet", sampleWs.worksheetTitle, sampleWs);
    }
  };

  const handlePlanAttachmentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const valid = files.filter((f) => f.size <= 75 * 1024 * 1024);
    if (valid.length < files.length) {
      setErrorMsg(
        isAr
          ? "بعض الملفات تتجاوز الحد الأقصى (75 ميجابايت) وتم تجاهلها."
          : "Some files exceed the 75 MB limit and were skipped."
      );
    }
    setPlanAttachedFiles((prev) => [...prev, ...valid].slice(0, 4));
    e.target.value = "";
  };

  const handleGenerateLessonPlan = async () => {
    if (!guardConsent()) return;
    if (demoMode) {
      onToggleDemoMode?.(false);
    }
    setLoading(true);
    setErrorMsg(null);
    setSaveNotice(null);
    try {
      const preparedAttachments: Array<{
        fileName: string;
        mimeType: string;
        fileBase64?: string;
        uploadId?: string;
      }> = [];

      for (const file of planAttachedFiles) {
        const prepared = await prepareUploadPayload(file);
        preparedAttachments.push({
          fileName: file.name,
          mimeType: inferUploadMimeType(file),
          ...prepared,
        });
      }

      const data = await generateLessonPlan(
        {
          lesson,
          language: uiLang,
          sourcePolicy,
          prepTemplateId: activePrepTemplate?.id || lesson.prepTemplateId || "",
          prepTemplate: activePrepTemplate,
          teacherInputs: {
            customTopic: planCustomTopic.trim() || undefined,
            durationMinutes: planDurationMinutes || lesson.estimatedMinutes || 45,
            targetGroup: planTargetGroup.trim() || undefined,
            focusObjectives: planFocusObjectives.trim() || undefined,
            extraInstructions: planExtraInstructions.trim() || undefined,
          },
          attachedNotes: planAttachedNotes.trim() || undefined,
          attachedFiles: preparedAttachments,
        },
        { onPhaseChange: setRequestPhase }
      );

      if (!data.lessonPlan) {
        setErrorMsg(
          data.message ||
            (isAr ? "لم يُرجع الخادم بيانات تحضير صالحة." : "Server did not return a valid lesson plan.")
        );
        return;
      }

      const normalizedPlan: LessonPlanData = {
        ...data.lessonPlan,
        objectives: Array.isArray(data.lessonPlan.objectives) ? data.lessonPlan.objectives : [],
        teachingStrategies: Array.isArray(data.lessonPlan.teachingStrategies)
          ? data.lessonPlan.teachingStrategies
          : [],
        learningActivities: Array.isArray(data.lessonPlan.learningActivities)
          ? data.lessonPlan.learningActivities
          : [],
        resourcesAndMedia: Array.isArray(data.lessonPlan.resourcesAndMedia)
          ? data.lessonPlan.resourcesAndMedia
          : [],
        customFormFields: Array.isArray(data.lessonPlan.customFormFields)
          ? data.lessonPlan.customFormFields
          : [],
      };

      setLessonPlan(normalizedPlan);
      setContentSource("ai");
      await persistArtifact("lesson_plan", normalizedPlan.lessonTitle, normalizedPlan);
    } catch (err) {
      if (err instanceof ApiResponseError) {
        setErrorMsg(err.message);
      } else {
        const msg = err instanceof Error ? err.message : "";
        setErrorMsg(msg || (isAr ? "تعذر توليد التحضير عبر الذكاء الاصطناعي." : "Failed to generate lesson plan."));
      }
    } finally {
      setLoading(false);
    }
  };

  const triggerBlobDownload = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  const triggerBase64PptxDownload = (base64: string, fileName: string, mimeType?: string) => {
    const byteChars = atob(base64);
    const bytes = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
      bytes[i] = byteChars.charCodeAt(i);
    }
    const blob = new Blob([bytes], {
      type:
        mimeType ||
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
    triggerBlobDownload(blob, fileName);
  };

  const buildDeckFromEditedPlan = (): PresentationDeckData | null => {
    if (!lessonPlan) return null;
    const slides: PresentationDeckData["slides"] = [
      {
        slideNumber: 1,
        slideType: "title",
        title: lessonPlan.lessonTitle || lesson.title,
        subtitle: `${lessonPlan.subject || lesson.subject} · ${lessonPlan.gradeLevel || lesson.gradeLevel}${
          lessonPlan.templateNameUsed ? ` · ${lessonPlan.templateNameUsed}` : ""
        }`,
        bullets: [],
        speakerNotes: lesson.summary || lessonPlan.lessonTitle,
      },
    ];
    if (lessonPlan.warmUp) {
      slides.push({
        slideNumber: slides.length + 1,
        slideType: "concept",
        title: isAr ? "المقدمة والتمهيد" : "Introduction & Warm-up",
        bullets: [lessonPlan.warmUp],
        speakerNotes: lessonPlan.warmUp,
      });
    }
    if (lessonPlan.objectives?.length) {
      slides.push({
        slideNumber: slides.length + 1,
        slideType: "objectives",
        title: isAr ? "الأهداف التعليمية" : "Learning Objectives",
        bullets: lessonPlan.objectives.slice(0, 6),
        speakerNotes: lessonPlan.objectives.join(" · "),
      });
    }
    if (Array.isArray(lessonPlan.customFormFields) && lessonPlan.customFormFields.length > 0) {
      for (const field of lessonPlan.customFormFields) {
        if (!field.content?.trim()) continue;
        slides.push({
          slideNumber: slides.length + 1,
          slideType: "concept",
          title: field.sectionName,
          bullets: field.content.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, 5),
          speakerNotes: field.content,
        });
      }
    } else if (lessonPlan.learningActivities?.length) {
      slides.push({
        slideNumber: slides.length + 1,
        slideType: "example",
        title: isAr ? "الأنشطة والتطبيقات" : "Activities & Practice",
        bullets: lessonPlan.learningActivities.slice(0, 6),
        speakerNotes: (lessonPlan.teachingStrategies || []).join(" · "),
      });
    }
    if (lessonPlan.assessment) {
      slides.push({
        slideNumber: slides.length + 1,
        slideType: "example",
        title: isAr ? "التقويم" : "Assessment",
        bullets: [lessonPlan.assessment],
        speakerNotes: lessonPlan.assessment,
      });
    }
    slides.push({
      slideNumber: slides.length + 1,
      slideType: "summary",
      title: isAr ? "الخاتمة والملخص والواجب" : "Conclusion & Homework",
      bullets: [
        ...(lessonPlan.homework ? [lessonPlan.homework] : []),
        ...(lessonPlan.differentiationAndInclusion ? [lessonPlan.differentiationAndInclusion] : []),
      ],
      speakerNotes: [lessonPlan.homework, lessonPlan.differentiationAndInclusion].filter(Boolean).join(" · "),
    });
    return {
      deckTitle: lessonPlan.lessonTitle || lesson.title,
      subject: lessonPlan.subject || lesson.subject,
      gradeLevel: lessonPlan.gradeLevel || lesson.gradeLevel,
      themeAccent: "#0F766E",
      templateNameUsed: lessonPlan.templateNameUsed,
      slides,
    };
  };

  const handleServerExportPptx = async (overrideDeck?: PresentationDeckData | null) => {
    setLoading(true);
    setErrorMsg(null);
    setPptxAutoStatus(
      isAr
        ? "جارٍ تنسيق الشرائح وتجهيز ملف PowerPoint (.pptx)..."
        : "Formatting slides & packaging .pptx..."
    );
    const candidateDeck = (overrideDeck !== undefined ? overrideDeck : deck) || buildDeckFromEditedPlan();
    try {
      const { blob, fileNameHeader } = await exportPowerPointFile({
        deck: overrideDeck !== undefined ? overrideDeck : deck,
        lesson,
        prepTemplateId: activePrepTemplate?.id || lesson.prepTemplateId || "",
        prepTemplate: activePrepTemplate,
        lessonPlan,
        diagramUrl: lesson.diagramUrl,
        language: uiLang,
      });
      const fallbackName = `${(deck?.deckTitle || lesson.title || "presentation").replace(/[\\/:*?"<>|\s]+/g, "_")}.pptx`;
      const resolvedFileName = fileNameHeader ? decodeURIComponent(fileNameHeader) : fallbackName;
      triggerBlobDownload(blob, resolvedFileName);
      setSaveNotice(
        isAr
          ? `تم تنسيق وتنزيل ملف PowerPoint (${resolvedFileName}) بنجاح.`
          : `Downloaded PowerPoint (${resolvedFileName}).`
      );
      setTimeout(() => setSaveNotice(null), 3500);
    } catch (err) {
      if (
        candidateDeck &&
        err instanceof ApiResponseError &&
        (err.status === 404 || err.status === 501 || err.code === "ROUTE_NOT_FOUND")
      ) {
        await exportPresentationPptx(candidateDeck, lesson.diagramUrl, uiLang);
        setSaveNotice(
          isAr
            ? `تم تصدير وتنزيل ملف PowerPoint (.pptx) بنجاح.`
            : `Exported and downloaded .pptx successfully.`
        );
        setTimeout(() => setSaveNotice(null), 3500);
        return;
      }
      setErrorMsg(
        err instanceof Error
          ? err.message
          : isAr
            ? "تعذر تنزيل ملف PowerPoint."
            : "Failed to download .pptx."
      );
    } finally {
      setLoading(false);
      setPptxAutoStatus(null);
    }
  };

  const handleAutoGenerateAndDownloadPptx = async () => {
    if (!guardConsent()) return;
    if (demoMode) onToggleDemoMode?.(false);
    setAutoGeneratingPptx(true);
    setErrorMsg(null);
    setPptxAutoStatus(
      activePrepTemplate
        ? isAr
          ? `جارٍ توليد وتنسيق ملف PowerPoint (.pptx) وفق قالب «${activePrepTemplate.templateName}»...`
          : `Auto-generating & formatting .pptx from "${activePrepTemplate.templateName}"...`
        : isAr
          ? "جارٍ توليد وتنسيق ملف PowerPoint (.pptx) بالذكاء الاصطناعي..."
          : "Auto-generating & formatting .pptx with AI..."
    );
    try {
      let generatedDeck: PresentationDeckData | undefined;
      let pptxBase64: string | undefined;
      let fileName: string | undefined;
      let mimeType: string | undefined;

      try {
        const data = await generateAutoPowerPointFile({
          lesson,
          slideCount: 8,
          language: uiLang,
          prepTemplateId: activePrepTemplate?.id || lesson.prepTemplateId || "",
          prepTemplate: activePrepTemplate,
          lessonPlan,
        });
        generatedDeck = data.deck;
        pptxBase64 = data.pptxBase64;
        fileName = data.fileName;
        mimeType = data.mimeType;
      } catch (autoErr) {
        if (
          autoErr instanceof ApiResponseError &&
          (autoErr.status === 404 || autoErr.status === 501 || autoErr.code === "ROUTE_NOT_FOUND")
        ) {
          const deckRes = await generatePowerPointDeck({
            lesson,
            slideCount: 8,
            language: uiLang,
            prepTemplateId: activePrepTemplate?.id || lesson.prepTemplateId || "",
            prepTemplate: activePrepTemplate,
            lessonPlan,
          });
          generatedDeck = deckRes.deck;
        } else {
          throw autoErr;
        }
      }

      if (!generatedDeck || !Array.isArray(generatedDeck.slides) || generatedDeck.slides.length === 0) {
        setErrorMsg(
          isAr
            ? "لم يُرجع الخادم شرائح صالحة لبناء ملف PowerPoint."
            : "Server did not return valid slides to build .pptx."
        );
        return;
      }

      setDeck(generatedDeck);
      setActiveSlideIdx(0);
      setContentSource("ai");
      await persistArtifact("presentation", generatedDeck.deckTitle, generatedDeck);

      if (pptxBase64 && fileName) {
        triggerBase64PptxDownload(pptxBase64, fileName, mimeType);
      } else {
        await exportPresentationPptx(generatedDeck, lesson.diagramUrl, uiLang);
      }

      if (activeSubTab !== "pptx") {
        onSubTabChange("pptx");
      }
      setSaveNotice(
        isAr
          ? `تم توليد وحفظ وتنزيل ملف PowerPoint (${fileName || generatedDeck.deckTitle + ".pptx"}) بنجاح.`
          : `Generated, saved, and downloaded "${fileName || generatedDeck.deckTitle + ".pptx"}".`
      );
      setTimeout(() => setSaveNotice(null), 4000);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : isAr
            ? "تعذر الاتصال بالخادم لتوليد العرض التقديمي."
            : "Server connection failed during .pptx generation."
      );
    } finally {
      setAutoGeneratingPptx(false);
      setPptxAutoStatus(null);
    }
  };

  const handleGeneratePresentation = async () => {
    if (!guardConsent()) return;
    if (demoMode) onToggleDemoMode?.(false);
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await generatePowerPointDeck(
        {
          lesson,
          slideCount: 7,
          language: uiLang,
          prepTemplateId: activePrepTemplate?.id || lesson.prepTemplateId || "",
          prepTemplate: activePrepTemplate,
          lessonPlan,
        },
        { onPhaseChange: setRequestPhase }
      );
      if (!data.deck) {
        setErrorMsg(
          data.message ||
            (isAr ? "لم يُرجع الخادم شرائح PowerPoint صالحة." : "Server did not return a valid PowerPoint deck.")
        );
        return;
      }
      setDeck(data.deck);
      setActiveSlideIdx(0);
      setContentSource("ai");
      await persistArtifact("presentation", data.deck.deckTitle, data.deck);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : isAr
            ? "تعذر توليد العرض التقديمي."
            : "Failed to generate PowerPoint deck."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleGeneratePlanAndDeckTogether = async () => {
    if (!guardConsent()) return;
    if (demoMode) onToggleDemoMode?.(false);
    setLoading(true);
    setErrorMsg(null);
    try {
      const resolvedTplId = activePrepTemplate?.id || lesson.prepTemplateId || "";
      const planData = await generateLessonPlan({
        lesson,
        language: uiLang,
        sourcePolicy,
        prepTemplateId: resolvedTplId,
        prepTemplate: activePrepTemplate,
      });
      if (!planData.lessonPlan) {
        setErrorMsg(planData.message || (isAr ? "تعذر توليد التحضير." : "Failed to generate lesson plan."));
        return;
      }

      setLessonPlan(planData.lessonPlan);
      await persistArtifact("lesson_plan", planData.lessonPlan.lessonTitle, planData.lessonPlan);

      const pptxData = await generatePowerPointDeck({
        lesson,
        slideCount: 7,
        language: uiLang,
        prepTemplateId: resolvedTplId,
        prepTemplate: activePrepTemplate,
        lessonPlan: planData.lessonPlan,
      });
      if (!pptxData.deck) {
        setErrorMsg(
          pptxData.message ||
            (isAr
              ? "تم توليد التحضير لكن تعذر توليد البوربوينت."
              : "Plan generated, but PowerPoint generation failed.")
        );
        return;
      }

      setDeck(pptxData.deck);
      setActiveSlideIdx(0);
      setContentSource("ai");
      await persistArtifact("presentation", pptxData.deck.deckTitle, pptxData.deck);

      setSaveNotice(
        isAr
          ? "تم بناء وحفظ تحضير الدرس وعرض PowerPoint معاً وفق الفورمة المعتمدة."
          : "Lesson plan and PowerPoint deck built & saved from Preparation Form."
      );
      setTimeout(() => setSaveNotice(null), 4000);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : isAr
            ? "تعذر إتمام البناء المتكامل."
            : "Failed combined generation."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateVideoScript = async () => {
    if (!guardConsent()) return;
    if (demoMode) onToggleDemoMode?.(false);
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await generateVideoScript({
        lesson,
        style: videoStyle,
        presenterPersona: videoPersona,
        language: videoLang,
      });
      if (!data.project) {
        setErrorMsg(data.message || (isAr ? "تعذر توليد سيناريو الفيديو." : "Failed to generate video script."));
        return;
      }
      setVideoProject(data.project);
      setPreviewSceneIdx(0);
      setContentSource("ai");
      await persistArtifact("video_project", data.project.videoTitle, data.project);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : isAr
            ? "تعذر توليد سيناريو الفيديو."
            : "Failed to generate video script."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleAssembleWebmVideo = async () => {
    if (!videoProject) return;
    setAssemblingVideo(true);
    setAssembleProgress(0);
    try {
      const blob = await assembleVideoWebm(videoProject, lesson.diagramUrl, setAssembleProgress);
      const url = URL.createObjectURL(blob);
      setAssembledVideoUrl(url);
    } catch {
      setErrorMsg(isAr ? "تعذر تجميع الفيديو في المتصفح." : "Browser video assembly failed.");
    } finally {
      setAssemblingVideo(false);
    }
  };

  const handleRequestVeoVideo = async () => {
    if (!guardConsent() || !videoProject) return;
    setVeoLoading(true);
    setVeoStatusMsg(null);
    try {
      const prompt = `Educational science animation for ${lesson.title}: ${videoProject.scenes
        .slice(0, 2)
        .map((s) => s.visualCue)
        .join(". ")}`;
      const data = await generateVeoVideo({ prompt });
      if (data.videoBase64) {
        setAssembledVideoUrl(`data:${data.mimeType || "video/mp4"};base64,${data.videoBase64}`);
        setVeoStatusMsg(isAr ? "تم إنتاج الفيديو عبر Veo بنجاح." : "Veo video generated successfully.");
      } else if (data.videoUri) {
        setAssembledVideoUrl(data.videoUri);
      } else {
        setVeoStatusMsg(data.message || "Veo API requires paid tier.");
      }
    } catch (err) {
      setVeoStatusMsg(
        err instanceof Error ? err.message : isAr ? "تعذر الاتصال بخدمة Veo." : "Veo connection error."
      );
    } finally {
      setVeoLoading(false);
    }
  };

  const handleGenerateWorksheet = async () => {
    if (!guardConsent()) return;
    if (demoMode) onToggleDemoMode?.(false);
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await generateWorksheet(
        { lesson, language: uiLang },
        { onPhaseChange: setRequestPhase }
      );
      if (!data.worksheet) {
        setErrorMsg(
          data.message ||
            (isAr ? "لم يُرجع الخادم ورقة عمل صالحة." : "Server did not return a valid worksheet.")
        );
        return;
      }
      setWorksheet(data.worksheet);
      setContentSource("ai");
      await persistArtifact("worksheet", data.worksheet.worksheetTitle, data.worksheet);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : isAr
            ? "تعذر توليد ورقة العمل."
            : "Failed to generate worksheet."
      );
    } finally {
      setLoading(false);
    }
  };

  const printLessonPlanPdf = () => {
    if (!lessonPlan) return;
    const customHtml =
      Array.isArray(lessonPlan.customFormFields) && lessonPlan.customFormFields.length > 0
        ? `<h2>${isAr ? "حقول فورمة التحضير المعتمدة" : "Preparation Form Fields"}</h2>` +
          lessonPlan.customFormFields
            .map((f) => `<div class="box"><strong>${f.sectionName}</strong><p>${f.content}</p></div>`)
            .join("")
        : "";
    const html = `
      <h1>${isAr ? "تحضير درس:" : "Lesson Plan:"} ${lessonPlan.lessonTitle}</h1>
      <div class="meta">${lessonPlan.subject} · ${lessonPlan.stage} · ${lessonPlan.gradeLevel} · ${lessonPlan.durationMinutes} min${
        lessonPlan.templateNameUsed ? ` · ${lessonPlan.templateNameUsed}` : ""
      }</div>
      <h2>${isAr ? "الأهداف التعليمية" : "Learning Objectives"}</h2>
      <ul>${lessonPlan.objectives.map((o) => `<li>${o}</li>`).join("")}</ul>
      <h2>${isAr ? "التمهيد والتهيئة" : "Warm-up"}</h2><p>${lessonPlan.warmUp}</p>
      <h2>${isAr ? "الاستراتيجيات التدريسية" : "Teaching Strategies"}</h2>
      <ul>${lessonPlan.teachingStrategies.map((s) => `<li>${s}</li>`).join("")}</ul>
      <h2>${isAr ? "الأنشطة التعليمية" : "Learning Activities"}</h2>
      <ol>${lessonPlan.learningActivities.map((a) => `<li>${a}</li>`).join("")}</ol>
      <h2>${isAr ? "الوسائل والمصادر" : "Resources & Media"}</h2>
      <ul>${lessonPlan.resourcesAndMedia.map((r) => `<li>${r}</li>`).join("")}</ul>
      <h2>${isAr ? "التقويم" : "Assessment"}</h2><p>${lessonPlan.assessment}</p>
      <h2>${isAr ? "الواجب المنزلي" : "Homework"}</h2><p>${lessonPlan.homework}</p>
      <h2>${isAr ? "مراعاة الفروق الفردية وذوي الهمم" : "Differentiation & Inclusion"}</h2>
      <div class="box">${lessonPlan.differentiationAndInclusion}</div>
      ${customHtml}
    `;
    printHtmlAsPdf(lessonPlan.lessonTitle, html, isAr ? "rtl" : "ltr");
  };

  const printWorksheetPdf = (withAnswers: boolean) => {
    if (!worksheet) return;
    const html = `
      <h1>${worksheet.worksheetTitle} (${withAnswers ? (isAr ? "نسخة المعلم" : "Teacher Key") : isAr ? "نسخة الطالب" : "Student Edition"})</h1>
      <div class="meta">${worksheet.subject} · ${worksheet.gradeLevel}</div>
      <p>${worksheet.studentInstructions}</p>
      <h2>${isAr ? "1. أسئلة متنوعة" : "1. Varied Questions"}</h2>
      ${worksheet.variedQuestions
        .map((q, i) => `<div class="box"><strong>${i + 1}. ${q.question}</strong>${withAnswers ? `<p>${q.answer}</p>` : "<p>.......................</p>"}</div>`)
        .join("")}
      <h2>${isAr ? "2. النشاط التطبيقي:" : "2. Practical Activity:"} ${worksheet.practicalActivity.title}</h2>
      <ol>${worksheet.practicalActivity.steps.map((s) => `<li>${s}</li>`).join("")}</ol>
      ${withAnswers ? `<p><strong>${isAr ? "النتيجة:" : "Outcome:"}</strong> ${worksheet.practicalActivity.expectedOutcome}</p>` : ""}
      <h2>${isAr ? "3. أكمل الفراغات" : "3. Fill in the Blanks"}</h2>
      <ul>${worksheet.fillInBlanks.map((f) => `<li>${f.sentence} ${withAnswers ? `<strong>[${f.missingWord}]</strong>` : ""}</li>`).join("")}</ul>
      <h2>${isAr ? "4. المطابقة والتصنيف" : "4. Matching & Classification"}</h2>
      <ul>${worksheet.matchingPairs.map((m) => `<li>${m.leftItem} ⟷ ${withAnswers ? m.rightMatch : ".........."}</li>`).join("")}</ul>
      <p><strong>${worksheet.classificationTask.prompt}</strong></p>
      <ul>${worksheet.classificationTask.categories.map((c) => `<li>${c.categoryName}: ${withAnswers ? c.items.join("، ") : ".........."}</li>`).join("")}</ul>
      <h2>${isAr ? "5. حل المسائل والتفكير العليا" : "5. Problem Solving & Higher-Order Thinking"}</h2>
      ${worksheet.problemSolving
        .map((p, i) => `<div class="box"><strong>${i + 1}. ${p.problem}</strong>${withAnswers ? `<p>${p.solutionSteps} → ${p.finalAnswer}</p>` : "<p>.......................</p>"}</div>`)
        .join("")}
      ${worksheet.higherOrderThinking
        .map((h, i) => `<div class="box"><strong>${i + 1}. ${h.question}</strong>${withAnswers ? `<p>${h.modelAnswer}</p>` : "<p>.......................</p>"}</div>`)
        .join("")}
    `;
    printHtmlAsPdf(worksheet.worksheetTitle, html, isAr ? "rtl" : "ltr");
  };

  return (
    <div className="space-y-6">
      {/* Unified Connected Tool Bar */}
      <section
        className="rounded-xl border p-5 flex flex-wrap items-center justify-between gap-4"
        style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}
      >
        <div>
          <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
            {isAr ? "الدرس الموحد المصدر:" : "Unified Source Lesson:"} {lesson.subject} · {lesson.gradeLevel}
          </div>
          <h1 className="text-xl font-bold">{lesson.title}</h1>
        </div>

        <div
          className="flex flex-wrap items-center gap-1 p-1 rounded-lg border"
          style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}
        >
          {[
            { id: "lesson_plan" as const, label: isAr ? "تحضير الدرس" : "Lesson Plan", icon: <FileText className="w-4 h-4" /> },
            { id: "pptx" as const, label: isAr ? "عرض PowerPoint" : "PowerPoint", icon: <Presentation className="w-4 h-4" /> },
            { id: "video" as const, label: isAr ? "الفيديو التعليمي" : "Video Studio", icon: <Video className="w-4 h-4" /> },
            { id: "worksheet" as const, label: isAr ? "أوراق العمل" : "Worksheets", icon: <ClipboardList className="w-4 h-4" /> },
          ].map((t) => {
            const active = activeSubTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onSubTabChange(t.id)}
                className="min-h-[40px] px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
                style={{
                  backgroundColor: active ? "var(--accent-primary)" : "transparent",
                  color: active ? "var(--accent-contrast)" : "var(--text-primary)",
                }}
              >
                {t.icon}
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Active Preparation Form Alignment Bar */}
      {(activeSubTab === "lesson_plan" || activeSubTab === "pptx") && (
        <section
          className="rounded-xl border p-4 flex flex-wrap items-center justify-between gap-3"
          style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}
        >
          <div className="flex flex-wrap items-center gap-2.5 text-xs">
            <FileCheck2 className="w-4 h-4 shrink-0" style={{ color: "var(--accent-primary)" }} />
            <label htmlFor="studio-prep-template-select" className="font-bold">
              {isAr ? "فورمة التحضير المعتمدة:" : "Active Preparation Form:"}
            </label>
            <select
              id="studio-prep-template-select"
              value={activePrepTemplate?.id || ""}
              onChange={(e) => onSelectPrepTemplate(e.target.value || null)}
              className="min-h-[38px] px-3 rounded-lg border text-xs font-semibold"
              style={{
                backgroundColor: "var(--bg-surface)",
                borderColor: "var(--border-hairline)",
                color: "var(--text-primary)",
              }}
            >
              <option value="">
                {isAr ? "— النمط القياسي العام للمنصة —" : "— Platform Standard Format —"}
              </option>
              {prepTemplates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.templateName} ({tpl.requiredSections.length})
                </option>
              ))}
            </select>
            {activePrepTemplate && (
              <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                {isAr
                  ? `${activePrepTemplate.requiredSections.slice(0, 4).join(" · ")}${activePrepTemplate.requiredSections.length > 4 ? " ..." : ""}`
                  : `${activePrepTemplate.requiredSections.slice(0, 4).join(" · ")}${activePrepTemplate.requiredSections.length > 4 ? " ..." : ""}`}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onOpenPrepForm && (
              <button
                type="button"
                onClick={onOpenPrepForm}
                className="min-h-[38px] px-3 py-2 rounded-lg border text-xs font-semibold flex items-center gap-1.5"
                style={{
                  backgroundColor: "var(--bg-surface)",
                  borderColor: "var(--border-hairline)",
                  color: "var(--text-primary)",
                }}
              >
                <FileCheck2 className="w-3.5 h-3.5" style={{ color: "var(--accent-primary)" }} />
                <span>
                  {isAr ? "إرفاق / تعديل فورمة التحضير" : "Attach / Edit Prep Form"}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={handleAutoGenerateAndDownloadPptx}
              disabled={loading || autoGeneratingPptx}
              className="min-h-[38px] px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
              style={{
                backgroundColor: "var(--accent-primary)",
                color: "var(--accent-contrast)",
              }}
            >
              {autoGeneratingPptx ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Presentation className="w-3.5 h-3.5" />
              )}
              <span>
                {isAr ? "توليد وتنزيل .pptx من القالب" : "Auto-Generate & Download .pptx"}
              </span>
            </button>

            <button
              type="button"
              onClick={handleGeneratePlanAndDeckTogether}
              disabled={loading || autoGeneratingPptx}
              className="min-h-[38px] px-3.5 py-2 rounded-lg border text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
              style={{
                backgroundColor: "var(--bg-surface)",
                borderColor: "var(--accent-primary)",
                color: "var(--accent-primary)",
              }}
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Layers className="w-3.5 h-3.5" />}
              <span>
                {isAr ? "بناء وحفظ التحضير + البوربوينت معاً" : "Build & Save Plan + PPTX Together"}
              </span>
            </button>
          </div>
        </section>
      )}

      {(pptxAutoStatus || (loading && requestPhase !== "idle" && requestPhase !== "success")) && (
        <div
          role="status"
          aria-live="polite"
          className="p-3.5 rounded-lg border text-xs font-semibold flex items-center gap-2"
          style={{
            backgroundColor: "var(--bg-subtle)",
            borderColor: "var(--accent-primary)",
            color: "var(--text-primary)",
          }}
        >
          <Loader2 className="w-4 h-4 animate-spin shrink-0" style={{ color: "var(--accent-primary)" }} />
          <span>{pptxAutoStatus || getAiPhaseMessage(requestPhase, uiLang)}</span>
        </div>
      )}
      {contentSource && (
        <div
          className="px-3.5 py-2 rounded-lg border text-xs font-bold flex flex-wrap items-center justify-between gap-2"
          style={
            contentSource === "demo"
              ? { backgroundColor: "#fef3c7", borderColor: "#f59e0b", color: "#92400e" }
              : { backgroundColor: "var(--bg-subtle)", borderColor: "var(--accent-primary)", color: "var(--accent-primary)" }
          }
        >
          <span>
            {contentSource === "demo"
              ? isAr
                ? "محتوى تجريبي نموذجي مسبق (Demo Mode) — غير مولّد بالذكاء الاصطناعي (يمكن تصديره وتعديله بحرية)."
                : "Preset Demo Mode Content — Not AI-generated (ready to preview & export)."
              : isAr
                ? "محتوى مولّد فعلياً بالذكاء الاصطناعي ومحفوظ في قاعدة بيانات الدرس."
                : "Live AI-generated content saved to lesson database."}
          </span>
        </div>
      )}
      {errorMsg && (
        <div
          className="p-3.5 rounded-lg border text-xs text-red-700 dark:text-red-300 flex flex-wrap items-center justify-between gap-2"
          role="alert"
          style={{ borderColor: "#dc2626", backgroundColor: "#fff1f2" }}
        >
          <span>{errorMsg}</span>
          <button
            type="button"
            onClick={() => {
              onToggleDemoMode?.(true);
              void loadDemoForActiveTab();
            }}
            className="px-3 py-1.5 rounded-lg border font-bold bg-amber-100 text-amber-900 border-amber-400 hover:opacity-90"
          >
            {isAr ? "تعبئة نموذج تجريبي (Demo Mode)" : "Load Demo Mode Sample"}
          </button>
        </div>
      )}
      {saveNotice && (
        <div className="p-3 rounded-lg border text-xs font-semibold text-emerald-700 dark:text-emerald-300" style={{ borderColor: "#059669", backgroundColor: "var(--bg-subtle)" }}>
          {saveNotice}
        </div>
      )}

      {/* 1. LESSON PLAN STUDIO */}
      {activeSubTab === "lesson_plan" && (
        <section
          className="science-card rounded-xl border p-6 space-y-5"
          style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4" style={{ borderColor: "var(--border-hairline)" }}>
            <div>
              <h2 className="text-lg font-bold">{isAr ? "منشئ تحضير الدرس الذكي (Gemini AI)" : "Smart AI Lesson Plan Builder"}</h2>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                {isAr
                  ? `المصادر المفعّلة للدرس: ${lesson.sources.filter((s) => s.enabled !== false).length} · المرفقات الإضافية: ${planAttachedFiles.length}`
                  : `Active lesson sources: ${lesson.sources.filter((s) => s.enabled !== false).length} · Attached files: ${planAttachedFiles.length}`}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setPlanInputsOpen((v) => !v)}
                className="min-h-[40px] px-3 py-2 rounded-lg border text-xs font-semibold"
                style={{ borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}
              >
                {planInputsOpen
                  ? isAr ? "إخفاء مدخلات ومرفقات التحضير" : "Hide Inputs & Files"
                  : isAr ? "مدخلات ومرفقات التحضير" : "Inputs & Files"}
              </button>
              <button
                type="button"
                onClick={handleGenerateLessonPlan}
                disabled={loading}
                className="min-h-[40px] px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5"
                style={{ backgroundColor: "var(--accent-primary)", color: "var(--accent-contrast)" }}
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                <span>
                  {loading
                    ? isAr ? "جارٍ التوليد الفعلي بالذكاء الاصطناعي..." : "Generating with AI..."
                    : isAr ? "توليد التحضير بالذكاء الاصطناعي" : "Generate AI Lesson Plan"}
                </span>
              </button>
              {lessonPlan && (
                <>
                  <button
                    type="button"
                    onClick={() => persistArtifact("lesson_plan", lessonPlan.lessonTitle, lessonPlan)}
                    className="min-h-[40px] px-3 py-2 rounded-lg border text-xs font-semibold flex items-center gap-1.5"
                    style={{ borderColor: "var(--border-hairline)" }}
                  >
                    <Save className="w-4 h-4" />
                    <span>{isAr ? "حفظ التعديلات" : "Save Edits"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => exportLessonPlanDocx(lessonPlan, uiLang)}
                    className="min-h-[40px] px-3 py-2 rounded-lg border text-xs font-semibold flex items-center gap-1.5"
                    style={{ borderColor: "var(--border-hairline)" }}
                  >
                    <Download className="w-4 h-4" />
                    <span>Word (.docx)</span>
                  </button>
                  <button
                    type="button"
                    onClick={printLessonPlanPdf}
                    className="min-h-[40px] px-3 py-2 rounded-lg border text-xs font-semibold flex items-center gap-1.5"
                    style={{ borderColor: "var(--border-hairline)" }}
                  >
                    <Printer className="w-4 h-4" />
                    <span>PDF</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {planInputsOpen && (
            <div
              className="p-4 rounded-xl border space-y-3"
              style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}
            >
              <div className="text-xs font-bold" style={{ color: "var(--accent-primary)" }}>
                {isAr
                  ? "بيانات ومدخلات المعلم والمصادر المرفقة للتحضير:"
                  : "Teacher Inputs & Attached Sources for Lesson Plan:"}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="block font-semibold mb-1">
                    {isAr ? "محور خاص أو عنوان فرعي (اختياري)" : "Custom Focus Topic (optional)"}
                  </label>
                  <input
                    type="text"
                    value={planCustomTopic}
                    onChange={(e) => setPlanCustomTopic(e.target.value)}
                    placeholder={lesson.title}
                    className="w-full min-h-[38px] px-3 rounded-lg border"
                    style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">
                    {isAr ? "مدة الحصة (بالدقائق)" : "Duration (minutes)"}
                  </label>
                  <input
                    type="number"
                    min={10}
                    max={180}
                    value={planDurationMinutes}
                    onChange={(e) => setPlanDurationMinutes(Math.max(10, Number(e.target.value) || 45))}
                    className="w-full min-h-[38px] px-3 rounded-lg border font-mono-num"
                    style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">
                    {isAr ? "الفئة المستهدفة / الشعبة (اختياري)" : "Target Group / Class (optional)"}
                  </label>
                  <input
                    type="text"
                    value={planTargetGroup}
                    onChange={(e) => setPlanTargetGroup(e.target.value)}
                    placeholder={isAr ? "مثال: عاشر/2 — تعليم عام وموهوبون" : "e.g., Grade 10 Section B"}
                    className="w-full min-h-[38px] px-3 rounded-lg border"
                    style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block font-semibold mb-1">
                    {isAr ? "أهداف أو مهارات تركّز عليها المعلمة (اختياري)" : "Teacher Focus Objectives (optional)"}
                  </label>
                  <textarea
                    rows={2}
                    value={planFocusObjectives}
                    onChange={(e) => setPlanFocusObjectives(e.target.value)}
                    placeholder={isAr ? "مثال: التركيز على حل مسائل التوازن الكيميائي والتعلم النشط..." : "Focus on problem-solving and active learning..."}
                    className="w-full p-2.5 rounded-lg border"
                    style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">
                    {isAr ? "ملاحظات / استراتيجيات مطلوبة أو نص مصدر إضافي" : "Additional Notes / Source Excerpt"}
                  </label>
                  <textarea
                    rows={2}
                    value={planAttachedNotes || planExtraInstructions}
                    onChange={(e) => {
                      setPlanAttachedNotes(e.target.value);
                      setPlanExtraInstructions(e.target.value);
                    }}
                    placeholder={isAr ? "الصق نصاً من الكتاب أو اكتب تعليمات خاصة بالتحضير..." : "Paste textbook notes or extra prep instructions..."}
                    className="w-full p-2.5 rounded-lg border"
                    style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <label
                  className="min-h-[38px] px-3.5 py-2 rounded-lg border border-dashed text-xs font-semibold flex items-center gap-2 cursor-pointer hover:opacity-90"
                  style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--accent-primary)", color: "var(--accent-primary)" }}
                >
                  <Upload className="w-4 h-4 shrink-0" />
                  <span>
                    {isAr
                      ? "إرفاق ملفات أو مصادر إضافية للتحضير (PDF / Word / PPTX / صورة / TXT)"
                      : "Attach Source Files (PDF, Word, PPTX, Image, TXT)"}
                  </span>
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.docx,.pptx,.txt,.md,.csv,image/*"
                    onChange={handlePlanAttachmentChange}
                    className="sr-only"
                  />
                </label>

                {planAttachedFiles.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    {planAttachedFiles.map((file, idx) => (
                      <span
                        key={`${file.name}-${idx}`}
                        className="px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1.5"
                        style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}
                      >
                        <Paperclip className="w-3.5 h-3.5" style={{ color: "var(--accent-primary)" }} />
                        <span className="truncate max-w-[160px]">{file.name}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setPlanAttachedFiles((prev) => prev.filter((_, i) => i !== idx))
                          }
                          aria-label={isAr ? "إزالة الملف" : "Remove file"}
                          className="text-red-600 hover:opacity-80"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {!lessonPlan ? (
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              {isAr
                ? "أدخل أي ملاحظات أو أرفق مصادر إضافية أعلاه ثم اضغط «توليد التحضير بالذكاء الاصطناعي» لإنشاء تحضير فعلي قابل للتعديل والتنزيل بصيغتي Word وPDF."
                : "Enter optional inputs or attach source files above, then click Generate AI Lesson Plan to build a real editable plan."}
            </p>
          ) : (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold mb-1">{isAr ? "الأهداف التعليمية (سطر لكل هدف)" : "Objectives (one per line)"}</label>
                  <textarea
                    rows={4}
                    value={lessonPlan.objectives.join("\n")}
                    onChange={(e) => setLessonPlan({ ...lessonPlan, objectives: e.target.value.split("\n").filter(Boolean) })}
                    className="w-full p-3 rounded-lg border text-xs"
                    style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">{isAr ? "التمهيد والتهيئة" : "Warm-up & Hook"}</label>
                  <textarea
                    rows={4}
                    value={lessonPlan.warmUp}
                    onChange={(e) => setLessonPlan({ ...lessonPlan, warmUp: e.target.value })}
                    className="w-full p-3 rounded-lg border text-xs"
                    style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">{isAr ? "الاستراتيجيات التدريسية" : "Teaching Strategies"}</label>
                  <textarea
                    rows={3}
                    value={lessonPlan.teachingStrategies.join("\n")}
                    onChange={(e) => setLessonPlan({ ...lessonPlan, teachingStrategies: e.target.value.split("\n").filter(Boolean) })}
                    className="w-full p-3 rounded-lg border text-xs"
                    style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">{isAr ? "الأنشطة التعليمية" : "Learning Activities"}</label>
                  <textarea
                    rows={3}
                    value={lessonPlan.learningActivities.join("\n")}
                    onChange={(e) => setLessonPlan({ ...lessonPlan, learningActivities: e.target.value.split("\n").filter(Boolean) })}
                    className="w-full p-3 rounded-lg border text-xs"
                    style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">{isAr ? "التقويم" : "Assessment"}</label>
                  <textarea
                    rows={3}
                    value={lessonPlan.assessment}
                    onChange={(e) => setLessonPlan({ ...lessonPlan, assessment: e.target.value })}
                    className="w-full p-3 rounded-lg border text-xs"
                    style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">{isAr ? "الواجب المنزلي" : "Homework"}</label>
                  <textarea
                    rows={3}
                    value={lessonPlan.homework}
                    onChange={(e) => setLessonPlan({ ...lessonPlan, homework: e.target.value })}
                    className="w-full p-3 rounded-lg border text-xs"
                    style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">{isAr ? "مراعاة الفروق الفردية وذوي الهمم" : "Differentiation & Inclusive Learning"}</label>
                <textarea
                  rows={3}
                  value={lessonPlan.differentiationAndInclusion}
                  onChange={(e) => setLessonPlan({ ...lessonPlan, differentiationAndInclusion: e.target.value })}
                  className="w-full p-3 rounded-lg border text-xs"
                  style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}
                />
              </div>

              {Array.isArray(lessonPlan.customFormFields) && lessonPlan.customFormFields.length > 0 && (
                <div className="pt-3 border-t space-y-3" style={{ borderColor: "var(--border-hairline)" }}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-bold flex items-center gap-1.5">
                      <FileCheck2 className="w-4 h-4" style={{ color: "var(--accent-primary)" }} />
                      <span>
                        {isAr ? "حقول فورمة التحضير المعتمدة" : "Attached Preparation Form Fields"}
                      </span>
                    </h3>
                    {lessonPlan.templateNameUsed && (
                      <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                        {lessonPlan.templateNameUsed}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {lessonPlan.customFormFields.map((field, idx) => (
                      <div key={`${field.sectionName}-${idx}`}>
                        <label className="block text-xs font-bold mb-1">{field.sectionName}</label>
                        <textarea
                          rows={3}
                          value={field.content}
                          onChange={(e) => {
                            const updatedFields = [...(lessonPlan.customFormFields || [])];
                            updatedFields[idx] = { ...updatedFields[idx], content: e.target.value };
                            setLessonPlan({ ...lessonPlan, customFormFields: updatedFields });
                          }}
                          className="w-full p-3 rounded-lg border text-xs"
                          style={{
                            backgroundColor: "var(--bg-subtle)",
                            borderColor: "var(--border-hairline)",
                            color: "var(--text-primary)",
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* 2. POWERPOINT PPTX STUDIO */}
      {activeSubTab === "pptx" && (
        <section
          className="science-card rounded-xl border p-6 space-y-5"
          style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4" style={{ borderColor: "var(--border-hairline)" }}>
            <div>
              <h2 className="text-lg font-bold">{isAr ? "منشئ عروض PowerPoint القابلة للتعديل (.pptx)" : "Editable PowerPoint Builder (.pptx)"}</h2>
              <p className="text-xs mt-0.5 tabular-nums" style={{ color: "var(--text-secondary)" }}>
                {activePrepTemplate
                  ? `${activePrepTemplate.templateName} · ${activePrepTemplate.requiredSections.length} ${
                      isAr ? "بنود في القالب" : "template sections"
                    }`
                  : isAr
                    ? "تنسيق قياسي عبر الخادم · قابل للتعديل والتنزيل بصيغة .pptx"
                    : "Server-formatted .pptx · Editable slides & notes"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleAutoGenerateAndDownloadPptx}
                disabled={loading || autoGeneratingPptx}
                className="min-h-[40px] px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
                style={{ backgroundColor: "var(--accent-primary)", color: "var(--accent-contrast)" }}
              >
                {autoGeneratingPptx ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                <span>{isAr ? "توليد وتنزيل تلقائي (.pptx)" : "Auto-Generate & Download (.pptx)"}</span>
              </button>
              <button
                type="button"
                onClick={handleGeneratePresentation}
                disabled={loading || autoGeneratingPptx}
                className="min-h-[40px] px-3.5 py-2 rounded-lg border text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
                style={{ borderColor: "var(--border-hairline)" }}
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                <span>{isAr ? "توليد للمعاينة فقط" : "Generate Preview Only"}</span>
              </button>
              {lessonPlan && !deck && (
                <button
                  type="button"
                  onClick={() => handleServerExportPptx(null)}
                  disabled={loading || autoGeneratingPptx}
                  className="min-h-[40px] px-3.5 py-2 rounded-lg border text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  style={{ borderColor: "var(--accent-primary)", color: "var(--accent-primary)" }}
                >
                  <FileCheck2 className="w-4 h-4" />
                  <span>{isAr ? "تصدير مباشر من التحضير (.pptx)" : "Export from Plan (.pptx)"}</span>
                </button>
              )}
              {deck && (
                <>
                  <button
                    type="button"
                    onClick={() => persistArtifact("presentation", deck.deckTitle, deck)}
                    className="min-h-[40px] px-3 py-2 rounded-lg border text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
                    style={{ borderColor: "var(--border-hairline)" }}
                  >
                    <Save className="w-4 h-4" />
                    <span>{isAr ? "حفظ" : "Save"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleServerExportPptx(deck)}
                    disabled={loading || autoGeneratingPptx}
                    className="min-h-[40px] px-4 py-2 rounded-lg border text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
                    style={{ borderColor: "var(--accent-primary)", color: "var(--accent-primary)" }}
                  >
                    <Download className="w-4 h-4" />
                    <span>{isAr ? "تنزيل ملف PowerPoint (.pptx)" : "Download Editable .pptx"}</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {!deck ? (
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              {isAr
                ? "اضغط على «توليد وتنزيل تلقائي (.pptx)» لإنشاء عرض PowerPoint منسق عبر الخادم وفق القالب المختار وتنزيله مباشرة، مع إمكانية تعديل شرائحه وحفظها بالمنصة."
                : "Click Auto-Generate & Download (.pptx) to format slides on the server from your selected template and download immediately, or edit slides in the studio."}
            </p>
          ) : (
            <div className="space-y-4">
              {deck.templateNameUsed && (
                <div className="text-xs font-medium flex items-center gap-1.5" style={{ color: "var(--text-secondary)" }}>
                  <FileCheck2 className="w-3.5 h-3.5" style={{ color: "var(--accent-primary)" }} />
                  <span>
                    {isAr ? "مبني وفق الفورمة:" : "Built from Preparation Form:"} {deck.templateNameUsed}
                  </span>
                </div>
              )}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              <div className="lg:col-span-4 space-y-2">
                {deck.slides.map((sl, idx) => (
                  <button
                    key={sl.slideNumber}
                    type="button"
                    onClick={() => setActiveSlideIdx(idx)}
                    className="w-full text-start p-3 rounded-lg border text-xs"
                    style={{
                      backgroundColor: idx === activeSlideIdx ? "var(--bg-subtle)" : "transparent",
                      borderColor: idx === activeSlideIdx ? "var(--accent-primary)" : "var(--border-hairline)",
                    }}
                  >
                    <div className="font-mono-num font-bold" style={{ color: "var(--accent-primary)" }}>
                      {isAr ? `شريحة ${sl.slideNumber}` : `Slide ${sl.slideNumber}`} · {sl.slideType}
                    </div>
                    <div className="font-semibold mt-0.5 truncate">{sl.title}</div>
                  </button>
                ))}
              </div>

              {deck.slides[activeSlideIdx] && (
                <div className="lg:col-span-8 p-5 rounded-xl border space-y-4" style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}>
                  <div>
                    <label className="block text-xs font-bold mb-1">{isAr ? "عنوان الشريحة" : "Slide Title"}</label>
                    <input
                      type="text"
                      value={deck.slides[activeSlideIdx].title}
                      onChange={(e) => {
                        const next = [...deck.slides];
                        next[activeSlideIdx] = { ...next[activeSlideIdx], title: e.target.value };
                        setDeck({ ...deck, slides: next });
                      }}
                      className="w-full min-h-[40px] px-3 rounded-lg border text-sm font-bold"
                      style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold mb-1">{isAr ? "نقاط المحتوى" : "Slide Bullets"}</label>
                    <textarea
                      rows={5}
                      value={deck.slides[activeSlideIdx].bullets.join("\n")}
                      onChange={(e) => {
                        const next = [...deck.slides];
                        next[activeSlideIdx] = { ...next[activeSlideIdx], bullets: e.target.value.split("\n") };
                        setDeck({ ...deck, slides: next });
                      }}
                      className="w-full p-3 rounded-lg border text-xs"
                      style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold mb-1">{isAr ? "ملاحظات المعلم (Speaker Notes)" : "Speaker Notes"}</label>
                    <textarea
                      rows={2}
                      value={deck.slides[activeSlideIdx].speakerNotes}
                      onChange={(e) => {
                        const next = [...deck.slides];
                        next[activeSlideIdx] = { ...next[activeSlideIdx], speakerNotes: e.target.value };
                        setDeck({ ...deck, slides: next });
                      }}
                      className="w-full p-3 rounded-lg border text-xs"
                      style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}
                    />
                  </div>
                </div>
              )}
              </div>
            </div>
          )}
        </section>
      )}

      {/* 3. EDUCATIONAL VIDEO STUDIO */}
      {activeSubTab === "video" && (
        <section
          className="science-card rounded-xl border p-6 space-y-5"
          style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4" style={{ borderColor: "var(--border-hairline)" }}>
            <h2 className="text-lg font-bold">{isAr ? "استوديو إنتاج الفيديو التعليمي" : "Educational Video Production Studio"}</h2>
            <button
              type="button"
              onClick={handleGenerateVideoScript}
              disabled={loading}
              className="min-h-[40px] px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5"
              style={{ backgroundColor: "var(--accent-primary)", color: "var(--accent-contrast)" }}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              <span>{isAr ? "كتابة السيناريو وتقسيم المشاهد" : "Generate Script & Scenes"}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div>
              <label className="block font-bold mb-1">{isAr ? "أسلوب العرض" : "Presentation Style"}</label>
              <select
                value={videoStyle}
                onChange={(e) => setVideoStyle(e.target.value as VideoProjectData["style"])}
                className="w-full min-h-[40px] px-3 rounded-lg border"
                style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}
              >
                <option value="educational_explainer">{isAr ? "شرح تعليمي مبسط" : "Educational Explainer"}</option>
                <option value="lab_story">{isAr ? "قصة مخبرية تطبيقية" : "Lab Story"}</option>
                <option value="exam_review">{isAr ? "مراجعة مركزة للاختبار" : "Exam Review"}</option>
              </select>
            </div>
            <div>
              <label className="block font-bold mb-1">{isAr ? "الشخصية التعليمية" : "Presenter Persona"}</label>
              <select
                value={videoPersona}
                onChange={(e) => setVideoPersona(e.target.value as VideoProjectData["presenterPersona"])}
                className="w-full min-h-[40px] px-3 rounded-lg border"
                style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}
              >
                <option value="science_mentor">{isAr ? "مرشد العلوم التفاعلي" : "Science Mentor"}</option>
                <option value="friendly_guide">{isAr ? "الرفيق المبسط" : "Friendly Guide"}</option>
                <option value="academic_professor">{isAr ? "الأستاذ الأكاديمي" : "Academic Professor"}</option>
              </select>
            </div>
            <div>
              <label className="block font-bold mb-1">{isAr ? "لغة التعليق والترجمة" : "Voiceover & Subtitle Language"}</label>
              <select
                value={videoLang}
                onChange={(e) => setVideoLang(e.target.value as "ar" | "en")}
                className="w-full min-h-[40px] px-3 rounded-lg border"
                style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}
              >
                <option value="ar">العربية</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>

          {videoProject && (
            <div className="space-y-5">
              {/* Interactive Scene Preview + Audio */}
              {videoProject.scenes[previewSceneIdx] && (
                <div className="p-5 rounded-xl border space-y-3 bg-slate-900 text-white border-slate-700">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-sky-300">
                    <span>
                      {videoProject.videoTitle} · {previewSceneIdx + 1}/{videoProject.scenes.length}
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => speakWithBrowser(videoProject.scenes[previewSceneIdx].narration, settings.speechRate, undefined, undefined, videoProject.language)}
                        className="px-2.5 py-1 rounded border border-slate-600 flex items-center gap-1"
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                        <span>{isAr ? "تعليق المتصفح" : "Browser Voice"}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => speakWithGeminiTTS(videoProject.scenes[previewSceneIdx].narration, settings.speechRate, undefined, undefined, videoProject.language)}
                        className="px-2.5 py-1 rounded bg-sky-600 text-white flex items-center gap-1"
                      >
                        <Play className="w-3.5 h-3.5" />
                        <span>Gemini Voice</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                    <img
                      src={lesson.diagramUrl}
                      alt={lesson.diagramTitle}
                      className="w-full h-48 object-cover rounded-lg border border-slate-700"
                    />
                    <div className="space-y-2">
                      <h3 className="text-lg font-bold">{videoProject.scenes[previewSceneIdx].title}</h3>
                      <p className="text-xs text-slate-300">{videoProject.scenes[previewSceneIdx].visualCue}</p>
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-slate-950 border border-sky-500/40 text-center text-sm font-semibold">
                    [CC] {videoProject.scenes[previewSceneIdx].subtitleText}
                  </div>
                </div>
              )}

              {/* Scene Cards */}
              <div className="space-y-2.5">
                {videoProject.scenes.map((sc, idx) => (
                  <div
                    key={sc.sceneNumber}
                    className="p-3.5 rounded-lg border space-y-2 text-xs"
                    style={{
                      backgroundColor: idx === previewSceneIdx ? "var(--bg-subtle)" : "transparent",
                      borderColor: idx === previewSceneIdx ? "var(--accent-primary)" : "var(--border-hairline)",
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <button type="button" onClick={() => setPreviewSceneIdx(idx)} className="font-bold underline">
                        {isAr ? `مشهد ${sc.sceneNumber}:` : `Scene ${sc.sceneNumber}:`} {sc.title} ({sc.durationSec}s)
                      </button>
                    </div>
                    <textarea
                      rows={2}
                      value={sc.narration}
                      onChange={(e) => {
                        const next = [...videoProject.scenes];
                        next[idx] = { ...next[idx], narration: e.target.value, subtitleText: e.target.value };
                        setVideoProject({ ...videoProject, scenes: next });
                      }}
                      className="w-full p-2 rounded border"
                      style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}
                    />
                  </div>
                ))}
              </div>

              {/* Assembly & Export Bar (Built-in WebM Assembler + Optional Veo Paid Route) */}
              <div className="p-4 rounded-xl border space-y-3" style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}>
                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    onClick={handleAssembleWebmVideo}
                    disabled={assemblingVideo}
                    className="min-h-[42px] px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5"
                    style={{ backgroundColor: "var(--accent-primary)", color: "var(--accent-contrast)" }}
                  >
                    {assemblingVideo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Video className="w-4 h-4" />}
                    <span>
                      {assemblingVideo
                        ? `${isAr ? "جارٍ تجميع الفيديو..." : "Assembling..."} ${assembleProgress}%`
                        : isAr
                        ? "إنتاج وتجميع فيديو قابل للمعاينة والتنزيل (.webm)"
                        : "Assemble & Download Video (.webm)"}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={handleRequestVeoVideo}
                    disabled={veoLoading}
                    className="min-h-[42px] px-4 py-2 rounded-lg border text-xs font-semibold flex items-center gap-1.5"
                    style={{ borderColor: "var(--border-hairline)" }}
                  >
                    {veoLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    <span>{isAr ? "توليد عبر Veo (يتطلب مفتاحاً مدفوعاً)" : "Generate via Veo (Paid Key Required)"}</span>
                  </button>
                </div>

                {veoStatusMsg && (
                  <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{veoStatusMsg}</span>
                  </div>
                )}

                {assembledVideoUrl && (
                  <div className="space-y-2 pt-2">
                    <video src={assembledVideoUrl} controls className="w-full max-w-2xl rounded-lg border" />
                    <div>
                      <a
                        href={assembledVideoUrl}
                        download={`${videoProject.videoTitle.replace(/\s+/g, "_")}.webm`}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border text-xs font-bold"
                        style={{ borderColor: "var(--accent-primary)", color: "var(--accent-primary)" }}
                      >
                        <Download className="w-4 h-4" />
                        <span>{isAr ? "تنزيل ملف الفيديو" : "Download Video File"}</span>
                      </a>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {/* 4. WORKSHEET STUDIO */}
      {activeSubTab === "worksheet" && (
        <section
          className="science-card rounded-xl border p-6 space-y-5"
          style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4" style={{ borderColor: "var(--border-hairline)" }}>
            <h2 className="text-lg font-bold">{isAr ? "منشئ أوراق العمل (نسخة الطالب ونسخة المعلم)" : "Worksheet Builder (Student & Teacher Key)"}</h2>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleGenerateWorksheet}
                disabled={loading}
                className="min-h-[40px] px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5"
                style={{ backgroundColor: "var(--accent-primary)", color: "var(--accent-contrast)" }}
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                <span>{isAr ? "توليد ورقة العمل" : "Generate Worksheet"}</span>
              </button>
              {worksheet && (
                <>
                  <button
                    type="button"
                    onClick={() => exportWorksheetDocx(worksheet, worksheetViewMode === "teacher", uiLang)}
                    className="min-h-[40px] px-3 py-2 rounded-lg border text-xs font-semibold flex items-center gap-1.5"
                    style={{ borderColor: "var(--border-hairline)" }}
                  >
                    <Download className="w-4 h-4" />
                    <span>Word (.docx)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => printWorksheetPdf(worksheetViewMode === "teacher")}
                    className="min-h-[40px] px-3 py-2 rounded-lg border text-xs font-semibold flex items-center gap-1.5"
                    style={{ borderColor: "var(--border-hairline)" }}
                  >
                    <Printer className="w-4 h-4" />
                    <span>PDF</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {worksheet && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setWorksheetViewMode("student")}
                  className="px-3 py-1.5 rounded-lg border text-xs font-semibold"
                  style={{
                    backgroundColor: worksheetViewMode === "student" ? "var(--accent-primary)" : "transparent",
                    color: worksheetViewMode === "student" ? "var(--accent-contrast)" : "var(--text-primary)",
                    borderColor: "var(--border-hairline)",
                  }}
                >
                  {isAr ? "نسخة الطالب" : "Student Edition"}
                </button>
                <button
                  type="button"
                  onClick={() => setWorksheetViewMode("teacher")}
                  className="px-3 py-1.5 rounded-lg border text-xs font-semibold"
                  style={{
                    backgroundColor: worksheetViewMode === "teacher" ? "var(--accent-primary)" : "transparent",
                    color: worksheetViewMode === "teacher" ? "var(--accent-contrast)" : "var(--text-primary)",
                    borderColor: "var(--border-hairline)",
                  }}
                >
                  {isAr ? "نسخة إجابة المعلم" : "Teacher Answer Key"}
                </button>
              </div>

              <div className="space-y-4 text-sm">
                <div className="p-4 rounded-lg border" style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}>
                  <h3 className="font-bold mb-2">{isAr ? "1. أسئلة متنوعة" : "1. Varied Questions"}</h3>
                  {worksheet.variedQuestions.map((q, i) => (
                    <div key={i} className="mb-2">
                      <div className="font-semibold">{i + 1}. {q.question}</div>
                      {worksheetViewMode === "teacher" && <div className="text-xs text-emerald-700 dark:text-emerald-300">{q.answer}</div>}
                    </div>
                  ))}
                </div>

                <div className="p-4 rounded-lg border" style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}>
                  <h3 className="font-bold mb-2">{isAr ? "2. النشاط التطبيقي:" : "2. Practical Activity:"} {worksheet.practicalActivity.title}</h3>
                  <ol className="list-decimal list-inside text-xs space-y-1">
                    {worksheet.practicalActivity.steps.map((s, i) => <li key={i}>{s}</li>)}
                  </ol>
                  {worksheetViewMode === "teacher" && (
                    <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-2">{worksheet.practicalActivity.expectedOutcome}</p>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 rounded-lg border" style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}>
                    <h3 className="font-bold mb-2">{isAr ? "3. أكمل الفراغات" : "3. Fill in the Blanks"}</h3>
                    {worksheet.fillInBlanks.map((f, i) => (
                      <div key={i} className="text-xs mb-1.5">
                        {i + 1}. {f.sentence} {worksheetViewMode === "teacher" && <strong className="text-emerald-600">[{f.missingWord}]</strong>}
                      </div>
                    ))}
                  </div>
                  <div className="p-4 rounded-lg border" style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}>
                    <h3 className="font-bold mb-2">{isAr ? "4. المطابقة والتصنيف" : "4. Matching & Classification"}</h3>
                    {worksheet.matchingPairs.map((m, i) => (
                      <div key={i} className="text-xs mb-1">
                        {m.leftItem} ⟷ {worksheetViewMode === "teacher" ? m.rightMatch : "........"}
                      </div>
                    ))}
                    <div className="text-xs font-bold mt-2">{worksheet.classificationTask.prompt}</div>
                    {worksheet.classificationTask.categories.map((c, i) => (
                      <div key={i} className="text-xs">• {c.categoryName}: {worksheetViewMode === "teacher" ? c.items.join("، ") : "........"}</div>
                    ))}
                  </div>
                </div>

                <div className="p-4 rounded-lg border" style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-hairline)" }}>
                  <h3 className="font-bold mb-2">{isAr ? "5. حل المسائل والتفكير العليا" : "5. Problem Solving & Higher-Order Thinking"}</h3>
                  {worksheet.problemSolving.map((p, i) => (
                    <div key={i} className="text-xs mb-2">
                      <div className="font-semibold">{p.problem}</div>
                      {worksheetViewMode === "teacher" && <div className="text-emerald-700 dark:text-emerald-300">{p.solutionSteps} → {p.finalAnswer}</div>}
                    </div>
                  ))}
                  {worksheet.higherOrderThinking.map((h, i) => (
                    <div key={i} className="text-xs mb-2">
                      <div className="font-semibold">{h.question}</div>
                      {worksheetViewMode === "teacher" && <div className="text-emerald-700 dark:text-emerald-300">{h.modelAnswer}</div>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
};

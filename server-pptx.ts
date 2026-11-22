import fs from "fs";
import path from "path";
import PptxGenJS from "pptxgenjs";
import type {
  LessonData,
  LessonPlanData,
  PreparationTemplate,
  PresentationDeckData,
  PresentationSlide,
  SubjectId,
} from "./src/types.ts";

const SUBJECT_ACCENTS: Record<SubjectId, string> = {
  chemistry: "#0F766E",
  physics: "#0369A1",
  biology: "#15803D",
  geology: "#B45309",
  mathematics: "#6D28D9",
};

export const PPTX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export function sanitizePptxFileName(title: string, templateName?: string): string {
  const cleanTitle = (title || "lesson_presentation")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 64);
  const cleanTpl = templateName
    ? `_${templateName
        .trim()
        .replace(/[\\/:*?"<>|]+/g, "")
        .replace(/\s+/g, "_")
        .slice(0, 32)}`
    : "";
  return `${cleanTitle || "lesson_presentation"}${cleanTpl}.pptx`;
}

export function resolveLocalDiagramDataUrl(diagramUrl?: string | null): string | null {
  if (!diagramUrl || typeof diagramUrl !== "string") return null;
  if (diagramUrl.startsWith("data:image/")) {
    return diagramUrl;
  }

  try {
    const cleanRel = diagramUrl.split("?")[0].replace(/^\/+/, "");
    const workspaceRoot = process.cwd();
    const resolved = path.resolve(workspaceRoot, cleanRel);

    const allowedAssetsDir = path.resolve(workspaceRoot, "src", "assets");
    const allowedPublicDir = path.resolve(workspaceRoot, "public");
    if (
      !resolved.startsWith(allowedAssetsDir + path.sep) &&
      !resolved.startsWith(allowedPublicDir + path.sep)
    ) {
      return null;
    }

    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      return null;
    }

    const ext = path.extname(resolved).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
      ".gif": "image/gif",
    };
    const mime = mimeMap[ext];
    if (!mime) return null;

    const bytes = fs.readFileSync(resolved);
    return `data:${mime};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

function normalizeBullets(raw: unknown, fallbackText?: string): string[] {
  const arr = Array.isArray(raw)
    ? raw.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  if (arr.length > 0) return arr.slice(0, 6);
  if (fallbackText && fallbackText.trim()) {
    return fallbackText
      .split(/\r?\n|[.;،]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 3)
      .slice(0, 5);
  }
  return [];
}

/**
 * Formats and validates generated or template-structured slides against
 * the active LessonData, PreparationTemplate, and optional LessonPlanData.
 */
export function formatTemplateStructuredDeck(params: {
  rawDeck?: Partial<PresentationDeckData> | null;
  lesson?: Partial<LessonData> | null;
  prepTemplate?: PreparationTemplate | null;
  lessonPlan?: LessonPlanData | null;
  language?: "ar" | "en";
}): PresentationDeckData {
  const { rawDeck, lesson, prepTemplate, lessonPlan, language = "ar" } = params;
  const isAr = language === "ar";
  const subjectId = (lesson?.subjectId as SubjectId) || "chemistry";
  const accentHex = rawDeck?.themeAccent || SUBJECT_ACCENTS[subjectId] || "#0F766E";

  const deckTitle =
    rawDeck?.deckTitle?.trim() ||
    lessonPlan?.lessonTitle ||
    lesson?.title ||
    (isAr ? "عرض تعليمي علمي" : "Science Presentation");
  const subjectName =
    rawDeck?.subject?.trim() || lessonPlan?.subject || lesson?.subject || "Science";
  const gradeLevel =
    rawDeck?.gradeLevel?.trim() || lessonPlan?.gradeLevel || lesson?.gradeLevel || "";
  const templateNameUsed =
    rawDeck?.templateNameUsed?.trim() ||
    prepTemplate?.templateName ||
    lessonPlan?.templateNameUsed ||
    "";

  const slides: PresentationSlide[] = Array.isArray(rawDeck?.slides)
    ? rawDeck.slides.map((sl, idx) => {
        const bullets = normalizeBullets(sl.bullets, sl.speakerNotes || sl.subtitle);
        return {
          slideNumber: idx + 1,
          slideType: (sl.slideType as PresentationSlide["slideType"]) || "concept",
          title: String(sl.title || `${isAr ? "شريحة" : "Slide"} ${idx + 1}`).trim(),
          subtitle: sl.subtitle ? String(sl.subtitle).trim() : undefined,
          bullets,
          speakerNotes: String(sl.speakerNotes || "").trim(),
          visualNote: sl.visualNote ? String(sl.visualNote).trim() : undefined,
          quizQuestion: sl.quizQuestion ? String(sl.quizQuestion).trim() : undefined,
          quizOptions: Array.isArray(sl.quizOptions)
            ? sl.quizOptions.map((o) => String(o).trim()).filter(Boolean)
            : undefined,
          quizAnswerIndex:
            typeof sl.quizAnswerIndex === "number" ? sl.quizAnswerIndex : undefined,
        };
      })
    : [];

  // Ensure every requiredSection in the selected PreparationTemplate is represented
  // when lessonPlan or customFormFields provides content and the AI deck omitted it.
  if (prepTemplate && prepTemplate.requiredSections.length > 0 && slides.length > 0) {
    const existingTextBlob = slides
      .map((s) => `${s.title} ${s.subtitle || ""}`.toLowerCase())
      .join(" ");

    const missingSections = prepTemplate.requiredSections.filter((sec) => {
      const normalized = sec.replace(/[:：]/g, "").trim().toLowerCase();
      if (!normalized || normalized.length < 2) return false;
      return !existingTextBlob.includes(normalized);
    });

    if (missingSections.length > 0 && lessonPlan?.customFormFields?.length) {
      const insertPos = Math.max(1, slides.length - 1);
      const extraSlides: PresentationSlide[] = [];

      for (const secName of missingSections) {
        const matchedField = lessonPlan.customFormFields.find((f) =>
          f.sectionName.toLowerCase().includes(secName.replace(/[:：]/g, "").trim().toLowerCase())
        );
        if (matchedField && matchedField.content.trim()) {
          extraSlides.push({
            slideNumber: 0,
            slideType: "concept",
            title: matchedField.sectionName,
            subtitle: templateNameUsed || undefined,
            bullets: normalizeBullets(null, matchedField.content),
            speakerNotes: matchedField.content.trim(),
          });
        }
      }

      if (extraSlides.length > 0) {
        slides.splice(insertPos, 0, ...extraSlides);
      }
    }
  }

  // Fallback deterministic slide builder strictly from edited lessonPlan + prepTemplate
  // if no AI slide array was passed (e.g., direct export from edited lesson plan).
  if (slides.length === 0 && lessonPlan) {
    slides.push({
      slideNumber: 1,
      slideType: "title",
      title: deckTitle,
      subtitle: `${subjectName} · ${gradeLevel}${
        templateNameUsed ? ` · ${templateNameUsed}` : ""
      }`,
      bullets: [],
      speakerNotes: `${isAr ? "مقدمة الدرس:" : "Lesson intro:"} ${deckTitle}`,
    });

    if (lessonPlan.warmUp) {
      slides.push({
        slideNumber: slides.length + 1,
        slideType: "concept",
        title: isAr ? "المقدمة والتمهيد" : "Introduction & Warm-up",
        bullets: normalizeBullets(null, lessonPlan.warmUp),
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
          bullets: normalizeBullets(null, field.content),
          speakerNotes: field.content.trim(),
        });
      }
    } else {
      if (lessonPlan.teachingStrategies?.length || lesson?.summary) {
        slides.push({
          slideNumber: slides.length + 1,
          slideType: "concept",
          title: isAr ? "المحتوى العلمي والاستراتيجيات" : "Scientific Content & Strategies",
          bullets: [
            ...(lesson?.summary ? [lesson.summary] : []),
            ...(lessonPlan.teachingStrategies || []),
          ].slice(0, 6),
          speakerNotes: lesson?.summary || (lessonPlan.teachingStrategies || []).join(" · "),
        });
      }
      if (lessonPlan.learningActivities?.length) {
        slides.push({
          slideNumber: slides.length + 1,
          slideType: "example",
          title: isAr ? "الأنشطة والتطبيقات العملية" : "Activities & Practice",
          bullets: lessonPlan.learningActivities.slice(0, 6),
          speakerNotes: (lessonPlan.learningActivities || []).join(" · "),
        });
      }
    }

    if (lessonPlan.assessment) {
      slides.push({
        slideNumber: slides.length + 1,
        slideType: "example",
        title: isAr ? "التقويم والتحقق من الفهم" : "Assessment & Check for Understanding",
        bullets: normalizeBullets(null, lessonPlan.assessment),
        speakerNotes: lessonPlan.assessment,
      });
    }

    slides.push({
      slideNumber: slides.length + 1,
      slideType: "summary",
      title: isAr ? "الخاتمة والملخص والواجب" : "Conclusion, Summary & Homework",
      bullets: [
        ...(lessonPlan.homework ? [`${isAr ? "الواجب المنزلي:" : "Homework:"} ${lessonPlan.homework}`] : []),
        ...(lessonPlan.differentiationAndInclusion
          ? [`${isAr ? "مراعاة الفروق:" : "Inclusion:"} ${lessonPlan.differentiationAndInclusion}`]
          : []),
      ].slice(0, 5),
      speakerNotes: [lessonPlan.homework, lessonPlan.differentiationAndInclusion].filter(Boolean).join(" · "),
    });
  }

  // Re-number sequentially 1..N
  const normalizedSlides = slides.map((s, idx) => ({
    ...s,
    slideNumber: idx + 1,
  }));

  return {
    deckTitle,
    subject: subjectName,
    gradeLevel,
    themeAccent: accentHex,
    templateNameUsed: templateNameUsed || undefined,
    slides: normalizedSlides,
  };
}

/**
 * Compiles a PresentationDeckData structure into a real 16:9 PowerPoint (.pptx) binary Buffer
 * using server-side layout formatting, Arabic RTL / English LTR mirroring, embedded diagrams,
 * speaker notes, and institutional preparation-form attribution.
 */
export async function buildServerPptxBuffer(params: {
  deck: PresentationDeckData;
  diagramUrl?: string | null;
  language?: "ar" | "en";
}): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
  const { deck, diagramUrl, language = "ar" } = params;
  const rtl = language === "ar";
  const pptx = new PptxGenJS();

  pptx.layout = "LAYOUT_16x9";
  pptx.rtlMode = rtl;
  pptx.title = deck.deckTitle;
  pptx.subject = deck.subject;
  pptx.author = "Smart Science AI";

  const accent = (deck.themeAccent || "#0F766E").replace("#", "");
  const diagramDataUrl = resolveLocalDiagramDataUrl(diagramUrl);
  const totalSlides = deck.slides.length || 1;
  const fontFace = rtl ? "IBM Plex Sans Arabic" : "Plus Jakarta Sans";

  for (const slideItem of deck.slides) {
    const slide = pptx.addSlide();
    const isTitleSlide = slideItem.slideType === "title";

    slide.background = { color: isTitleSlide ? "0F172A" : "F8FAFC" };

    // Top accent bar across 16:9 width (10in)
    slide.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 0,
      w: 10,
      h: 0.14,
      fill: { color: accent },
      line: { color: accent },
    });

    if (isTitleSlide) {
      slide.addText(slideItem.title, {
        x: 0.75,
        y: 1.55,
        w: 8.5,
        h: 1.5,
        fontSize: 32,
        bold: true,
        color: "FFFFFF",
        fontFace,
        align: rtl ? "right" : "left",
        rtlMode: rtl,
      });

      const subLine =
        slideItem.subtitle ||
        `${deck.subject} · ${deck.gradeLevel}${
          deck.templateNameUsed ? ` · ${deck.templateNameUsed}` : ""
        }`;

      slide.addText(subLine, {
        x: 0.75,
        y: 3.15,
        w: 8.5,
        h: 0.85,
        fontSize: 17,
        color: "CBD5E1",
        fontFace,
        align: rtl ? "right" : "left",
        rtlMode: rtl,
      });

      if (deck.templateNameUsed) {
        slide.addText(
          rtl
            ? `مبني وفق فورمة التحضير المعتمدة: ${deck.templateNameUsed}`
            : `Aligned to Preparation Form: ${deck.templateNameUsed}`,
          {
            x: 0.75,
            y: 4.7,
            w: 8.5,
            h: 0.4,
            fontSize: 12,
            color: "94A3B8",
            fontFace,
            align: rtl ? "right" : "left",
            rtlMode: rtl,
          }
        );
      }
    } else {
      // Slide header
      slide.addText(slideItem.title, {
        x: 0.6,
        y: 0.35,
        w: 8.8,
        h: 0.62,
        fontSize: 23,
        bold: true,
        color: "0F172A",
        fontFace,
        align: rtl ? "right" : "left",
        rtlMode: rtl,
      });

      // Subtle hairline divider under header
      slide.addShape(pptx.ShapeType.line, {
        x: 0.6,
        y: 1.05,
        w: 8.8,
        h: 0,
        line: { color: "CBD5E1", width: 1 },
      });

      const hasDiagram = slideItem.slideType === "diagram" && Boolean(diagramDataUrl);
      const textWidth = hasDiagram ? 4.4 : 8.8;
      const textX = hasDiagram ? (rtl ? 5.0 : 0.6) : 0.6;

      if (hasDiagram && diagramDataUrl) {
        slide.addImage({
          data: diagramDataUrl,
          x: rtl ? 0.6 : 5.2,
          y: 1.25,
          w: 4.1,
          h: 3.2,
        });
      }

      const bodyLines =
        slideItem.slideType === "interactive_quiz" && slideItem.quizQuestion
          ? [
              slideItem.quizQuestion,
              ...(slideItem.quizOptions || []).map((o, idx) => `${idx + 1}. ${o}`),
            ]
          : slideItem.bullets.length > 0
            ? slideItem.bullets
            : slideItem.speakerNotes
              ? [slideItem.speakerNotes]
              : [];

      if (bodyLines.length > 0) {
        slide.addText(
          bodyLines.map((line) => ({
            text: line,
            options: {
              bullet: slideItem.slideType !== "interactive_quiz",
              breakLine: true,
            },
          })),
          {
            x: textX,
            y: 1.25,
            w: textWidth,
            h: 3.75,
            fontSize: 16,
            color: "1E293B",
            fontFace,
            align: rtl ? "right" : "left",
            valign: "top",
            rtlMode: rtl,
            paraSpaceAfter: 10,
          }
        );
      }

      const footerMeta = [
        deck.subject,
        deck.gradeLevel,
        deck.templateNameUsed || undefined,
        `${slideItem.slideNumber}/${totalSlides}`,
      ]
        .filter(Boolean)
        .join(" · ");

      slide.addText(footerMeta, {
        x: 0.6,
        y: 5.15,
        w: 8.8,
        h: 0.3,
        fontSize: 10,
        color: "64748B",
        fontFace,
        align: rtl ? "right" : "left",
        rtlMode: rtl,
      });
    }

    if (slideItem.speakerNotes) {
      slide.addNotes(slideItem.speakerNotes);
    }
  }

  const out = await pptx.write({ outputType: "nodebuffer" });
  const buffer = Buffer.isBuffer(out) ? out : Buffer.from(out as Uint8Array);
  const fileName = sanitizePptxFileName(deck.deckTitle, deck.templateNameUsed);

  return { buffer, fileName, mimeType: PPTX_MIME_TYPE };
}

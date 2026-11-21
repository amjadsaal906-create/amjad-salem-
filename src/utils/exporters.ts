import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
} from "docx";
import PptxGenJS from "pptxgenjs";
import type {
  LessonPlanData,
  PresentationDeckData,
  VideoProjectData,
  WorksheetData,
} from "../types.ts";

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function makeParagraph(
  text: string,
  options: { bold?: boolean; heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel]; rtl?: boolean; spacingAfter?: number } = {}
): Paragraph {
  const rtl = options.rtl ?? true;
  return new Paragraph({
    heading: options.heading,
    bidirectional: rtl,
    alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
    spacing: { after: options.spacingAfter ?? 140 },
    children: [
      new TextRun({
        text,
        bold: options.bold,
        rightToLeft: rtl,
        size: options.heading ? 28 : 22,
        font: "IBM Plex Sans Arabic",
      }),
    ],
  });
}

export async function exportLessonPlanDocx(plan: LessonPlanData, lang: "ar" | "en" = "ar"): Promise<void> {
  const rtl = lang === "ar";
  const rows: TableRow[] = [
    new TableRow({
      children: [
        new TableCell({
          width: { size: 35, type: WidthType.PERCENTAGE },
          children: [makeParagraph(rtl ? "المادة / المرحلة / الصف" : "Subject / Stage / Grade", { bold: true, rtl })],
        }),
        new TableCell({
          width: { size: 65, type: WidthType.PERCENTAGE },
          children: [makeParagraph(`${plan.subject} · ${plan.stage} · ${plan.gradeLevel}`, { rtl })],
        }),
      ],
    }),
    new TableRow({
      children: [
        new TableCell({
          children: [makeParagraph(rtl ? "الزمن المخصص" : "Duration", { bold: true, rtl })],
        }),
        new TableCell({
          children: [makeParagraph(`${plan.durationMinutes} ${rtl ? "دقيقة" : "minutes"}`, { rtl })],
        }),
      ],
    }),
  ];

  const customFieldParagraphs: Paragraph[] =
    Array.isArray(plan.customFormFields) && plan.customFormFields.length > 0
      ? [
          makeParagraph(
            rtl ? "بنود فورمة التحضير المعتمدة:" : "Preparation Form Custom Sections:",
            { heading: HeadingLevel.HEADING_2, bold: true, rtl }
          ),
          ...plan.customFormFields.flatMap((field) => [
            makeParagraph(field.sectionName, { bold: true, rtl, spacingAfter: 80 }),
            makeParagraph(field.content, { rtl }),
          ]),
        ]
      : [];

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          makeParagraph(rtl ? `تحضير درس: ${plan.lessonTitle}` : `Lesson Plan: ${plan.lessonTitle}`, {
            heading: HeadingLevel.HEADING_1,
            bold: true,
            rtl,
            spacingAfter: 160,
          }),
          ...(plan.templateNameUsed
            ? [
                makeParagraph(
                  rtl
                    ? `مبني على فورمة التحضير: ${plan.templateNameUsed}`
                    : `Built using Preparation Form: ${plan.templateNameUsed}`,
                  { bold: true, rtl, spacingAfter: 180 }
                ),
              ]
            : []),
          new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }),
          makeParagraph("", { rtl, spacingAfter: 120 }),
          makeParagraph(rtl ? "الأهداف التعليمية:" : "Learning Objectives:", { heading: HeadingLevel.HEADING_2, bold: true, rtl }),
          ...plan.objectives.map((o, i) => makeParagraph(`${i + 1}. ${o}`, { rtl })),
          makeParagraph(rtl ? "التمهيد والتهيئة:" : "Warm-up & Hook:", { heading: HeadingLevel.HEADING_2, bold: true, rtl }),
          makeParagraph(plan.warmUp, { rtl }),
          makeParagraph(rtl ? "الاستراتيجيات التدريسية:" : "Teaching Strategies:", { heading: HeadingLevel.HEADING_2, bold: true, rtl }),
          ...plan.teachingStrategies.map((s) => makeParagraph(`• ${s}`, { rtl })),
          makeParagraph(rtl ? "الأنشطة التعليمية:" : "Learning Activities:", { heading: HeadingLevel.HEADING_2, bold: true, rtl }),
          ...plan.learningActivities.map((a, i) => makeParagraph(`${i + 1}. ${a}`, { rtl })),
          makeParagraph(rtl ? "الوسائل والمصادر:" : "Resources & Media:", { heading: HeadingLevel.HEADING_2, bold: true, rtl }),
          ...plan.resourcesAndMedia.map((r) => makeParagraph(`• ${r}`, { rtl })),
          makeParagraph(rtl ? "التقويم:" : "Assessment:", { heading: HeadingLevel.HEADING_2, bold: true, rtl }),
          makeParagraph(plan.assessment, { rtl }),
          makeParagraph(rtl ? "الواجب المنزلي:" : "Homework:", { heading: HeadingLevel.HEADING_2, bold: true, rtl }),
          makeParagraph(plan.homework, { rtl }),
          makeParagraph(rtl ? "مراعاة الفروق الفردية وذوي الهمم:" : "Differentiation & Inclusive Support:", {
            heading: HeadingLevel.HEADING_2,
            bold: true,
            rtl,
          }),
          makeParagraph(plan.differentiationAndInclusion, { rtl }),
          ...customFieldParagraphs,
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  triggerDownload(blob, `${plan.lessonTitle.replace(/\s+/g, "_")}_lesson_plan.docx`);
}

export async function exportWorksheetDocx(
  worksheet: WorksheetData,
  includeAnswers: boolean,
  lang: "ar" | "en" = "ar"
): Promise<void> {
  const rtl = lang === "ar";
  const children: Paragraph[] = [
    makeParagraph(
      `${worksheet.worksheetTitle} (${
        includeAnswers
          ? rtl
            ? "نسخة المعلم — الإجابات النموذجية"
            : "Teacher Answer Key"
          : rtl
          ? "نسخة الطالب"
          : "Student Edition"
      })`,
      { heading: HeadingLevel.HEADING_1, bold: true, rtl }
    ),
    makeParagraph(`${worksheet.subject} · ${worksheet.gradeLevel}`, { rtl }),
    makeParagraph(worksheet.studentInstructions, { rtl, spacingAfter: 200 }),

    makeParagraph(rtl ? "أولاً: أسئلة متنوعة" : "1. Varied Questions", { heading: HeadingLevel.HEADING_2, bold: true, rtl }),
    ...worksheet.variedQuestions.flatMap((q, i) => [
      makeParagraph(`${i + 1}. ${q.question}`, { bold: true, rtl }),
      makeParagraph(
        includeAnswers ? `${rtl ? "الإجابة:" : "Answer:"} ${q.answer}` : "........................................................",
        { rtl }
      ),
    ]),

    makeParagraph(rtl ? "ثانياً: النشاط التطبيقي" : "2. Practical Activity", { heading: HeadingLevel.HEADING_2, bold: true, rtl }),
    makeParagraph(worksheet.practicalActivity.title, { bold: true, rtl }),
    ...worksheet.practicalActivity.steps.map((s, i) => makeParagraph(`${i + 1}) ${s}`, { rtl })),
    ...(includeAnswers
      ? [makeParagraph(`${rtl ? "النتيجة المتوقعة:" : "Expected Outcome:"} ${worksheet.practicalActivity.expectedOutcome}`, { rtl })]
      : []),

    makeParagraph(rtl ? "ثالثاً: أكمل الفراغات" : "3. Fill in the Blanks", { heading: HeadingLevel.HEADING_2, bold: true, rtl }),
    ...worksheet.fillInBlanks.map((f, i) =>
      makeParagraph(
        `${i + 1}. ${f.sentence}${includeAnswers ? `  [${f.missingWord}]` : ""}`,
        { rtl }
      )
    ),

    makeParagraph(rtl ? "رابعاً: المطابقة" : "4. Matching", { heading: HeadingLevel.HEADING_2, bold: true, rtl }),
    ...worksheet.matchingPairs.map((m, i) =>
      makeParagraph(
        `${i + 1}. ${m.leftItem}  ⟷  ${includeAnswers ? m.rightMatch : "................"}`,
        { rtl }
      )
    ),

    makeParagraph(rtl ? "خامساً: التصنيف" : "5. Classification", { heading: HeadingLevel.HEADING_2, bold: true, rtl }),
    makeParagraph(worksheet.classificationTask.prompt, { rtl }),
    ...worksheet.classificationTask.categories.map((cat) =>
      makeParagraph(
        `• ${cat.categoryName}: ${includeAnswers ? cat.items.join("، ") : "......................"}`,
        { rtl }
      )
    ),

    makeParagraph(rtl ? "سادساً: حل المسائل والتدريبات" : "6. Problem Solving", { heading: HeadingLevel.HEADING_2, bold: true, rtl }),
    ...worksheet.problemSolving.flatMap((p, i) => [
      makeParagraph(`${i + 1}. ${p.problem}`, { bold: true, rtl }),
      makeParagraph(
        includeAnswers
          ? `${rtl ? "الحل:" : "Solution:"} ${p.solutionSteps} — ${p.finalAnswer}`
          : "........................................................",
        { rtl }
      ),
    ]),

    makeParagraph(rtl ? "سابعاً: أسئلة التفكير والتحليل" : "7. Higher-Order Thinking", {
      heading: HeadingLevel.HEADING_2,
      bold: true,
      rtl,
    }),
    ...worksheet.higherOrderThinking.flatMap((h, i) => [
      makeParagraph(`${i + 1}. ${h.question}`, { bold: true, rtl }),
      makeParagraph(
        includeAnswers ? `${rtl ? "نموذج الإجابة:" : "Model Answer:"} ${h.modelAnswer}` : "........................................................",
        { rtl }
      ),
    ]),
  ];

  const doc = new Document({ sections: [{ properties: {}, children }] });
  const blob = await Packer.toBlob(doc);
  const suffix = includeAnswers ? "teacher_key" : "student";
  triggerDownload(blob, `${worksheet.worksheetTitle.replace(/\s+/g, "_")}_${suffix}.docx`);
}

async function imageUrlToDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result || ""));
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function exportPresentationPptx(
  deck: PresentationDeckData,
  diagramUrl: string,
  lang: "ar" | "en" = "ar"
): Promise<void> {
  const rtl = lang === "ar";
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.rtlMode = rtl;
  pptx.title = deck.deckTitle;
  pptx.subject = deck.subject;

  const accent = (deck.themeAccent || "#0284C7").replace("#", "");
  const diagramDataUrl = diagramUrl ? await imageUrlToDataUrl(diagramUrl) : null;

  for (const slideItem of deck.slides) {
    const slide = pptx.addSlide();
    slide.background = { color: slideItem.slideType === "title" ? "0F172A" : "F8FAFC" };

    // Top accent bar
    slide.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 0,
      w: 10,
      h: 0.14,
      fill: { color: accent },
      line: { color: accent },
    });

    if (slideItem.slideType === "title") {
      slide.addText(slideItem.title, {
        x: 0.8,
        y: 1.7,
        w: 8.4,
        h: 1.4,
        fontSize: 32,
        bold: true,
        color: "FFFFFF",
        align: rtl ? "right" : "left",
        rtlMode: rtl,
      });
      slide.addText(slideItem.subtitle || `${deck.subject} · ${deck.gradeLevel}`, {
        x: 0.8,
        y: 3.2,
        w: 8.4,
        h: 0.8,
        fontSize: 18,
        color: "CBD5E1",
        align: rtl ? "right" : "left",
        rtlMode: rtl,
      });
    } else {
      slide.addText(slideItem.title, {
        x: 0.6,
        y: 0.35,
        w: 8.8,
        h: 0.65,
        fontSize: 24,
        bold: true,
        color: "0F172A",
        align: rtl ? "right" : "left",
        rtlMode: rtl,
      });

      const hasDiagram = slideItem.slideType === "diagram" && diagramDataUrl;
      const textWidth = hasDiagram ? 4.4 : 8.8;
      const textX = hasDiagram ? (rtl ? 5.0 : 0.6) : 0.6;

      if (hasDiagram && diagramDataUrl) {
        slide.addImage({
          data: diagramDataUrl,
          x: rtl ? 0.6 : 5.2,
          y: 1.25,
          w: 4.1,
          h: 3.1,
        });
      }

      const bodyLines =
        slideItem.slideType === "interactive_quiz" && slideItem.quizQuestion
          ? [slideItem.quizQuestion, ...(slideItem.quizOptions || []).map((o, idx) => `${idx + 1}. ${o}`)]
          : slideItem.bullets;

      slide.addText(
        bodyLines.map((line) => ({
          text: line,
          options: { bullet: slideItem.slideType !== "interactive_quiz", breakLine: true },
        })),
        {
          x: textX,
          y: 1.25,
          w: textWidth,
          h: 3.7,
          fontSize: 16,
          color: "1E293B",
          align: rtl ? "right" : "left",
          valign: "top",
          rtlMode: rtl,
          paraSpaceAfter: 10,
        }
      );

      slide.addText(`${deck.subject} · ${slideItem.slideNumber}/${deck.slides.length}`, {
        x: 0.6,
        y: 5.15,
        w: 8.8,
        h: 0.3,
        fontSize: 10,
        color: "64748B",
        align: rtl ? "left" : "right",
      });
    }

    if (slideItem.speakerNotes) {
      slide.addNotes(slideItem.speakerNotes);
    }
  }

  await pptx.writeFile({ fileName: `${deck.deckTitle.replace(/\s+/g, "_")}.pptx` });
}

export function printHtmlAsPdf(title: string, htmlBody: string, dir: "rtl" | "ltr"): void {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    iframe.remove();
    return;
  }

  doc.open();
  doc.write(`<!doctype html>
<html lang="${dir === "rtl" ? "ar" : "en"}" dir="${dir}">
<head>
<meta charset="utf-8" />
<title>${title}</title>
<style>
  @page { margin: 18mm; }
  body { font-family: "IBM Plex Sans Arabic", Arial, sans-serif; color: #0f172a; line-height: 1.7; font-size: 13pt; }
  h1 { font-size: 18pt; border-bottom: 2px solid #0284c7; padding-bottom: 6px; margin-bottom: 14px; }
  h2 { font-size: 14pt; color: #0369a1; margin-top: 16px; margin-bottom: 6px; }
  ul, ol { padding-inline-start: 22px; }
  .meta { background: #f1f5f9; padding: 10px 14px; border-radius: 6px; margin-bottom: 14px; font-size: 11pt; }
  .box { border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px 14px; margin: 10px 0; }
</style>
</head>
<body>${htmlBody}</body>
</html>`);
  doc.close();

  window.setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    window.setTimeout(() => iframe.remove(), 2000);
  }, 350);
}

export async function assembleVideoWebm(
  project: VideoProjectData,
  diagramUrl: string,
  onProgress: (pct: number) => void
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context unavailable");

  let diagramImg: HTMLImageElement | null = null;
  if (diagramUrl) {
    diagramImg = await new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = diagramUrl;
    });
  }

  const stream = canvas.captureStream(24);
  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
    ? "video/webm;codecs=vp9"
    : "video/webm";
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (ev) => {
    if (ev.data.size > 0) chunks.push(ev.data);
  };

  const donePromise = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }));
  });

  recorder.start(250);
  const rtl = project.language === "ar";
  const totalScenes = project.scenes.length;

  for (let sIdx = 0; sIdx < totalScenes; sIdx++) {
    const scene = project.scenes[sIdx];
    const durationMs = Math.min(6000, Math.max(2500, (scene.durationSec || 4) * 500));
    const steps = 20;
    const stepMs = durationMs / steps;

    for (let f = 0; f < steps; f++) {
      // Background
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, 1280, 720);

      // Header bar
      ctx.fillStyle = "#0284c7";
      ctx.fillRect(0, 0, 1280, 8);

      // Scene title
      ctx.fillStyle = "#38bdf8";
      ctx.font = "bold 24px sans-serif";
      ctx.textAlign = rtl ? "right" : "left";
      ctx.fillText(
        `${project.videoTitle} — ${sIdx + 1}/${totalScenes}`,
        rtl ? 1220 : 60,
        56
      );

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 36px sans-serif";
      ctx.fillText(scene.title, rtl ? 1220 : 60, 112);

      // Diagram on opposite side
      if (diagramImg) {
        const imgX = rtl ? 60 : 700;
        ctx.save();
        ctx.drawImage(diagramImg, imgX, 150, 520, 320);
        ctx.restore();
      }

      // Visual cue text
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "24px sans-serif";
      const textX = rtl ? 1220 : 60;
      const cueWords = scene.visualCue.split(" ");
      let line = "";
      let y = 210;
      for (const word of cueWords) {
        const test = line ? `${line} ${word}` : word;
        if (ctx.measureText(test).width > 560) {
          ctx.fillText(line, textX, y);
          line = word;
          y += 38;
        } else {
          line = test;
        }
      }
      if (line) ctx.fillText(line, textX, y);

      // Closed Caption Subtitle Bar at bottom
      ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
      ctx.fillRect(60, 560, 1160, 110);
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 2;
      ctx.strokeRect(60, 560, 1160, 110);

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 24px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(scene.subtitleText.slice(0, 95), 640, 622);

      // Progress bar
      const overall = ((sIdx + f / steps) / totalScenes) * 100;
      ctx.fillStyle = "#38bdf8";
      ctx.fillRect(0, 712, (1280 * overall) / 100, 8);
      onProgress(Math.round(overall));

      await new Promise((r) => setTimeout(r, stepMs));
    }
  }

  recorder.stop();
  onProgress(100);
  return await donePromise;
}

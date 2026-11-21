import React, { useState } from "react";
import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  HeadingLevel,
  AlignmentType,
} from "docx";
import type {
  RadarConceptStat,
  RadarInterventionImpact,
  RadarSessionSnapshot,
} from "../types.ts";

interface ConceptRadarChartProps {
  concepts: RadarConceptStat[];
  selectedStudentConcepts?: Array<{ concept: string; pct: number }>;
  selectedStudentName?: string;
  thresholdPct: number;
  isAr: boolean;
}

export const ConceptRadarChart: React.FC<ConceptRadarChartProps> = ({
  concepts,
  selectedStudentConcepts,
  selectedStudentName,
  thresholdPct,
  isAr,
}) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (!concepts || concepts.length === 0) {
    return (
      <div
        className="rounded-2xl border p-6 text-center text-xs"
        style={{
          backgroundColor: "var(--bg-subtle)",
          borderColor: "var(--border-hairline)",
          color: "var(--text-secondary)",
        }}
      >
        {isAr
          ? "سيظهر مخطط رادار المفاهيم تلقائياً فور بدء استقبال إجابات الطلاب."
          : "Concept mastery radar chart appears once answers arrive."}
      </div>
    );
  }

  // When fewer than 3 concepts exist, render an ultra-clear radial + gauge bar matrix
  if (concepts.length < 3) {
    return (
      <div className="space-y-3">
        {concepts.map((c) => {
          const statusLabel =
            c.totalAnswers === 0
              ? isAr
                ? "بانتظار الإجابات"
                : "Awaiting answers"
              : c.status === "mastered"
                ? isAr
                  ? "متقن"
                  : "Mastered"
                : c.status === "developing"
                  ? isAr
                    ? "متوسط"
                    : "Developing"
                  : isAr
                    ? "بحاجة لتدخل"
                    : "Needs intervention";

          const barColor =
            c.status === "mastered"
              ? "#0f766e"
              : c.status === "developing"
                ? "#d97706"
                : "#be123c";

          return (
            <div
              key={c.concept}
              className="p-3.5 rounded-2xl border space-y-2"
              style={{
                backgroundColor: "var(--bg-subtle)",
                borderColor: "var(--border-hairline)",
              }}
            >
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="font-bold" style={{ color: "var(--text-primary)" }}>
                  {c.concept}
                </span>
                <span className="font-mono-num font-bold" style={{ color: barColor }}>
                  {c.understandingPct}% · {statusLabel}
                </span>
              </div>
              <div className="relative h-2.5 rounded-full overflow-hidden bg-slate-200/70 dark:bg-slate-800">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.max(4, c.understandingPct)}%`,
                    backgroundColor: barColor,
                  }}
                />
                <div
                  aria-hidden="true"
                  className="absolute top-0 bottom-0 w-0.5 bg-slate-600/60"
                  style={{ left: `${thresholdPct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  const size = 320;
  const cx = size / 2;
  const cy = size / 2;
  const maxR = 104;
  const totalAxes = concepts.length;
  const rings = [25, 50, 75, 100];

  const polarToCartesian = (idx: number, pct: number) => {
    const angle = (Math.PI * 2 * idx) / totalAxes - Math.PI / 2;
    const r = (Math.max(0, Math.min(100, pct)) / 100) * maxR;
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
      angle,
    };
  };

  const classPoints = concepts
    .map((c, idx) => {
      const pt = polarToCartesian(idx, c.understandingPct);
      return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
    })
    .join(" ");

  const thresholdPoints = concepts
    .map((_, idx) => {
      const pt = polarToCartesian(idx, thresholdPct);
      return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
    })
    .join(" ");

  const studentPoints =
    selectedStudentConcepts && selectedStudentConcepts.length > 0
      ? concepts
          .map((c, idx) => {
            const match = selectedStudentConcepts.find((sc) => sc.concept === c.concept);
            const pt = polarToCartesian(idx, match ? match.pct : 0);
            return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
          })
          .join(" ")
      : null;

  const activeConcept = hoveredIdx !== null ? concepts[hoveredIdx] : null;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative w-full max-w-[330px] aspect-square flex items-center justify-center">
        <svg
          viewBox={`0 0 ${size} ${size}`}
          className="w-full h-full overflow-visible"
          role="img"
          aria-label={isAr ? "رادار إتقان مفاهيم الدرس" : "Lesson Concept Mastery Radar"}
        >
          {/* Concentric grid polygons */}
          {rings.map((ring) => {
            const pts = concepts
              .map((_, idx) => {
                const pt = polarToCartesian(idx, ring);
                return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
              })
              .join(" ");
            return (
              <polygon
                key={ring}
                points={pts}
                fill={ring === 100 ? "rgba(164, 203, 191, 0.08)" : "none"}
                stroke="var(--border-hairline)"
                strokeWidth="1"
              />
            );
          })}

          {/* Intervention Threshold Polygon */}
          <polygon
            points={thresholdPoints}
            fill="none"
            stroke="#d97706"
            strokeWidth="1.2"
            strokeDasharray="4 4"
          />

          {/* Axes lines + labels */}
          {concepts.map((c, idx) => {
            const edge = polarToCartesian(idx, 100);
            const labelPos = polarToCartesian(idx, 124);
            const isHovered = hoveredIdx === idx;
            const dotColor =
              c.status === "mastered"
                ? "#0f766e"
                : c.status === "developing"
                  ? "#d97706"
                  : "#be123c";
            const dataPt = polarToCartesian(idx, c.understandingPct);

            return (
              <g
                key={c.concept}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
                className="cursor-pointer"
              >
                <line
                  x1={cx}
                  y1={cy}
                  x2={edge.x}
                  y2={edge.y}
                  stroke="var(--border-hairline)"
                  strokeWidth={isHovered ? "1.8" : "1"}
                />
                <circle
                  cx={dataPt.x}
                  cy={dataPt.y}
                  r={isHovered ? 6 : 4.5}
                  fill={dotColor}
                  stroke="#ffffff"
                  strokeWidth="1.5"
                />
                <text
                  x={labelPos.x}
                  y={labelPos.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={isHovered ? "var(--accent-primary)" : "var(--text-primary)"}
                  fontSize="10"
                  fontWeight={isHovered ? "700" : "600"}
                >
                  {c.concept.length > 16 ? `${c.concept.slice(0, 15)}…` : c.concept}
                </text>
              </g>
            );
          })}

          {/* Class Mastery Polygon */}
          <polygon
            points={classPoints}
            fill="rgba(47, 107, 91, 0.24)"
            stroke="#2f6b5b"
            strokeWidth="2.4"
            strokeLinejoin="round"
          />

          {/* Selected Student Comparison Polygon */}
          {studentPoints && (
            <polygon
              points={studentPoints}
              fill="rgba(217, 119, 6, 0.18)"
              stroke="#d97706"
              strokeWidth="2"
              strokeDasharray="3 2"
            />
          )}

          {/* Ring scale numbers on top axis */}
          {[50, 100].map((val) => {
            const p = polarToCartesian(0, val);
            return (
              <text
                key={val}
                x={p.x + 12}
                y={p.y + 4}
                fontSize="9"
                fill="var(--text-secondary)"
              >
                {val}%
              </text>
            );
          })}
        </svg>
      </div>

      {/* Legend & Hover Telemetry Line */}
      <div className="w-full flex flex-wrap items-center justify-center gap-4 text-[11px]" style={{ color: "var(--text-secondary)" }}>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 inline-block bg-[#2f6b5b]" />
          {isAr ? "متوسط الفصل" : "Class Average"}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 inline-block border-t border-dashed border-amber-600" />
          <span className="font-mono-num">
            {isAr ? `حد التدخل (${thresholdPct}%)` : `Threshold (${thresholdPct}%)`}
          </span>
        </span>
        {selectedStudentName && (
          <span className="flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-300">
            <span className="w-3 h-0.5 inline-block border-t-2 border-dashed border-amber-600" />
            {selectedStudentName}
          </span>
        )}
      </div>

      {activeConcept && (
        <div
          className="w-full rounded-xl border px-3.5 py-2.5 text-xs flex items-center justify-between gap-2"
          style={{
            backgroundColor: "var(--bg-subtle)",
            borderColor: "var(--accent-primary)",
          }}
        >
          <span className="font-bold" style={{ color: "var(--text-primary)" }}>
            {activeConcept.concept}
          </span>
          <span className="font-mono-num font-bold" style={{ color: "var(--accent-primary)" }}>
            {activeConcept.understandingPct}% ({activeConcept.correctAnswers}/{activeConcept.totalAnswers})
          </span>
        </div>
      )}
    </div>
  );
};

export const BeforeAfterImpactCard: React.FC<{
  impact: RadarInterventionImpact;
  isAr: boolean;
}> = ({ impact, isAr }) => {
  const improved = (impact.deltaPct ?? 0) > 0;
  return (
    <div
      className="rounded-2xl border p-4 space-y-3"
      style={{
        backgroundColor: "var(--bg-subtle)",
        borderColor: "var(--border-hairline)",
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-0.5">
          <span className="text-[11px] font-bold" style={{ color: "var(--text-secondary)" }}>
            {isAr ? "تقرير قياس أثر التدخل التعليمي" : "Post-Intervention Impact Report"}
          </span>
          <h4 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
            {impact.concept}
          </h4>
        </div>
        {impact.deltaPct !== null && (
          <span
            className="px-2.5 py-1 rounded-lg text-xs font-mono-num font-bold"
            style={{
              backgroundColor: improved ? "#0f766e" : "#b45309",
              color: "#ffffff",
            }}
          >
            {impact.deltaPct > 0 ? `+${impact.deltaPct}%` : `${impact.deltaPct}%`}{" "}
            {isAr ? (improved ? "تحسن" : "تغير") : "Delta"}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
        <div className="p-2.5 rounded-xl border" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}>
          <span className="block text-[11px]" style={{ color: "var(--text-secondary)" }}>
            {isAr ? "قبل التدخل" : "Before"}
          </span>
          <strong className="font-mono-num text-base" style={{ color: "var(--text-primary)" }}>
            {impact.beforePct}%
          </strong>
        </div>

        <div className="p-2.5 rounded-xl border" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}>
          <span className="block text-[11px]" style={{ color: "var(--text-secondary)" }}>
            {isAr ? "بعد التدخل" : "After"}
          </span>
          <strong
            className="font-mono-num text-base"
            style={{ color: impact.afterPct !== null ? "#0f766e" : "var(--text-secondary)" }}
          >
            {impact.afterPct !== null ? `${impact.afterPct}%` : "—"}
          </strong>
        </div>

        <div className="p-2.5 rounded-xl border" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}>
          <span className="block text-[11px]" style={{ color: "var(--text-secondary)" }}>
            {isAr ? "تجاوزوا الخطأ" : "Overcame Error"}
          </span>
          <strong className="font-mono-num text-base" style={{ color: "#0f766e" }}>
            {impact.overcameCount}
          </strong>
        </div>

        <div className="p-2.5 rounded-xl border" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-hairline)" }}>
          <span className="block text-[11px]" style={{ color: "var(--text-secondary)" }}>
            {isAr ? "يحتاجون دعماً" : "Need Support"}
          </span>
          <strong className="font-mono-num text-base" style={{ color: "#be123c" }}>
            {impact.stillNeedsSupportCount}
          </strong>
        </div>
      </div>

      <p className="text-xs leading-relaxed" style={{ color: "var(--text-primary)" }}>
        {impact.summaryText}
      </p>

      {impact.stillNeedsSupportNames.length > 0 && (
        <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
          <strong>{isAr ? "الطلاب بحاجة لمتابعة فردية:" : "Students needing follow-up:"}</strong>{" "}
          {impact.stillNeedsSupportNames.join("، ")}
        </p>
      )}
    </div>
  );
};

// ==========================================
// Export Utilities (Excel CSV + Word DOCX)
// ==========================================

function csvEscape(v: string | number): string {
  const s = String(v ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

export function exportRadarExcel(snapshot: RadarSessionSnapshot, isAr: boolean): void {
  const rows: string[] = [];

  rows.push(
    [
      csvEscape(isAr ? "تقرير رادار الفهم الذكي — Smart Science AI" : "AI Understanding Radar Report"),
      csvEscape(snapshot.lessonTopic),
      csvEscape(snapshot.subjectName),
      csvEscape(snapshot.gradeLevel),
      csvEscape(`${isAr ? "نسبة الفهم الكلية" : "Overall Mastery"}: ${snapshot.overallUnderstandingPct}%`),
    ].join(",")
  );
  rows.push("");

  // Section 1: Concepts
  rows.push(
    [
      csvEscape(isAr ? "المفهوم العلمي" : "Concept"),
      csvEscape(isAr ? "عدد الإجابات" : "Total Answers"),
      csvEscape(isAr ? "الإجابات الصحيحة" : "Correct Answers"),
      csvEscape(isAr ? "نسبة الفهم %" : "Understanding %"),
      csvEscape(isAr ? "الحالة التربوية" : "Status"),
    ].join(",")
  );
  for (const c of snapshot.conceptStats) {
    const statusText =
      c.status === "mastered"
        ? isAr
          ? "متقن"
          : "Mastered"
        : c.status === "developing"
          ? isAr
            ? "نامٍ"
            : "Developing"
          : isAr
            ? "بحاجة لتدخل"
            : "Needs Intervention";
    rows.push(
      [
        csvEscape(c.concept),
        c.totalAnswers,
        c.correctAnswers,
        `${c.understandingPct}%`,
        csvEscape(statusText),
      ].join(",")
    );
  }
  rows.push("");

  // Section 2: Intervention Impacts
  if (snapshot.interventionHistory.length > 0) {
    rows.push(
      [
        csvEscape(isAr ? "المفهوم المستهدف بالتدخل" : "Intervention Concept"),
        csvEscape(isAr ? "الاستراتيجية المطبقة" : "Strategy Applied"),
        csvEscape(isAr ? "قبل التدخل %" : "Before %"),
        csvEscape(isAr ? "بعد التدخل %" : "After %"),
        csvEscape(isAr ? "التحسن" : "Improvement"),
        csvEscape(isAr ? "تجاوزوا الخطأ" : "Overcame Error"),
        csvEscape(isAr ? "الطلاب المحتاجون للدعم" : "Need Support"),
      ].join(",")
    );
    for (const rec of snapshot.interventionHistory) {
      const imp = rec.impact;
      rows.push(
        [
          csvEscape(rec.concept),
          csvEscape(rec.selectedStrategy?.title || ""),
          `${imp?.beforePct ?? rec.beforePct}%`,
          imp?.afterPct !== null && imp?.afterPct !== undefined ? `${imp.afterPct}%` : "-",
          imp?.deltaPct !== null && imp?.deltaPct !== undefined
            ? `${imp.deltaPct > 0 ? "+" : ""}${imp.deltaPct}%`
            : "-",
          imp?.overcameCount ?? 0,
          csvEscape((imp?.stillNeedsSupportNames || []).join(" | ") || "-"),
        ].join(",")
      );
    }
    rows.push("");
  }

  // Section 3: Individual Students
  rows.push(
    [
      csvEscape(isAr ? "اسم الطالب" : "Student Name"),
      csvEscape(isAr ? "الأسئلة المجابة" : "Answered"),
      csvEscape(isAr ? "الصحيحة" : "Correct"),
      csvEscape(isAr ? "نسبة الفهم %" : "Understanding %"),
      csvEscape(isAr ? "المفاهيم المتقنة" : "Mastered Concepts"),
      csvEscape(isAr ? "يحتاج دعم في" : "Needs Support In"),
      csvEscape(isAr ? "مفاهيم تحسنت بعد التدخل" : "Overcame After Intervention"),
    ].join(",")
  );
  for (const stu of snapshot.studentProfiles) {
    rows.push(
      [
        csvEscape(stu.name),
        stu.answeredCount,
        stu.correctCount,
        `${stu.understandingPct}%`,
        csvEscape(stu.masteredConcepts.join(" | ") || "-"),
        csvEscape(stu.needsSupportConcepts.join(" | ") || "-"),
        csvEscape(stu.overcameConcepts.join(" | ") || "-"),
      ].join(",")
    );
  }

  // UTF-8 BOM guarantees Excel opens Arabic cleanly with zero encoding issues
  const csvContent = "\uFEFF" + rows.join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `radar-report-${snapshot.roomCode || "session"}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export async function exportRadarWordReport(
  snapshot: RadarSessionSnapshot,
  isAr: boolean
): Promise<void> {
  const rtl = isAr;
  const makePara = (text: string, bold = false) =>
    new Paragraph({
      bidirectional: rtl,
      alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
      children: [new TextRun({ text, bold, rightToLeft: rtl })],
    });

  const conceptRows = [
    new TableRow({
      children: [
        isAr ? "المفهوم" : "Concept",
        isAr ? "الفهم %" : "Mastery %",
        isAr ? "الإجابات الصحيحة" : "Correct / Total",
        isAr ? "الحالة" : "Status",
      ].map((h) => new TableCell({ children: [makePara(h, true)] })),
    }),
    ...snapshot.conceptStats.map(
      (c) =>
        new TableRow({
          children: [
            c.concept,
            `${c.understandingPct}%`,
            `${c.correctAnswers} / ${c.totalAnswers}`,
            c.status === "mastered"
              ? isAr
                ? "متقن"
                : "Mastered"
              : c.status === "developing"
                ? isAr
                  ? "نامٍ"
                  : "Developing"
                : isAr
                  ? "بحاجة لتدخل"
                  : "Needs Intervention",
          ].map((val) => new TableCell({ children: [makePara(val)] })),
        })
    ),
  ];

  const studentRows = [
    new TableRow({
      children: [
        isAr ? "الطالب" : "Student",
        isAr ? "نسبة الفهم" : "Mastery %",
        isAr ? "صحيحة / مجابة" : "Correct / Answered",
        isAr ? "بحاجة لدعم" : "Needs Support",
      ].map((h) => new TableCell({ children: [makePara(h, true)] })),
    }),
    ...snapshot.studentProfiles.map(
      (s) =>
        new TableRow({
          children: [
            s.name,
            `${s.understandingPct}%`,
            `${s.correctCount} / ${s.answeredCount}`,
            s.needsSupportConcepts.join("، ") || (isAr ? "لا يوجد" : "None"),
          ].map((val) => new TableCell({ children: [makePara(val)] })),
        })
    ),
  ];

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            bidirectional: rtl,
            alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
            children: [
              new TextRun({
                text: isAr
                  ? `تقرير رادار الفهم الذكي — ${snapshot.lessonTopic}`
                  : `AI Understanding Radar Report — ${snapshot.lessonTopic}`,
                bold: true,
                rightToLeft: rtl,
              }),
            ],
          }),
          makePara(
            `${snapshot.subjectName} · ${snapshot.gradeLevel} · ${
              isAr ? "رمز الجلسة" : "Room"
            }: ${snapshot.roomCode} · ${isAr ? "الفهم العام" : "Class Mastery"}: ${
              snapshot.overallUnderstandingPct
            }%`
          ),
          new Paragraph({ text: "" }),
          makePara(isAr ? "تحليل إتقان المفاهيم:" : "Concept Mastery Breakdown:", true),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: conceptRows,
          }),
          new Paragraph({ text: "" }),
          makePara(isAr ? "تشخيص أداء الطلاب:" : "Student Diagnostic Breakdown:", true),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: studentRows,
          }),
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `radar-report-${snapshot.roomCode || "session"}.docx`;
  a.click();
  URL.revokeObjectURL(url);
}

import type {
  ChatActionMode,
  ChatLanguage,
  DailyScienceFact,
  LessonData,
  LessonPlanData,
  PresentationDeckData,
  RadarQuestion,
  UILanguage,
  UserRole,
  VideoProjectData,
  WorksheetData,
} from "../types.ts";

export interface DemoChatResponse {
  reply: string;
  alternativeExplanation?: string;
  quickExercise?: {
    question: string;
    options: string[];
    correctIndex: number;
    hint: string;
    explanation: string;
  };
  followUpSuggestions: string[];
  citations: Array<{
    sourceTitle: string;
    excerptUsed: string;
    withinApprovedSources: boolean;
  }>;
}

export function buildDemoChatReply(params: {
  query: string;
  lesson: LessonData;
  role: UserRole;
  actionMode: ChatActionMode;
  language: ChatLanguage;
  uiLang: UILanguage;
}): DemoChatResponse {
  const { query, lesson, role, actionMode, language, uiLang } = params;
  const useEn =
    language === "en" ||
    (language === "auto" && (uiLang === "en" || /^[a-zA-Z0-9\s?!.,'"]+$/.test(query.trim())));

  const firstConcept =
    lesson.extractedAnalysis?.concepts?.[0] ||
    lesson.quizQuestions?.[0]?.concept ||
    lesson.title;
  const firstObjective =
    lesson.extractedAnalysis?.objectives?.[0] ||
    (useEn ? `Understand the core principle of ${lesson.title}` : `فهم المبدأ الأساسي في درس ${lesson.title}`);
  const sampleQ = lesson.quizQuestions?.[0];
  const mainSource = lesson.sources?.find((s) => s.enabled) || lesson.sources?.[0];

  if (useEn) {
    let reply = `[Preset Demo Mode Sample — Not Live AI]\n\nRegarding "${query}" in the lesson "${lesson.title}" (${lesson.subject}):\n\n`;
    if (role === "teacher" || actionMode === "teacher_assist") {
      reply += `• Core Focus: ${firstConcept}\n• Suggested Classroom Goal: ${firstObjective}\n• Practical Tip: Start with a 2-minute visual prompt using the lesson diagram, then run a quick check inside Understanding Radar.`;
    } else if (actionMode === "example") {
      reply += `Real-world connection for "${firstConcept}":\n${lesson.simplifiedSummary || lesson.summary}\nThink of how this principle shows up in everyday lab experiments and natural phenomena around us.`;
    } else if (actionMode === "diagnose_weakness") {
      reply += `Diagnostic Check for "${lesson.title}":\nCommon misconception to watch out for: mixing up cause and effect in ${firstConcept}. Review the summary carefully: ${lesson.simplifiedSummary}`;
    } else {
      reply += `${lesson.summary}\n\nKey takeaway: ${firstConcept} connects directly to "${firstObjective}".`;
    }

    return {
      reply,
      alternativeExplanation: lesson.simplifiedSummary,
      quickExercise: sampleQ
        ? {
            question: sampleQ.prompt,
            options: sampleQ.options,
            correctIndex: sampleQ.correctIndex,
            hint: sampleQ.hint,
            explanation: sampleQ.explanation,
          }
        : undefined,
      followUpSuggestions: [
        `Give a real-world example of ${firstConcept}`,
        `Test me with a quick question on ${lesson.title}`,
        `Simplify this concept step by step`,
      ],
      citations: mainSource
        ? [
            {
              sourceTitle: mainSource.title,
              excerptUsed: mainSource.content.slice(0, 120),
              withinApprovedSources: true,
            },
          ]
        : [],
    };
  }

  let reply = `[رد تجريبي نموذجي — وضع التجربة Demo Mode وليس مولّداً بالذكاء الاصطناعي]\n\nبخصوص استفسارك: «${query}» حول درس «${lesson.title}» (${lesson.subject}):\n\n`;
  if (role === "teacher" || actionMode === "teacher_assist") {
    reply += `• المفهوم المحوري: ${firstConcept}\n• الهدف المقترح للحصة: ${firstObjective}\n• مقترح تفاعلي جاهز: اعرضي الرسم العلمي في "اكتشف العالم من حولك" لمدة دقيقتين، ثم أطلقي سؤال تحقق سريعاً عبر "رادار الفهم".`;
  } else if (actionMode === "example") {
    reply += `مثال تطبيقي مرتبط بمفهوم «${firstConcept}»:\n${lesson.simplifiedSummary || lesson.summary}\nيمكنك ملاحظة هذا المبدأ في التجارب المخبرية اليومية والظواهر الطبيعية من حولنا.`;
  } else if (actionMode === "diagnose_weakness") {
    reply += `فحص سريع لموطن صعوبة محتمل في «${lesson.title}»:\nكثيراً ما يخلط الطلبة بين السبب والنتيجة عند دراسة ${firstConcept}. راجع الخلاصة المبسطة: ${lesson.simplifiedSummary}`;
  } else {
    reply += `${lesson.summary}\n\nالخلاصة الأساسية: يرتبط مفهوم «${firstConcept}» مباشرة بالهدف التعليمي: ${firstObjective}.`;
  }

  return {
    reply,
    alternativeExplanation: lesson.simplifiedSummary,
    quickExercise: sampleQ
      ? {
          question: sampleQ.prompt,
          options: sampleQ.options,
          correctIndex: sampleQ.correctIndex,
          hint: sampleQ.hint,
          explanation: sampleQ.explanation,
        }
      : undefined,
    followUpSuggestions: [
      `أعطني مثالاً من حياتنا اليومية على ${firstConcept}`,
      `اختبر فهمي بسؤال سريع في ${lesson.title}`,
      `بسّط لي الفكرة في خطوات قصيرة`,
    ],
    citations: mainSource
      ? [
          {
            sourceTitle: mainSource.title,
            excerptUsed: mainSource.content.slice(0, 120),
            withinApprovedSources: true,
          },
        ]
      : [],
  };
}

export function buildDemoLessonPlan(lesson: LessonData, uiLang: UILanguage, templateName?: string): LessonPlanData {
  const isAr = uiLang === "ar";
  const concepts = lesson.extractedAnalysis?.concepts || [lesson.title];
  const objectives = lesson.extractedAnalysis?.objectives?.length
    ? lesson.extractedAnalysis.objectives
    : [
        isAr ? `أن يفسر الطالب مفهوم ${lesson.title} بدقة.` : `Explain the core principle of ${lesson.title}.`,
        isAr ? `أن يربط الطالب المفاهيم العلمية بتطبيقات حياتية.` : `Connect scientific concepts to daily life.`,
      ];

  return {
    lessonTitle: lesson.title,
    subject: lesson.subject,
    stage: lesson.stage === "elementary" ? (isAr ? "ابتدائي" : "Elementary") : lesson.stage === "middle" ? (isAr ? "متوسط" : "Middle") : (isAr ? "ثانوي" : "High"),
    gradeLevel: lesson.gradeLevel,
    durationMinutes: lesson.estimatedMinutes || 45,
    templateNameUsed: templateName || (isAr ? "نموذج تجريبي مسبق (Demo Mode)" : "Preset Demo Template"),
    objectives,
    warmUp: isAr
      ? `عرض تمهيدي سريع حول «${concepts[0]}» وطرح سؤال استقصائي للطلبة (نموذج تجريبي مسبق).`
      : `Quick inquiry warm-up introducing "${concepts[0]}" (Preset Demo sample).`,
    teachingStrategies: isAr
      ? ["التعلم النشط والاستقصاء", "النمذجة البصرية التفاعلية", "التقويم البنائي الفوري"]
      : ["Active Inquiry", "Visual Modeling", "Formative Check-ins"],
    learningActivities: isAr
      ? [
          `مناقشة المفاهيم الأساسية: ${concepts.join("، ")}`,
          `استخدام المحاكاة التفاعلية لدرس ${lesson.title} وملاحظة المتغيرات`,
          "نشاط تقويمي عبر رادار الفهم أو خريطة المراحل",
        ]
      : [
          `Discuss key concepts: ${concepts.join(", ")}`,
          `Explore the interactive simulation for ${lesson.title}`,
          "Run quick Understanding Radar check",
        ],
    resourcesAndMedia: isAr
      ? ["عرض الشرائح التفاعلي", "المختبر الافتراضي والمحاكاة", "مصادر الدرس المعتمدة"]
      : ["Interactive Slides", "Virtual Science Simulation", "Approved Lesson Sources"],
    assessment: isAr
      ? "أسئلة تقويم تكويني قصيرة لقياس استيعاب المفاهيم الأساسية قبل الانتقال للخاتمة."
      : "Short formative comprehension checks prior to lesson wrap-up.",
    homework: isAr
      ? `تلخيص مفهوم ${concepts[0]} مع مثال تطبيقي واحد من البيئة المحيطة.`
      : `Summarize ${concepts[0]} with one real-world example.`,
    differentiationAndInclusion: isAr
      ? "تفعيل الوضع المبسط والقراءة الصوتية عبر Web Speech API للطلبة ذوي الاحتياجات المتنوعة."
      : "Enable Simplified Mode and browser Web Speech narration for diverse learners.",
  };
}

export function buildDemoPresentationDeck(lesson: LessonData, uiLang: UILanguage, templateName?: string): PresentationDeckData {
  const isAr = uiLang === "ar";
  const concepts = lesson.extractedAnalysis?.concepts || [lesson.title];
  const objectives = lesson.extractedAnalysis?.objectives || [lesson.summary];
  const sampleQ = lesson.quizQuestions?.[0];

  return {
    deckTitle: `${lesson.title} (${isAr ? "عرض تجريبي مسبق" : "Demo Sample"})`,
    subject: lesson.subject,
    gradeLevel: lesson.gradeLevel,
    themeAccent: "#0f766e",
    templateNameUsed: templateName || (isAr ? "قالب تجريبي مسبق (Demo)" : "Demo Sample Deck"),
    slides: [
      {
        slideNumber: 1,
        slideType: "title",
        title: lesson.title,
        subtitle: `${lesson.subject} · ${lesson.gradeLevel} (${isAr ? "نموذج تجريبي" : "Demo Mode"})`,
        bullets: [lesson.simplifiedSummary || lesson.summary],
        speakerNotes: lesson.summary,
      },
      {
        slideNumber: 2,
        slideType: "objectives",
        title: isAr ? "أهداف التعلم الرئيسية" : "Learning Objectives",
        bullets: objectives.slice(0, 4),
        speakerNotes: isAr ? "تقديم الأهداف للطلبة في بداية الحصة." : "Introduce lesson goals clearly.",
      },
      {
        slideNumber: 3,
        slideType: "concept",
        title: isAr ? "المفاهيم العلمية الأساسية" : "Core Scientific Concepts",
        bullets: concepts.slice(0, 5),
        speakerNotes: lesson.summary,
        visualNote: lesson.diagramTitle,
      },
      {
        slideNumber: 4,
        slideType: "diagram",
        title: lesson.diagramTitle || (isAr ? "الشكل العلمي التوضيحي" : "Visual Science Diagram"),
        bullets: [lesson.diagramBaselineAlt || lesson.simplifiedSummary],
        speakerNotes: isAr ? "توجيه الطلبة لملاحظة عناصر الشكل." : "Guide learners through key parts of the visual.",
      },
      {
        slideNumber: 5,
        slideType: "interactive_quiz",
        title: isAr ? "سؤال تقويم تفاعلي" : "Quick Formative Question",
        bullets: sampleQ ? sampleQ.options : [isAr ? "سؤال مناقشة صفي" : "Class check question"],
        quizQuestion: sampleQ?.prompt,
        quizOptions: sampleQ?.options,
        quizAnswerIndex: sampleQ?.correctIndex,
        speakerNotes: sampleQ?.explanation || "",
      },
      {
        slideNumber: 6,
        slideType: "summary",
        title: isAr ? "الخلاصة والتطبيق" : "Summary & Application",
        bullets: [
          lesson.simplifiedSummary,
          isAr ? "جاهز للتصدير بصيغة PowerPoint (.pptx)" : "Ready to export as PowerPoint (.pptx)",
        ],
        speakerNotes: isAr ? "مراجعة النقاط الأساسية في نهاية الدرس." : "Recap key concepts before closing.",
      },
    ],
  };
}

export function buildDemoVideoProject(
  lesson: LessonData,
  style: VideoProjectData["style"],
  persona: VideoProjectData["presenterPersona"],
  lang: "ar" | "en"
): VideoProjectData {
  const isAr = lang === "ar";
  return {
    videoTitle: `${lesson.title} — ${isAr ? "سيناريو تجريبي مسبق" : "Preset Demo Script"}`,
    style,
    presenterPersona: persona,
    language: lang,
    fullScript: isAr
      ? `مرحباً بكم في درس ${lesson.title}. ${lesson.summary} وتذكروا دائماً: ${lesson.simplifiedSummary}`
      : `Welcome to ${lesson.title}. ${lesson.summary} Key takeaway: ${lesson.simplifiedSummary}`,
    scenes: [
      {
        sceneNumber: 1,
        title: isAr ? "المقدمة والتمهيد" : "Introduction",
        narration: isAr ? `أهلاً بكم اليوم في رحلة علمية حول ${lesson.title}.` : `Welcome to today's science exploration on ${lesson.title}.`,
        subtitleText: lesson.title,
        visualCue: lesson.diagramTitle || lesson.title,
        durationSec: 6,
      },
      {
        sceneNumber: 2,
        title: isAr ? "الشرح الأساسي" : "Core Explanation",
        narration: lesson.summary,
        subtitleText: lesson.simplifiedSummary,
        visualCue: lesson.diagramBaselineAlt,
        durationSec: 10,
      },
      {
        sceneNumber: 3,
        title: isAr ? "الخلاصة السريعة" : "Quick Wrap-up",
        narration: lesson.simplifiedSummary,
        subtitleText: isAr ? "راجع المفهوم في المختبر التفاعلي" : "Explore the interactive simulation lab",
        visualCue: lesson.title,
        durationSec: 6,
      },
    ],
  };
}

export function buildDemoWorksheet(lesson: LessonData, uiLang: UILanguage): WorksheetData {
  const isAr = uiLang === "ar";
  const concepts = lesson.extractedAnalysis?.concepts || [lesson.title];
  const sampleQ = lesson.quizQuestions?.[0];
  return {
    worksheetTitle: `${lesson.title} — ${isAr ? "ورقة عمل تجريبية مسبقة" : "Demo Worksheet"}`,
    subject: lesson.subject,
    gradeLevel: lesson.gradeLevel,
    studentInstructions: isAr
      ? "نموذج تجريبي مسبق (Demo Mode): أجب عن الأسئلة التالية بالاعتماد على ملخص الدرس."
      : "Preset Demo Sample: Answer the following questions based on the lesson summary.",
    variedQuestions: [
      {
        question: sampleQ ? sampleQ.prompt : isAr ? `عرّف مفهوم ${concepts[0]} بأسلوبك.` : `Define ${concepts[0]} in your own words.`,
        answer: sampleQ ? sampleQ.options[sampleQ.correctIndex] || sampleQ.explanation : lesson.simplifiedSummary,
      },
      {
        question: isAr ? `اذكر تطبيقاً واحداً من الحياة اليومية لدرس ${lesson.title}.` : `Give one real-life application of ${lesson.title}.`,
        answer: lesson.summary,
      },
    ],
    practicalActivity: {
      title: isAr ? `استكشاف ${lesson.title} في المختبر التفاعلي` : `Explore ${lesson.title} in Virtual Lab`,
      steps: isAr
        ? ["افتح أداة المحاكاة العلمية", "غيّر قيم المتغيرات وسجّل الملاحظة", "ناقش النتيجة مع زميلك"]
        : ["Open the interactive simulation", "Adjust variables and record observations", "Discuss your finding"],
      expectedOutcome: lesson.simplifiedSummary,
    },
    fillInBlanks: [
      {
        sentence: isAr ? `يركز هذا الدرس على مفهوم ________ بوصفه أساساً للفهم العلمي.` : `This lesson focuses on ________ as a core concept.`,
        missingWord: concepts[0] || lesson.title,
      },
    ],
    matchingPairs: [
      {
        leftItem: concepts[0] || lesson.title,
        rightMatch: lesson.simplifiedSummary.slice(0, 75),
      },
    ],
    classificationTask: {
      prompt: isAr ? `صنّف المفاهيم المرتبطة بدرس ${lesson.title}:` : `Classify concepts from ${lesson.title}:`,
      categories: [
        {
          categoryName: isAr ? "مفاهيم أساسية" : "Core Concepts",
          items: concepts.slice(0, 3),
        },
      ],
    },
    problemSolving: [
      {
        problem: isAr ? `كيف تفسّر حدوث ظاهرة مرتبطة بـ ${concepts[0]}؟` : `How would you explain a phenomenon involving ${concepts[0]}?`,
        solutionSteps: lesson.summary,
        finalAnswer: lesson.simplifiedSummary,
      },
    ],
    higherOrderThinking: [
      {
        question: isAr ? `ماذا تتوقع أن يحدث إذا تغيّر أحد شروط ${lesson.title}؟` : `What happens if a key condition in ${lesson.title} changes?`,
        modelAnswer: lesson.summary,
      },
    ],
  };
}

export function buildDemoRadarQuestions(
  lessonTopic: string,
  subjectName: string,
  lessons: LessonData[],
  uiLang: UILanguage
): RadarQuestion[] {
  const isAr = uiLang === "ar";
  const matchedLesson =
    lessons.find((l) => l.title === lessonTopic) || lessons[0];
  const baseQs = matchedLesson?.quizQuestions || [];

  if (baseQs.length >= 2) {
    return baseQs.map((q, idx) => ({
      id: `demo-rq-${idx + 1}-${Date.now().toString(36)}`,
      questionType: idx % 2 === 0 ? "mcq" : "misconception",
      cognitiveLevel: idx % 2 === 0 ? "understanding" : "misconception_check",
      difficulty: q.difficulty === "challenge" ? "hard" : q.difficulty,
      concept: q.concept || lessonTopic,
      objective: isAr ? `التحقق من فهم ${q.concept}` : `Check understanding of ${q.concept}`,
      misconceptionTarget: isAr ? "الخلط المفاهيمي الشائع في هذا الجزء" : "Common conceptual confusion",
      question: q.prompt,
      options: q.options,
      correctIndex: q.correctIndex,
      timeLimitSec: 45,
      explanation: q.explanation,
      hint: q.hint,
    }));
  }

  return [
    {
      id: `demo-rq-1-${Date.now().toString(36)}`,
      questionType: "mcq",
      cognitiveLevel: "understanding",
      difficulty: "medium",
      concept: lessonTopic || subjectName,
      objective: isAr ? "فهم المفهوم الأساسي للدرس" : "Understand the core concept",
      misconceptionTarget: isAr ? "نموذج تجريبي مسبق" : "Demo preset check",
      question: isAr
        ? `ما الفكرة العلمية الأهم التي يفسرها درس «${lessonTopic}»؟`
        : `What is the central scientific idea explained in "${lessonTopic}"?`,
      options: isAr
        ? [
            "العلاقة المنظمة بين السبب والنتيجة وفق القوانين العلمية",
            "تغيرات عشوائية لا تخضع لأي قاعدة",
            "معلومات حفظية غير مرتبطة بالتطبيق",
            "افتراضات غير قابلة للملاحظة",
          ]
        : [
            "Structured cause-and-effect relationship grounded in scientific laws",
            "Random changes without any pattern",
            "Memorized facts unrelated to reality",
            "Unobservable guesses",
          ],
      correctIndex: 0,
      timeLimitSec: 45,
      explanation: isAr
        ? "العلوم تفسر الظواهر عبر علاقات قابلة للاختبار والملاحظة."
        : "Science explains phenomena through testable, observable relationships.",
      hint: isAr ? "فكّر في كيفية عمل القوانين العلمية." : "Think about how scientific laws work.",
    },
    {
      id: `demo-rq-2-${Date.now().toString(36)}`,
      questionType: "true_false",
      cognitiveLevel: "misconception_check",
      difficulty: "easy",
      concept: lessonTopic || subjectName,
      objective: isAr ? "كشف التصور الخاطئ" : "Detect misconception",
      question: isAr
        ? `التمثيل البصري والتجربة التفاعلية يساعدان على ترسيخ مفاهيم «${lessonTopic}» أكثر من الحفظ المجرد.`
        : `Visual models and interactive experiments reinforce "${lessonTopic}" better than rote memorization.`,
      options: isAr ? ["صحيح", "خطأ"] : ["True", "False"],
      correctIndex: 0,
      timeLimitSec: 30,
      explanation: isAr
        ? "التعلم النشط والتجريب البصري يقللان التصورات الخاطئة."
        : "Active visual learning reduces conceptual misconceptions.",
      hint: isAr ? "تذكر أثر المختبر التفاعلي." : "Remember the effect of interactive labs.",
    },
  ];
}

export function buildDemoDailyFact(uiLang: UILanguage, date: string): DailyScienceFact {
  const factsAr: Array<Omit<DailyScienceFact, "date" | "lang">> = [
    {
      discipline: "الكيمياء",
      headline: "لماذا يطفو الجليد فوق الماء رغم أنه أكثر برودة؟",
      fact: "عندما يتجمد الماء، تشكّل جزيئاته شبكة سداسية من الروابط الهيدروجينية تجعل الجليد أقل كثافة من الماء السائل بحوالي 9%.",
      whyItMatters: "هذه الخاصية تحفظ الحياة البحرية في البحيرات المتجمدة لأن طبقة الجليد تعزل الماء الدافئ في الأعماق.",
      quickPrompt: "اشرح لي لماذا الروابط الهيدروجينية تجعل الجليد يطفو فوق الماء",
    },
    {
      discipline: "الفيزياء",
      headline: "ضوء الشمس يستغرق 8 دقائق و20 ثانية ليصل إلينا",
      fact: "رغم أن سرعة الضوء تقارب 300 ألف كيلومتر في الثانية، إلا أن المسافة بين الشمس والأرض تبلغ نحو 150 مليون كيلومتر.",
      whyItMatters: "قياس زمن وصول الضوء يساعد الفلكيين على حساب المسافات الكونية ورؤية تاريخ النجوم البعيدة.",
      quickPrompt: "كيف يحسب الفيزيائيون الزمن الذي يستغرقه الضوء من الشمس للأرض؟",
    },
    {
      discipline: "الأحياء",
      headline: "الميتوكوندريا تمتلك حمضاً نووياً مستقلاً داخل الخلية",
      fact: "تحتوي محطات الطاقة في خلايانا (الميتوكوندريا) على جزيئات DNA دائرية خاصة بها تساعدها على إنتاج جزيئات ATP بسرعة.",
      whyItMatters: "يساعد ذلك العلماء على تتبع الطاقة الخلوية وفهم تطور الخلايا الحية.",
      quickPrompt: "ما دور الميتوكوندريا في إنتاج الطاقة داخل الخلية؟",
    },
    {
      discipline: "الجيولوجيا",
      headline: "الصفائح التكتونية تتحرك ببطء يشبه نمو أظافرك!",
      fact: "تتحرك صفائح القشرة الأرضية بمعدل يتراوح غالباً بين 2 إلى 5 سنتيمترات سنوياً فوق طبقة الوشاح اللدنة.",
      whyItMatters: "هذه الحركة البطيئة على مدى ملايين السنين هي التي تشكل السلاسل الجبلية والمحيطات وتفسر مواقع الزلازل.",
      quickPrompt: "كيف تشكل حركة الصفائح التكتونية الجبال والزلازل؟",
    },
  ];

  const factsEn: Array<Omit<DailyScienceFact, "date" | "lang">> = [
    {
      discipline: "Chemistry",
      headline: "Why Ice Floats on Liquid Water",
      fact: "As water freezes, hydrogen bonds lock water molecules into an open hexagonal lattice that is roughly 9% less dense than liquid water.",
      whyItMatters: "Floating surface ice insulates lakes and oceans below, allowing aquatic ecosystems to survive winter.",
      quickPrompt: "Explain how hydrogen bonding makes ice less dense than liquid water",
    },
    {
      discipline: "Physics",
      headline: "Sunlight Takes 8 Minutes and 20 Seconds to Reach Earth",
      fact: "Even at ~300,000 km/s in vacuum, light crosses about 150 million kilometers between the Sun and our planet.",
      whyItMatters: "Understanding the speed of light lets scientists measure cosmic distances accurately.",
      quickPrompt: "How do physicists calculate the travel time of light from the Sun?",
    },
  ];

  const pool = uiLang === "ar" ? factsAr : factsEn;
  const dayNum = Number(date.replace(/-/g, "")) || 1;
  const picked = pool[dayNum % pool.length];
  return {
    ...picked,
    date,
    lang: uiLang,
    cached: true,
  };
}

export interface WorldDiscoveryResult {
  objectName: string;
  discipline: string;
  summary: string;
  scientificExplanation: string;
  keyFacts: string[];
  relatedConcepts: string[];
  experimentIdea: string;
  funQuestion: string;
  funAnswer: string;
}

export function buildDemoDiscoveryResult(
  presetKey: "leaf" | "water" | "lamp" | "rock" | "custom",
  uiLang: UILanguage
): WorldDiscoveryResult {
  const isAr = uiLang === "ar";
  if (!isAr) {
    const mapEn: Record<typeof presetKey, WorldDiscoveryResult> = {
      leaf: {
        objectName: "Green Plant Leaf (Demo Sample)",
        discipline: "Biology & Chemistry",
        summary: "A natural solar factory converting sunlight, water, and CO2 into glucose and oxygen.",
        scientificExplanation:
          "Chlorophyll inside chloroplasts absorbs red and blue wavelengths while reflecting green light. Tiny pores called stomata regulate gas exchange.",
        keyFacts: [
          "Chlorophyll gives leaves their vibrant green color.",
          "One mature tree produces oxygen for several people every year.",
          "Veins transport water via xylem and sugars via phloem.",
        ],
        relatedConcepts: ["Photosynthesis", "Chloroplast", "Stomata", "Xylem & Phloem"],
        experimentIdea: "Place a fresh leaf in a glass of water under sunlight and watch tiny oxygen bubbles form after 20 minutes!",
        funQuestion: "Why do most plant leaves appear green to our eyes?",
        funAnswer: "Because chlorophyll absorbs red and blue light and reflects green wavelengths back to our eyes.",
      },
      water: {
        objectName: "Water & Ice Glass (Demo Sample)",
        discipline: "Chemistry & Physics",
        summary: "Polar H2O molecules linked by hydrogen bonds give water remarkable thermal and density properties.",
        scientificExplanation:
          "Each water molecule has a slight positive charge on hydrogen and negative charge on oxygen, causing cohesion, surface tension, and floating ice.",
        keyFacts: [
          "Ice floats because its crystalline hydrogen-bond lattice is less dense than liquid water.",
          "Water can dissolve more substances than almost any other common liquid.",
          "Surface tension lets light insects walk across water.",
        ],
        relatedConcepts: ["Hydrogen Bonding", "States of Matter", "Density", "Polarity"],
        experimentIdea: "Gently place a dry paperclip flat on a calm water surface using a fork to observe surface tension!",
        funQuestion: "Why does ice float instead of sinking?",
        funAnswer: "Hydrogen bonds expand into an open crystal lattice when frozen, lowering ice density below liquid water.",
      },
      lamp: {
        objectName: "LED Lamp / Light Source (Demo Sample)",
        discipline: "Physics (Optics & Electricity)",
        summary: "Converts electrical energy into visible electromagnetic waves via semiconductor electron transitions.",
        scientificExplanation:
          "When current flows through a semiconductor diode, electrons cross the band gap and release photons without wasting excess heat.",
        keyFacts: [
          "LED bulbs use up to 80% less energy than incandescent bulbs.",
          "Visible light travels at roughly 300,000 km/s in a vacuum.",
          "White LED light combines multiple wavelengths across the visible spectrum.",
        ],
        relatedConcepts: ["Photons", "Electromagnetic Spectrum", "Electric Energy", "Semiconductors"],
        experimentIdea: "Shine light from a lamp through a CD back or glass prism onto white paper to split it into rainbow colors!",
        funQuestion: "Why do LED lamps stay much cooler than old filament bulbs?",
        funAnswer: "LEDs emit light via electron transitions rather than heating a metal wire to glowing temperature.",
      },
      rock: {
        objectName: "Natural Rock Specimen (Demo Sample)",
        discipline: "Geology & Earth Science",
        summary: "A solid mineral aggregate recording Earth's geological history across igneous, sedimentary, or metamorphic cycles.",
        scientificExplanation:
          "Rocks continuously transform over millions of years through cooling magma, weathering, compaction, heat, and tectonic pressure.",
        keyFacts: [
          "Rocks are made of one or more naturally occurring minerals.",
          "Sedimentary rocks often preserve ancient fossils and climate clues.",
          "Basalt and granite are classic igneous rocks formed from magma/lava.",
        ],
        relatedConcepts: ["Rock Cycle", "Minerals", "Plate Tectonics", "Weathering"],
        experimentIdea: "Inspect any stone with a magnifying lens or phone zoom to spot distinct crystal grains and color bands.",
        funQuestion: "What transforms a sedimentary rock into a metamorphic rock?",
        funAnswer: "Intense heat and pressure deep beneath Earth's surface without completely melting it.",
      },
      custom: {
        objectName: "Photographed Object (Preset Demo Sample)",
        discipline: "General Science",
        summary:
          "Demo Mode is active: this is a preset educational sample rather than live AI image recognition. Switch to Live AI Mode to analyze your real photo.",
        scientificExplanation:
          "Every everyday object obeys core laws of physics (force, light, energy), chemistry (atoms, bonds, materials), and biology/earth science.",
        keyFacts: [
          "Light reflecting off this object reaches your lens so we can observe its texture and color.",
          "All visible matter is composed of atoms bonded into molecules or crystal lattices.",
          "Live AI Mode uses multimodal vision to inspect the exact details in your captured photo.",
        ],
        relatedConcepts: ["Matter & Atoms", "Light Reflection", "Energy", "Observation"],
        experimentIdea: "Switch to Live AI Mode above and click Analyze Photo to inspect the exact scientific identity of your captured image.",
        funQuestion: "How does a camera capture the colors of the object in front of you?",
        funAnswer: "Sensors detect reflected red, green, and blue light photons coming from the object's surface.",
      },
    };
    return mapEn[presetKey];
  }

  const mapAr: Record<typeof presetKey, WorldDiscoveryResult> = {
    leaf: {
      objectName: "ورقة نبات خضراء (نموذج تجريبي مسبق)",
      discipline: "الأحياء والكيمياء الحيوية",
      summary: "مصنع طبيعي مصغّر يحوّل ضوء الشمس والماء وثاني أكسيد الكربون إلى غذاء وأكسجين.",
      scientificExplanation:
        "تحتوي الورقة على البلاستيدات الخضراء الغنية بصبغة الكلوروفيل التي تمتص الضوء الأحمر والأزرق وتعكس الأخضر، وتتبادل الغازات عبر الثغور المجهرية.",
      keyFacts: [
        "تعكس صبغة الكلوروفيل اللون الأخضر ولذلك نرى الأوراق خضراء.",
        "تنتج الأوراق الأكسجين اللازم لتنفس الكائنات الحية.",
        "تنقل عروق الورقة الماء والأملاح عبر الخشب، والسكريات عبر اللحاء.",
      ],
      relatedConcepts: ["البناء الضوئي", "البلاستيدة الخضراء", "الكلوروفيل", "الثغور"],
      experimentIdea: "ضع ورقة طازجة داخل كوب ماء في ضوء الشمس لمدة 20 دقيقة وراقب تشكّل فقاعات الأكسجين الصغيرة على سطحها!",
      funQuestion: "لماذا يبدو لون معظم أوراق النباتات أخضر لأعيننا؟",
      funAnswer: "لأن الكلوروفيل يمتص الأطوال الموجية الحمراء والزرقاء ويعكس الضوء الأخضر نحو أعيننا.",
    },
    water: {
      objectName: "كوب ماء وثلج (نموذج تجريبي مسبق)",
      discipline: "الكيمياء والفيزياء",
      summary: "تترابط جزيئات الماء القطبية (H2O) بروابط هيدروجينية تمنح الماء خصائص حرارية وكثافة فريدة.",
      scientificExplanation:
        "يتميز جزيء الماء بقطبية كهربائية تجعل الجزيئات تتجاذب فيما بينها، مما ينتج التوتر السطحي ويجعل الجليد أقل كثافة من الماء السائل.",
      keyFacts: [
        "يطفو الثلج لأن شبكته البلورية عند التجمد تشغل حجماً أكبر وكثافة أقل بحوالي 9%.",
        "الماء مذيب قطبي ممتاز يدخل في معظم التفاعلات الحيوية.",
        "التوتر السطحي يسمح لبعض الحشرات الخفيفة بالمشي على سطح الماء.",
      ],
      relatedConcepts: ["الروابط الهيدروجينية", "حالات المادة", "الكثافة", "القطبية"],
      experimentIdea: "جرّب وضع مشبك ورق معدني جاف برفق أفقياً على سطح ماء ساكن لتشاهد قوة التوتر السطحي وهو يحمله!",
      funQuestion: "لماذا يطفو مكعب الثلج فوق سطح الماء بدلاً من أن يغوص؟",
      funAnswer: "لأن الروابط الهيدروجينية ترتب الجزيئات في شبكة سداسية متباعدة عند التجمد فتقل كثافة الثلج عن الماء السائل.",
    },
    lamp: {
      objectName: "مصباح إضاءة (نموذج تجريبي مسبق)",
      discipline: "الفيزياء (الكهرباء والضوء)",
      summary: "يحوّل الطاقة الكهربائية إلى موجات كهرومغناطيسية مرئية تضيء المكان بكفاءة عالية.",
      scientificExplanation:
        "في مصابيح LED الحديثة، تمر الإلكترونات عبر شبه موصل فتطلق فوتونات ضوئية مباشرة دون الحاجة لتسخين سلك معدني إلى درجات عالية.",
      keyFacts: [
        "تستهلك مصابيح LED طاقة أقل بنسبة تصل إلى 80% مقارنة بالمصابيح التقليدية.",
        "يسير الضوء في الفراغ بسرعة تقارب 300 ألف كيلومتر في الثانية.",
        "الضوء الأبيض يتكون من مزيج ألوان الطيف المرئي السبعة.",
      ],
      relatedConcepts: ["الطاقة الكهربائية", "الفوتونات", "الطيف المرئي", "أشباه الموصلات"],
      experimentIdea: "وجّه ضوء المصباح بزاوية مائلة على ظهر قرص مدمج (CD) فوق ورقة بيضاء لتشاهد تحلل الضوء إلى ألوان الطيف!",
      funQuestion: "لماذا تبقى مصابيح LED أبرد بكثير من المصابيح السلكية القديمة؟",
      funAnswer: "لأنها تنتج الضوء مباشرة عبر انتقالات الإلكترونات في أشباه الموصلات وليس عبر تسخين فتيلة معدنية.",
    },
    rock: {
      objectName: "عينة صخرية طبيعية (نموذج تجريبي مسبق)",
      discipline: "الجيولوجيا وعلوم الأرض",
      summary: "تجمع طبيعي من المعادن يسجل تاريخ القشرة الأرضية عبر دورة الصخور المستمرة.",
      scientificExplanation:
        "تتشكل الصخور ناريةً من تبريد الصهارة، أو رسوبيةً من تراكم الفتات وضغطه، أو متحولةً بفعل الحرارة والضغط الشديدين في باطن الأرض.",
      keyFacts: [
        "يتكون الصخر عادةً من معدن واحد أو مجموعة معادن مترابطة.",
        "تحفظ الصخور الرسوبية الأحافير وتكشف مناخ الأرض القديم.",
        "البازلت والجرانيت من أشهر الصخور النارية على سطح الأرض.",
      ],
      relatedConcepts: ["دورة الصخور", "المعادن", "القشرة الأرضية", "التجوية والتعرية"],
      experimentIdea: "افحص أي حجر أو رمل تحت عدسة مكبرة أو تقريب كاميرا الهاتف لتلاحظ اختلاف أحجام البلورات وألوان المعادن فيه!",
      funQuestion: "ما العاملان الرئيسيان اللذان يحوّلان الصخر الرسوبي إلى صخر متحول؟",
      funAnswer: "الحرارة المرتفعة والضغط الشديد في أعماق الأرض دون انصهار كامل للصخر.",
    },
    custom: {
      objectName: "عنصر مُلتقط بالصورة (نموذج تجريبي عام)",
      discipline: "العلوم المتكاملة",
      summary:
        "الوضع التجريبي (Demo Mode) مفعّل حالياً: هذا شرح إرشادي نموذجي مسبق وليس تحليلاً فعلياً بالذكاء الاصطناعي لمحتوى صورتك.",
      scientificExplanation:
        "أي جسم حولنا يخضع لقوانين الفيزياء (الحركة والضوء والطاقة) والكيمياء (الذرات والروابط وتركيب المواد). فعّل «الذكاء الاصطناعي المباشر» لتحليل صورتك الحقيقية بدقة.",
      keyFacts: [
        "تظهر الألوان لأن سطح الجسم يمتص بعض الأطوال الموجية للضوء ويعكس الباقي.",
        "تتكون جميع المواد حولنا من ذرات وجزيئات متماسكة بروابط كيميائية.",
        "عند تفعيل الذكاء الاصطناعي المباشر يتم تحليل تفاصيل صورتك الفعلية فوراً.",
      ],
      relatedConcepts: ["المادة والذرات", "انعكاس الضوء", "الطاقة", "الملاحظة العلمية"],
      experimentIdea: "انتقل إلى وضع «الذكاء الاصطناعي المباشر» واضغط «تحليل الصورة علمياً» للتعرف الدقيق على ما صورته.",
      funQuestion: "كيف تصل صورة أي شيء أمامك إلى عدسة الكاميرا أو عينك؟",
      funAnswer: "عبر انعكاس فوتونات الضوء الساقط من المصدر الضوئي على سطح الجسم نحو العدسة.",
    },
  };

  return mapAr[presetKey];
}


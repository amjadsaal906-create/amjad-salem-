export type SubjectId =
  | "chemistry"
  | "physics"
  | "biology"
  | "geology"
  | "mathematics";

export type EducationStage = "elementary" | "middle" | "high";

export type UILanguage = "ar" | "en";

export type UserRole = "student" | "teacher";

export type StudentLevel = "beginner" | "intermediate" | "advanced";

export type ChatLanguage = "auto" | "ar" | "en";

export type SourcePolicy =
  | "lesson_only"
  | "lesson_plus_curriculum"
  | "open_scientific";

export type ChatActionMode =
  | "explain"
  | "example"
  | "exercise"
  | "diagnose_weakness"
  | "alternative_explanation"
  | "teacher_assist";

export type ThemeMode = "light" | "dark" | "high-contrast" | "sepia";

export type LearningAccommodation =
  | "visual_impairment"
  | "hearing_impairment"
  | "learning_difficulty"
  | "motor_keyboard";

export interface KnowledgeSource {
  id: string;
  title: string;
  category: string;
  content: string;
  enabled: boolean;
  sourceFileName?: string;
}

export interface ExtractedLessonAnalysis {
  concepts: string[];
  objectives: string[];
  tablesAndFiguresSummary: string[];
  keyFormulasOrRules: string[];
}

export interface SimulationControlDef {
  id: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
}

export interface QuizQuestion {
  id: string;
  concept: string;
  difficulty: "easy" | "medium" | "challenge";
  prompt: string;
  simplifiedPrompt: string;
  options: string[];
  correctIndex: number;
  hint: string;
  explanation: string;
  visualCue: string;
}

export interface LessonData {
  id: string;
  subjectId: SubjectId;
  title: string;
  subject: string;
  stage: EducationStage;
  gradeLevel: string;
  estimatedMinutes: number;
  summary: string;
  simplifiedSummary: string;
  diagramUrl: string;
  diagramTitle: string;
  diagramBaselineAlt: string;
  audioLessonScript: string;
  keySignTerms: string[];
  sources: KnowledgeSource[];
  extractedAnalysis?: ExtractedLessonAnalysis;
  simulationControls: SimulationControlDef[];
  quizQuestions: QuizQuestion[];
  isCustom?: boolean;
  prepTemplateId?: string;
  bookId?: string;
  pageRange?: string;
  updatedAt?: string;
}

export interface PreparationTemplate {
  id: string;
  subjectScope: SubjectId | "all";
  templateName: string;
  sourceFileName: string;
  institutionOrSchool: string;
  requiredSections: string[];
  rawStructureText: string;
  presentationMappingGuidelines: string;
  customInstructions: string;
  updatedAt: string;
}

export interface LessonPlanData {
  lessonTitle: string;
  subject: string;
  stage: string;
  gradeLevel: string;
  durationMinutes: number;
  templateNameUsed?: string;
  objectives: string[];
  warmUp: string;
  teachingStrategies: string[];
  learningActivities: string[];
  resourcesAndMedia: string[];
  assessment: string;
  homework: string;
  differentiationAndInclusion: string;
  customFormFields?: Array<{ sectionName: string; content: string }>;
}

export interface PresentationSlide {
  slideNumber: number;
  slideType: "title" | "objectives" | "concept" | "diagram" | "example" | "interactive_quiz" | "summary";
  title: string;
  subtitle?: string;
  bullets: string[];
  speakerNotes: string;
  visualNote?: string;
  quizQuestion?: string;
  quizOptions?: string[];
  quizAnswerIndex?: number;
}

export interface PresentationDeckData {
  deckTitle: string;
  subject: string;
  gradeLevel: string;
  themeAccent: string;
  templateNameUsed?: string;
  slides: PresentationSlide[];
}

export interface VideoScene {
  sceneNumber: number;
  title: string;
  narration: string;
  subtitleText: string;
  visualCue: string;
  durationSec: number;
}

export interface VideoProjectData {
  videoTitle: string;
  style: "educational_explainer" | "lab_story" | "exam_review";
  presenterPersona: "science_mentor" | "friendly_guide" | "academic_professor";
  language: "ar" | "en";
  fullScript: string;
  scenes: VideoScene[];
}

export interface KahootQuestion {
  id: string;
  questionType: "mcq" | "true_false" | "higher_order";
  question: string;
  options: string[];
  correctIndex: number;
  timeLimitSec: number;
  points: number;
  explanation: string;
}

export interface KahootQuizData {
  quizTitle: string;
  lessonTitle: string;
  questions: KahootQuestion[];
}

export interface QuizParticipant {
  id: string;
  name: string;
  avatarId?: string;
  score: number;
  correctCount: number;
  answeredCount: number;
  answeredCurrent?: boolean;
}

export interface QuizSessionReport {
  roomCode: string;
  quizTitle: string;
  lessonId: string;
  totalQuestions: number;
  participants: QuizParticipant[];
  questionAccuracy: Array<{
    question: string;
    correctRate: number;
    totalAnswered: number;
  }>;
  finishedAt: string;
}

export interface WorksheetData {
  worksheetTitle: string;
  subject: string;
  gradeLevel: string;
  studentInstructions: string;
  variedQuestions: Array<{ question: string; answer: string }>;
  practicalActivity: { title: string; steps: string[]; expectedOutcome: string };
  fillInBlanks: Array<{ sentence: string; missingWord: string }>;
  matchingPairs: Array<{ leftItem: string; rightMatch: string }>;
  classificationTask: { prompt: string; categories: Array<{ categoryName: string; items: string[] }> };
  problemSolving: Array<{ problem: string; solutionSteps: string; finalAnswer: string }>;
  higherOrderThinking: Array<{ question: string; modelAnswer: string }>;
}

export interface WeakSpot {
  concept: string;
  observation: string;
  suggestedRemediation: string;
  detectedAt: string;
}

export interface SourceCitation {
  sourceTitle: string;
  excerptUsed: string;
  withinApprovedSources: boolean;
}

export interface QuickExercise {
  question: string;
  options: string[];
  correctIndex: number;
  hint: string;
  explanation: string;
}

export interface ChatMessage {
  id: string;
  sender: "user" | "assistant";
  roleContext: UserRole;
  text: string;
  timestamp: string;
  inputMode?: "text" | "voice";
  languageUsed?: ChatLanguage;
  citations?: SourceCitation[];
  alternativeExplanation?: string;
  detectedWeakSpots?: Array<{
    concept: string;
    observation: string;
    suggestedRemediation: string;
  }>;
  quickExercise?: QuickExercise;
  remedialQuestions?: QuickExercise[];
  followUpSuggestions?: string[];
  outOfScopeNotice?: string;
  isDemoPreset?: boolean;
  isAiGenerated?: boolean;
}

export interface SimplifiedStep {
  stepNumber: number;
  title: string;
  simpleSentence: string;
  visualCue: string;
  checkQuestion: string;
}

export interface ImageDescriptionResult {
  shortAlt: string;
  detailedSpatialDescription: string;
  scientificComponents: string[];
  keyTakeaway: string;
}

export interface TimedCaption {
  startSec: number;
  endSec: number;
  text: string;
}

export interface AccessibilitySettings {
  theme: ThemeMode;
  fontScale: number;
  lineHeight: number;
  letterSpacing: number;
  wordSpacing: number;
  simplifiedMode: boolean;
  readingRuler: boolean;
  reduceMotion: boolean;
  autoReadResponses: boolean;
  speechRate: number;
  captionsEnabled: boolean;
  keyboardHintsVisible: boolean;
  accommodations: LearningAccommodation[];
  aiProcessingConsent: boolean;
}

export interface PlatformCapabilities {
  geminiConfigured: boolean;
  databaseEngine: string;
  realtimeEngine: string;
  models: {
    chatAndVision: string;
    tts: string;
    stt: string;
    veoVideo: string;
  };
  signLanguageExternalService: {
    configured: boolean;
    providerName: string | null;
    statusMessage: string;
    requiredEnvVars: string[];
  };
}

export interface DailyScienceFact {
  date: string;
  discipline: string;
  headline: string;
  fact: string;
  whyItMatters: string;
  quickPrompt: string;
  lang: UILanguage;
  cached?: boolean;
}

export interface BookLessonEntry {
  id: string;
  lessonNumber: string;
  title: string;
  startPage: number;
  endPage: number;
  summary: string;
  objectives: string[];
  keyConcepts: string[];
  contentExcerpt: string;
}

export interface BookChapter {
  id: string;
  chapterNumber: string;
  chapterTitle: string;
  startPage: number;
  endPage: number;
  lessons: BookLessonEntry[];
}

export interface BookUnit {
  id: string;
  unitNumber: string;
  unitTitle: string;
  startPage: number;
  endPage: number;
  chapters: BookChapter[];
}

export interface BookRecord {
  id: string;
  subjectId: SubjectId;
  subjectName: string;
  stage: EducationStage;
  gradeLevel: string;
  title: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  storagePath: string;
  totalPagesEstimated: number;
  bookSummary: string;
  analysisStatus: "pending" | "analyzing" | "indexed" | "error";
  analysisError?: string;
  units: BookUnit[];
  uploadedAt: string;
  updatedAt: string;
}

// ==========================================
// AI Understanding Radar (رادار الفهم الذكي)
// ==========================================

export type RadarQuestionType =
  | "mcq"
  | "true_false"
  | "short_answer"
  | "applied"
  | "misconception";

export type RadarDifficulty = "easy" | "medium" | "hard" | "mixed";

export type RadarCognitiveLevel =
  | "understanding"
  | "application"
  | "analysis"
  | "misconception_check";

export interface RadarQuestion {
  id: string;
  questionType: RadarQuestionType;
  cognitiveLevel: RadarCognitiveLevel;
  difficulty: "easy" | "medium" | "hard";
  concept: string;
  objective: string;
  misconceptionTarget?: string;
  question: string;
  options: string[];
  correctIndex: number;
  acceptableAnswers?: string[];
  timeLimitSec: number;
  explanation: string;
  hint: string;
  isVerification?: boolean;
  interventionId?: string;
}

export interface RadarStudentAnswerRecord {
  questionId: string;
  concept: string;
  isCorrect: boolean;
  chosenIndex?: number;
  textAnswer?: string;
  answeredAt: string;
  isPostIntervention?: boolean;
}

export interface RadarStudentProfile {
  id: string;
  name: string;
  joinedAt: string;
  connected: boolean;
  answeredCurrent: boolean;
  answeredCount: number;
  correctCount: number;
  understandingPct: number;
  masteredConcepts: string[];
  needsSupportConcepts: string[];
  overcameConcepts: string[];
  answers: RadarStudentAnswerRecord[];
}

export interface RadarConceptStat {
  concept: string;
  totalAnswers: number;
  correctAnswers: number;
  understandingPct: number;
  status: "mastered" | "developing" | "needs_intervention";
  commonMisconception?: string;
}

export interface RadarQuestionStat {
  questionId: string;
  totalAnswered: number;
  correctCount: number;
  wrongCount: number;
  understandingPct: number;
  optionCounts: number[];
  sampleWrongTextAnswers: string[];
}

export interface RadarInterventionStrategy {
  id: string;
  strategyType:
    | "re_explain"
    | "simplified_example"
    | "analogy"
    | "mini_activity"
    | "scaffolded_steps";
  title: string;
  teacherScript: string;
  studentFacingExplanation: string;
  practicalExample: string;
  estimatedMinutes: number;
}

export interface RadarInterventionImpact {
  interventionId: string;
  concept: string;
  beforePct: number;
  afterPct: number | null;
  deltaPct: number | null;
  beforeSampleSize: number;
  afterSampleSize: number;
  overcameCount: number;
  stillNeedsSupportCount: number;
  stillNeedsSupportNames: string[];
  summaryText: string;
}

export interface RadarInterventionRecord {
  id: string;
  concept: string;
  triggeredAt: string;
  beforePct: number;
  selectedStrategy: RadarInterventionStrategy;
  verificationQuestion: RadarQuestion;
  verificationLaunched: boolean;
  impact?: RadarInterventionImpact;
}

export interface RadarSessionSnapshot {
  roomCode: string;
  subjectId: string;
  subjectName: string;
  gradeLevel: string;
  lessonTopic: string;
  lessonId?: string;
  interventionThresholdPct: number;
  status: "lobby" | "question" | "reveal" | "intervention" | "finished";
  currentQuestionIndex: number;
  totalQuestions: number;
  questionStartedAt: number;
  currentQuestion: RadarQuestion | null;
  allQuestions: RadarQuestion[];
  studentCount: number;
  answeredCurrentCount: number;
  waitingCurrentCount: number;
  overallUnderstandingPct: number;
  currentQuestionStat: RadarQuestionStat | null;
  questionStats: RadarQuestionStat[];
  conceptStats: RadarConceptStat[];
  masteredConcepts: string[];
  needsReteachingConcepts: string[];
  topMisconceptions: Array<{
    concept: string;
    label: string;
    count: number;
    pct: number;
  }>;
  studentProfiles: RadarStudentProfile[];
  activeInterventionBanner: {
    id: string;
    concept: string;
    title: string;
    explanation: string;
    example: string;
    sentAt: string;
  } | null;
  interventionHistory: RadarInterventionRecord[];
  createdAt: string;
  finishedAt?: string;
}

export interface RadarSavedReport {
  id: string;
  roomCode: string;
  subjectId: string;
  subjectName: string;
  gradeLevel: string;
  lessonTopic: string;
  overallAccuracy: number;
  studentCount: number;
  interventionCount: number;
  snapshot: RadarSessionSnapshot;
  createdAt: string;
  updatedAt: string;
}



export interface SignTermEntry {
  term: string;
  english: string;
  handshape: string;
  movement: string;
  facialExpression: string;
  fingerspelling: string[];
  visualMotif: "sun" | "water" | "oxygen" | "cell" | "heart" | "atom" | "bond" | "energy";
}

export const SIGN_LANGUAGE_GLOSSARY: Record<string, SignTermEntry> = {
  "ضوء": {
    term: "ضوء / إضاءة",
    english: "Light",
    handshape: "أصابع مضمومة تفتح فجأة للأمام",
    movement: "تبدأ اليد مغلقة قرب الرأس أو الأعلى ثم تنفتح الأصابع باتجاه الأسفل كالأشعة",
    facialExpression: "توسيع العينين قليلاً للدلالة على السطوع",
    fingerspelling: ["ض", "و", "ء"],
    visualMotif: "sun",
  },
  "ماء": {
    term: "ماء",
    english: "Water",
    handshape: "الأصابع الثلاثة الوسطى ممدودة (حرف W إشارياً) أو راحة اليد مقعرة",
    movement: "ملامسة خفيفة قرب الذقن مع حركة موجية أفقية أمام الصدر للدلالة على السائل",
    facialExpression: "تعبيرات محايدة هادئة",
    fingerspelling: ["م", "ا", "ء"],
    visualMotif: "water",
  },
  "أكسجين": {
    term: "أكسجين (O₂)",
    english: "Oxygen",
    handshape: "تشكيل دائرة بالإبهام والسبابة (حرف O)",
    movement: "حركة تنفسية بطيئة أمام الأنف والصدر مع إشارة الرقم ٢",
    facialExpression: "شهيق لطيف يرافق الإشارة",
    fingerspelling: ["أ", "ك", "س", "ج", "ي", "ن"],
    visualMotif: "oxygen",
  },
  "خلية": {
    term: "خلية",
    english: "Cell",
    handshape: "كلتا اليدين تشكلان نصف دائرة متقابلة كوعاء صغير",
    movement: "تقريب اليدين لتشكيل دائرة مغلقة ثم تحريك السبابة في مركزها كإشارة للنواة",
    facialExpression: "تركيز بصري نحو مركز اليدين",
    fingerspelling: ["خ", "ل", "ي", "ة"],
    visualMotif: "cell",
  },
  "طاقة": {
    term: "طاقة",
    english: "Energy",
    handshape: "اليدان ممدودتان بخط مستقيم ومتوازي",
    movement: "حركة صاعدة سريعة ومتذبذبة للأعلى تدل على النشاط والحيوية",
    facialExpression: "تعبير حيوي نشط",
    fingerspelling: ["ط", "ا", "ق", "ة"],
    visualMotif: "energy",
  },
  "قلب": {
    term: "قلب",
    english: "Heart",
    handshape: "اليد اليمنى مقبوضة برفق على الجانب الأيسر من الصدر",
    movement: "نبضتان متتاليتان (فتح وغلق خفيف لقبضة اليد) فوق موضع القلب",
    facialExpression: "تعبيرات هادئة متزامنة مع النبض",
    fingerspelling: ["ق", "ل", "ب"],
    visualMotif: "heart",
  },
  "ضغط": {
    term: "ضغط",
    english: "Pressure",
    handshape: "راحتا اليدين متقابلتان مفتوحتان",
    movement: "دفع اليد العليا للأسفل باتجاه اليد السفلى مع مقاومة خفيفة",
    facialExpression: "شد خفيف في الحاجبين لإظهار القوة",
    fingerspelling: ["ض", "غ", "ط"],
    visualMotif: "oxygen",
  },
  "ذرة": {
    term: "ذرة",
    english: "Atom",
    handshape: "إبهام وسبابة اليد اليسرى يمسكان نقطة مركزية، واليمنى تدور حولها",
    movement: "دوران سريع بالسبابة اليمنى في مسار بيضاوي حول المركز الثابت",
    facialExpression: "نظرة متابعة لحركة الإلكترون",
    fingerspelling: ["ذ", "ر", "ة"],
    visualMotif: "atom",
  },
  "رابطة": {
    term: "رابطة كيميائية",
    english: "Chemical Bond",
    handshape: "تشابك الإبهام والسبابة في كلتا اليدين كحلقتي سلسلة",
    movement: "ربط الحلقتين معاً بثبات أمام الصدر ثم سحبهما قليلاً لإثبات التماسك",
    facialExpression: "إيماءة ثبات",
    fingerspelling: ["ر", "ا", "ب", "ط", "ة"],
    visualMotif: "bond",
  },
  "شحنة": {
    term: "شحنة كهربائية",
    english: "Electric Charge",
    handshape: "السبابة ممدودة مع إبراز علامة زائد أو ناقص باليد الأخرى",
    movement: "حركة خاطفة متقاطعة بين السبابتين كشرارة",
    facialExpression: "انتباه سريع",
    fingerspelling: ["ش", "ح", "ن", "ة"],
    visualMotif: "energy",
  },
};

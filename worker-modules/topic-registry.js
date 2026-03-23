// Topic registry with weighted random selection
// Focused on exam prep, language learning, and actionable study content
// that real students and test-takers actually search for.

const CATEGORIES = [
  // ────────────────────────────────────────────
  // TIER 1: Highest priority — exam & language (weight 10-12)
  // ────────────────────────────────────────────
  {
    name: 'English Proficiency Tests',
    weight: 12,
    subtopics: [
      {
        id: 'toeic-strategy',
        titleHint: 'TOEIC Score Improvement Strategy',
        keywords: ['TOEIC', 'TOEIC score', 'TOEIC tips', 'business English', 'TOEIC listening'],
        tags: ['toeic', 'exam-prep', 'english'],
        audience: 'job seekers and professionals preparing for TOEIC',
      },
      {
        id: 'toeic-part5-grammar',
        titleHint: 'TOEIC Part 5 Grammar Patterns',
        keywords: ['TOEIC Part 5', 'grammar', 'sentence completion', 'TOEIC reading'],
        tags: ['toeic', 'grammar', 'exam-prep'],
        audience: 'TOEIC test takers targeting 700+ score',
      },
      {
        id: 'toeic-listening',
        titleHint: 'TOEIC Listening Section Tactics',
        keywords: ['TOEIC listening', 'Part 1', 'Part 2', 'Part 3', 'Part 4', 'audio comprehension'],
        tags: ['toeic', 'listening', 'exam-prep'],
        audience: 'TOEIC test takers struggling with listening',
      },
      {
        id: 'toefl-strategy',
        titleHint: 'TOEFL iBT Study Plan',
        keywords: ['TOEFL', 'TOEFL iBT', 'academic English', 'TOEFL writing', 'TOEFL speaking'],
        tags: ['toefl', 'exam-prep', 'english'],
        audience: 'students applying to English-speaking universities',
      },
      {
        id: 'toefl-writing',
        titleHint: 'TOEFL Writing — Integrated & Independent Essays',
        keywords: ['TOEFL writing', 'essay structure', 'academic writing', 'TOEFL integrated'],
        tags: ['toefl', 'writing', 'exam-prep'],
        audience: 'TOEFL test takers targeting 100+ score',
      },
      {
        id: 'ielts-strategy',
        titleHint: 'IELTS Band Score Improvement',
        keywords: ['IELTS', 'IELTS band', 'IELTS academic', 'IELTS general', 'IELTS speaking'],
        tags: ['ielts', 'exam-prep', 'english'],
        audience: 'students and immigrants preparing for IELTS',
      },
      {
        id: 'ielts-speaking',
        titleHint: 'IELTS Speaking — Parts 1, 2, 3 Tips',
        keywords: ['IELTS speaking', 'cue card', 'fluency', 'pronunciation score'],
        tags: ['ielts', 'speaking', 'exam-prep'],
        audience: 'IELTS candidates aiming for band 7+',
      },
    ],
  },
  {
    name: 'English Vocabulary & Grammar',
    weight: 10,
    subtopics: [
      {
        id: 'english-vocabulary-building',
        titleHint: 'English Vocabulary Expansion with Flashcards',
        keywords: ['English vocabulary', 'word lists', 'flashcards', 'memorization', 'word roots'],
        tags: ['vocabulary', 'english', 'flashcards'],
        audience: 'English learners at intermediate to advanced level',
      },
      {
        id: 'english-phrasal-verbs',
        titleHint: 'Essential Phrasal Verbs for Fluency',
        keywords: ['phrasal verbs', 'English idioms', 'conversational English', 'native expressions'],
        tags: ['phrasal-verbs', 'english', 'vocabulary'],
        audience: 'English learners wanting to sound more natural',
      },
      {
        id: 'english-grammar-essentials',
        titleHint: 'English Grammar Rules That Matter Most',
        keywords: ['English grammar', 'tenses', 'articles', 'prepositions', 'common mistakes'],
        tags: ['grammar', 'english', 'study-tips'],
        audience: 'English learners making frequent grammar errors',
      },
      {
        id: 'business-english',
        titleHint: 'Business English for the Workplace',
        keywords: ['business English', 'email writing', 'meeting vocabulary', 'presentation English'],
        tags: ['business-english', 'vocabulary', 'professional'],
        audience: 'professionals using English at work',
      },
      {
        id: 'english-collocations',
        titleHint: 'English Collocations Every Learner Should Know',
        keywords: ['collocations', 'word combinations', 'natural English', 'academic collocations'],
        tags: ['collocations', 'english', 'vocabulary'],
        audience: 'intermediate English learners improving naturalness',
      },
    ],
  },
  {
    name: 'Other Language Learning',
    weight: 10,
    subtopics: [
      {
        id: 'japanese-jlpt',
        titleHint: 'JLPT N3/N2/N1 Study Strategy',
        keywords: ['JLPT', 'Japanese', 'kanji', 'N2', 'N1', 'Japanese vocabulary'],
        tags: ['jlpt', 'japanese', 'exam-prep'],
        audience: 'Japanese language learners preparing for JLPT',
      },
      {
        id: 'japanese-kanji',
        titleHint: 'Kanji Memorization with Spaced Repetition',
        keywords: ['kanji', 'radicals', 'stroke order', 'kanji mnemonics', 'Japanese writing'],
        tags: ['kanji', 'japanese', 'memorization'],
        audience: 'Japanese learners struggling with kanji',
      },
      {
        id: 'chinese-hsk',
        titleHint: 'HSK Exam Preparation Guide',
        keywords: ['HSK', 'Chinese', 'Mandarin', 'hanzi', 'Chinese vocabulary', 'HSK 4'],
        tags: ['hsk', 'chinese', 'exam-prep'],
        audience: 'Chinese language learners preparing for HSK',
      },
      {
        id: 'chinese-characters',
        titleHint: 'Chinese Character Learning Methods',
        keywords: ['Chinese characters', 'hanzi', 'radicals', 'character components', 'writing practice'],
        tags: ['hanzi', 'chinese', 'memorization'],
        audience: 'beginners and intermediate Chinese learners',
      },
      {
        id: 'korean-topik',
        titleHint: 'TOPIK Study Guide & Vocabulary',
        keywords: ['TOPIK', 'Korean', 'Korean vocabulary', 'TOPIK II', 'Korean grammar'],
        tags: ['topik', 'korean', 'exam-prep'],
        audience: 'Korean language learners preparing for TOPIK',
      },
      {
        id: 'spanish-dele',
        titleHint: 'Spanish DELE Exam Preparation',
        keywords: ['DELE', 'Spanish', 'Spanish vocabulary', 'conjugation', 'Spanish grammar'],
        tags: ['dele', 'spanish', 'exam-prep'],
        audience: 'Spanish language learners',
      },
      {
        id: 'second-language-tips',
        titleHint: 'How to Learn Any Language with Flashcards',
        keywords: ['language learning', 'polyglot', 'flashcard method', 'vocabulary retention'],
        tags: ['language-learning', 'flashcards', 'study-tips'],
        audience: 'anyone starting a new language',
      },
    ],
  },
  {
    name: 'College Entrance Exams',
    weight: 10,
    subtopics: [
      {
        id: 'suneung-korean',
        titleHint: '수능 국어 독해 전략',
        keywords: ['수능', '국어', '비문학', '문학', '독해력', 'CSAT Korean'],
        tags: ['suneung', 'korean-exam', 'reading'],
        audience: 'Korean high school students preparing for 수능 국어',
      },
      {
        id: 'suneung-english',
        titleHint: '수능 영어 고득점 공략법',
        keywords: ['수능 영어', '영어 독해', '빈칸 추론', '수능 어휘', 'CSAT English'],
        tags: ['suneung', 'english', 'exam-prep'],
        audience: 'Korean students targeting 수능 영어 1등급',
      },
      {
        id: 'suneung-math',
        titleHint: '수능 수학 킬러 문제 접근법',
        keywords: ['수능 수학', '미적분', '확률과 통계', '킬러 문항', 'CSAT math'],
        tags: ['suneung', 'math', 'exam-prep'],
        audience: 'Korean students preparing for 수능 수학',
      },
      {
        id: 'sat-strategy',
        titleHint: 'SAT Reading & Writing Strategies',
        keywords: ['SAT', 'SAT reading', 'SAT writing', 'college admission', 'test prep'],
        tags: ['sat', 'exam-prep', 'college'],
        audience: 'high school students preparing for SAT',
      },
      {
        id: 'sat-math',
        titleHint: 'SAT Math — Key Concepts & Problem Types',
        keywords: ['SAT math', 'algebra', 'geometry', 'data analysis', 'SAT problem solving'],
        tags: ['sat', 'math', 'exam-prep'],
        audience: 'students targeting SAT 1500+',
      },
      {
        id: 'act-prep',
        titleHint: 'ACT vs SAT — Which to Take & How to Prepare',
        keywords: ['ACT', 'ACT prep', 'ACT science', 'ACT English', 'college entrance'],
        tags: ['act', 'exam-prep', 'college'],
        audience: 'high school students deciding between ACT and SAT',
      },
    ],
  },

  // ────────────────────────────────────────────
  // TIER 2: Graduate & professional exams (weight 8)
  // ────────────────────────────────────────────
  {
    name: 'Graduate School Exams',
    weight: 8,
    subtopics: [
      {
        id: 'gre-verbal',
        titleHint: 'GRE Verbal — Vocabulary & Reading Strategies',
        keywords: ['GRE', 'GRE verbal', 'GRE vocabulary', 'text completion', 'sentence equivalence'],
        tags: ['gre', 'exam-prep', 'graduate-school'],
        audience: 'graduate school applicants',
      },
      {
        id: 'gre-quant',
        titleHint: 'GRE Quantitative — Math Review & Shortcuts',
        keywords: ['GRE quant', 'GRE math', 'quantitative reasoning', 'data interpretation'],
        tags: ['gre', 'math', 'exam-prep'],
        audience: 'GRE test takers improving quant scores',
      },
      {
        id: 'gmat-prep',
        titleHint: 'GMAT Preparation — Verbal & Quant',
        keywords: ['GMAT', 'MBA', 'business school', 'GMAT verbal', 'GMAT quant'],
        tags: ['gmat', 'exam-prep', 'mba'],
        audience: 'MBA applicants preparing for GMAT',
      },
      {
        id: 'lsat-prep',
        titleHint: 'LSAT Logical Reasoning & Reading Comp',
        keywords: ['LSAT', 'law school', 'logical reasoning', 'reading comprehension', 'logic games'],
        tags: ['lsat', 'law', 'exam-prep'],
        audience: 'law school applicants',
      },
      {
        id: 'mcat-prep',
        titleHint: 'MCAT Study Plan & Content Review',
        keywords: ['MCAT', 'medical school', 'biology', 'chemistry', 'CARS', 'MCAT prep'],
        tags: ['mcat', 'medical', 'exam-prep'],
        audience: 'pre-med students preparing for MCAT',
      },
    ],
  },
  {
    name: 'Professional Certification',
    weight: 8,
    subtopics: [
      {
        id: 'cpa-exam',
        titleHint: 'CPA Exam — Study Schedule & Section Tips',
        keywords: ['CPA', 'CPA exam', 'accounting', 'FAR', 'AUD', 'REG', 'BEC'],
        tags: ['cpa', 'accounting', 'professional-cert'],
        audience: 'accounting professionals pursuing CPA',
      },
      {
        id: 'cfa-exam',
        titleHint: 'CFA Level I/II/III Preparation',
        keywords: ['CFA', 'CFA exam', 'finance', 'investment', 'portfolio management'],
        tags: ['cfa', 'finance', 'professional-cert'],
        audience: 'finance professionals pursuing CFA charter',
      },
      {
        id: 'aws-certification',
        titleHint: 'AWS Certification Study with Flashcards',
        keywords: ['AWS', 'cloud computing', 'AWS certification', 'Solutions Architect', 'cloud'],
        tags: ['aws', 'it-cert', 'technology'],
        audience: 'IT professionals pursuing AWS certification',
      },
      {
        id: 'pmp-certification',
        titleHint: 'PMP Exam — PMBOK Concepts & Formulas',
        keywords: ['PMP', 'project management', 'PMBOK', 'agile', 'PMI'],
        tags: ['pmp', 'project-management', 'professional-cert'],
        audience: 'project managers pursuing PMP',
      },
      {
        id: 'bar-exam',
        titleHint: 'Bar Exam — MBE Subjects & Essay Strategy',
        keywords: ['bar exam', 'MBE', 'law', 'constitutional law', 'contracts', 'torts'],
        tags: ['bar-exam', 'law', 'exam-prep'],
        audience: 'law graduates preparing for the bar exam',
      },
      {
        id: 'nursing-nclex',
        titleHint: 'NCLEX-RN Study Tips & Content Areas',
        keywords: ['NCLEX', 'nursing', 'NCLEX-RN', 'pharmacology', 'patient care'],
        tags: ['nclex', 'nursing', 'exam-prep'],
        audience: 'nursing students preparing for NCLEX',
      },
    ],
  },

  // ────────────────────────────────────────────
  // TIER 2: Medical & science subjects (weight 7)
  // ────────────────────────────────────────────
  {
    name: 'Medical & Science Study',
    weight: 7,
    subtopics: [
      {
        id: 'anatomy-memorization',
        titleHint: 'Anatomy — Memorizing Muscles, Bones & Organs',
        keywords: ['anatomy', 'human body', 'medical studies', 'muscle memorization', 'skeletal system'],
        tags: ['anatomy', 'medical', 'memorization'],
        audience: 'medical, nursing, and physical therapy students',
      },
      {
        id: 'pharmacology-flashcards',
        titleHint: 'Pharmacology — Drug Classes & Mechanisms',
        keywords: ['pharmacology', 'drug classes', 'mechanisms of action', 'side effects', 'mnemonics'],
        tags: ['pharmacology', 'medical', 'flashcards'],
        audience: 'pharmacy and medical students',
      },
      {
        id: 'biology-key-concepts',
        titleHint: 'Biology Exam — Cell Biology & Genetics',
        keywords: ['biology', 'cell biology', 'genetics', 'DNA', 'mitosis', 'AP biology'],
        tags: ['biology', 'science', 'exam-prep'],
        audience: 'biology students preparing for exams',
      },
      {
        id: 'chemistry-formulas',
        titleHint: 'Chemistry — Formulas & Reactions to Memorize',
        keywords: ['chemistry', 'chemical formulas', 'reactions', 'organic chemistry', 'periodic table'],
        tags: ['chemistry', 'science', 'memorization'],
        audience: 'chemistry students at high school or university level',
      },
    ],
  },

  // ────────────────────────────────────────────
  // TIER 3: Study methods (weight 5 — supportive, not dominant)
  // ────────────────────────────────────────────
  {
    name: 'Study Methods & Productivity',
    weight: 5,
    subtopics: [
      {
        id: 'spaced-repetition',
        titleHint: 'Spaced Repetition — The Science of Long-Term Memory',
        keywords: ['spaced repetition', 'SRS', 'forgetting curve', 'memory retention'],
        tags: ['spaced-repetition', 'memory', 'learning-science'],
        audience: 'students discovering spaced repetition for the first time',
      },
      {
        id: 'active-recall',
        titleHint: 'Active Recall — Why Testing Beats Re-Reading',
        keywords: ['active recall', 'retrieval practice', 'testing effect', 'study method'],
        tags: ['active-recall', 'study-techniques', 'learning-science'],
        audience: 'students seeking evidence-based study methods',
      },
      {
        id: 'pomodoro-technique',
        titleHint: 'Pomodoro Technique for Exam Season',
        keywords: ['pomodoro', 'time management', 'focus', 'study schedule'],
        tags: ['pomodoro', 'productivity', 'study-tips'],
        audience: 'students managing exam preparation schedules',
      },
      {
        id: 'flashcard-creation',
        titleHint: 'How to Create Effective Flashcards',
        keywords: ['flashcards', 'card creation', 'study tips', 'effective flashcards', 'card design'],
        tags: ['flashcards', 'study-tips', 'learning-science'],
        audience: 'new flashcard users wanting to study more effectively',
      },
      {
        id: 'exam-anxiety',
        titleHint: 'Managing Test Anxiety & Exam Stress',
        keywords: ['test anxiety', 'exam stress', 'performance anxiety', 'study confidence'],
        tags: ['exam-anxiety', 'mental-health', 'exam-prep'],
        audience: 'students experiencing test anxiety',
      },
      {
        id: 'study-planning',
        titleHint: 'Building a Study Schedule That Actually Works',
        keywords: ['study plan', 'study schedule', 'exam timeline', 'goal setting'],
        tags: ['planning', 'study-tips', 'productivity'],
        audience: 'students who need structure in their study routine',
      },
    ],
  },
]

export function selectTopic(recentSubtopicIds = []) {
  const recentSet = new Set(recentSubtopicIds)

  // Build weighted pool excluding recently used subtopics
  const pool = []
  for (const category of CATEGORIES) {
    const available = category.subtopics.filter((s) => !recentSet.has(s.id))
    if (available.length === 0) continue

    for (let i = 0; i < category.weight; i++) {
      pool.push({ category: category.name, subtopics: available })
    }
  }

  // Fallback: if all subtopics were recently used, use everything
  if (pool.length === 0) {
    for (const category of CATEGORIES) {
      for (let i = 0; i < category.weight; i++) {
        pool.push({ category: category.name, subtopics: category.subtopics })
      }
    }
  }

  const entry = pool[Math.floor(Math.random() * pool.length)]
  const subtopic = entry.subtopics[Math.floor(Math.random() * entry.subtopics.length)]

  return {
    category: entry.category,
    ...subtopic,
  }
}

export function getAllSubtopicIds() {
  return CATEGORIES.flatMap((c) => c.subtopics.map((s) => s.id))
}

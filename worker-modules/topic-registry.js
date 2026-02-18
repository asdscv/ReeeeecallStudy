// Topic registry with weighted random selection

const CATEGORIES = [
  {
    name: 'Learning Science',
    weight: 9,
    subtopics: [
      {
        id: 'spaced-repetition',
        titleHint: 'Spaced Repetition',
        keywords: ['spaced repetition', 'SRS', 'memory retention', 'forgetting curve'],
        tags: ['spaced-repetition', 'memory', 'learning-science'],
        audience: 'students and lifelong learners',
      },
      {
        id: 'active-recall',
        titleHint: 'Active Recall',
        keywords: ['active recall', 'retrieval practice', 'testing effect'],
        tags: ['active-recall', 'study-techniques', 'learning-science'],
        audience: 'students seeking effective study methods',
      },
      {
        id: 'metacognition',
        titleHint: 'Metacognition',
        keywords: ['metacognition', 'self-regulated learning', 'learning strategies'],
        tags: ['metacognition', 'self-learning', 'learning-science'],
        audience: 'learners who want to study smarter',
      },
      {
        id: 'interleaving',
        titleHint: 'Interleaving Practice',
        keywords: ['interleaving', 'mixed practice', 'varied practice'],
        tags: ['interleaving', 'study-techniques', 'learning-science'],
        audience: 'students and educators',
      },
      {
        id: 'elaboration',
        titleHint: 'Elaborative Learning',
        keywords: ['elaboration', 'deep processing', 'meaningful learning'],
        tags: ['elaboration', 'deep-learning', 'learning-science'],
        audience: 'students seeking deeper understanding',
      },
    ],
  },
  {
    name: 'Language Learning',
    weight: 8,
    subtopics: [
      {
        id: 'vocabulary-acquisition',
        titleHint: 'Vocabulary Building',
        keywords: ['vocabulary', 'word acquisition', 'flashcards', 'memorization'],
        tags: ['vocabulary', 'language-learning', 'flashcards'],
        audience: 'language learners at any level',
      },
      {
        id: 'grammar-mastery',
        titleHint: 'Grammar Mastery',
        keywords: ['grammar', 'syntax', 'language structure', 'grammar rules'],
        tags: ['grammar', 'language-learning', 'study-tips'],
        audience: 'intermediate language learners',
      },
      {
        id: 'listening-skills',
        titleHint: 'Listening Comprehension',
        keywords: ['listening', 'comprehension', 'audio learning', 'podcasts'],
        tags: ['listening', 'language-learning', 'comprehension'],
        audience: 'language learners improving comprehension',
      },
      {
        id: 'pronunciation',
        titleHint: 'Pronunciation Training',
        keywords: ['pronunciation', 'phonetics', 'accent', 'speaking'],
        tags: ['pronunciation', 'speaking', 'language-learning'],
        audience: 'language learners focused on speaking',
      },
    ],
  },
  {
    name: 'Exam Preparation',
    weight: 7,
    subtopics: [
      {
        id: 'sat-act',
        titleHint: 'SAT/ACT Prep',
        keywords: ['SAT', 'ACT', 'college admission', 'test prep'],
        tags: ['sat', 'act', 'exam-prep', 'college'],
        audience: 'high school students preparing for college',
      },
      {
        id: 'toefl-ielts',
        titleHint: 'TOEFL/IELTS Strategy',
        keywords: ['TOEFL', 'IELTS', 'English proficiency', 'test strategy'],
        tags: ['toefl', 'ielts', 'english', 'exam-prep'],
        audience: 'international students and professionals',
      },
      {
        id: 'gre-prep',
        titleHint: 'GRE Preparation',
        keywords: ['GRE', 'graduate school', 'verbal reasoning', 'quantitative'],
        tags: ['gre', 'exam-prep', 'graduate-school'],
        audience: 'graduate school applicants',
      },
      {
        id: 'suneung',
        titleHint: 'Korean CSAT (수능) Tips',
        keywords: ['수능', 'CSAT', 'Korean college entrance', 'exam strategy'],
        tags: ['suneung', 'csat', 'exam-prep', 'korea'],
        audience: 'Korean high school students',
      },
    ],
  },
  {
    name: 'Medical Studies',
    weight: 6,
    subtopics: [
      {
        id: 'usmle-prep',
        titleHint: 'USMLE Step Prep',
        keywords: ['USMLE', 'medical board', 'Step 1', 'Step 2'],
        tags: ['usmle', 'medical', 'exam-prep', 'board-exam'],
        audience: 'medical students',
      },
      {
        id: 'anatomy-study',
        titleHint: 'Anatomy Study Methods',
        keywords: ['anatomy', 'human body', 'medical studies', 'visual learning'],
        tags: ['anatomy', 'medical', 'study-techniques'],
        audience: 'medical and nursing students',
      },
      {
        id: 'pharmacology',
        titleHint: 'Pharmacology Memorization',
        keywords: ['pharmacology', 'drug classes', 'mechanisms', 'mnemonics'],
        tags: ['pharmacology', 'medical', 'memorization'],
        audience: 'pharmacy and medical students',
      },
    ],
  },
  {
    name: 'Study Productivity',
    weight: 6,
    subtopics: [
      {
        id: 'pomodoro-technique',
        titleHint: 'Pomodoro Technique',
        keywords: ['pomodoro', 'time management', 'focus', 'productivity'],
        tags: ['pomodoro', 'productivity', 'time-management'],
        audience: 'students and professionals',
      },
      {
        id: 'note-taking',
        titleHint: 'Note-Taking Systems',
        keywords: ['note-taking', 'Cornell method', 'mind maps', 'Zettelkasten'],
        tags: ['note-taking', 'organization', 'study-tips'],
        audience: 'students seeking better organization',
      },
      {
        id: 'focus-concentration',
        titleHint: 'Focus & Concentration',
        keywords: ['focus', 'concentration', 'distraction', 'deep work'],
        tags: ['focus', 'concentration', 'productivity'],
        audience: 'anyone struggling with distractions',
      },
      {
        id: 'study-planning',
        titleHint: 'Study Planning',
        keywords: ['study plan', 'schedule', 'goal setting', 'time blocking'],
        tags: ['planning', 'study-tips', 'organization'],
        audience: 'students managing multiple subjects',
      },
    ],
  },
  {
    name: 'Professional Certification',
    weight: 5,
    subtopics: [
      {
        id: 'cpa-cfa',
        titleHint: 'CPA/CFA Exam Tips',
        keywords: ['CPA', 'CFA', 'accounting', 'finance', 'certification'],
        tags: ['cpa', 'cfa', 'professional-cert', 'finance'],
        audience: 'finance and accounting professionals',
      },
      {
        id: 'it-certifications',
        titleHint: 'IT Certification Guide',
        keywords: ['AWS', 'CompTIA', 'Cisco', 'IT certification'],
        tags: ['it-cert', 'technology', 'professional-cert'],
        audience: 'IT professionals and career changers',
      },
      {
        id: 'project-management',
        titleHint: 'PMP Certification',
        keywords: ['PMP', 'project management', 'certification', 'PMI'],
        tags: ['pmp', 'project-management', 'professional-cert'],
        audience: 'project managers and aspiring PMs',
      },
    ],
  },
  {
    name: 'Law Studies',
    weight: 5,
    subtopics: [
      {
        id: 'bar-exam',
        titleHint: 'Bar Exam Preparation',
        keywords: ['bar exam', 'law school', 'MBE', 'legal studies'],
        tags: ['bar-exam', 'law', 'exam-prep'],
        audience: 'law students and bar exam candidates',
      },
      {
        id: 'case-analysis',
        titleHint: 'Case Briefing & Analysis',
        keywords: ['case brief', 'legal analysis', 'court opinion', 'precedent'],
        tags: ['case-analysis', 'law', 'study-techniques'],
        audience: 'law students',
      },
      {
        id: 'legal-memorization',
        titleHint: 'Legal Rules Memorization',
        keywords: ['legal rules', 'statutes', 'memorization', 'law mnemonics'],
        tags: ['memorization', 'law', 'study-tips'],
        audience: 'law students preparing for exams',
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

export function getSampleDeck(locale: string) {
  const samples: Record<string, { name: string; description: string }> = {
    ko: { name: '영어 단어장', description: '영어 기초 단어 학습' },
    ja: { name: '英単語帳', description: '基本英単語の学習' },
    zh: { name: '英语词汇', description: '基础英语词汇学习' },
    es: { name: 'Vocabulario Inglés', description: 'Palabras básicas en inglés' },
    vi: { name: 'Từ vựng tiếng Anh', description: 'Từ vựng cơ bản' },
    th: { name: 'คำศัพท์ภาษาอังกฤษ', description: 'คำศัพท์พื้นฐาน' },
    id: { name: 'Kosakata Bahasa Inggris', description: 'Kosakata dasar' },
  }
  return samples[locale] ?? { name: 'English Vocabulary', description: 'Daily English words to learn' }
}

export function getSampleCards(locale: string): { word: string; meaning: string }[] {
  const cards: Record<string, { word: string; meaning: string }[]> = {
    ko: [
      { word: 'apple', meaning: '사과' },
      { word: 'hello', meaning: '안녕하세요' },
      { word: 'thank you', meaning: '감사합니다' },
      { word: 'water', meaning: '물' },
      { word: 'book', meaning: '책' },
    ],
    ja: [
      { word: 'apple', meaning: 'りんご' },
      { word: 'hello', meaning: 'こんにちは' },
      { word: 'thank you', meaning: 'ありがとう' },
      { word: 'water', meaning: '水' },
      { word: 'book', meaning: '本' },
    ],
    zh: [
      { word: 'apple', meaning: '苹果' },
      { word: 'hello', meaning: '你好' },
      { word: 'thank you', meaning: '谢谢' },
      { word: 'water', meaning: '水' },
      { word: 'book', meaning: '书' },
    ],
  }
  return cards[locale] ?? [
    { word: 'apple', meaning: 'a round fruit' },
    { word: 'hello', meaning: 'a greeting' },
    { word: 'thank you', meaning: 'expression of gratitude' },
    { word: 'water', meaning: 'clear liquid for drinking' },
    { word: 'book', meaning: 'written or printed work' },
  ]
}

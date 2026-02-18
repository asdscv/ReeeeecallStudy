-- Sample content data for testing
-- Run this after applying 012_contents.sql migration

INSERT INTO contents (slug, locale, title, subtitle, thumbnail_url, content_blocks, reading_time_minutes, tags, meta_title, meta_description, author_name, is_published, published_at) VALUES

-- Article 1: English
('spaced-repetition-science', 'en',
 'The Science Behind Spaced Repetition',
 'How your brain forms lasting memories and why timing matters',
 'https://images.unsplash.com/photo-1507413245164-6160d8298b31?w=600&h=400&fit=crop',
 '[
   {"type":"hero","props":{"title":"The Science Behind Spaced Repetition","subtitle":"How your brain forms lasting memories and why timing matters","date":"2026-01-15","readingTime":7}},
   {"type":"paragraph","props":{"text":"Have you ever crammed for an exam, only to forget everything a week later? You''re not alone. Research shows that **massed practice** — studying everything at once — leads to rapid forgetting. But there''s a better way."}},
   {"type":"blockquote","props":{"text":"We forget approximately 70% of what we learn within 24 hours unless we actively review it.","attribution":"Hermann Ebbinghaus, Memory Researcher"}},
   {"type":"heading","props":{"level":2,"text":"What Is Spaced Repetition?","accent":true}},
   {"type":"paragraph","props":{"text":"Spaced repetition is a learning technique that involves reviewing material at **increasing intervals**. Instead of studying everything at once, you review information just as you''re about to forget it — strengthening the memory each time."}},
   {"type":"statistics","props":{"items":[{"value":"200%","label":"Better Retention"},{"value":"70%","label":"Less Study Time"},{"value":"3x","label":"Longer Memory"},{"value":"90%","label":"Recall Rate"}]}},
   {"type":"heading","props":{"level":2,"text":"How Does It Work?","accent":true}},
   {"type":"paragraph","props":{"text":"The key insight is the **forgetting curve**. When you first learn something, the memory decays rapidly. But each time you successfully recall the information, the curve flattens — meaning you retain the information longer before needing to review it again."}},
   {"type":"feature_cards","props":{"items":[{"icon":"brain","title":"Active Recall","description":"Testing yourself strengthens neural pathways more than passive reading","color":"blue"},{"icon":"clock","title":"Optimal Timing","description":"Review at the moment just before forgetting for maximum reinforcement","color":"green"},{"icon":"trending-up","title":"Progressive Intervals","description":"Each successful recall extends the interval before the next review","color":"purple"}]}},
   {"type":"heading","props":{"level":2,"text":"5 Tips for Effective Spaced Repetition","accent":true}},
   {"type":"numbered_list","props":{"items":[{"heading":"Start Small","description":"Begin with 10-20 new cards per day. Quality over quantity."},{"heading":"Be Consistent","description":"Daily practice beats marathon sessions. Even 10 minutes helps."},{"heading":"Use Active Recall","description":"Don''t just read — test yourself. The effort of remembering strengthens memory."},{"heading":"Trust the Algorithm","description":"Let the SRS schedule your reviews. It knows when you''re about to forget."},{"heading":"Keep Cards Simple","description":"One fact per card. Complex cards lead to confusion and poor recall."}]}},
   {"type":"highlight_box","props":{"title":"Ready to Experience It?","description":"ReeeeecallStudy uses a scientifically-tuned SRS algorithm that automatically schedules your reviews at the optimal time. No more guessing when to study — the app handles it for you.","variant":"blue"}},
   {"type":"cta","props":{"title":"Start Learning Smarter Today","description":"Join thousands of learners using spaced repetition to remember more in less time.","buttonText":"Get Started Free","buttonUrl":"/auth/login"}}
 ]'::jsonb,
 7, ARRAY['spaced-repetition', 'learning-science', 'memory'],
 'The Science Behind Spaced Repetition | ReeeCall',
 'Learn how spaced repetition leverages the forgetting curve to create lasting memories with less study time.',
 'ReeeCall', true, '2026-01-15T10:00:00Z'),

-- Article 1: Korean
('spaced-repetition-science', 'ko',
 '간격 반복 학습의 과학',
 '뇌가 지속적인 기억을 형성하는 방법과 타이밍이 중요한 이유',
 'https://images.unsplash.com/photo-1507413245164-6160d8298b31?w=600&h=400&fit=crop',
 '[
   {"type":"hero","props":{"title":"간격 반복 학습의 과학","subtitle":"뇌가 지속적인 기억을 형성하는 방법과 타이밍이 중요한 이유","date":"2026-01-15","readingTime":7}},
   {"type":"paragraph","props":{"text":"시험 직전에 벼락치기를 한 후 일주일이 지나면 전부 잊어버린 경험이 있으신가요? 연구에 따르면 **집중 학습** — 한꺼번에 모든 것을 공부하는 방식 — 은 빠른 망각으로 이어집니다. 하지만 더 나은 방법이 있습니다."}},
   {"type":"blockquote","props":{"text":"적극적으로 복습하지 않으면 24시간 내에 학습한 내용의 약 70%를 잊어버립니다.","attribution":"헤르만 에빙하우스, 기억 연구자"}},
   {"type":"heading","props":{"level":2,"text":"간격 반복이란?","accent":true}},
   {"type":"paragraph","props":{"text":"간격 반복은 **점점 늘어나는 간격**으로 학습 자료를 복습하는 학습 기법입니다. 한꺼번에 모든 것을 공부하는 대신, 잊어버리기 직전에 정보를 복습하여 매번 기억을 강화합니다."}},
   {"type":"statistics","props":{"items":[{"value":"200%","label":"기억력 향상"},{"value":"70%","label":"학습 시간 절약"},{"value":"3배","label":"기억 지속"},{"value":"90%","label":"회상률"}]}},
   {"type":"heading","props":{"level":2,"text":"어떻게 작동하나요?","accent":true}},
   {"type":"paragraph","props":{"text":"핵심 통찰은 **망각 곡선**입니다. 처음 무언가를 배우면 기억이 빠르게 감소합니다. 하지만 정보를 성공적으로 떠올릴 때마다 곡선이 평탄해져서 다시 복습할 때까지 더 오래 정보를 유지하게 됩니다."}},
   {"type":"feature_cards","props":{"items":[{"icon":"brain","title":"능동적 회상","description":"자기 테스트가 수동적 읽기보다 신경 경로를 더 강화합니다","color":"blue"},{"icon":"clock","title":"최적 타이밍","description":"잊기 직전에 복습하여 최대 강화 효과","color":"green"},{"icon":"trending-up","title":"점진적 간격","description":"성공적 회상마다 다음 복습까지의 간격 연장","color":"purple"}]}},
   {"type":"cta","props":{"title":"지금 바로 스마트하게 학습하세요","description":"간격 반복을 활용하여 적은 시간으로 더 많이 기억하는 학습자 대열에 합류하세요.","buttonText":"무료로 시작하기","buttonUrl":"/auth/login"}}
 ]'::jsonb,
 7, ARRAY['간격반복', '학습과학', '기억력'],
 '간격 반복 학습의 과학 | ReeeCall',
 '간격 반복이 망각 곡선을 활용하여 적은 학습 시간으로 지속적인 기억을 만드는 방법을 알아보세요.',
 'ReeeCall', true, '2026-01-15T10:00:00Z'),

-- Article 2: English
('flashcard-best-practices', 'en',
 'How to Create Perfect Flashcards',
 'Master the art of effective flashcard design for maximum retention',
 'https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=600&h=400&fit=crop',
 '[
   {"type":"hero","props":{"title":"How to Create Perfect Flashcards","subtitle":"Master the art of effective flashcard design for maximum retention","date":"2026-01-28","readingTime":5}},
   {"type":"paragraph","props":{"text":"Not all flashcards are created equal. The way you design your cards has a **massive impact** on how well you remember the material. Follow these research-backed principles to create cards that actually work."}},
   {"type":"heading","props":{"level":2,"text":"The One-Fact Rule","accent":true}},
   {"type":"paragraph","props":{"text":"The most common mistake is putting too much information on a single card. Each card should test **exactly one piece of knowledge**. If you find yourself writing long answers, break the card into multiple simpler cards."}},
   {"type":"feature_cards","props":{"items":[{"icon":"target","title":"Be Specific","description":"\"What is the capital of France?\" is better than \"Tell me about France\"","color":"blue"},{"icon":"zap","title":"Be Concise","description":"Short questions and answers lead to faster reviews and better retention","color":"amber"},{"icon":"lightbulb","title":"Use Context","description":"Add examples and mnemonics to make abstract concepts concrete","color":"green"}]}},
   {"type":"heading","props":{"level":2,"text":"Image-Enhanced Learning","accent":true}},
   {"type":"paragraph","props":{"text":"Adding relevant images to your cards can boost retention by up to **65%**. Our visual memory is incredibly powerful — use it! ReeeeecallStudy supports image fields in custom templates, making it easy to create visual flashcards."}},
   {"type":"highlight_box","props":{"title":"Pro Tip: Custom Templates","description":"Use ReeeeecallStudy''s template editor to create card layouts that match your learning style. Add image fields, audio for pronunciation, and multiple text fields for context.","variant":"green"}},
   {"type":"cta","props":{"title":"Create Better Flashcards Today","description":"Start with our customizable templates and build your perfect study deck.","buttonText":"Try It Free","buttonUrl":"/auth/login"}}
 ]'::jsonb,
 5, ARRAY['flashcards', 'study-tips', 'productivity'],
 'How to Create Perfect Flashcards | ReeeCall',
 'Learn research-backed principles for designing flashcards that maximize retention and minimize study time.',
 'ReeeCall', true, '2026-01-28T10:00:00Z'),

-- Article 2: Korean
('flashcard-best-practices', 'ko',
 '완벽한 플래시카드 만드는 법',
 '최대 기억력을 위한 효과적인 플래시카드 디자인의 기술',
 'https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=600&h=400&fit=crop',
 '[
   {"type":"hero","props":{"title":"완벽한 플래시카드 만드는 법","subtitle":"최대 기억력을 위한 효과적인 플래시카드 디자인의 기술","date":"2026-01-28","readingTime":5}},
   {"type":"paragraph","props":{"text":"모든 플래시카드가 같은 것은 아닙니다. 카드를 디자인하는 방식이 학습 내용을 얼마나 잘 기억하는지에 **큰 영향**을 미칩니다. 연구에 기반한 원칙들을 따라 실제로 효과가 있는 카드를 만들어 보세요."}},
   {"type":"heading","props":{"level":2,"text":"하나의 사실 규칙","accent":true}},
   {"type":"paragraph","props":{"text":"가장 흔한 실수는 하나의 카드에 너무 많은 정보를 넣는 것입니다. 각 카드는 **정확히 하나의 지식**을 테스트해야 합니다. 긴 답변을 작성하고 있다면, 카드를 여러 개의 간단한 카드로 나누세요."}},
   {"type":"feature_cards","props":{"items":[{"icon":"target","title":"구체적으로","description":"\"프랑스에 대해 말해보세요\"보다 \"프랑스의 수도는?\"이 더 효과적","color":"blue"},{"icon":"zap","title":"간결하게","description":"짧은 질문과 답변이 빠른 복습과 더 나은 기억으로 이어집니다","color":"amber"},{"icon":"lightbulb","title":"맥락 활용","description":"예시와 기억술을 추가하여 추상적 개념을 구체화하세요","color":"green"}]}},
   {"type":"cta","props":{"title":"오늘부터 더 나은 플래시카드를 만드세요","description":"커스터마이즈 가능한 템플릿으로 시작하고 완벽한 학습 덱을 만들어 보세요.","buttonText":"무료로 체험하기","buttonUrl":"/auth/login"}}
 ]'::jsonb,
 5, ARRAY['플래시카드', '학습팁', '생산성'],
 '완벽한 플래시카드 만드는 법 | ReeeCall',
 '기억력을 극대화하고 학습 시간을 최소화하는 연구 기반 플래시카드 디자인 원칙을 알아보세요.',
 'ReeeCall', true, '2026-01-28T10:00:00Z'),

-- Article 3: English
('active-recall-guide', 'en',
 'Active Recall: The Most Effective Study Technique',
 'Why testing yourself beats re-reading every time',
 'https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=600&h=400&fit=crop',
 '[
   {"type":"hero","props":{"title":"Active Recall: The Most Effective Study Technique","subtitle":"Why testing yourself beats re-reading every time","date":"2026-02-10","readingTime":6}},
   {"type":"paragraph","props":{"text":"If you''re still highlighting textbooks and re-reading notes, you''re using one of the **least effective** study methods. Research consistently shows that active recall — the practice of retrieving information from memory — produces dramatically better results."}},
   {"type":"statistics","props":{"items":[{"value":"50%","label":"Higher Test Scores"},{"value":"2x","label":"Faster Learning"},{"value":"80%","label":"Long-term Retention"},{"value":"40%","label":"Fewer Study Hours"}]}},
   {"type":"heading","props":{"level":2,"text":"What Makes Active Recall So Powerful?","accent":true}},
   {"type":"paragraph","props":{"text":"When you try to recall information, you''re not just checking if you know it — you''re actually **strengthening the memory** itself. This is known as the *testing effect* or *retrieval practice effect*. Every time you successfully retrieve a memory, it becomes more durable and accessible."}},
   {"type":"numbered_list","props":{"items":[{"heading":"Close the Book","description":"Before reviewing, try to recall the key points from memory first."},{"heading":"Use Flashcards","description":"The question-answer format naturally encourages active recall."},{"heading":"Practice Explaining","description":"Teaching concepts to others (or an imaginary audience) forces deep recall."},{"heading":"Space Your Practice","description":"Combine active recall with spaced repetition for maximum effect."}]}},
   {"type":"highlight_box","props":{"title":"The Perfect Combination","description":"Active recall + spaced repetition is the gold standard of evidence-based learning. ReeeeecallStudy combines both in a single, easy-to-use platform.","variant":"blue"}},
   {"type":"cta","props":{"title":"Experience Evidence-Based Learning","description":"Try the study method backed by decades of cognitive science research.","buttonText":"Start Free","buttonUrl":"/auth/login"}}
 ]'::jsonb,
 6, ARRAY['active-recall', 'study-techniques', 'learning-science'],
 'Active Recall: The Most Effective Study Technique | ReeeCall',
 'Discover why active recall outperforms re-reading and highlighting, and how to implement it in your study routine.',
 'ReeeCall', true, '2026-02-10T10:00:00Z'),

-- Article 3: Korean
('active-recall-guide', 'ko',
 '능동적 회상: 가장 효과적인 학습 기법',
 '자기 테스트가 왜 항상 반복 읽기를 이기는지',
 'https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=600&h=400&fit=crop',
 '[
   {"type":"hero","props":{"title":"능동적 회상: 가장 효과적인 학습 기법","subtitle":"자기 테스트가 왜 항상 반복 읽기를 이기는지","date":"2026-02-10","readingTime":6}},
   {"type":"paragraph","props":{"text":"여전히 교과서에 형광펜을 칠하고 노트를 반복해서 읽고 계신가요? 가장 **효과가 낮은** 학습 방법 중 하나를 사용하고 계신 겁니다. 연구에 따르면 능동적 회상 — 기억에서 정보를 끄집어내는 연습 — 이 훨씬 더 나은 결과를 만들어냅니다."}},
   {"type":"statistics","props":{"items":[{"value":"50%","label":"시험 점수 향상"},{"value":"2배","label":"학습 속도"},{"value":"80%","label":"장기 기억률"},{"value":"40%","label":"학습 시간 절약"}]}},
   {"type":"heading","props":{"level":2,"text":"능동적 회상이 강력한 이유","accent":true}},
   {"type":"paragraph","props":{"text":"정보를 떠올리려고 노력할 때, 단순히 알고 있는지 확인하는 것이 아닙니다 — 실제로 **기억 자체를 강화**하고 있는 것입니다. 이것을 *테스팅 효과* 또는 *인출 연습 효과*라고 합니다. 기억을 성공적으로 인출할 때마다 그 기억은 더 견고하고 접근하기 쉬워집니다."}},
   {"type":"highlight_box","props":{"title":"완벽한 조합","description":"능동적 회상 + 간격 반복은 근거 기반 학습의 황금 기준입니다. ReeeeecallStudy는 두 가지를 하나의 사용하기 쉬운 플랫폼에서 결합합니다.","variant":"blue"}},
   {"type":"cta","props":{"title":"근거 기반 학습을 경험하세요","description":"수십 년의 인지 과학 연구가 뒷받침하는 학습법을 직접 체험해 보세요.","buttonText":"무료로 시작하기","buttonUrl":"/auth/login"}}
 ]'::jsonb,
 6, ARRAY['능동적회상', '학습기법', '학습과학'],
 '능동적 회상: 가장 효과적인 학습 기법 | ReeeCall',
 '능동적 회상이 왜 반복 읽기와 형광펜 표시보다 뛰어난지, 그리고 학습 루틴에 어떻게 적용하는지 알아보세요.',
 'ReeeCall', true, '2026-02-10T10:00:00Z');

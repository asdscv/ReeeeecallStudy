# 09. Phase 6 — Monetization (인앱 결제)

> **Status**: Draft
> **Duration**: ~1 week

---

## Strategy

```
Web  → 무료 기능만 (Pro 기능 잠금 → "앱에서 구독하세요")
App  → 인앱 결제로 Pro 구독
```

---

## Tier Structure

| Feature | Free | Pro ($5.99/mo) |
|---------|------|----------------|
| 덱 | 3개 | 무제한 |
| 카드 | 100장/덱 | 무제한 |
| AI 생성 | 월 5회 (자체 API키 사용 시 무제한) | 무제한 |
| 학습 모드 | SRS + 순차복습 | 전체 4종 |
| TTS | Web Speech | Edge TTS 고품질 |
| 학습 분석 | 기본 | 상세 차트 + 예측 |
| 마켓플레이스 | 다운로드만 | 업로드 + 수익 분배 |
| 광고 | 없음 | 없음 |

---

## Tech Stack

| Component | Tool |
|-----------|------|
| 결제 SDK | **RevenueCat** |
| Apple IAP | App Store Connect |
| Google IAP | Google Play Console |
| 구독 상태 DB | Supabase `subscriptions` table |
| Webhook | RevenueCat → Supabase Edge Function |

---

## Architecture

```
User taps "Subscribe"
  │
  ▼
RevenueCat SDK (in-app)
  │
  ├── Apple/Google 결제 처리
  │
  ▼
RevenueCat Webhook → Supabase Edge Function
  │
  ├── subscriptions table UPDATE
  │   { user_id, plan: 'pro', expires_at, provider: 'apple'|'google' }
  │
  ▼
App/Web reads subscription status
  │
  ├── subscriptionStore.fetchSubscription()
  └── tier gate: if (plan === 'free') → show upgrade prompt
```

---

## Supabase Schema

```sql
CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL UNIQUE,
  plan text NOT NULL DEFAULT 'free',  -- 'free' | 'pro'
  provider text,                       -- 'apple' | 'google' | null
  product_id text,                     -- RevenueCat product ID
  expires_at timestamptz,
  is_active boolean GENERATED ALWAYS AS (
    plan = 'pro' AND (expires_at IS NULL OR expires_at > now())
  ) STORED,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS: users can only read their own subscription
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own subscription"
  ON subscriptions FOR SELECT USING (auth.uid() = user_id);
```

---

## Tier Gate Implementation

```typescript
// shared/lib/tier-gate.ts
import { useSubscriptionStore } from '../stores/subscription-store'

export function requirePro(feature: string): boolean {
  const { plan } = useSubscriptionStore.getState()
  if (plan === 'pro') return true
  // Show upgrade prompt
  return false
}

export function getLimit(feature: 'decks' | 'cards' | 'ai_generates'): number {
  const { plan } = useSubscriptionStore.getState()
  const limits = {
    free: { decks: 3, cards: 100, ai_generates: 5 },
    pro:  { decks: Infinity, cards: Infinity, ai_generates: Infinity },
  }
  return limits[plan][feature]
}
```

---

## Revenue Projection

| Scenario | Monthly Users | Conversion | MRR |
|----------|---------------|------------|-----|
| Conservative | 1,000 | 3% | $180 |
| Moderate | 5,000 | 5% | $1,500 |
| Optimistic | 20,000 | 7% | $8,400 |

*After Apple/Google 15% small business commission*

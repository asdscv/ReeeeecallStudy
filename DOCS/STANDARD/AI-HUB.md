# AI 학습 (AI Learning)

The menu that gathers every AI-assisted study surface, and the kernel that makes adding one cheap.

## What a user sees

`학습 (Study)` now contains a nested section, `AI 학습`, with three entries:

| entry | web | mobile |
| --- | --- | --- |
| 학습 플랜 | `/learning` | `AITab` / `LearningGoals` |
| 퀴즈 | `/quiz` | `QuizTab` / `QuizHome` |
| 덱·카드 생성 | `/ai-generate` | `AITab` / `AIGenerate` |

The section header is itself a link to the hub — `/ai` on web, `AITab/AIHub` on mobile — which
lists the same three as cards and shows the AI wallet balance and today's remaining free cards.

No feature URL or route name changed. The three surfaces are exactly where they were; what is new
is that there is one place that names them.

## Adding a fourth AI feature

One registration, in `packages/shared/lib/ai/hub/catalog.ts`:

```ts
.register({
  id: 'summarize',
  icon: '📝',
  order: 40,
  titleKey: 'hub.entries.summarize.title',
  descKey: 'hub.entries.summarize.desc',
  webPath: '/summarize',
  mobileStack: 'AITab',
  mobileScreen: 'Summarize',
  poweredBy: 'model',
})
```

It then appears in all four menus — the web nav submenu, the web hub page, the mobile drawer
sub-group and the mobile hub screen — with no edit to any of them. What you still owe it:

1. The route: a `<Route>` in `packages/web/src/App.tsx` and a `<Stack.Screen>` in
   `packages/mobile/src/navigation/AIStack.tsx` (plus the key in `AIStackParamList`).
2. `hub.entries.<id>.title` and `.desc` in all 8 locales on **both** platforms —
   `packages/web/public/locales/*/ai-generate.json` and
   `packages/mobile/src/i18n/locales/*/ai-generate.json`.
3. `AI_HUB_STACK_SCREENS` in `packages/mobile/src/screens/ai/aiHubRoutes.ts` if the screen is new.

Three tests fail until you do: `ai-hub-catalog.test.ts` checks the route exists on both platforms
and the strings exist in all 16 bundles; `ai-hub-not-hardcoded.test.ts` checks no menu re-typed the
list; `ai-hub-kernel-no-dead-exports.test.ts` checks nothing was exported without a reader.

## `poweredBy` is not decoration

`'model'` means a paid model call. `'device'` means it is computed locally — no model, no charge.

The learning plan is `'device'`. Its scheduling is SM-2 over rows the client composed; both
`LearningTodayPage.tsx` and `LearningTodayScreen.tsx` record that the paid remediation was removed
as a product decision. It sits in a menu called "AI 학습" because that is where a learner looks for
it, which makes an "AI" badge on that one tile the easiest false claim in the product to ship by
accident. So the badge is derived, never stored: `isAiBadgeEligible(entry)` returns
`entry.poweredBy === 'model'`, and `ai-hub-catalog.test.ts` states the consequence directly.

## The kernel

Two primitives under `packages/shared/lib/kernel/`, both dependency-free:

- **`registry.ts`** — `Registry<T extends Identified>`: `register` (chainable, throws on a blank or
  repeated id), `has`, `get` (throws), `find` (null), `ids()` (sorted), `all()` (registration
  order). It exists because the repo already had two hand-written copies and
  `knowledge-registry.ts` carried the rule *"Merge them when a third appears, not before."* The AI
  hub was the third. The two learning registries are deliberately **not** retrofitted — they throw
  `LearningError`, and that module's contract is that the learning kernel imports nothing outside
  itself. Adopt it there when a learning change next touches them.
- **`event-bus.ts`** — `EventBus<E>`: `on(type, fn)`, `onAny(fn)`, `emit(e)`, each returning an
  unsubscribe. Snapshots listeners before notifying, so a handler may unsubscribe itself mid-emit,
  and contains a throwing listener so telemetry can never break the flow it observes.

## The bus, and why it is not ornamental

Every AI entry point emits on `aiHubBus` (`packages/shared/lib/ai/hub/events.ts`): the nav, the hub
tiles, and the "AI로 만들기" buttons in deck and card creation. Three event types, each carrying an
`AiHubSource` so "opened the menu" is distinguishable from "pressed the button inside deck
creation" — which is the question the new entry points exist to answer.

The subscribers are the two analytics bridges, `useAiHubEventBridge` on each platform. Web forwards
into the existing `useTrackEvent`; mobile calls `record_analytics_event` directly, which is the
mobile app's first event telemetry of any kind. Both map through the shared
`aiHubAnalyticsEvent(event)` so one funnel cannot end up reported under two names.

Mount each bridge exactly once — web in `Layout`, mobile in `MainDrawer`. Both wrap every
authenticated screen; a second mount double-counts.

**The bus carries intent, never money.** Reservation, pricing and charging stay in
`packages/shared/lib/ai/server-client.ts` and the `ai-generate` edge function. A listener cannot
change what is spent, and because `emit` swallows listener throws, it cannot block a request
either.

## Entry points

"AI로 만들기" in deck creation and "AI 카드" in card creation navigate into the menu's generate
surface with the mode already chosen — `?mode=full` and `?mode=cards_only&deckId=…&templateId=…` on
web, the equivalent route params on mobile. Both are ghost/secondary actions placed after the
primary save: typing a deck or a card by hand stays the fastest path.

Two things learned by driving this on a simulator, both worth keeping in mind for the next entry
point:

- **A stack screen is mounted once.** `AIGenerateScreen` seeded its state from `route.params` in a
  `useState` initialiser. Pressing an AI action in deck creation and then one in card creation
  navigates to the instance that is already mounted: React Navigation swaps the params and
  re-renders, and the initialiser never runs again, so the wizard stayed on the first press's mode.
  It now re-seeds in an effect keyed on the param *values*.
- **Only offer it where cards can land.** A read-only deck (subscribed or official) cannot receive
  generated cards — the AI screen drops the deck as soon as its owned-and-editable list loads and
  silently reopens on 전체 생성. `deck-detail-ai-cards` and `card-edit-ai-cards` are gated on
  `!deck.is_readonly`.

## Verifying a change

```bash
# gates
pnpm --filter @reeeeecall/web exec tsc -b --noEmit
pnpm --filter @reeeeecall/web typecheck:e2e
pnpm --filter @reeeeecall/web lint
pnpm --filter @reeeeecall/web test
cd packages/mobile && npx tsx src/i18n/i18n.test.ts

# web screenshots (light + dark, every surface the menu gathers)
E2E_TEST_EMAIL=… E2E_TEST_PASSWORD=… E2E_BASE_URL=http://localhost:5173 \
  npx playwright test e2e/tests/ai-hub-screens.spec.ts --project=chromium
# -> packages/web/e2e/screenshots/ai-hub/
```

For the simulators, start Appium with `APPIUM_HOME=$HOME/.appium npx appium --port 4723` (without
it Appium 3 reports "No drivers installed"). Two things that cost time and will again:

- Supabase allows **one session per platform**, so a Playwright run and a mobile harness on the
  same account kick each other. Run them sequentially, or use separate accounts.
- The Android emulator reaches Metro at `10.0.2.2:8081`, not through `adb reverse`. Set it once
  with `adb shell run-as com.reeeeecall.study` writing `debug_http_host` into
  `shared_prefs/com.reeeeecall.study_preferences.xml`, then force-stop and relaunch.

Emoji render as tofu (`?`) in the iOS 26.3 simulator — every emoji in the app, not just the menu's.
Android renders them correctly, which is how we know it is the simulator's font and not the icons.

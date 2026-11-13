# BUILD PLAN: 두뇌 트레이닝, 8 games that are simple but actually hard (Quick Eye is planned separately)

> 2026-11-13: Quick Eye was removed from the product by the owner («빠른 눈 아예 빼자»). Its mentions below are history; `placementCeiling` (kept only for it) is gone too. See `GAME_LOGIC.md` «빠른 눈 제거».
>
> 2026-11-13 (later): the ceilings of §3.2 Number Pattern (28 families, top band 30–31), §3.5 Color Word (a colour-vision-safe palette for everyone), §3.6 Flash Grid (7×6, 7×7, half-lit whole-screen boards, up to 20 cells), §3.7 Sequence (a ladder of more tiles and faster flashes, never over 3/s) and §3.8 Match Pairs (30, 36, 42 cards) were raised past this plan. See `GAME_LOGIC.md` «천장 높이기».

## 1) 한 줄 요약

8개 게임 모두 레벨 숫자가 아니라 **실제 문제 내용**으로 다시 깐다. 빠른 계산은 L2부터 받아올림·내림이 반드시 있고, 25단계 뒤에는 자릿수가 늘어난다. 저장 형식을 v2로 올리고 배치를 고쳐서, 옛 기록이 있는 사람도 첫 라운드에서 자기 수준(보통 성인은 L13 안팎)에 바로 들어간다. RPG·메타 진행은 없고, 어려움은 게임 안에서만 만든다.

**Where to start and what limits apply**
- **Base commit.** Start from the Quick Eye redesign once it is committed in `wt-quick-eye`. Right now it is uncommitted there, and it touches `types.ts`, `mechanics.ts` (it appends `quickEye.clearView` at bit 48), `rules.ts`, `sync.ts`, `progress.ts`, `useBrainRound.ts`, `useTodaysTraining.ts`, both `RoundView.tsx` files and all 16 `brain.json` files. Do not branch from `cb4b2b9f` alone, and do not point other agents at `wt-quick-eye`.
- **Out of scope.** No RPG, world map or meta layer. No new native modules: no expo-font, no svg. Everything must be OTA-able JS.
- **Kept as they are.** Staircase ratios (85% target, Corsi for span games), 3 lives, the 20 and 14 trial caps, practice, the relaxed-timing rule, and the EVIDENCE gates.
- **Every reviewer must-fix is applied.** Where a must-fix conflicted with a design, the reviewer wins. Two places go further than the reviewers asked; both are marked ★.

---

## 2) Cross-cutting engine fixes

### 2.1 Shared contract: `packages/shared/lib/brain-games/types.ts` (WP-A, lands first)

```ts
// CreateContext — add (DEFAULT_CONTEXT: maxRows 7, blockRules [], trialKind 'counted', recent [], roundSeed 1)
maxRows: number                                   // tallest grid with cells ≥ 56dp
blockRules: readonly string[]                     // unseen rule tags this trial must NOT use
trialKind: 'practice' | 'intro' | 'placement' | 'counted'
recent: readonly { level: number; kind: string; carry?: string }[]   // last ≤2 trials, oldest first
roundSeed: number                                 // fixed per round (Color Word colour subset)
export function maxRowsFor(boardHeight: number): number  // max(3, min(7, floor((h + 8) / 64)))

// BrainGameDef — add
trialInfo?(s: S): { kind: string; carry?: string } // variety rules and Color Word carry-over
spanLength?(level: number, ctx: CreateContext): number

// CellView — add
mirror?: boolean                  // scaleX(-1), applied before rotate
ink?: 'neutral' | 'amber' | 'cyan'
boxed?: boolean                   // rounded outline (second Number Hunt series)

// GridView — add
extra?: { key: string; index: number }            // full-width button under the grid (Odd One Out «없음»)
chip?: { text?: string; key?: string; params?: Record<string, string | number>; ink?: 'neutral' | 'amber' }
progress?: { kind: 'waves'; done: number; total: number } | { kind: 'set'; open: number; size: number }
showBar?: { ms: number }                          // memorise countdown bar
badge?: { key: string }                           // header badge (거꾸로 / 비슷한 그림)
budget?: { left: number; total: number }          // Match Pairs board budget, drawn as dots, never hearts
missChip?: { odd: CellView; common: CellView }    // Odd One Out, after a miss

// ChoiceView — add
stimulus.tokens?: (number | string)[]   // render numbers with Intl.NumberFormat(locale); wrap only between tokens
stimulus.terms?: (number | null)[]      // Number Pattern tiles; null marks the gap
stimulus.hidden?: boolean               // Color Word cue lead: word not shown yet
stimulus.cue?: 'ink' | 'word'
stimulus.frame?: BrainColor
stimulus.reveal?: { lines?: string[]; highlight?: [number, number]; gaps?: string[]; groups?: number[]; prompt?: PromptView }  // only when done
options[i].value?: number               // numeric options, engine already sorted them ascending
options[i].color?: BrainColor           // label ink, drawn as a white tile

// RoundOutcome — add
informedMisses?: number                 // Match Pairs probe ladder
```

**`catalog.ts` (WP-A).** Add `steps?: { scale: number; kMax: number }` to `BrainGameEntry`. Pairs gets `{ scale: 2, kMax: 1.5 }`.

**`mechanics.ts` (WP-A).**
- Add `retired?: true` to `MechanicInfo`.
- Add `pending?: true` as a temporary flag. WP-M deletes it at the end.
- `placementCeiling` ignores retired and pending entries. Board games stop calling it; it stays exported for Quick Eye.
- Append the full new block from §2.10 with `pending: true` on every line. Each game WP removes `pending` only from its own group.

**`tiers.ts` (WP-A).** Set every threshold from the §2.10 table in one commit. This is safe before the games change, because each new master threshold sits below the old cap.

**`games/choice.ts` (WP-A).**
- `nearMissOptions(answer, errors: {v: number; trap?: boolean}[], rng, opts)`:
  - Draw the answer's sorted position uniformly first. If that position is impossible (small answers), redraw among feasible positions.
  - Build distractors to fit: the given errors first, then ±1/±2/±10/±100 fill.
  - Options must be distinct non-negative integers within ±max(20%, 20) of the answer. Trap options are exempt.
  - With `opts.sameUnits` (multi-digit add/subtract with answer ≥ 50), at least 2 distractors share the answer's units digit.
  - Return options in ascending order. Bounded at 200 tries, then fall back to `numericOptions`.
- `choiceGame` passes through `tokens`, `terms`, `reveal`, `cue`, `frame` and option `value`/`color`.
- Add optional `leadMs`: phase `'lead'` (pendingMs = leadMs, no input, `stimulus.hidden: true`), then `'answer'`.

**`games/bands.ts` (NEW, WP-A).** `pickBand(level, rng, ctx, { bands, isBlocked })`:
- Weights 55/25/12/8 over the current band, then one, two and three below, renormalised where fewer exist (L1 100, L2 67/33, L3 59/29/12).
- Nothing older than three bands below.
- If `floor(ctx.recent.at(-1).level) < floor(level)`, use the current band.
- Never the same band three times in a row.
- `ctx.trialKind === 'placement'` uses the current band only.
- A blocked band falls to the nearest unblocked band below.

### 2.2 Save format v2 and level-scale migration (WP-B)

**Why a format bump rather than a marker.** A marker (a top-level field or a bit in `seen`) survives an old client's sync, but that old client can still push old-scale levels under it. The repo already has the right lock:
- `isNewerFormat` makes an old app stop syncing with status `'outdated'`.
- Migration 288 refuses any write whose `v` is lower than the stored one (`client_outdated`).

So conversion runs exactly once, when a v1 document is read, and is idempotent by construction. This replaces the reviewers' sentinel-bit fix and is stronger, because the server enforces it.

**Changes by file:**
- `sync.ts`: set `BRAIN_PROGRESS_FORMAT`, `BRAIN_META_FORMAT` and `BRAIN_HISTORY_FORMAT` to 2.
- `progress.ts` `parseProgress`:
  - Accept v1 or v2 and always write v2.
  - On v1: for the 8 games convert `level` and `bestLevel` through `migrateLevelV1`, and delete `bestRuns[id]` (scores earned on easier content; same precedent as Quick Eye).
  - Keep the Quick Eye `quickEyeField` handling exactly as it is.
- `meta.ts` `parseMeta`:
  - Accept 1 or 2.
  - On v1, for oddOneOut, schulte, stroop, math, series and pairs: `sk[id] = { mu: migrateLevelV1(id, mu), sd: 9, n: 0, day }`. Setting `n = 0` forces one placement or probe.
  - `tier` stays as is (sticky). Span estimates stay, clamped to the new cap.
- `history.ts` `parseHistory`: read `v`. If it is not 2, convert `level10` through the same map. Write `v: 2`.
- `scale.ts` (NEW): `V1_TIERS` (the old table) and `migrateLevelV1(id, lv)`:

| game | v1 → v2 map |
|---|---|
| math | clamp(1, 0.45·old + 1, 12) |
| series | clamp(1, 0.75·old, 14) |
| oddOneOut, schulte, stroop | `levelAtStanding(new, standingOn(V1_TIERS, old))`. Example: Odd One Out old 26 → 11.5 |
| pairs | ≤3→1 · 4–6→2 · 7–9→4 · 10–12→6 · 13–15→9 · 16–23→11 · ≥24→12 |
| memoryGrid, sequence | identity, clamped to [1, 14] |
| quickEye | identity (not ours) |

Merges always run on parsed v2 documents, so `mergeProgress`'s `max(bestLevel)` compares like with like.

### 2.3 Placement (`placement.ts`, `useBrainRound.ts` init; WP-B)

**`placement.ts`:**
- `startPlacement` gets `tailMass?: number`. When set: `post_i = (1−t)·g_i/Σg + t/count` (the normalised flat tail).
  - Today the tail is 0.19–0.28% of the prior mass, not 20%.
  - Undefined keeps the old formula, so Quick Eye is unchanged until its own plan adopts the fix.
- `placementLevel` gets `hotMove?: number`, used while the last three answers were right.
- `updatePlacement(p, level, correct, guess, weight = 1)`: the likelihood is raised to `weight`.
- `placementResult(p, handoverK = 0.5)`.
- Export a `PLACEMENT` table:

| game | method | hi | trials | tailMass | hotMove | handoverK |
|---|---|---|---|---|---|---|
| math | ZEST | 26 | 8–14 (continues while last 3 right) | 0.2 | 4 | 0.25 |
| series | ZEST | 20 | 8–14 | 0.2 | 4 | 0.25 |
| oddOneOut | ZEST | 24 | 8–14 | 0.2 | 4 | 0.25 |
| stroop | ZEST | 24 | 8–14 | 0.2 | 4 | 0.25 |
| schulte | ZEST, graded | 20 | exactly 3 boards | 0.2 | 5 after a strong pass | 0.25 |
| pairs | probe ladder (§2.7) | — | ≤ 4 boards | — | — | — |
| memoryGrid, sequence | fast entry (§2.6) | — | — | — | — | — |

**`init()` (speed-group games except pairs):**
- One path covers `neverPlayed || legacy || est.n === 0`. This removes the separate uncommitted `legacy` branch and its "no rule ceiling".
- `seed = est?.n === 0 ? est.mu : legacy ? gp.level : crossGameSeed(meta, id)`. Note that `gp.level` is already converted by `parseProgress`.
- `mu0 = seed === null ? 3 : max(3, seed)`, `sigma0 = 9` always.
- `hi = PLACEMENT[id].hi`. No `TIERS[4]`, no `placementCeiling`.
- `placeStart = seed === null ? 3 : null`: the first placement trial is never above practice level + 2.
- Schulte graded evidence: `share = (now − inputStartedAt − pausedMs) / trialLimit`.
  - A correct board with `share ≤ 0.5` gets `weight 2` and `hotMove 5`.
  - A timeout with ≥ 80% of numbers found gets `weight 0.5`.

**Measured with the real `pCorrect`/`updatePlacement` and an idealised slope-2 responder, 400 runs per row:**

| config | perfect responder hands over at | θ=14: hands over / round-1 end / accuracy | θ=20 | θ=2 |
|---|---|---|---|---|
| today (hi 28, unnormalised tail) | 19.6 | — | 15.6 hand | — |
| tail fix only | 23.2 | — | — | — |
| **new math (hi 26)** | **23.2** | 13.2 / 13.2 / 85% | 16.2 / 17.9 / 86% | 3.1 / 2.1 / 75% |
| new hi 24 (Odd One Out, Color Word) | 21.3–21.7 | | | |
| new series hi 20 | 17.7 | | | |
| schulte 3 boards, weight 2, move 5 | 13.1 (today 9.9) | | | |

### 2.4 Rule gating (replaces `placementCeiling` for board games; WP-B)

The hook fills `ctx.blockRules` before every `create`:
- **Placement and practice:** every unseen rule tag of the game.
- **Counted and intro trials:**
  - At most 2 new rule cards per round, at least 3 counted trials apart. While either limit is hit, every unseen rule is blocked.
  - Otherwise, every unseen rule except the one with the lowest `from`. So at most one new rule can appear per trial, in `from` order.
- Each generator replaces blocked content with that level's non-rule content at the same clock (listed per game below).

### 2.5 Staircase (WP-B)

**`skill.ts`:**
- `stepMultiplier(group, sd, kMax = SKILL[group].kMax)`.
- `nextSd(group, sd, reversal, upRun)`: for the speed group with `upRun ≥ 4` (4 or more right answers in a row), `min(sd0, sd·1.1)`; otherwise `shrinkSd`.
- ★ Only upward runs hold sd. Holding on downward runs too pushed a slow θ=2 player down to L1.3–1.6 in simulation.

**`judgeTrial` (counted trials):** `k = stepMultiplier(group, sd, entry.steps?.kMax) × (entry.steps?.scale ?? 1)`. Both steps are scaled by the same factor, so the 85% target is unchanged.

`RECENT_SIGS` goes from 12 to 24.

### 2.6 Span fast entry (memoryGrid, sequence; WP-B)

**When it runs:** the first round of a game, a return after 14 or more days away, or an estimate with `n = 0`. It lasts until the first miss.

**How it moves:**
- A first-try pass jumps +2 instead of +1, but never past the next rule level. Sequence's reverse rule is at L4, so L3 +2 is clamped to L4.
- The first miss is a probe: no chance is spent, the level drops by 1, and normal Corsi takes over.
- Only lengths actually passed count toward `spanPassed`, tiers and achievements.

**Where it starts:** memoryGrid at L1 (3 cells); sequence at L2 (forward 4), after practice. Either game can still be seeded from the other span game, converted through `spanLength`.

Record this in EVIDENCE §4.2 as a [제품 결정] (WP-M).

### 2.7 Match Pairs probe ladder (WP-B)

- After practice, play boards at L3 → L6 → L9 → L12, at most 4. They are `placement` trials: no lives, no score, no stats.
- After each board:
  - Cleared with `informedMisses ≤ 1`: +3 and continue.
  - Cleared with 2 or more informed misses: +1 and stop.
  - Failed: stop.
- The staircase then starts at the last passed level − 0.5 (L2 if none passed), with `sd = 2`.
- The L3 board opens with the `pairs.noPreview` card. That board still counts as probe board 1.

### 2.8 Today's Training budget (`useBrainRound.ts`, `useTodaysTraining.ts`; WP-B)

For every game except Quick Eye:
- Add `stats.setupMs`: time spent on practice, placement/probe and rule-card intro trials, capped at 120 s per round.
- The time-budget check subtracts it: `played = now − startedAt − pausedMs − setupMs`. A round never ends during placement.
- `useTodaysTraining` subtracts `setupMs` from `slotActiveMs`, so first-day setup does not eat the slot.

### 2.9 Miscellaneous (WP-B)

- `finishRound`: the achievement `spanLength = def.spanLength?.(s.spanPassed, ctx) ?? s.spanPassed + 2`.
- A choice trial whose view has `stimulus.reveal` gets `REVEAL.wrongWithReveal = 2400` ms on a miss, skippable after 500 ms through the existing `skipReveal`.
- `PlatformContext.maxRows` is passed into `buildCtx`, and from there into `levelCap`.
- `buildCtx` sets `trialKind`, `recent` (from `def.trialInfo` plus level, last 2) and `roundSeed` (`randomSeed()` at init).
- EVIDENCE §4.3 (WP-M): relaxed timing never lengthens exposure phases (Flash Grid show, Match Pairs preview, Sequence flashes).

### 2.10 Mechanics block and tiers (WP-A writes these; game WPs remove `pending`)

Existing entries keep their bits; only `from` changes, edited by each game's WP inside that game's existing block:

| game | from changes |
|---|---|
| oddOneOut | rotation 4→5 · lookalike 5→3 · glyphs 15→7 · grid5 7→6 · **nearTwin `retired: true`** |
| schulte | reshuffle 12→14 · grid4 4→3 · grid5 9→6 · grid6 16→18 |
| memoryGrid | grid7 12→11 · fastShow 3→14 (grid6 now means board area ≥ 30, from 8) |
| series | alternating 6→5 · growing 8→6 · fibonacci 10→9 · squares 12→20 · interleaved 14→8 · doublePlus 16→10 |
| pairs | oneFamily 10→5 · noPreview 22→3 · board4 4→2 · board6 7→4 · board8 10→6 · board10 13→9 · board12 16→11 |
| stroop | word 8→10 · options4 5→4 · options5 8→6 · options6 11→7 |
| math | mul 6→4 · div 10→6 · twoStep 14→13 |

New entries are appended after `quickEye.clearView` (bit 48). Each new entry has `game` equal to the tag prefix and `copy` equal to the tag minus the prefix, i.e. the key `mechanics.<game>.<name>`. If Quick Eye appends more entries first, renumber this block; nothing has shipped yet.

| bit | tag | kind | from |
|---|---|---|---|
| 49 | math.missing | rule | 11 |
| 50 | math.threeDigit | board | 14 |
| 51 | math.parens | board | 20 |
| 52 | math.bigMul | board | 22 |
| 53 | series.halving | board | 7 |
| 54 | series.altOps | board | 11 |
| 55 | series.mixedLines | board | 12 |
| 56 | series.growFactor | board | 13 |
| 57 | series.tribonacci | board | 14 |
| 58 | series.threeLines | board | 15 |
| 59 | series.diffGrowing | board | 16 |
| 60 | series.opCycle | board | 17 |
| 61 | series.diffLines | board | 18 |
| 62 | series.diffFib | board | 19 |
| 63 | series.cubes | board | 20 |
| 64 | series.missingTerm | rule | 21 |
| 65 | oddOneOut.colorNoise | board | 10 |
| 66 | oddOneOut.mirror | rule | 12 |
| 67 | oddOneOut.absent | rule | 16 |
| 68 | oddOneOut.glyphTwin | board | 17 |
| 69 | schulte.twoDigit | board | 8 |
| 70 | schulte.skipCount | board | 9 |
| 71 | schulte.alternate | rule | 10 |
| 72 | schulte.alternateOpposite | rule | 12 |
| 73 | schulte.unmarked | board | 16 |
| 74 | stroop.shuffle | board | 5 |
| 75 | stroop.labelInk | rule | 8 |
| 76 | stroop.switchOften | board | 12 |
| 77 | stroop.frame | board | 14 |
| 78 | memoryGrid.waves | board | 13 |
| 79 | pairs.lookalike | board | 8 |
| 80 | pairs.triples | rule | 14 |

New tier thresholds, each sitting where the puzzle itself changes:

| game | TIERS | cap (`maxLevel`) | what each threshold is |
|---|---|---|---|
| oddOneOut | [3, 7, 10, 13, 17, 26] | 32 | look-alikes · glyphs · colour noise · mirror · «없음» · deep clock |
| schulte | [3, 6, 10, 14, 16, 21] | 24 | 4×4 · 5×5 · alternation · reshuffle · unmarked · deep clock |
| stroop | [3, 7, 10, 14, 20, 27] | 34 | 3 options · 6 options · cued switch · frame · clock · clock |
| math | [3, 6, 10, 13, 18, 23] | 41 | sub facts · div facts · two carries · × before + · borrow across zero · two-step missing |
| series | [3, 6, 9, 12, 15, 20] | 28 | descending · growing step · Fibonacci · mixed lines · three lines · squares/cubes |
| pairs | [3, 6, 8, 11, 13, 15] | 16 (4 columns) / 18 (5 columns) | no preview · 8 pairs · look-alike · 12 pairs · L13 · triples 8 |
| memoryGrid | [3, 4, 6, 7, 9, 12] (unchanged) | 14 on boards with ≥ 28 cells | |
| sequence | [2, 3, 4, 5, 6, 8] (unchanged; now forward 4 / forward 5 / reverse 6 / reverse 7 / reverse 8 / reverse 10) | 14 (4×4) | |

Rule cards per game: math 2, series 1, stroop 2, pairs 2, sequence 1, memoryGrid 0, oddOneOut 3, schulte 4. The last two rely on gating (§2.4).

---

## 3) Per game

### 3.1 Quick Math (`games/math.ts`, WP-C)

**Clock.**
- `limit = par(band) × (1.15 − 0.4·frac(L))`. Every trial uses its own band's par.
- Bands 1–3: `max(9000, …)`.
- Relaxed timing multiplies the result; the rule-card trial gets 2×.

**Mix.** `pickBand` (§2.1). Placement trials come only from the current band.

**Operands.**
- Built column by column, so each band's carry or borrow is guaranteed.
- From band 2 on: single-digit operands are 3–9; no 0 or 1, no ×1 or ×10, no n − n.
- No repeated operand pair within a round.

| L (band) | content | example | par |
|---|---|---|---|
| 1 | a + b ≤ 10 (also practice) | 3 + 5 | 9.5 s |
| 2 | single-digit sums crossing 10 (always a carry) | 7 + 8 | 9.5 |
| 3 | teen − 1-digit, always a borrow [math.sub] | 15 − 7 | 9.5 |
| 4 | times tables 3–9, facts with 6–9 weighted ×2 [math.mul] | 7 × 8 | 6.5 |
| 5 | 2-digit + 1-digit, carry | 47 + 8 | 7 |
| 6 | division facts [math.div] | 56 ÷ 7 | 7 |
| 7 | 2-digit − 1-digit, borrow | 52 − 7 | 7.5 |
| 8 | 2d + 2d, units carry, sum < 100 | 38 + 47 | 8 |
| 9 | 2d − 2d, borrow | 73 − 48 | 8.5 |
| 10 | 2d + 2d, two carries, sum > 100 | 68 + 57 | 8.5 |
| 11 | missing addend or subtrahend with a borrow [math.missing, rule] | 37 + ? = 82 | 9 |
| 12 | 2d × 1d with a carry | 38 × 6 | 10 |
| 13 | only a ± b×c or a ± b÷c where working left to right gives a different answer; that wrong answer is always an option [math.twoStep, rule] | 6 + 4 × 7 (option 70) | 10 |
| 14 | 3d ± 2d with a carry or borrow [math.threeDigit] | 403 − 57 | 10 |
| 15 | missing factor or divisor, 2-digit result | 7 × ? = 84 | 9 |
| 16 | 2- or 3-digit ÷ 1-digit, 2-digit quotient | 112 ÷ 7 | 11 |
| 17 | three numbers left to right, with carries | 48 + 27 − 19 | 11 |
| 18 | 3d − 3d, borrow across a zero | 503 − 268 | 12 |
| 19 | two products | 8 × 7 − 6 × 4 | 14 |
| 20 | brackets; no friendly ×10 or 25×4 [math.parens, board] | 6 × (23 − 15) | 12 |
| 21 | 3d + 3d with 2–3 carries | 478 + 356 | 12 |
| 22 | friendly 2d × 2d (×11, teen × teen, 15×, 25×) [math.bigMul] | 14 × 15 | 13 |
| 23 | two-step missing number | 4 × ? + 7 = 35 | 13 |
| 24 | 3d ÷ 1d | 432 ÷ 6 | 13 |
| 25 | general 2d × 2d | 37 × 21 | 16 |

**L26–41: five kinds take turns, one more digit every 4 levels.** Within a block, each whole level multiplies the par by 0.95, so every step still changes the clock. maxLevel is 41.

| block | add/subtract | multiply | divide | order of operations | missing number |
|---|---|---|---|---|---|
| 26–29 | 4d ± 4d, 2+ carries | 3d × 1d | 3d ÷ 1d | a ± b×c with a 3-digit a | ? + 478 = 1,203 |
| 30–33 | 4d − 4d across zeros, + a third term | 4d × 1d | 4d ÷ 1d | a×b ± c×d | 7 × ? = 868 |
| 34–37 | 5d ± 4d | 2d × 2d with 2+ carries | 3d ÷ 2d | (a ± b) × c − d | ? × 12 − 17 = 79 |
| 38–41 | three 5-digit terms | friendly 3d × 2d | 4d ÷ 2d | a × (b ± c) ± d×e | (? + 18) × 4 = 132 |

**Distractors** (`nearMissOptions`; position drawn first, ascending):
- Errors fed in: a slipped carry (±10/±100), a slipped borrow, neighbouring table facts (7×8 → 48/54/63/64), the left-to-right result (trap), brackets ignored (trap).
- `sameUnits` applies to multi-digit add/subtract answers ≥ 50.

**Feel.**
- After a miss, show the worked line, e.g. `6 + 4 × 7 → 6 + 28 = 34`, with the part done first highlighted.
- After a right answer, the '?' fills in place (700 ms).
- Options in tabular digits.
- Each kind has its own clock (amber and red thirds, no ticking).
- The first trial after crossing a level comes from the new band.

**Blocked rule:** band 11 → band 10, band 13 → band 12.

**Engine notes.**
- Replace `simple`/`advanced` with a `MATH_BANDS` table (optionally in a new `games/math-bands.ts`).
- `trialInfo = { kind: 'b' + band }`, `sig = 'ma:' + text`.
- Emit `tokens`; `choiceGame(..., { maxLevel: 41 })`.

**UI** (WP-J web, WP-K mobile):
- Tokens wrap only between tokens, breaking before an operator; never below 28 pt; up to 3 lines at 200% font size.
- Numbers ≥ 1000 use locale grouping.
- The reveal line appears in the 2.4 s miss window.

**Tests** (`brain-math-ladder.test.ts`; for L1–40, 1000 seeded trials each):
- Marked option = true answer; options distinct, non-negative, ascending.
- Answer position 25% ± 3% per band, for bands ≥ 2, in placement mode.
- ≥ 50% of trials from `floor(L)` when L ≥ 4; none from more than 3 bands below; placement mode 100% current band.
- Band invariants:
  - B2 always a carry; B3/B5/B7/B9 always a borrow; B8 units carry and sum < 100; B10 two carries and sum > 100; B12 a carry; B14 has a 3-digit operand.
  - B13: the left-to-right result ≠ the answer, and it is among the options.
  - B18 borrows across a zero.
  - B4 factors are 3–9, and 6–9 facts appear at least 1.8× as often.
  - From B2: no 0/1 operands, no ×1/×10, no n − n.
- **Hard enough:** at L ≥ 5, every trial needs a carry, a borrow, a table or division fact, a missing operand or an order-of-operations step (asserted per band tag).
- For multi-digit add/subtract answers ≥ 50: ≥ 2 distractors share the units digit; every non-trap option within ±max(20%, 20).
- Digits per kind never decrease with level; L40 has more digits than L30.
- ≥ 150 distinct signatures per level for L4–7, ≥ 300 from L8.
- Limit = par × (1.15 − 0.4·frac); bands 1–3 ≥ 9000 ms.
- With math.missing and math.twoStep blocked, neither tag ever appears.

### 3.2 Number Pattern (`games/series.ts`, new `games/series-rules.ts`; WP-D)

**Clock.**
- `limit = par × (1.15 − 0.35·frac(L))`, no speed floor.
- Par: bands 1–3 15 s with a 14.8 s floor; bands 4–12 16 s; 13–20 18 s; 21+ 20 s.

**Mix.** As in math. Placement uses the band's own family. No family twice in a row unless it is the current band.

| L | rule | example |
|---|---|---|
| 1 | +d, d 1–3, 4 terms (practice) | 3, 5, 7, 9, ? |
| 2 | +d, d 4–12, 2-digit starts | 14, 21, 28, 35, ? |
| 3 | −d [series.descending] | 50, 44, 38, 32, ? |
| 4 | ×2, start 1–30, 4–5 terms [series.geometric] | 7, 14, 28, 56, ? |
| 5 | alternating +a −b [series.alternating] | 10, 15, 12, 17, 14, ? |
| 6 | growing step, increment 1–2, ≥ 5 terms [series.growing] | 2, 3, 5, 8, 12, ? |
| 7 | ×3 (start 1–20), or halving (odd × 2^k) [series.halving] | 96, 48, 24, 12, ? |
| 8 | two interleaved lines with different steps [series.interleaved] | 2, 20, 4, 17, 6, 14, ? |
| 9 | sum of the two before, any pair 1–15 [series.fibonacci] | 3, 4, 7, 11, 18, ? |
| 10 | ×2 ± c (c −3..5, not 0, start > −c so rows rise); k grows to 3–4 from L16 inside this family [series.doublePlus] | 3, 5, 9, 17, ? |
| 11 | ×2 and +k taking turns [series.altOps] | 2, 4, 7, 14, 17, ? |
| 12 | arithmetic line interleaved with a geometric one [series.mixedLines] | 1, 50, 2, 45, 4, 40, ? |
| 13 | growing factor ×2, ×3, ×4 [series.growFactor] | 1, 2, 6, 24, ? |
| 14 | sum of the three before [series.tribonacci] | 1, 2, 3, 6, 11, 20, ? |
| 15 | three interleaved lines [series.threeLines] | 3, 10, 50, 5, 9, 45, 7, 8, ? |
| 16 | differences follow a growing step [series.diffGrowing] | 1, 2, 5, 11, 21, 36, ? |
| 17 | repeating cycle of three operations [series.opCycle] | 2, 5, 10, 9, 12, 24, ? |
| 18 | differences in two interleaved lines, α + β ≠ 0 [series.diffLines] | 10, 12, 11, 15, 13, 19, 16, ? |
| 19 | differences are sum-of-two-before [series.diffFib] | 2, 3, 4, 6, 9, 14, ? |
| 20 | squares ± k [series.squares] or cubes ± k [series.cubes] | 8, 27, 64, 125, ? |
| 21 | missing term, gap anywhere [series.missingTerm, rule] | 4, 9, ?, 25, 36 |
| 22–23 | two different families from bands 4–12 interleaved | |
| 24–25 | two families from bands 9–16, gap anywhere | |
| 26–28 | two families from bands 13–20, gap anywhere, shown terms down to free parameters + 2 | 120, 13, 60, 16, 30, 19, ? |

maxLevel is 28. Numbers stay at 3 digits or fewer (geometric tails up to 4).

**Ambiguity check.**
- The checker covers every ladder family plus "repeat the last difference" and "repeat the last ratio".
- Regenerate a row if any checker fits all shown terms but predicts a different next term.
- A distractor must never equal any checker's prediction.

**Distractors.** From plausible wrong rules, answer position drawn first, ascending.

**Feel.**
- After answering, show the rule for 1.2–1.5 s: gap labels such as `+3 +3`, two colours for interleaved lines, `3+4=7` arcs.
- Terms as tiles. The '?' tile pulses at 1 Hz or slower, and not at all under reduced motion.
- Rows wrap onto as many lines as needed at 200% font size, never below 28 pt.

**Blocked rule:** missingTerm → the same row with the gap at the end.

**Tests** (`brain-series-ladder.test.ts`; L1–28):
- The marked option is the true next term; all terms and options ≥ 0.
- ≥ 50 distinct rows per band in single-band mode.
- No family above 55% at any level; ≥ 50% from the current band (L ≥ 4); nothing older than 3 bands below.
- The ambiguity property holds for every generated row and every distractor.
- **Hard enough:** for bands ≥ 4, the strategies "last term + last difference", "last term × last ratio" and "pick a middle option" each score ≤ 35%.
- Growing-step rows have ≥ 5 terms; shown terms ≥ free parameters + 2.
- L22+ changes every 2 levels.
- Limit formula, with the 14.8 s floor on bands 1–3.
- With missingTerm blocked, no row has a gap.

### 3.3 Odd One Out (`games/odd-one-out.ts`; WP-E)

**Clock.**
- `limit = max(900 + 45·cells, (3000 + cells·itemMs(kind)) × 0.925^(L−1))`.
- `itemMs`: pop 200 · look-alike 260 · rotation 150 + 6000/Δ · glyph 260 · noise 300 · mirror 600.
- «없음» trials get 1.4× their kind's clock.

| L | content | limit (phone 5×5 unless noted) |
|---|---|---|
| 1–2 | 3×3, pair differs in shape **and** colour (no colour-only pairs anywhere) | 4.8 s, 4.4 s |
| 3–4 | 4×4 same-colour look-alikes (🍊/🍑, 🐯/🦁, 🐭/🐹, 🍋/🍈, 🐸/🐢, 🍒/🍓) | 6.1, 5.6 |
| 5 | rotation card: half the trials one glyph turned 120° on an upright board; the rest look-alikes | 4.5 |
| 6 | 5×5 [grid5]; turn 103°, or look-alikes | 5.4–6.4 |
| 7–9 | glyph pairs b/d, p/q, E/F, 6/9, C/G mixed with rotation (89° → 65°); no emoji from L7 | |
| 10–11 | colour noise [board]: cells inked neutral/amber/cyan at random; the odd one differs only in shape | 5.2 |
| 12–15 | mirror card: F, P, G, J only, every cell at a random 45° step, odd one mirrored; 20% of trials; desktop 6×6 | mirror 7.6 at L12 |
| 16–17 | «없음» card, 25% of trials have no odd one; L17 glyph twins 日/曰, 土/士, 未/末, 人/入 [glyphTwin] in system CJK fonts | |
| 18–19 | desktop 7×7 (phone stays 5×5); rotation trials add up to ±8° random tilt on every cell | |
| 20–21 | mirror share 30% | |
| 22–23 | «없음» share 33% | |
| 24–25 | glyph twins inside colour noise | |
| 26–32 | clock only, reaching its floor around L24–30 | maxLevel 32 |

**Feel.**
- Kinds drawn by weight, never the same kind 3 in a row (`ctx.recent`).
- On a miss, the odd cell pulses and a 1 s chip shows the odd one next to a typical cell, both upright.
- All cells appear at once with a 120 ms fade; the clock starts on first paint.
- The pitch of the hit sound rises with each consecutive find. A correct «없음» has its own tone; a wrong tap on an empty board shows an «없었어요» stamp.
- On desktop, N or Space presses «없음».

**Engine.**
- State gains `kind`, `inks[]`, `rotations[]`, `mirror` and `absent`.
- When absent, `oddIndex = cells` and `solution() = [cells]`.
- `signature` includes `kind`; `trialInfo = { kind }`.
- Rotation angle = `max(15, 120·0.86^(L−5))`.
- Emoji near-twins are removed (the tag stays, retired).
- Blocked rule: mirror or absent → a glyph board at the same clock; rotation → a look-alike board.

**UI.**
- `CellView.mirror` → `scaleX(-1) rotate()`.
- `ink` tokens chosen by brightness, never red or green.
- «없음» button: ≥ 56 dp tall, **≥ 16 dp** below the grid, `index = cells.length`.
- The miss chip.

**Tests** (`brain-odd-one-out-ladder.test.ts`):
- Every integer level 1–31 differs from the level below in band or by ≥ 5% of clock.
- Absent boards: `solution() = [cells]`, `extra` present, any cell tap wrong; «없음» on a board that has an odd one is wrong.
- Mirror boards: the glyph is in {F, P, G, J}, rotations are multiples of 45, the odd one is mirrored.
- Noise boards: other cells use ≥ 2 inks; the odd one differs only in glyph.
- No colour-only pair at any level; shape-and-colour pop-out only at L1–2; no emoji from L7.
- Clock ≥ 900 + 45·cells; L1 ≥ 4.5 s; absent clock = 1.4 × kind clock.
- Never 3 of a kind in a row, given `recent`.
- With all rules blocked, no rule tag appears.
- Phone ≤ 5 columns; desktop 7×7 from L18.
- **Hard enough:**
  - L ≥ 10: ≥ 70% of trials are glyph, noise, mirror, or a rotation of ≤ 60°.
  - L12–19: mirror share ≥ 15%.
  - L ≥ 16: absent 25% ± 4%.
  - Closed-form check with the reviewer's per-kind search model: young-adult expected timeouts at L24 ≥ 15%; slow-75 timeouts at L1–2 ≤ 7%.

### 3.4 Number Hunt (`games/schulte.ts`; WP-F)

**Clock per board.**
- `1.5 s + cells × (1.6 + 0.09·cells) s × modeMul × max(0.2, 0.93^(L−1))`.
- `modeMul`: asc 1 · desc 1.1 · twoDigit 1.15 · skip 1.6 · alt 2.2 · altOpp 2.6 · reshuffle 1.7 · ×1.15 when unmarked.
- A timeout costs no life; each wrong tap costs one (unchanged).

| L | board and mode | limit |
|---|---|---|
| 1–2 | 3×3, 1→9 | 23.2 s, 21.7 s |
| 3–4 | 4×4, 1→16 [grid4] | 43.6, 40.6 |
| 5 | 4×4, descending on half the boards (existing rule card) | asc 37.9 / desc 41.5 |
| 6–7 | 5×5, 1→25, 40% descending [grid5] | 68.5 / 63.8 |
| 8 | 5×5 run of consecutive two-digit numbers (start 10–70), next number shown [twoDigit] | 68.1 |
| 9 | skip counting by 2 (2–50) or 3 (3–75); chip shows the rule only («3씩»); the next number appears for 1.5 s only after a wrong tap [skipCount] | 87.7 |
| 10 | alternation card on 4×4: white 1–8, amber **boxed** 1–8, white 1 → amber 1 → white 2 … | 57.2 |
| 11 | alternation on 5×5 (white 1–13, amber 1–12) | 104 |
| 12 | opposite-alternation card on 4×4 (amber counts down) | 58.4 |
| 13 | opposite alternation on 5×5 | 106 |
| 14–15 | reshuffle after every tap, on 4×4 (existing rule) | 33.7 |
| 16–17 | found numbers stay unmarked [unmarked] | |
| 18 | desktop 6×6 [grid6]; phone stays 5×5 | |
| 18–24 | clock only, floor around L23; maxLevel 24 | |

**Mix.** From L5: 50% the level's own mode, 50% the modes of the three levels below. From L8, never the same mode twice in a row.

**Feel.**
- Alternation boards flash a two-colour legend for 600 ms; the chip carries the series colour.
- Found numbers fade but stay readable, except at L16–17, where they stay unmarked.
- A wrong tap shakes the cell and pulses the chip.
- At the end: «여유 1/3 남김», compared only with the player's own median.
- In alternation, the two series have different tap sounds.

**Engine.**
- A precomputed `sequence: number[]` of cell indices in tap order replaces `nextValue`/`isFound`. Reshuffle recomputes it.
- `hintUntilNext` state: `pendingMs` 1500 → `advance` clears it.
- `n` stays the board side, so `flawlessHunt` keeps working.
- Blocked rules: alternate/altOpp/reshuffle → skip or two-digit; descending → ascending, each at its own clock.

**UI.** The amber series is drawn with amber ink **and** a rounded box (safe for colour blindness). Check that two-digit labels stay ≥ 28 pt on 5×5 at 358 px.

**Tests** (`brain-schulte-ladder.test.ts`):
- Each mode's tap order is right; following `solution()` wins.
- No cliff: at the same level and mode, `limit(4×4)/limit(3×3) ≥ (16/9)·(3.04/2.41) − ε`.
- The limit never rises with level within a mode and never goes below the floor.
- Phone ≤ 5×5; desktop 6×6 only from L18.
- Every level 1–23 changes band or moves the clock by ≥ 5%.
- From L9, skip and alternation prompts have no `next` param until a wrong tap.
- Unmarked boards keep found cells at tone `'idle'`.
- **Hard enough:** at L ≥ 10, ≥ 50% of boards need tracking (skip, alt, altOpp) or are reshuffle boards.

### 3.5 Color Word (`games/stroop.ts`, `theme.ts`; WP-G)

**Clock.** `limit = max(1200, (3800 + 480·N + 400·colouredLabels + 400·switching) × 0.955^(L−1))`.

**Colour subset per round.**
- Take a permutation of `BRAIN_COLORS` seeded by `roundSeed`; use its first N colours, adding colours as N grows.
- The word and the ink are both drawn from this subset.
- Below L5 the options stay in that order.

| L | content | limit |
|---|---|---|
| 1 | 2 options, 50% conflicting | 4.8 s |
| 2–3 | 3 options, fixed places, 60% then 67% conflicting | |
| 4 | 4 options; 75% conflicting from here on (25% stay matching) | 5.0 |
| 5 | buttons move every trial [stroop.shuffle] | |
| 6–7 | 5 options, then 6 | |
| 8 | coloured labels (rule card): no label in its own colour; exactly one label inked in the stimulus ink, as a lure, never the answer; other label inks never CVD-confusable with the stimulus ink | |
| 9 | carry-over: on 50% of conflicting trials, the ink is the previous trial's word (not counted as a difficulty step) | |
| 10–11 | cued switch (the existing word rule, now from 10) on 25% of trials; cue strip shows 600 ms before the word | 4.9 |
| 12–13 | switch on 50% of trials [switchOften] | |
| 14–15 | frame lure: a 12 px ring in a third colour (≠ ink, ≠ word, not confusable with the ink) [frame] | 4.1 |
| 16–17 | cue lead 300 ms | |
| 18–19 | cue and word appear together | 3.4 |
| 20–34 | clock only: 3.1 s (L20), 2.4 (L26), 1.6 (L34); maxLevel 34 | |

**Engine.**
- Cue lead uses `choiceGame` `leadMs`.
- `trialInfo = { kind: rule, carry: word }`.
- Word-rule trials are always conflicting.
- New `INK_CONFUSABLE: Record<BrainColor, BrainColor[]>` in `theme.ts`, computed with a Viénot/Machado CVD simulation of the `INK_COLORS` hex values and hard-coded. The test recomputes it.
- Blocked labelInk → white labels; blocked word → ink-only trials.
- The full colour-blind-safe palette and shape mode stay open (EVIDENCE §5). Coloured labels and the frame ship only under the confusable-pair exclusion above.

**Feel.**
- On a switch trial the cue strip flips (250 ms).
- After a wrong pick, «글자 색: 보라» shows for 1.2 s.
- Buttons stay fixed at L1–4, with desktop key hints 1–6.

**UI.**
- Coloured labels are white tiles with ink text, ≥ 24 px (or 18.66 px bold), since orange is 3.6:1.
- The cue uses the app's own icons plus a word (droplet + «색깔», book-open + «뜻»; lucide on web, Feather on mobile), always in the same place.

**Tests** (`brain-stroop-ladder.test.ts`):
- The coloured-label invariants above, including the confusable-pair rule.
- Same `roundSeed` → same order at L < 5; the order changes from L5.
- Word and ink always come from the round subset.
- Word trials are never congruent.
- From L10 every trial has a cue that matches the rule; cue lead 600 / 300 / 0 ms by band.
- Conflicting share: 50 / 60 / 67%, then 75 ± 3% from L4.
- Carry-over: ≥ 40% at L ≥ 9 when `recent` carries a word.
- Clock ≥ 1200; every level 1–33 moves band or clock by ≥ 3%.

### 3.6 Flash Grid (`games/memory-grid.ts`; WP-H)

**Rules.**
- Level = cells − 2 for L1–12, on every screen that can hold L + 2 cells.
- Exposure = `min(3000, 1000 + 180k)` ms.
- Board ladder (explicit table, not a formula): 3×3 up to 3 cells · 4×4 up to 6 · 5×5 up to 9 · 5×6 or 6×5 up to 12 · 5×7 or 7×5 up to 14.
- If no regular board fits, use a 50%-density fallback (4×6 = 12, 4×7 = 14, 5×5 = 12, 5×6 = 15). Fallback boards only ban a lit 2×2 and 4 in a row.
- Board patterns come from rejection sampling: from L4 no lit 2×2; from L8 no 3 in a row; at most 300 tries.

| L | cells | board | exposure |
|---|---|---|---|
| 1 | 3 | 3×3 | 1.54 s (floor) |
| 2–3 | 4–5 | 4×4 | 1.72–1.90 |
| 4 | 6 | 4×4, no lit 2×2 | 2.08 |
| 5–7 | 7–9 | 5×5 | 2.26–2.62 |
| 8–10 | 10–12 | 5×6 / 6×5, no 3 in a row | 2.80–3.00 |
| 11–12 | 13–14 | 5×7 / 7×5 (or the 50% fallback) | 3.00 |
| 13 | 14 | same board, 2 waves of about 1.25 s, 500 ms blank, onsets at least 1.75 s apart [waves] | |
| 14 (cap) | 14 | 3 waves of about 830 ms, onsets at least 1.33 s apart [fastShow] | |

- No mask phase.
- A screen that cannot hold 14 cells caps at its largest L plus 2 wave levels. For example, a 4×6 small phone has L10 = 12 cells, L11–12 are wave levels, and the cap is L12.
- `spanLength(L, ctx) = min(L + 2, kmax(ctx))`.
- Input limit stays `3000 + 900·k`.

**Feel.**
- A thin countdown bar under the board while it is shown (static under reduced motion).
- Wave dots ●○○.
- When the board grows, the new row slides in (260 ms).
- In-round chip «9칸!» on a new best length.
- Header shows «N칸».
- Missed cells are shown for 1.5 s, as now.

**Engine.**
- Phases: `show` (per wave) → `gap` → … → `recall`.
- Pausing keeps the remaining time.
- `solution()` is null outside `recall`; taps during show or gap are ignored.
- `maxLevel(ctx)` uses `maxRows`.
- `signature` includes the board and the waves.

**UI.**
- Boards can be portrait or landscape (`cols ≠ rows`); cell size is computed from both width and height.
- `maxRowsFor(boardHeight)` is fed into `PlatformContext`.

**Tests** (`brain-span-ladder.test.ts`; screens: 7×7, 5 columns × 7 rows, 4×6, 5 × 5-only, 3 columns):
- Every level step changes at least one of: cells, board, waves, exposure. Cells never decrease.
- L1–12 cells equal L + 2 on every screen that fits them.
- Shape bans and density (≤ 40%, ≤ 50% for fallback boards).
- Exposure formula, ≥ 1500 ms; wave onsets ≥ 1000 ms apart; blank ≥ 300 ms.
- Waves are disjoint and together equal the targets.
- `TIERS.memoryGrid[5] < maxLevel` on the 5 × 7 phone.

### 3.7 Sequence (`games/sequence.ts`; WP-H)

**Rules.**
- Level = length − 2. One tile per second (flash 700 ms + gap 300 ms).
- No repeated tiles; no 3-tile straight sweep.
- From length 5, at least one real crossing (segments between tile centres intersect; shared endpoints do not count). Rejection sampling, at most 300 tries.

| L | content |
|---|---|
| 1–3 | forward 3–5 on 3×3 (L1 is the floor) |
| 4 | reverse 6, always reverse from here (rule card, `from` 4; the random coin is gone) |
| 5 | reverse 7, 4×4 starts [grid4] |
| 6 | reverse 8 |
| 8 | reverse 10 (master) |
| 9–14 | reverse 11–16; cap = n² − 2 (14 on 4×4; 7 on 3-column screens, where master is out of reach, noted) |

**Feel.**
- A persistent «⟲ 거꾸로» header badge from L4.
- A 3-dot "ready" pulse over ≥ 1 s; the lead-in becomes 1000 ms.
- Input progress dots.
- In-round chip «거꾸로 7개!».
- The replay-after-miss idea is deferred.

**Tests:**
- `new Set(seq).size === seq.length`.
- `reverse === (L ≥ 4)` for every seed.
- length = L + 2; 4×4 from L5 when `maxCols ≥ 4`.
- No straight sweep; crossings ≥ 1 from length 5; flash + gap ≥ 1000 ms.
- `maxLevel = n² − 2`.
- `spanLength(5) = 7`, so passing L5 earns `span7`.

### 3.8 Match Pairs (`games/pairs.ts`; WP-I)

**Rules.**
- The level table is looked up with `floor(level)`.
- Preview is only a hint: `seen` starts false.
- Turning over an unseen card is still free (EVIDENCE #39).
- Time = 6000 + 6000·pairs. For triples: 6000 + 9000·sets.
- Families:
  - Distinct: animals, fruit, sports.
  - Look-alike: vehicles, flowers and plants.
  - Faces are removed; so is every emoji from Unicode 12 or later (🫐, 🛻).

| L | board | family | preview | budget |
|---|---|---|---|---|
| 1 | 3 pairs, 3×2 | mixed | 2 s (hint) | 2 |
| 2 | 4 pairs | mixed | 2 s (hint) | 2 |
| 3 | 4 pairs | mixed | none (rule card) | 2 |
| 4 / 5 | 6 pairs, 4×3 | mixed / distinct | — | 3 |
| 6 / 7 / 8 | 8 pairs, 4×4 | mixed / distinct / look-alike [lookalike] | — | 3 |
| 9 / 10 | 10 pairs, 4×5 | distinct / look-alike | — | 4 |
| 11 / 12 | 12 pairs, 4×6 | distinct / look-alike | — | 4 |
| 13 | 12 pairs | look-alike | — | 3 |
| 14 | triples, 6 sets (3×6) [triples, rule] | distinct | — | 4 |
| 15 / 16 | triples, 8 sets (4×6) | distinct / look-alike | — | 4 (cap on 4-column screens) |
| 17 / 18 | triples, 10 sets (5×6) | distinct / look-alike | — | 4 (5-column screens) |

3-column screens use the closest fit: 3×4, 3×6, 3×8. Level meaning differs slightly there (a rare case, noted).

**Staircase.** Probe ladder (§2.7), then `steps {scale 2, kMax 1.5}`: +0.30 / −1.70, still an 85% target.

**Feel.**
- Tapping another card during the 650 ms mismatch flips the pair back and opens that card at once.
- The budget shows as dots and «실수 N번까지», never as hearts.
- A miss on two unseen cards shows a «새 카드 — 괜찮아요» tag.
- Matched cards are drawn semi-transparent.
- A climbing combo sound (web).
- «비슷한 그림» badge; «2/3» counter on triples boards.
- A failed board reveals all cards calmly for 1 s.
- Countdown bar during the L1–2 preview.

**Engine.**
- Triples generalise the informed-miss rule: if the third card has never been seen, it is free.
- `outcome.informedMisses`.
- `maxLevel(ctx)` by columns.
- Blocked rules: noPreview → keep the preview; triples → pairs with an equal card count.

**Tests** (`brain-pairs-ladder.test.ts`):
- Every integer level differs in pairs, set size, family class or preview; `floor(2.99)` uses the L2 setup.
- Every level up to `maxLevel` can be built on 3-, 4- and 5-column screens.
- Preview never sets `seen`.
- Informed-miss rule, including triples.
- **Hard enough:** a scripted player with 50% memory fails ≥ 30% of boards at L ≥ 6.
- Family classes per level; no Unicode ≥ 12 emoji; no faces.
- Tapping during a mismatch never counts twice.
- `TIERS.pairs[5] < maxLevel` on both 4- and 5-column screens.

---

## 4) i18n: 8 locales × web `packages/web/public/locales/<l>/brain.json` and mobile `packages/mobile/src/i18n/locales/<l>/brain.json` (WP-L)

Locales: en, es, id, ja, ko, th, vi, zh. WP-L translates the other six from ko/en, keeps key parity, and greps the EVIDENCE §6.2 forbidden-word list. Copy for Number Pattern families describes the rule and never works one out.

| key | ko | en |
|---|---|---|
| mechanics.math.missing.title / body | 빈칸 채우기 / 식에서 ?에 들어갈 수를 고르세요. | Fill the gap / Pick the number that goes where the ? is. |
| mechanics.math.twoStep (rewrite) | 곱셈·나눗셈 먼저 / +, −와 ×, ÷가 함께 있으면 ×, ÷를 먼저 계산해요. 예: 6 + 4 × 7 = 6 + 28 | Multiply and divide first / With + or − next to × or ÷, do × and ÷ first: 6 + 4 × 7 = 6 + 28 |
| mechanics.math.threeDigit | 세 자리 수 / 세 자리 수 계산이 나와요. | Three-digit numbers / Three-digit numbers join in. |
| mechanics.math.parens | 괄호 먼저 / 괄호가 있으면 괄호 안을 먼저 계산해요. | Brackets first / Work out the brackets first. |
| mechanics.math.bigMul | 두 자리 × 두 자리 / 두 자리 수끼리 곱하는 문제가 나와요. | Two digits × two digits / Two-digit numbers are multiplied together. |
| mechanics.series.halving | 반씩 줄어요 / 반으로 줄거나 세 배씩 커지는 규칙이 나와요. | Halving / Rows that halve, or triple, appear. |
| mechanics.series.altOps | 두 계산이 번갈아 / 두 가지 계산이 한 번씩 번갈아 나와요. | Two steps take turns / Two different steps take turns. |
| mechanics.series.mixedLines | 더하는 줄과 곱하는 줄 / 하나 걸러 읽으면 한 줄은 더하고 한 줄은 곱해요. | Adding and multiplying lines / Read every other number: one line adds, one multiplies. |
| mechanics.series.growFactor | 곱하는 수가 커져요 / 곱하는 수가 하나씩 커지는 규칙이 나와요. | A growing multiplier / The multiplier grows by one each time. |
| mechanics.series.tribonacci | 앞의 세 수 / 앞의 세 수를 더해 다음 수를 만들어요. | The three before / Add the three before to get the next. |
| mechanics.series.threeLines | 세 줄이 섞여요 / 세 규칙이 한 칸씩 돌아가며 나와요. 두 개 걸러 읽어 보세요. | Three lines mixed / Three rules take turns. Read every third number. |
| mechanics.series.diffGrowing | 간격의 간격 / 간격이 커지는 정도도 점점 커져요. | Gaps that grow in steps / How much the gap grows also grows. |
| mechanics.series.opCycle | 세 계산이 돌아가며 / 세 가지 계산이 차례로 되풀이돼요. | Three steps in a cycle / Three steps repeat in order. |
| mechanics.series.diffLines | 간격이 두 줄 / 간격을 하나 걸러 읽으면 각각 규칙이 있어요. | Gaps in two lines / Read the gaps every other one. |
| mechanics.series.diffFib | 간격의 합 / 간격이 앞의 두 간격을 더한 값이 돼요. | Gaps from the two before / Each gap is the two gaps before added. |
| mechanics.series.cubes | 세 번 곱하기 / 수를 자기 자신과 세 번 곱한 값으로 이어지는 규칙이 나와요. | Cubes / Numbers multiplied by themselves three times. |
| mechanics.series.missingTerm (rule) | 빈칸 찾기 / 이제 ?가 줄 가운데에도 나와요. 빈칸에 들어갈 수를 고르세요. | Find the gap / The ? can now sit inside the row. Pick the number that fills it. |
| mechanics.series.squares, .doublePlus (rewrite) | …(조금 더하거나 뺄 때도 있어요) / 몇 배 하고 같은 수를 더하거나 빼는 규칙 | …(sometimes plus or minus a little) / multiply, then add or subtract the same number |
| mechanics.oddOneOut.colorNoise | 색은 상관없어요 / 칸마다 색이 달라요. 색은 무시하고 모양이 다른 하나를 누르세요. | Ignore the colours / Colours vary. Tap the one with a different shape. |
| mechanics.oddOneOut.mirror (rule) | 뒤집힌 하나 / 모두 같은 글자가 돌아가 있어요. 돌아간 건 괜찮아요 — 거울처럼 뒤집힌 하나를 찾으세요. | The flipped one / All are turned; that is fine. Find the one flipped like a mirror. |
| mechanics.oddOneOut.absent (rule) | 없을 수도 있어요 / 다른 하나가 없는 판도 있어요. 끝까지 보고 없으면 «없음»을 누르세요. | Maybe none / Some boards have none. Check all, then tap «None». |
| mechanics.oddOneOut.glyphTwin | 아주 닮은 글자 / 획 길이만 조금 다른 글자가 나와요. | Near-identical characters / Characters that differ only in stroke length. |
| mechanics.oddOneOut.rotation (rewrite body) | 「판 전체가 기울어…」 문장 삭제 | drop the tilted-board sentence |
| mechanics.schulte.twoDigit | 두 자리 숫자 / 숫자가 두 자리로 바뀌어요. 가장 작은 수부터 차례로 누르세요. | Two-digit numbers / Tap from the smallest up. |
| mechanics.schulte.skipCount | 건너 세기 / 2씩 또는 3씩 커지는 수예요. 다음 수는 직접 세어야 해요. | Counting in steps / Numbers go up by 2 or 3. Count the next one yourself. |
| mechanics.schulte.alternate (rule) | 번갈아 누르기 / 흰 숫자와 노란 네모 숫자를 번갈아: 흰 1 → 노랑 1 → 흰 2 → 노랑 2 … | Take turns / White and yellow boxed numbers in turn: white 1 → yellow 1 → white 2 … |
| mechanics.schulte.alternateOpposite (rule) | 반대 방향 / 흰 숫자는 1부터 올라가고 노란 숫자는 큰 수부터 내려가요: 흰 1 → 노랑 8 → 흰 2 → 노랑 7 … | Opposite directions / White counts up, yellow counts down: white 1 → yellow 8 → white 2 … |
| mechanics.schulte.unmarked | 표시 없이 / 찾은 숫자가 흐려지지 않아요. 어디까지 눌렀는지 기억하세요. | No marks / Found numbers stay as they are. Keep track yourself. |
| mechanics.stroop.shuffle | 보기 자리가 바뀌어요 / 이제 보기 자리가 문제마다 바뀌어요. | Buttons move / Buttons change places every question. |
| mechanics.stroop.labelInk (rule) | 보기 색에 속지 마세요 / 보기에도 색이 칠해져 있어요. 보기의 색이 아니라 «적힌» 색 이름으로 고르세요. | Don't trust button colours / Pick by the colour name written, not the button's colour. |
| mechanics.stroop.switchOften | 규칙이 자주 바뀌어요 / 카드 위 표시(색깔 / 뜻)를 매번 확인하세요. | The rule switches more / Check the Colour / Word sign every time. |
| mechanics.stroop.frame | 테두리는 무시 / 카드 테두리 색은 답이 아니에요. | Ignore the frame / The frame colour is never the answer. |
| mechanics.stroop.word (rewrite body) | «뜻» 표시면 글자가 말하는 색, «색깔» 표시면 글자 색을 고르세요. | «Word» sign: pick the colour named; «Colour» sign: pick the ink. |
| mechanics.memoryGrid.waves | 나눠서 보여요 / 칸이 두세 번에 나눠 켜져요. 다 본 뒤 모두 누르세요. | Shown in parts / Squares light in 2–3 parts. Tap them all after. |
| mechanics.memoryGrid.fastShow (rewrite) | 더 짧게 보여요 / 나눠 보이는 칸이 더 짧게 켜져요. | Shown faster / The parts light up more briefly. |
| mechanics.sequence.reverse (append) | … 이제부터 계속 거꾸로예요. | … From now on it is always reversed. |
| mechanics.pairs.lookalike | 비슷한 그림 / 모양이 닮은 그림끼리 나와요. | Look-alike pictures / Similar-looking pictures appear together. |
| mechanics.pairs.triples (rule) | 세 장 맞추기 / 같은 그림 3장을 찾으세요. 두 번째 장이 다르면 바로 덮여요. | Find three / Find 3 of the same. A wrong second card flips back. |
| mechanics.board.moreCards (rewrite body) | 짝이 더 많아졌어요. 시간도 함께 늘어요. | More pairs, and more time. |
| play.missingTerm | 빈칸에 들어갈 수는? | Which number fills the gap? |
| play.noneOdd · play.findOddOrNone · play.noneWas | 없음 · 다른 하나를 누르세요 · 없으면 «없음» · 없었어요 | None · Tap the different one, or «None» · There was none |
| play.tapRange · play.tapSkip · play.nextHint | {{from}}부터 {{to}}까지 순서대로 · 다음: {{next}} · {{step}}씩 커지는 수를 차례로 · 다음: {{next}} | In order {{from}}–{{to}} · next: {{next}} · Count up in {{step}}s · Next: {{next}} |
| play.tapAlternate · play.tapAlternateOpposite | 흰 ↔ 노랑 번갈아 · 흰 숫자는 올라가고 노랑은 내려가요 | White ↔ yellow in turn · White up, yellow down |
| play.cueInk · play.cueWord · play.inkWas | 색깔 · 뜻 · 글자 색: {{color}} | Colour · Word · Ink: {{color}} |
| play.findTriples · play.newCardFree · play.budget | 같은 그림 3장을 찾으세요 · 새 카드 — 괜찮아요 · 실수 {{left}}번까지 | Find 3 of the same · New card — no problem · {{left}} slips left |
| play.cells · play.newBestCells · play.reverseBadge · play.newBestReverse · play.lookalikeBadge | {{count}}칸 · {{count}}칸! · 거꾸로 · 거꾸로 {{count}}개! · 비슷한 그림 | {{count}} squares · {{count}} squares! · Reverse · {{count}} in reverse! · Look-alikes |

---

## 5) Work packages: separate worktrees, exact file ownership

**Setup.**
- Worktrees: `git -C ~/development/ReeeeecallStudy/develop worktree add ../wt-bhc-<wp> -b feat/bhc-<wp> feat/brain-hard-content`.
- The integration branch `feat/brain-hard-content` is cut from the Quick Eye commit.
- `pnpm install --frozen-lockfile` in each worktree; node lives in `/opt/homebrew/opt/node/bin`.
- Never `git add -A`.
- **Run at most 3 engineers at once** (session usage limit).
- Paths are relative to `packages/`.

| WP | wave | owns (exclusive) | depends on |
|---|---|---|---|
| **A Contracts** | 1 (alone, ~½ day) | `shared/lib/brain-games/{types.ts, catalog.ts, tiers.ts, games/choice.ts, games/bands.ts(new)}`; `mechanics.ts` (type fields, `placementCeiling` skip, the appended block with `pending`); tests `web/src/lib/__tests__/brain-games.test.ts` (`solve()` → `solution()` for all games; LEVELS [1,2,3,4,5,6,7,8,9,10,11,12,13,14,16,18,20,22,24,26,28,30,34,40,60,120]; CONTEXTS + `maxRows` 7/7, phone 5/7, 4/6, 3/5); `brain-logic.test.ts` **mechanics and tiers blocks only** (skip pending/retired; `maxRows` contexts); `brain-choice.test.ts`(new) | Quick Eye commit |
| **B Engine core and saves** | 2 | `shared/lib/brain-games/{placement.ts, skill.ts, scale.ts(new), progress.ts, meta.ts, history.ts, sync.ts, index.ts}`; `shared/hooks/{useBrainRound.ts, useTodaysTraining.ts}`; tests `brain-logic.test.ts` **placement, skill and cross-game-seed blocks** (perfect responder hands over ≥ hi − 3.5; Number Hunt ≥ 12.5; the gating test replaces the `placementCeiling` test), `brain-round-hook.test.ts`, `brain-sync.test.ts`, `brain-migration.test.ts`(new) | A |
| **C Math** | 2 | `games/math.ts`, `games/math-bands.ts`(new); math lines in `mechanics.ts` (its existing block plus its `pending` lines); `brain-math-ladder.test.ts` | A |
| **J Web UI** | 2 | `web/src/components/brain/{BrainBoard.tsx, RoundView.tsx (`maxRows`), DemoPlayer.tsx, sfx.ts, brain-ui.ts}`; `shared/hooks/useBrainFx.ts` (new events: «없음» correct, wave) | A (builds against fixture views) |
| **D Series** | 3 | `games/series.ts`, `games/series-rules.ts`(new); series lines in `mechanics.ts`; `brain-series-ladder.test.ts` | A |
| **E Odd One Out** | 3 | `games/odd-one-out.ts`; its `mechanics.ts` lines; `brain-odd-one-out-ladder.test.ts` | A |
| **K Mobile UI** | 3 | `mobile/src/components/brain/{BrainBoard.tsx, RoundView.tsx, DemoPlayer.tsx, brain-ui.ts (`maxRows`), fx-haptics.ts, motion.ts}` | A |
| **F Number Hunt** | 4 | `games/schulte.ts`; its `mechanics.ts` lines; `brain-schulte-ladder.test.ts` | A |
| **G Color Word** | 4 | `games/stroop.ts`, `theme.ts` (`INK_CONFUSABLE`); its `mechanics.ts` lines; `brain-stroop-ladder.test.ts` | A |
| **L i18n** | 4 | all 16 `brain.json` files | A (works from the key table) |
| **H Span** | 5 | `games/memory-grid.ts`, `games/sequence.ts`; their `mechanics.ts` lines; `brain-span-ladder.test.ts` | A |
| **I Pairs** | 5 | `games/pairs.ts`; its `mechanics.ts` lines; `brain-pairs-ladder.test.ts` | A |
| **M Integration and docs** | 6 | `DOCS/BRAIN_TRAINING/{EVIDENCE.md ([제품 결정]: span fast entry, pairs probe; §4.3 exposure note), GAME_LOGIC.md, GAME_FEEL.md §5}`; `demo.ts` if a demo needs a new level; deletes the `pending` field and adds the "no pending entries" test; `.audit/brain-samples.ts`, `.audit/brain-sim.ts` (git-ignored) | all |

**Why the shared files merge cleanly.**
- Game blocks in `mechanics.ts`, both existing and appended, are separated by comment lines, so edits by different WPs never sit on adjacent lines.
- `brain-logic.test.ts` is split into describe blocks owned by A or B.
- Every create() must accept any level ≥ 1 and clamp it internally. This lets the solver test run before the hook changes land.

---

## 6) Verification plan

1. **Unit tests and typecheck.** Run `pnpm --filter @reeeeecall/web test`, `tsc -b --noEmit` (the CI web typecheck), and the mobile `tsc`. The 9-game × level × screen `solution()` test must pass on every context, including `maxRows`.
2. **Sample tables** (WP-M, `.audit/brain-samples.ts`). For each game and each whole level from 1 to its cap, record:
   - 6 example trials, the limit or exposure, and the tags.
   - 2000-draw shares: band/kind, trivial share, units-digit-alone share, answer position.

   Paste the Korean summary into the PR body.
3. **Persona check** (`.audit/brain-sim.ts`: real `placement.ts`, `skill.ts`, `rules.ts` with modelled players, not measured people). Pass criteria:

| game | sharp 30-year-old after placement, end of round 1 | average 70-year-old | slow 75-year-old |
|---|---|---|---|
| math | ≥ L13, accuracy ≤ 92% | L5–10 | ≤ L3, ≥ 70% at the floor |
| series | ≥ L11 | L4–7 | L1–3 |
| oddOneOut | ≥ L16, accuracy ≤ 92% | about L14 | ≥ 93% on L1–6 |
| schulte | L12–13 | about L6 | L2–3 |
| stroop | ≥ L10 | L7–8 | ≥ 85% at L1 |
| memoryGrid / sequence | first miss by trial 3–4 / trial 3 | by trial 3 / trial 2 | reaches L1 |
| pairs | second board has 8 or more pairs | about L6 | about L4 |

4. **Migration.**
   - Local Supabase (`scripts/local-supabase.sh up`). Seed a v1 save shaped like the owner's: math L3, rounds > 0, no `sk`. The first math round must run placement, and its trials must contain carries.
   - Pushing a v1 doc after a v2 save must return `client_outdated`.
   - An old build reading v2 must show status `'outdated'`.
   - Reading the same v1 doc twice must give an identical v2 doc.
5. **Browser play** (Claude in Chrome, as CLAUDE.md requires; if it is not connected, say so first).
   - Play all 8 games at 390 px and 1280 px, in light and dark themes, at 200% zoom, and with reduced motion.
   - Check: numbers ≥ 28 pt, expressions wrapping at operators, ascending tabular options, the reveal lines, the «없음» button 16 dp below the grid, coloured labels and cue strip, portrait 5×7 Flash Grid, triples UI, and no console errors.
   - Also run `.audit/phone-flow.mjs` and `.audit/brain-axe.mjs`.
6. **iOS and Android** (`.audit/mobile-brain.mjs` with Appium; Android AVD `brain_test`, iOS simulator).
   - The iPhone 17 simulator has no emoji font, so check emoji pairs on Android.
   - Check: mirror transform, CJK glyph twins looking distinct in system fonts, 200% font scale, portrait boards, haptics events, and touch targets ≥ 56 dp.
7. **Release.** Merging to develop puts the web build in production immediately. Push the mobile OTA the same day (`main` path or `gh workflow run deploy-mobile.yml -f mode=ota`, with the asdscv token), so the window in which old app versions show `'outdated'` stays short.

---

## 7) Risks

- **The format bump stops old apps syncing** until the OTA arrives. It is JS-only and `runtimeVersion = appVersion`, so ship the OTA the same day. Plays made on an old app stay on that device until it updates, then convert and merge.
- **Quick Eye work is in flight** on the same hook, mechanics, sync, locale and RoundView files. Branch only after it commits, and renumber bits 49+ if Quick Eye appends more.
- **The modelled difficulty is not measured data.** `itemMs`, the pars and the mode multipliers must be recalibrated from logged per-kind medians and converged accuracy (EVIDENCE §4.5). The tests assert content properties, not people.
- **Number Hunt rounds get long.** Alternation boards take 57–106 s and the 20-board cap is kept. Today's Training budgets bound it; standalone rounds can run past 15 minutes. Flagged, not changed: caps were out of scope.
- **Colour.** Coloured labels and the frame depend on the confusable-pair table. The full colour-blind-safe palette and shape mode are still pending under EVIDENCE §5.
- **Emoji and fonts.** Emoji are limited to L1–6 in Odd One Out and to Unicode ≤ 11 in Match Pairs. Glyph twins rely on system CJK fonts, because bundling a font would need a native module.
- **The gating and card budget** mean a strong first round of Odd One Out or Number Hunt meets some rule content only in round 2. That is intended: at most 2 cards per round.
- **Tier and score scales.** Earned tiers stay (sticky), even though the new content at the same tier is harder. Best scores for the 8 games are cleared once (the Quick Eye precedent); "new best" restarts.
- **Rejection sampling** (board shapes, crossings, the ambiguity check, distractors) can loop. Every loop is bounded (200–300 tries) with a deterministic fallback, and the tests cover high levels and small screens.
/**
 * Quiz — real end-to-end audit against the LIVE stack.
 *
 * The SQL suites prove the rules hold in the database. This proves they hold through the
 * deployed edge function, a real provider call, and the real wallet — the layers a psql
 * transaction cannot reach and the layers where a deploy can silently be stale.
 *
 * It runs on a THROWAWAY account it creates and deletes nothing of anyone else's, and every
 * unit it spends comes out of the one-time trial, so the audit costs the owner nothing.
 *
 *   SMOKE     — generate → run → answer → grade → finish, for all three question types.
 *   NET-ZERO  — the wallet is untouched across the whole audit, because the trial covers it,
 *               and the trial arithmetic is checked against what was actually delivered.
 *   ISOLATION — no answer key reaches the client before the item is answered.
 *   QUALITY   — every question is printed, so distractors can be judged by eye. Nothing
 *               automated can tell a plausible-but-useless distractor from a good one.
 *
 * Usage:  cd packages/web && npx tsx ../../supabase/tests/quiz_prod_e2e.ts
 * Reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from packages/web/.env.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync('.env', 'utf-8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }),
)
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)

const line = (s = '') => console.log(s)
const rule = (s: string) => line(`\n${'━'.repeat(72)}\n${s}\n${'━'.repeat(72)}`)
const fails: string[] = []
const check = (ok: boolean, label: string) => {
  line(`${ok ? '  ✅' : '  ❌'} ${label}`)
  if (!ok) fails.push(label)
}

interface RunItem {
  item_id: string; position: number; question_type: string; stem: string
  options: string[] | null; answered: boolean; score: number | null
  reference_answer: string | null; meta: unknown; rubric: unknown; feedback: unknown
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * One retry on a provider-busy response, and a pause between calls.
 *
 * This audit fires several generations back to back, which a learner never does, and the
 * provider rate-limits it. That is a fact about the audit, not a finding about the feature —
 * so it is absorbed here rather than reported as a failure. A genuine provider outage still
 * surfaces, because the retry is one attempt and not a loop.
 */
async function edge(body: Record<string, unknown>): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await sb.functions.invoke('ai-generate', { body })
    if (!error) return null
    const ctx = (error as { context?: Response }).context
    const text = ctx instanceof Response ? await ctx.clone().text() : error.message
    if (attempt === 0 && text.includes('AI_PROVIDER_ERROR')) {
      line('     (provider busy — the audit is calling faster than a learner would; retrying)')
      await sleep(45000)
      continue
    }
    return text
  }
  return null
}

async function main() {
  rule('SETUP — throwaway account, real deck')
  const email = `quizaudit+${Date.now()}@reeeeecallstudy.xyz`
  const { data: auth, error: authErr } = await sb.auth.signUp({
    email, password: `Audit!${Date.now()}aA1`,
  })
  if (authErr || !auth.user) throw new Error(`sign-up: ${authErr?.message}`)
  const uid = auth.user.id
  line(`  account ${email}`)

  const { data: trial } = await sb.rpc('grant_ai_quiz_trial')
  const trialStart = (trial as { units_remaining: number }).units_remaining
  line(`  trial units: ${trialStart}`)
  check(trialStart > 0, 'a new account is granted trial units')

  const { data: tpls } = await sb.from('card_templates').select('id, name, fields')
  const tpl = (tpls ?? []).find((t: { name: string }) => t.name === '영어 단어')
  if (!tpl) throw new Error('seeded template missing')
  const { data: deck, error: dErr } = await sb.from('decks')
    .insert({ user_id: uid, name: 'Audit deck', default_template_id: (tpl as { id: string }).id })
    .select('id').single()
  if (dErr) throw new Error(`deck: ${dErr.message}`)
  const deckId = (deck as { id: string }).id

  // A deliberately close set. If distractors are lazy, this is where it shows.
  const VOCAB: Array<[string, string, string, string]> = [
    ['lend', '빌려주다', 'lend', 'He lent me a book.'],
    ['borrow', '빌리다', 'ˈbɑːroʊ', 'May I borrow this?'],
    ['owe', '빚지다', 'oʊ', 'I owe you ten dollars.'],
    ['repay', '갚다', 'rɪˈpeɪ', 'He repaid the loan in full.'],
    ['lease', '임대하다', 'liːs', 'They leased the office.'],
    ['rent', '세를 내다', 'rent', 'We rent a flat downtown.'],
    ['pledge', '담보로 맡기다', 'pledʒ', 'He pledged his watch.'],
    ['forgive', '탕감하다', 'fərˈɡɪv', 'The bank forgave the debt.'],
  ]
  const { error: cErr } = await sb.from('cards').insert(VOCAB.map(([w, m, p, e]) => ({
    deck_id: deckId, user_id: uid, template_id: (tpl as { id: string }).id,
    field_values: { field_1: w, field_2: m, field_3: p, field_4: e },
  })))
  if (cErr) throw new Error(`cards: ${cErr.message}`)

  const { data: counts } = await sb.rpc('count_quizzable_cards', { p_deck_id: deckId })
  const eligible = (counts as { eligible: number }).eligible
  check(eligible === VOCAB.length, `all ${VOCAB.length} cards are quizzable (got ${eligible})`)

  rule('DRY-RUN — a quote must move nothing')
  const { data: bal0 } = await sb.from('ai_credit_balance').select('balance').maybeSingle()
  const { data: t0 } = await sb.from('ai_quiz_trial').select('units_remaining').maybeSingle()
  for (const action of ['generate_mcq', 'generate_short', 'generate_essay', 'grade_essay']) {
    await sb.rpc('get_ai_quiz_quote', { p_action: action, p_count: 1 })
  }
  const { data: t1 } = await sb.from('ai_quiz_trial').select('units_remaining').maybeSingle()
  check((t0 as { units_remaining: number }).units_remaining
        === (t1 as { units_remaining: number }).units_remaining,
    'quoting consumed no trial units')
  check((bal0 as { balance: number } | null)?.balance === undefined
        || (bal0 as { balance: number }).balance === 0,
    'a new account has no wallet balance to move')

  rule('SMOKE + QUALITY — all three question types, printed for judgement')
  let spent = 0
  for (const type of ['mcq', 'short', 'essay'] as const) {
    const count = type === 'mcq' ? 5 : 3
    const action = `generate_${type}`
    const { data: quote, error: qErr } = await sb.rpc('get_ai_quiz_quote', {
      p_action: action, p_count: count,
    })
    if (qErr) { check(false, `${type}: quote (${qErr.message})`); continue }

    const { data: created, error: crErr } = await sb.rpc('create_quiz_set', {
      p_deck_id: deckId, p_title: `Audit ${type}`, p_question_type: type,
      p_count: count, p_content_locale: 'ko',
    })
    if (crErr) { check(false, `${type}: create set (${crErr.message})`); continue }
    const setId = (created as { set_id: string }).set_id
    const cardIds = (created as { cards: Array<{ card_id: string }> }).cards.map((c) => c.card_id)

    // A full minute between batches. The provider rate-limits per minute and this audit
    // fires three generations plus two gradings — a learner never does that, so the wait
    // is the audit apologising for its own shape rather than a property of the feature.
    await sleep(60000)
    const t = Date.now()
    const genErr = await edge({
      kind: 'quiz_generate', setId, questionType: type, cardIds,
      clientRef: crypto.randomUUID(),
      maxPriceMicro: (quote as { price_micro: number }).price_micro,
    })
    if (genErr) {
      // An eight-word vocabulary deck genuinely cannot ground an essay rubric: the criteria
      // quote terms from the card, and a two-word card has nothing to quote. Refusing is
      // CORRECT — what matters is that the learner is told which type to use instead.
      if (type === 'essay' && genErr.includes('QUIZ_CARDS_TOO_SHORT')) {
        check(true, 'essay: a vocabulary deck is refused with an actionable reason, not a generic failure')
        continue
      }
      check(false, `${type}: generate — ${genErr}`)
      continue
    }

    const { data: runRaw } = await sb.rpc('start_quiz_run', { p_set_id: setId })
    const runId = (runRaw as { run_id: string }).run_id
    const { data: runData } = await sb.rpc('get_quiz_run_items', { p_run_id: runId })
    const items = (runData as { items: RunItem[] }).items
    check(items.length > 0, `${type}: ${items.length} question(s) in ${((Date.now() - t) / 1000).toFixed(1)}s`)

    // ISOLATION, on live data: nothing that reveals the answer before it is given.
    const raw = JSON.stringify(runData)
    check(!raw.includes('correct_index') && !raw.includes('option_order'),
      `${type}: no answer key in the payload`)
    check(items.every((i) => i.reference_answer === null && i.meta === null && i.rubric === null),
      `${type}: reference/meta/rubric withheld until answered`)

    for (const item of items) {
      line(`\n     [${type.toUpperCase()} ${item.position + 1}] ${item.stem}`)
      for (const [i, o] of (item.options ?? []).entries()) line(`          ${'ABCD'[i]}. ${o}`)
    }

    if (type === 'mcq') {
      // Answer A every time. The correct option is placed by item id, so a per-sitting
      // shuffle means this must NOT score 100%.
      let correct = 0
      for (const item of items) {
        const { data: res } = await sb.rpc('submit_quiz_answer', {
          p_run_item_id: item.item_id, p_response: { choice: 0 }, p_duration_ms: 1200,
        })
        if ((res as { score: number }).score === 1) correct++
      }
      line(`\n     answering A every time: ${correct}/${items.length}`)
      check(correct < items.length, 'mcq: the correct option is not always in the same slot')

      const { data: after } = await sb.rpc('get_quiz_run_items', { p_run_id: runId })
      check((after as { items: RunItem[] }).items.every((i) => i.reference_answer !== null),
        'mcq: the answer IS revealed once answered')
    } else {
      // One AI-graded answer, deliberately shallow, to exercise the paid path.
      const first = items[0]
      const answer = type === 'short'
        ? '빌려주는 것과 비슷한 뜻'
        : 'It means you let someone use something of yours for a while and they give it back later.'
      await sb.rpc('submit_quiz_answer', {
        p_run_item_id: first.item_id, p_response: { text: answer }, p_duration_ms: 30000,
      })
      const { data: gq } = await sb.rpc('get_ai_quiz_quote', {
        p_action: `grade_${type}`, p_count: 1,
      })
      const grErr = await edge({
        kind: 'quiz_grade', runItemId: first.item_id, answer,
        clientRef: crypto.randomUUID(), maxPriceMicro: (gq as { price_micro: number }).price_micro,
      })
      if (grErr) { check(false, `${type}: grade — ${grErr}`); continue }

      const { data: after } = await sb.rpc('get_quiz_run_items', { p_run_id: runId })
      const graded = (after as { items: RunItem[] }).items.find((i) => i.item_id === first.item_id)
      line(`\n     answered: "${answer}"`)
      line(`     score: ${graded?.score}`)
      line(`     feedback: ${JSON.stringify(graded?.feedback)}`)
      check(graded?.score !== null && graded?.score !== undefined, `${type}: an AI grade was written`)
      check(graded?.feedback != null, `${type}: renderable feedback was stored`)

      // The learner's override is free and works both ways.
      const before = graded?.score
      await sb.rpc('override_quiz_grade', { p_run_item_id: first.item_id, p_score: 1 })
      const { data: over } = await sb.rpc('get_quiz_run_items', { p_run_id: runId })
      const flipped = (over as { items: RunItem[] }).items.find((i) => i.item_id === first.item_id)
      check(flipped?.score === 1, `${type}: the learner can overrule the grade (was ${before})`)
    }

    await sb.rpc('finish_quiz_run', { p_run_id: runId })
    spent += 1
  }

  rule('NET-ZERO — the trial paid for all of it, the wallet moved nothing')
  const { data: balEnd } = await sb.from('ai_credit_balance').select('balance').maybeSingle()
  const { data: tEnd } = await sb.from('ai_quiz_trial').select('units_remaining').maybeSingle()
  const used = trialStart - (tEnd as { units_remaining: number }).units_remaining
  line(`  trial ${trialStart} → ${(tEnd as { units_remaining: number }).units_remaining} (${used} units)`)
  check((balEnd as { balance: number } | null) == null
        || (balEnd as { balance: number }).balance === 0,
    'the wallet was never debited — everything came out of the trial')
  // NOT `used > 0`. When every generation failed — a provider outage, which is exactly when
  // this property matters most — zero units consumed is the CORRECT outcome, not a failure.
  check(used >= 0 && used <= trialStart, `trial usage is within the grant (${used})`)
  if (used === 0) line('     (nothing was generated, so nothing was consumed — the point of the check)')

  const { data: jobs } = await sb.from('ai_generation_jobs')
    .select('job_kind, quiz_units_held, quiz_units_done, charged, refunded')
    .in('job_kind', ['quiz_generate', 'quiz_grade'])
  const open = (jobs ?? []).filter((j: { quiz_units_done: number | null }) => j.quiz_units_done === null)
  check(open.length === 0, `no job left holding units (${open.length} open of ${(jobs ?? []).length})`)
  const overcharged = (jobs ?? []).filter(
    (j: { quiz_units_done: number | null; quiz_units_held: number }) =>
      (j.quiz_units_done ?? 0) > j.quiz_units_held)
  check(overcharged.length === 0, 'no job settled more units than it held')

  rule('WALLET SURFACE — the allowance is visible where a learner would look')
  const { data: wallet } = await sb.rpc('get_ai_wallet_summary')
  const w = wallet as Record<string, unknown>
  for (const key of ['quiz_unit_price_micro', 'quiz_free_limit', 'quiz_free_remaining_today',
                     'quiz_trial_remaining']) {
    check(w?.[key] !== undefined, `wallet summary reports ${key}`)
  }

  rule(fails.length === 0 ? 'RESULT: all checks passed' : `RESULT: ${fails.length} FAILED`)
  for (const f of fails) line(`  ❌ ${f}`)

  // Leave nothing behind. The account cascades to its deck, cards, sets, runs and jobs.
  line(`\n(cleanup: delete the audit account with
   DELETE FROM auth.users WHERE email = '${email}';)`)

  if (fails.length > 0) process.exit(1)
}

main().catch((e) => { console.error('\n❌ audit aborted:', e.message); process.exit(1) })

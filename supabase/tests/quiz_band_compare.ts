/**
 * Are the difficulty bands actually different, and in the right direction?
 *
 * `quiz_difficulty_test.sql` proves a band's numbers are stored and enforced. It cannot
 * prove the only thing that matters to a learner: that the band labelled 쉬움 produces an
 * easier question than the one labelled 어려움. That is a property of the model's output,
 * so it takes a real generation to see.
 *
 * It is worth the provider calls because the bands have been wrong in exactly this way
 * before. Band 1 shipped with `allowed_flaws = '{}'` — which means NO restriction, not "no
 * flaws" — so it was handed the full flaw menu and produced, for `wrench`, three other hand
 * tools. near=3 against a band whose ceiling is 0: band 1 was HARDER than band 3, and every
 * automated check passed, because each individual item was well-formed.
 *
 * Prints one question per band, side by side, and reports the near-miss count against what
 * each band permits. The counts are the model's own flaw labels, so this is a check on
 * whether the band instruction landed — a human still has to read the options.
 *
 * Usage:  cd packages/web && npx tsx ../../supabase/tests/quiz_band_compare.ts
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync('.env', 'utf-8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }),
)
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)

/** Same set the edge validator treats as "close enough to be a trap". */
const NEAR = new Set(['adjacent_sense', 'opposite', 'plausible_form', 'partial'])

const COUNT = 3
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const line = (s = '') => console.log(s)
const fails: string[] = []

async function main() {
  const email = `bandcompare+${Date.now()}@reeeeecallstudy.xyz`
  const { data: auth, error: suErr } = await sb.auth.signUp({
    email, password: `Band!${Date.now()}aA1`,
  })
  if (suErr || !auth.user) throw new Error(`signUp: ${suErr?.message}`)
  const uid = auth.user.id
  line(`  account ${email}`)
  await sb.rpc('grant_ai_quiz_trial')

  const { data: tpls } = await sb.from('card_templates').select('id, name, fields')
  const tpl = (tpls ?? []).find((t: { name: string }) => t.name === '영어 단어')
  if (!tpl) throw new Error('seeded template missing')
  const { data: deck, error: dErr } = await sb.from('decks')
    .insert({ user_id: uid, name: 'Band compare', default_template_id: (tpl as { id: string }).id })
    .select('id').single()
  if (dErr) throw new Error(`deck: ${dErr.message}`)
  const deckId = (deck as { id: string }).id

  // A deliberately MULTI-DOMAIN deck. The easy band promises wrong options from a different
  // area, and a single-topic deck (all finance verbs, say) would hide whether it delivered:
  // every option would look unrelated-ish no matter what the model did.
  const VOCAB: Array<[string, string, string, string]> = [
    ['wrench', '렌치', 'rentʃ', 'He tightened it with a wrench.'],
    ['ferment', '발효시키다', 'fərˈment', 'They ferment the cabbage.'],
    ['glacier', '빙하', 'ˈɡleɪʃər', 'The glacier is retreating.'],
    ['auction', '경매', 'ˈɔːkʃən', 'It sold at auction.'],
    ['lullaby', '자장가', 'ˈlʌləbaɪ', 'She sang a lullaby.'],
    ['vaccine', '백신', 'vækˈsiːn', 'The vaccine is free.'],
    ['harbour', '항구', 'ˈhɑːrbər', 'The boat left the harbour.'],
    ['compass', '나침반', 'ˈkʌmpəs', 'Use a compass to navigate.'],
  ]
  const { error: cErr } = await sb.from('cards').insert(VOCAB.map(([w, m, p, e]) => ({
    deck_id: deckId, user_id: uid, template_id: (tpl as { id: string }).id,
    field_values: { field_1: w, field_2: m, field_3: p, field_4: e },
  })))
  if (cErr) throw new Error(`cards: ${cErr.message}`)

  const { data: bands } = await sb.rpc('get_quiz_difficulty_levels')
  const levels = (bands as Array<{ level: number; near_required: number; near_max: number }>) ?? []

  for (const band of levels.sort((a, b) => a.level - b.level)) {
    const { data: created, error: cErr } = await sb.rpc('create_quiz_set', {
      p_deck_id: deckId, p_title: `Band ${band.level}`, p_question_type: 'mcq',
      p_count: COUNT, p_content_locale: 'ko', p_difficulty: band.level,
    })
    if (cErr) { fails.push(`band ${band.level}: create — ${cErr.message}`); continue }
    const setId = (created as { set_id: string }).set_id
    const cardIds = (created as { cards: Array<{ card_id: string }> }).cards.map((c) => c.card_id)

    const { data: quote } = await sb.rpc('get_ai_quiz_quote', {
      p_action: 'generate_mcq', p_count: COUNT,
    })

    // The provider rate-limits, and this fires one generation per band back to back — which
    // no learner does. The wait is this script apologising for its own shape.
    if (band.level !== levels[0].level) await sleep(60000)

    const { error: gErr } = await sb.functions.invoke('ai-generate', {
      body: {
        kind: 'quiz_generate', setId, questionType: 'mcq', cardIds,
        clientRef: crypto.randomUUID(),
        maxPriceMicro: (quote as { price_micro: number }).price_micro,
      },
    })
    if (gErr) {
      const body = await (gErr as unknown as { context?: Response }).context?.text?.()
      fails.push(`band ${band.level}: generate — ${body ?? gErr.message}`)
      continue
    }

    const { data: run } = await sb.rpc('start_quiz_run', { p_set_id: setId })
    const runId = (run as { run_id: string }).run_id
    const { data: items } = await sb.rpc('get_quiz_run_items', { p_run_id: runId })
    const list = (items as { items: Array<{ item_id: string; stem: string; options: string[] }> }).items

    line(`\n${'━'.repeat(72)}`)
    line(`BAND ${band.level}  —  near-misses allowed: ${band.near_required}..${band.near_max}`)
    line('━'.repeat(72))

    let offBand = 0
    for (const it of list) {
      // Answering is what releases the flaw labels — they are an answer key until then.
      const { error: sErr } = await sb.rpc('submit_quiz_answer', {
        p_run_item_id: it.item_id, p_response: { choice: 0 }, p_duration_ms: 1000,
      })
      // Loud, because a silently-failed submit leaves `meta` withheld and every band then
      // reports zero near-misses — which reads as a pass and means nothing.
      if (sErr) throw new Error(`submit: ${sErr.message}`)
    }
    const { data: after } = await sb.rpc('get_quiz_run_items', { p_run_id: runId })
    const graded = (after as {
      items: Array<{ stem: string; options: string[]; reference_answer: string; meta: { flaws?: (string | null)[] } | null }>
    }).items

    for (const it of graded) {
      const flaws = it.meta?.flaws ?? []
      // No labels means the payload is withheld, not that the options are far. Without this
      // every band scores near=0 and "passes" — the failure mode that made an earlier run of
      // this script report bands 1 and 2 green while measuring nothing at all.
      if (flaws.length === 0) {
        fails.push(`band ${band.level}: no flaw labels came back — nothing was measured`)
        line(`\n  ${it.stem}: ❌ no flaw labels (item not answered, or meta withheld)`)
        continue
      }
      const near = flaws.filter((f) => f && NEAR.has(f)).length
      const ok = near >= band.near_required && near <= band.near_max
      if (!ok) offBand += 1
      line(`\n  ${it.stem}   (answer: ${it.reference_answer})`)
      it.options.forEach((opt, i) => {
        const f = flaws[i]
        line(`     ${opt === it.reference_answer ? '✓' : ' '} ${opt}${f ? `   [${f}]` : ''}`)
      })
      line(`     near-misses: ${near}  ${ok ? '✅ in band' : '❌ OUT OF BAND'}`)
    }
    if (offBand > 0) {
      fails.push(`band ${band.level}: ${offBand}/${graded.length} items outside the band`)
    }
  }

  line(`\n${'━'.repeat(72)}`)
  if (fails.length === 0) {
    line('RESULT: every band produced options inside the range it promises')
  } else {
    line('RESULT: FAILED')
    for (const f of fails) line(`  ❌ ${f}`)
  }
  line('━'.repeat(72))
  line(`\n(cleanup: DELETE FROM auth.users WHERE email = '${email}';)`)
  if (fails.length > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })

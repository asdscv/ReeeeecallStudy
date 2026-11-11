// Where readers leave a guide, and the app CTA that meets them there.
//
// A searcher leaves at two predictable points: right after the first direct answer (they got
// what they searched for) and when the wrap-up starts. Each gets an app CTA; the article's own
// closing CTA stays last. Applied at render time, so every published article gets it without a
// rewrite — on the web page and in the crawler HTML alike.

export type DropOffPosition = 'answer' | 'wrap_up'

export interface AppCtaBlock {
  type: 'app_cta'
  props: { position: DropOffPosition; campaign: string }
}

const MIN_BLOCKS = 6

const isCta = (b: { type: string } | undefined) => b?.type === 'cta' || b?.type === 'app_cta'

export function withDropOffCtas<T extends { type: string }>(
  blocks: readonly T[],
  campaign: string,
): Array<T | AppCtaBlock> {
  if (blocks.length < MIN_BLOCKS) return [...blocks]

  const firstHeading = blocks.findIndex((b) => b.type === 'heading')
  const searchFrom = firstHeading >= 0 ? firstHeading + 1 : 1
  let answerEnd = -1
  for (let i = searchFrom; i < blocks.length; i++) {
    if (blocks[i].type === 'paragraph') { answerEnd = i; break }
  }

  let lastHeading = -1
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].type === 'heading') { lastHeading = i; break }
  }

  // Key = index the CTA goes in front of.
  const insertBefore = new Map<number, DropOffPosition>()
  const answerAt = answerEnd + 1
  if (answerEnd >= 0 && !isCta(blocks[answerAt])) insertBefore.set(answerAt, 'answer')

  // The wrap-up starts at the last section when it sits in the back half; most generated
  // articles have only two sections, so otherwise ~3/4 of the way through.
  let wrapAt = lastHeading > blocks.length / 2 ? lastHeading : Math.round(blocks.length * 0.75)
  if (blocks[wrapAt - 1]?.type === 'heading') wrapAt++
  const roomAfterAnswer = answerEnd < 0 || wrapAt >= answerAt + 3
  const roomBeforeEnd = wrapAt <= blocks.length - 2
  if (roomAfterAnswer && roomBeforeEnd && !isCta(blocks[wrapAt - 1]) && !isCta(blocks[wrapAt])) {
    insertBefore.set(wrapAt, 'wrap_up')
  }

  const out: Array<T | AppCtaBlock> = []
  blocks.forEach((block, i) => {
    const position = insertBefore.get(i)
    if (position) out.push({ type: 'app_cta', props: { position, campaign } })
    out.push(block)
  })
  return out
}

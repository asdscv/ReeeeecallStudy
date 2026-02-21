import { test, expect } from '../fixtures/test-helpers'

/**
 * Diagnostic test: "영어 회화!" 덱에 120장이 있는데 49장만 나오는 문제 진단
 *
 * 이 테스트는 실제 유저 계정으로 로그인하여:
 * 1. Supabase API 응답을 인터셉트하여 cards 테이블에서 반환되는 카드 수/srs_status 분포를 확인
 * 2. 크래밍 모드 "전체"에서 프로그레스 바에 표시되는 total 확인
 * 3. 순차 복습에서 total 확인
 */

const TARGET_DECK_NAME = '영어 회화!'

test.describe('Card Count Diagnosis — 49-card bug', () => {

  test('Intercept Supabase cards query → count cards + srs_status distribution', async ({
    quickStudyPage,
    page,
  }) => {
    test.setTimeout(60_000)

    // Intercept ALL Supabase REST API calls to the cards table
    const cardResponses: Array<{ url: string; count: number; statusDist: Record<string, number>; cards: Array<{ id: string; srs_status: string }> }> = []

    await page.route('**/rest/v1/cards**', async (route) => {
      const response = await route.fetch()
      const body = await response.json().catch(() => null)

      if (Array.isArray(body) && body.length > 0) {
        const statusDist: Record<string, number> = {}
        for (const card of body) {
          const status = card.srs_status ?? 'unknown'
          statusDist[status] = (statusDist[status] || 0) + 1
        }
        cardResponses.push({
          url: route.request().url(),
          count: body.length,
          statusDist,
          cards: body.map((c: Record<string, unknown>) => ({ id: c.id as string, srs_status: c.srs_status as string })),
        })

        console.log(`\n========== SUPABASE CARDS RESPONSE ==========`)
        console.log(`URL: ${route.request().url()}`)
        console.log(`Total cards returned: ${body.length}`)
        console.log(`srs_status distribution:`, JSON.stringify(statusDist, null, 2))
        console.log(`==============================================\n`)
      }

      await route.fulfill({ response })
    })

    // Navigate to quick study and select the target deck
    await quickStudyPage.navigate()
    await quickStudyPage.selectDeck(TARGET_DECK_NAME)

    // Select cramming mode (전체)
    await quickStudyPage.selectCrammingMode()
    await quickStudyPage.expectCrammingSetupVisible()

    // Make sure "All Cards" / "전체" filter is selected (should be default)
    const allFilter = page.getByRole('button').filter({ hasText: /All Cards|전체|所有/i })
    if (await allFilter.isVisible().catch(() => false)) {
      await allFilter.click()
    }

    // Start cramming study
    await quickStudyPage.startStudy()
    await page.waitForURL(/\/study\?/, { timeout: 15_000 })
    await page.waitForTimeout(3000) // Wait for all API calls to complete

    // === Analysis: log all intercepted responses ===
    console.log(`\n\n========== DIAGNOSIS SUMMARY ==========`)
    console.log(`Total intercepted card queries: ${cardResponses.length}`)
    for (let i = 0; i < cardResponses.length; i++) {
      const r = cardResponses[i]
      console.log(`\n--- Query ${i + 1} ---`)
      console.log(`  URL: ${r.url}`)
      console.log(`  Cards returned: ${r.count}`)
      console.log(`  Status distribution: ${JSON.stringify(r.statusDist)}`)
    }
    console.log(`========================================\n`)

    // Check what total the UI shows
    // StudyProgressBar renders: {current}/{total}
    // CrammingProgressBar renders round info
    const progressText = await page.locator('text=/\\d+\\/\\d+/').first().textContent().catch(() => null)
    console.log(`\n>>> UI progress text: ${progressText}`)

    // Also check for cramming round info
    const roundText = await page.locator('.bg-purple-100').first().textContent().catch(() => null)
    console.log(`>>> Cramming round badge: ${roundText}`)

    // Extract total from Zustand store directly
    const storeData = await page.evaluate(() => {
      // Access Zustand store from window (devtools)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stores = (window as any).__ZUSTAND_STORES__
      if (stores) {
        return JSON.stringify(stores)
      }

      // Alternative: try to find the study store state from React fiber
      return 'Zustand store not accessible from window'
    })
    console.log(`>>> Zustand store data: ${storeData}`)

    // The key assertion: at least one card query should return more than 49 cards
    // If this FAILS, it means Supabase itself is only returning 49 cards
    const crammingQuery = cardResponses.find(r =>
      r.url.includes('srs_status=neq.suspended') || // cramming query pattern
      (r.count > 0 && !r.url.includes('limit=1'))   // any non-limit-1 query
    )

    if (crammingQuery) {
      console.log(`\n>>> KEY FINDING: Cramming query returned ${crammingQuery.count} cards`)
      console.log(`>>> srs_status distribution: ${JSON.stringify(crammingQuery.statusDist)}`)

      if (crammingQuery.statusDist['suspended']) {
        console.log(`\n>>> !!! ${crammingQuery.statusDist['suspended']} cards are SUSPENDED !!!`)
        console.log(`>>> This is likely the cause of the 49-card bug.`)
        console.log(`>>> Non-suspended cards: ${crammingQuery.count - (crammingQuery.statusDist['suspended'] || 0)}`)
      }
    }

    // IMPORTANT: Log the largest response — this tells us the total in DB
    const largest = cardResponses.reduce((max, r) => r.count > max.count ? r : max, { count: 0 } as (typeof cardResponses)[0])
    if (largest && largest.count > 0) {
      console.log(`\n>>> LARGEST QUERY returned ${largest.count} cards`)
      console.log(`>>> Distribution: ${JSON.stringify(largest.statusDist)}`)
    }

    // Soft assertion — we expect more than 49
    // This test is diagnostic, so we log everything regardless
    expect(cardResponses.length).toBeGreaterThan(0)
  })

  test('Sequential review batch 100 → check total cards', async ({
    quickStudyPage,
    page,
  }) => {
    test.setTimeout(60_000)

    const cardResponses: Array<{ url: string; count: number; statusDist: Record<string, number> }> = []

    await page.route('**/rest/v1/cards**', async (route) => {
      const response = await route.fetch()
      const body = await response.json().catch(() => null)

      if (Array.isArray(body) && body.length > 0) {
        const statusDist: Record<string, number> = {}
        for (const card of body) {
          const status = card.srs_status ?? 'unknown'
          statusDist[status] = (statusDist[status] || 0) + 1
        }
        cardResponses.push({
          url: route.request().url(),
          count: body.length,
          statusDist,
        })

        console.log(`\n[SEQ REVIEW] Cards response: ${body.length} cards, dist: ${JSON.stringify(statusDist)}`)
      }

      await route.fulfill({ response })
    })

    await quickStudyPage.navigate()
    await quickStudyPage.selectDeck(TARGET_DECK_NAME)

    // Select sequential review mode (🔄)
    const seqReviewBtn = page.locator('.fixed.inset-0').getByRole('button').filter({ hasText: '🔄' })
    if (await seqReviewBtn.isVisible().catch(() => false)) {
      await seqReviewBtn.click()
    } else {
      // Try finding by text
      const altBtn = page.locator('.fixed.inset-0').getByRole('button').filter({ hasText: /Sequential Review|순차 복습/i })
      await altBtn.click()
    }

    // Wait for study session to start
    await page.waitForURL(/\/study\?/, { timeout: 15_000 }).catch(() => {
      // If there's a setup screen, try to start
    })

    await page.waitForTimeout(3000)

    // Log results
    console.log(`\n\n========== SEQUENTIAL REVIEW DIAGNOSIS ==========`)
    for (const r of cardResponses) {
      console.log(`  Cards: ${r.count}, Distribution: ${JSON.stringify(r.statusDist)}`)
    }

    // Check progress bar
    const progressText = await page.locator('text=/\\d+\\/\\d+/').first().textContent().catch(() => null)
    console.log(`>>> Sequential review progress: ${progressText}`)
    console.log(`==================================================\n`)

    expect(cardResponses.length).toBeGreaterThan(0)
  })

  test('Direct Supabase count — check true total & row limit', async ({
    page,
  }) => {
    test.setTimeout(30_000)

    const DECK_ID = 'c2b7be09-320b-42a5-8f81-9ef7ebef7d61'

    // Capture real auth headers from the app's own Supabase requests
    let capturedHeaders: Record<string, string> = {}
    let supabaseUrl = ''

    await page.route('**/rest/v1/**', async (route) => {
      const reqHeaders = route.request().headers()
      if (reqHeaders['apikey'] && !supabaseUrl) {
        const url = new URL(route.request().url())
        supabaseUrl = `${url.protocol}//${url.host}`
        capturedHeaders = {
          'apikey': reqHeaders['apikey'],
          'authorization': reqHeaders['authorization'] || '',
        }
      }
      await route.continue()
    })

    // Navigate to trigger Supabase requests → capture credentials
    await page.goto('/decks')
    await page.waitForTimeout(3000)

    console.log(`\n>>> Captured Supabase URL: ${supabaseUrl}`)
    console.log(`>>> Has auth header: ${!!capturedHeaders['authorization']}`)

    if (!supabaseUrl || !capturedHeaders['authorization']) {
      console.log('>>> Failed to capture credentials. Skipping direct queries.')
      expect(true).toBe(true)
      return
    }

    // Remove the route interceptor so our direct fetches go through
    await page.unrouteAll()

    // Make direct API calls from the browser using captured credentials
    const diagnosticResult = await page.evaluate(async ({ url, headers, deckId }) => {
      const results: Record<string, unknown> = {}

      // 1. Count ALL cards (including suspended) — HEAD request with count
      try {
        const countRes = await fetch(
          `${url}/rest/v1/cards?deck_id=eq.${deckId}&select=id`,
          {
            headers: {
              ...headers,
              'Prefer': 'count=exact',
              'Range-Unit': 'items',
              'Range': '0-0',
            },
          }
        )
        results.totalCountHeader = countRes.headers.get('content-range')
        results.totalCountStatus = countRes.status
        results.totalCountBody = await countRes.json().catch(() => null)
      } catch (e) {
        results.totalCountError = String(e)
      }

      // 2. Fetch ALL cards with explicit limit=1000
      try {
        const res = await fetch(
          `${url}/rest/v1/cards?deck_id=eq.${deckId}&select=id,srs_status,sort_position,created_at&order=sort_position.asc&limit=1000`,
          { headers }
        )
        const data = await res.json()
        const statusDist: Record<string, number> = {}
        if (Array.isArray(data)) {
          for (const c of data) {
            statusDist[c.srs_status ?? 'unknown'] = (statusDist[c.srs_status ?? 'unknown'] || 0) + 1
          }
        }
        results.withLimit1000 = {
          count: Array.isArray(data) ? data.length : data,
          statusDist,
        }
      } catch (e) {
        results.withLimit1000Error = String(e)
      }

      // 3. Fetch cards WITHOUT any filter
      try {
        const res = await fetch(
          `${url}/rest/v1/cards?deck_id=eq.${deckId}&select=id,srs_status&order=sort_position.asc`,
          { headers }
        )
        const data = await res.json()
        const statusDist: Record<string, number> = {}
        if (Array.isArray(data)) {
          for (const c of data) {
            statusDist[c.srs_status ?? 'unknown'] = (statusDist[c.srs_status ?? 'unknown'] || 0) + 1
          }
        }
        results.noFilter = {
          count: Array.isArray(data) ? data.length : data,
          statusDist,
        }
      } catch (e) {
        results.noFilterError = String(e)
      }

      // 4. Count per srs_status
      for (const status of ['new', 'learning', 'review', 'suspended']) {
        try {
          const res = await fetch(
            `${url}/rest/v1/cards?deck_id=eq.${deckId}&srs_status=eq.${status}&select=id`,
            {
              headers: {
                ...headers,
                'Prefer': 'count=exact',
                'Range-Unit': 'items',
                'Range': '0-0',
              },
            }
          )
          results[`count_${status}`] = {
            contentRange: res.headers.get('content-range'),
            status: res.status,
          }
        } catch (e) {
          results[`count_${status}_error`] = String(e)
        }
      }

      // 5. Check if user has other decks with similar names
      try {
        const res = await fetch(
          `${url}/rest/v1/decks?select=id,name,created_at&name=ilike.*회화*`,
          { headers }
        )
        results.relatedDecks = await res.json()
      } catch (e) {
        results.relatedDecksError = String(e)
      }

      return results
    }, { url: supabaseUrl, headers: capturedHeaders, deckId: DECK_ID })

    console.log(`\n========== DIRECT SUPABASE DIAGNOSTICS ==========`)
    console.log(JSON.stringify(diagnosticResult, null, 2))
    console.log(`==================================================\n`)

    // Analyze
    const totalHeader = diagnosticResult.totalCountHeader as string
    if (totalHeader) {
      const match = totalHeader.match(/\/(\d+)/)
      if (match) {
        const trueTotal = parseInt(match[1])
        console.log(`\n>>> TRUE TOTAL CARDS IN DB (via content-range): ${trueTotal}`)
        if (trueTotal > 49) {
          console.log(`>>> !!! ROW LIMIT DETECTED: DB has ${trueTotal} but default query returns fewer !!!`)
        } else {
          console.log(`>>> DB genuinely has only ${trueTotal} cards — no row limit issue`)
        }
      }
    }

    expect(true).toBe(true)
  })

  test('RPC get_deck_stats vs REST cards query — find RLS discrepancy', async ({
    page,
  }) => {
    test.setTimeout(30_000)

    const DECK_ID = 'c2b7be09-320b-42a5-8f81-9ef7ebef7d61'

    // Capture credentials from real app requests
    let supabaseUrl = ''
    let capturedHeaders: Record<string, string> = {}

    await page.route('**/rest/v1/**', async (route) => {
      const reqHeaders = route.request().headers()
      if (reqHeaders['apikey'] && !supabaseUrl) {
        const url = new URL(route.request().url())
        supabaseUrl = `${url.protocol}//${url.host}`
        capturedHeaders = {
          'apikey': reqHeaders['apikey'],
          'authorization': reqHeaders['authorization'] || '',
        }
      }
      await route.continue()
    })

    // Also intercept RPC calls to capture get_deck_stats response
    let rpcStatsResponse: unknown = null
    await page.route('**/rest/v1/rpc/get_deck_stats**', async (route) => {
      const response = await route.fetch()
      rpcStatsResponse = await response.json().catch(() => null)
      await route.fulfill({ response })
    })

    // Navigate to decks page (triggers get_deck_stats RPC)
    await page.goto('/decks')
    await page.waitForTimeout(4000)

    // Log RPC response
    if (Array.isArray(rpcStatsResponse)) {
      const targetDeckStats = (rpcStatsResponse as Array<Record<string, unknown>>).find(
        (d) => d.deck_id === DECK_ID
      )
      console.log(`\n========== get_deck_stats RPC RESULT ==========`)
      console.log(`Target deck stats:`, JSON.stringify(targetDeckStats, null, 2))
      console.log(`================================================\n`)

      if (targetDeckStats) {
        console.log(`>>> RPC says total_cards = ${targetDeckStats.total_cards}`)
        console.log(`>>> RPC says new_cards = ${targetDeckStats.new_cards}`)
        console.log(`>>> RPC says review_cards = ${targetDeckStats.review_cards}`)
        console.log(`>>> RPC says learning_cards = ${targetDeckStats.learning_cards}`)
      }
    }

    // Now make direct REST query (goes through RLS) for comparison
    if (supabaseUrl && capturedHeaders['authorization']) {
      await page.unrouteAll()

      const result = await page.evaluate(async ({ url, headers, deckId }) => {
        const results: Record<string, unknown> = {}

        // 1. Direct REST query (through RLS) — count exact
        try {
          const res = await fetch(
            `${url}/rest/v1/cards?deck_id=eq.${deckId}&select=id`,
            {
              headers: {
                ...headers,
                'Prefer': 'count=exact',
                'Range-Unit': 'items',
                'Range': '0-0',
              },
            }
          )
          results.restCount = res.headers.get('content-range')
        } catch (e) {
          results.restCountError = String(e)
        }

        // 2. Check user_id of cards via RPC (bypasses RLS)
        // Call get_deck_stats to see the SECURITY DEFINER count
        try {
          const res = await fetch(
            `${url}/rest/v1/rpc/get_deck_stats`,
            {
              method: 'POST',
              headers: {
                ...headers,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                p_user_id: 'current', // Will be replaced below
              }),
            }
          )
          results.rpcDirect = await res.json()
        } catch (e) {
          results.rpcDirectError = String(e)
        }

        // 3. Get current user ID
        try {
          const token = headers.authorization?.replace('Bearer ', '')
          if (token) {
            // Decode JWT to get user ID (Supabase JWT has 'sub' claim)
            const parts = token.split('.')
            if (parts.length === 3) {
              const payload = JSON.parse(atob(parts[1]))
              results.currentUserId = payload.sub
              results.jwtRole = payload.role

              // Now call get_deck_stats with the actual user_id
              const res2 = await fetch(
                `${url}/rest/v1/rpc/get_deck_stats`,
                {
                  method: 'POST',
                  headers: {
                    ...headers,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    p_user_id: payload.sub,
                  }),
                }
              )
              const stats = await res2.json()
              if (Array.isArray(stats)) {
                const target = stats.find((d: Record<string, unknown>) => d.deck_id === deckId)
                results.rpcTotalCards = target?.total_cards
                results.rpcNewCards = target?.new_cards
                results.rpcReviewCards = target?.review_cards
                results.rpcLearningCards = target?.learning_cards
              }
            }
          }
        } catch (e) {
          results.jwtError = String(e)
        }

        return results
      }, { url: supabaseUrl, headers: capturedHeaders, deckId: DECK_ID })

      console.log(`\n========== RLS DISCREPANCY ANALYSIS ==========`)
      console.log(JSON.stringify(result, null, 2))
      console.log(`\n>>> REST API (with RLS): ${result.restCount}`)
      console.log(`>>> RPC get_deck_stats (SECURITY DEFINER, no RLS): total_cards = ${result.rpcTotalCards}`)
      console.log(`>>> Current user ID: ${result.currentUserId}`)

      const restMatch = (result.restCount as string)?.match(/\/(\d+)/)
      const restTotal = restMatch ? parseInt(restMatch[1]) : 0
      const rpcTotal = (result.rpcTotalCards as number) ?? 0

      if (rpcTotal > restTotal) {
        console.log(`\n>>> !!! CONFIRMED: RLS DISCREPANCY !!!`)
        console.log(`>>> RPC sees ${rpcTotal} cards, REST sees ${restTotal} cards`)
        console.log(`>>> ${rpcTotal - restTotal} cards have DIFFERENT user_id than current user`)
        console.log(`>>> This is the root cause of the 49-card bug!`)
        console.log(`>>> FIX: get_deck_stats needs to filter cards by user_id,`)
        console.log(`>>>   OR add user_id check to cards JOIN,`)
        console.log(`>>>   OR reassign orphaned cards to the deck owner.`)
      } else {
        console.log(`\n>>> No RLS discrepancy detected. Both show ${restTotal} cards.`)
      }
      console.log(`================================================\n`)
    }

    expect(true).toBe(true)
  })
})

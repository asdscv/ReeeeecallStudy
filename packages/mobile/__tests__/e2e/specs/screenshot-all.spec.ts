/**
 * Screenshot capture spec — navigates to every screen and takes screenshots.
 * Run: npx wdio wdio.ios.conf.ts --spec __tests__/e2e/specs/screenshot-all.spec.ts
 */
import { openDrawer, navigateToDrawerItem } from '../helpers/navigation'

const SCREENSHOT_DIR = '/tmp/screenshots'

function getDir() {
  return driver.isIOS ? `${SCREENSHOT_DIR}/ios` : `${SCREENSHOT_DIR}/android`
}

async function shot(name: string) {
  const dir = getDir()
  await browser.saveScreenshot(`${dir}/${name}.png`)
  console.log(`[screenshot] Saved: ${dir}/${name}.png`)
}

describe('Screenshot All Screens', () => {
  it('01 - Dashboard', async () => {
    await navigateToDrawerItem('Dashboard')
    await browser.pause(2000)
    await shot('01-dashboard')
  })

  it('02 - Drawer Menu', async () => {
    await openDrawer()
    await browser.pause(500)
    await shot('02-drawer-closed')

    // Expand Study group
    if (driver.isIOS) {
      const study = $('-ios predicate string:label == "Study"')
      if (await study.isDisplayed().catch(() => false)) await study.click()
    } else {
      const study = $('android=new UiSelector().text("Study")')
      if (await study.isDisplayed().catch(() => false)) await study.click()
    }
    await browser.pause(500)
    await shot('02-drawer-study-expanded')

    // Close drawer by tapping outside or navigating
    await navigateToDrawerItem('Dashboard')
  })

  it('03 - Decks List', async () => {
    await navigateToDrawerItem('Decks')
    await browser.pause(2000)
    await shot('03-decks-list')
  })

  it('04 - Deck Detail (first deck)', async () => {
    // Tap the first deck card
    if (driver.isIOS) {
      const card = $('-ios class chain:**/XCUIElementTypeScrollView/XCUIElementTypeOther/XCUIElementTypeOther[1]')
      if (await card.isDisplayed().catch(() => false)) {
        await card.click()
        await browser.pause(1500)
        await shot('04-deck-detail')
        // Go back
        const back = $('-ios predicate string:label CONTAINS "Deck List"')
        if (await back.isDisplayed().catch(() => false)) await back.click()
        await browser.pause(500)
      }
    } else {
      const card = $('android=new UiSelector().resourceIdMatches(".*deck-card.*").instance(0)')
      if (await card.isDisplayed().catch(() => false)) {
        await card.click()
        await browser.pause(1500)
        await shot('04-deck-detail')
        await driver.back()
        await browser.pause(500)
      } else {
        // Try by text
        const deckName = $('android=new UiSelector().textContains("Test").instance(0)')
        if (await deckName.isDisplayed().catch(() => false)) {
          await deckName.click()
          await browser.pause(1500)
          await shot('04-deck-detail')
          await driver.back()
          await browser.pause(500)
        }
      }
    }
  })

  it('05 - Study Setup', async () => {
    await navigateToDrawerItem('Quick Study')
    await browser.pause(2000)
    await shot('05-study-setup')
  })

  it('06 - Marketplace', async () => {
    await navigateToDrawerItem('Marketplace')
    await browser.pause(2000)
    await shot('06-marketplace')
  })

  it('07 - Study History', async () => {
    await navigateToDrawerItem('History')
    await browser.pause(2000)
    await shot('07-study-history')
  })

  it('08 - Settings', async () => {
    await navigateToDrawerItem('Settings')
    await browser.pause(2000)
    await shot('08-settings-top')

    // Scroll down to see more sections
    if (driver.isIOS) {
      await driver.execute('mobile: scroll', { direction: 'down' })
    } else {
      await $('android=new UiSelector().scrollable(true)').scrollIntoView(
        $('android=new UiSelector().text("Answer Mode")'),
      ).catch(() => {})
    }
    await browser.pause(500)
    await shot('08-settings-answer-mode')

    // Scroll more to TTS
    if (driver.isIOS) {
      await driver.execute('mobile: scroll', { direction: 'down' })
    } else {
      await $('android=new UiSelector().scrollable(true)').scrollIntoView(
        $('android=new UiSelector().text("Auto TTS Reading")'),
      ).catch(() => {})
    }
    await browser.pause(500)
    await shot('08-settings-tts')

    // Scroll more to AI Providers
    if (driver.isIOS) {
      await driver.execute('mobile: scroll', { direction: 'down' })
    } else {
      await $('android=new UiSelector().scrollable(true)').scrollIntoView(
        $('android=new UiSelector().text("AI Providers")'),
      ).catch(() => {})
    }
    await browser.pause(500)
    await shot('08-settings-ai-providers')

    // Scroll more to Account
    if (driver.isIOS) {
      await driver.execute('mobile: scroll', { direction: 'down' })
      await driver.execute('mobile: scroll', { direction: 'down' })
    } else {
      await $('android=new UiSelector().scrollable(true)').scrollIntoView(
        $('android=new UiSelector().text("Account")'),
      ).catch(() => {})
    }
    await browser.pause(500)
    await shot('08-settings-account')
  })

  it('09 - Guide', async () => {
    await navigateToDrawerItem('Guide')
    await browser.pause(2000)
    await shot('09-guide')
  })

  it('10 - AI Generate', async () => {
    await navigateToDrawerItem('AI Generate')
    await browser.pause(2000)
    await shot('10-ai-generate')
  })
})

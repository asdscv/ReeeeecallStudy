/**
 * Cross-platform scroll helper for iOS (XCUITest) and Android (UiAutomator2).
 *
 * iOS:     mobile: scroll with direction param
 * Android: mobile: scrollGesture with direction + area params
 */
export async function scrollDown() {
  if (driver.isIOS) {
    await browser.execute('mobile: scroll', { direction: 'down' })
  } else {
    // Android: use scrollGesture with screen coordinates
    const { width, height } = await browser.getWindowSize()
    await browser.execute('mobile: scrollGesture', {
      left: 100,
      top: Math.round(height * 0.5),
      width: width - 200,
      height: Math.round(height * 0.3),
      direction: 'down',
      percent: 0.75,
    })
  }
}

export async function scrollUp() {
  if (driver.isIOS) {
    await browser.execute('mobile: scroll', { direction: 'up' })
  } else {
    const { width, height } = await browser.getWindowSize()
    // Android: use scrollGesture with 'up' direction (NOT swipeGesture which can trigger notification shade)
    await browser.execute('mobile: scrollGesture', {
      left: Math.round(width * 0.2),
      top: Math.round(height * 0.4),
      width: Math.round(width * 0.6),
      height: Math.round(height * 0.3),
      direction: 'up',
      percent: 0.75,
    })
  }
}

/**
 * Scroll until an element is visible or max attempts reached.
 */
export async function scrollToElement(selector: string, direction: 'up' | 'down' = 'down', maxAttempts = 5) {
  for (let i = 0; i < maxAttempts; i++) {
    const el = $(selector)
    if (await el.isDisplayed().catch(() => false)) return true
    if (direction === 'down') await scrollDown()
    else await scrollUp()
    await browser.pause(300)
  }
  return false
}

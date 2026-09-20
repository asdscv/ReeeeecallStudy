// Appium W3C REST 드라이버 — webdriverio 없이. node 26 에서 undici 가 POST /session 을
// UND_ERR_INVALID_ARG 로 깨뜨리므로 내장 http 만 쓴다. (reference_mobile_sim_e2e)
import http from 'node:http'
import fs from 'node:fs'

const BASE = { host: '127.0.0.1', port: 4723 }

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body))
    const r = http.request({
      ...BASE, method, path,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': data.length } : {}),
      },
    }, (res) => {
      let buf = ''
      res.on('data', c => buf += c)
      res.on('end', () => {
        let json = null
        try { json = JSON.parse(buf) } catch { json = buf }
        resolve({ status: res.statusCode, json })
      })
    })
    r.on('error', reject)
    if (data) r.write(data)
    r.end()
  })
}

export class Driver {
  constructor(sessionId) { this.id = sessionId }

  static async start(caps, { timeoutMs = 300000 } = {}) {
    const res = await req('POST', '/session', { capabilities: { alwaysMatch: caps, firstMatch: [{}] } })
    const sid = res.json?.value?.sessionId
    if (!sid) throw new Error(`세션 생성 실패 ${res.status}: ${JSON.stringify(res.json).slice(0, 600)}`)
    return new Driver(sid)
  }

  async quit() { try { await req('DELETE', `/session/${this.id}`) } catch { /* 이미 죽음 */ } }

  async find(using, value) {
    const r = await req('POST', `/session/${this.id}/element`, { using, value })
    const el = r.json?.value?.['element-6066-11e4-a52e-4f735466cecc'] || r.json?.value?.ELEMENT
    return el || null
  }

  /** 나타날 때까지 기다린다. 없으면 null. */
  async waitFor(using, value, ms = 20000) {
    const end = Date.now() + ms
    while (Date.now() < end) {
      const el = await this.find(using, value)
      if (el) return el
      await new Promise(r => setTimeout(r, 700))
    }
    return null
  }

  async tap(el) { return req('POST', `/session/${this.id}/element/${el}/click`) }
  async type(el, text) { return req('POST', `/session/${this.id}/element/${el}/value`, { text }) }
  async text(el) { const r = await req('GET', `/session/${this.id}/element/${el}/text`); return r.json?.value }
  async source() { const r = await req('GET', `/session/${this.id}/source`); return r.json?.value || '' }

  async shot(file) {
    const r = await req('GET', `/session/${this.id}/screenshot`)
    if (r.json?.value) { fs.writeFileSync(file, Buffer.from(r.json.value, 'base64')); return file }
    return null
  }

  async hideKeyboard() { return req('POST', `/session/${this.id}/appium/device/hide_keyboard`, {}) }
}

// 플랫폼별 셀렉터. RN testID 는 iOS=accessibility id, Android=resource-id 로 매핑된다.
export const sel = {
  ios: (testID) => ['accessibility id', testID],
  androidId: (testID) => ['-android uiautomator', `new UiSelector().resourceId("${testID}")`],
  // 공유 ui/TextInput 은 testID 를 래퍼 View 의 content-desc 로도 복제하므로,
  // 입력칸은 진짜 EditText 를 겨눠야 한다.
  androidInput: (testID) => ['-android uiautomator',
    `new UiSelector().className("android.widget.EditText").resourceId("${testID}")`],
}

export const IOS_CAPS = (udid) => ({
  platformName: 'iOS',
  'appium:automationName': 'XCUITest',
  'appium:udid': udid,
  'appium:bundleId': 'com.reeeeecall.study',
  'appium:newCommandTimeout': 300,
  'appium:wdaLaunchTimeout': 180000,
  'appium:usePrebuiltWDA': false,
})

export const ANDROID_CAPS = () => ({
  platformName: 'Android',
  'appium:automationName': 'UiAutomator2',
  'appium:appPackage': 'com.reeeeecall.study',
  'appium:appActivity': '.MainActivity',
  'appium:newCommandTimeout': 300,
  'appium:uiautomator2ServerLaunchTimeout': 180000,
  'appium:uiautomator2ServerInstallTimeout': 180000,
  'appium:autoGrantPermissions': true,
})

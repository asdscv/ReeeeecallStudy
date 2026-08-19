import { config as sharedConfig } from './wdio.conf'
import path from 'path'

const APK_PATH = path.resolve(__dirname, 'android/app/build/outputs/apk/debug/app-debug.apk')

export const config: WebdriverIO.Config = {
  ...sharedConfig,

  /**
   * 에뮬레이터는 시뮬레이터보다 느립니다. 같은 스펙이 iOS 에서 2~3분에 끝나는데 Android 에서는
   * 한 테스트가 120초 기본값을 넘깁니다 — 화면은 정상이고(검색창·FAB 다 보입니다) 요소 조회가
   * 느릴 뿐입니다. 느린 것을 실패로 기록하면 진짜 실패가 묻힙니다.
   *
   * 공유 설정을 건드리지 않고 이 플랫폼에서만 올립니다.
   */
  mochaOpts: { ...sharedConfig.mochaOpts, timeout: 240000 },

  port: 4723,

  capabilities: [{
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'appium:deviceName': process.env.ANDROID_DEVICE_NAME ?? 'emulator-5554',
    'appium:platformVersion': process.env.ANDROID_PLATFORM_VERSION ?? '14',
    'appium:app': process.env.ANDROID_APP_PATH ?? APK_PATH,
    'appium:noReset': true,
    'appium:newCommandTimeout': 300,
    'appium:uiautomator2ServerInstallTimeout': 120000,
    'appium:uiautomator2ServerLaunchTimeout': 120000,
    'appium:adbExecTimeout': 120000,
    'appium:appPackage': 'com.reeeeecall.study',
    'appium:appActivity': '.MainActivity',
    // Auto-dismiss ANR/crash dialogs to prevent test blocking
    'appium:disableWindowAnimation': true,
    'appium:ignoreUnimportantViews': false,
  }],
}

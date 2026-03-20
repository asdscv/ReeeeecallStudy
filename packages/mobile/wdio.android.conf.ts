import { config as sharedConfig } from './wdio.conf'
import path from 'path'

const APK_PATH = path.resolve(__dirname, 'android/app/build/outputs/apk/debug/app-debug.apk')

export const config: WebdriverIO.Config = {
  ...sharedConfig,

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

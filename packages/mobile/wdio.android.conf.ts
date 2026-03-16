import { config as sharedConfig } from './wdio.conf'

export const config: WebdriverIO.Config = {
  ...sharedConfig,

  port: 4723,

  capabilities: [{
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'appium:deviceName': process.env.ANDROID_DEVICE_NAME ?? 'Pixel_8_API_35',
    'appium:platformVersion': process.env.ANDROID_PLATFORM_VERSION ?? '15',
    'appium:app': process.env.ANDROID_APP_PATH ?? './android/app/build/outputs/apk/debug/app-debug.apk',
    'appium:noReset': false,
    'appium:newCommandTimeout': 240,
  }],
}

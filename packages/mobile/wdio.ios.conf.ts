import { config as sharedConfig } from './wdio.conf'

export const config: WebdriverIO.Config = {
  ...sharedConfig,

  port: 4723,

  capabilities: [{
    platformName: 'iOS',
    'appium:automationName': 'XCUITest',
    'appium:deviceName': process.env.IOS_DEVICE_NAME ?? 'iPhone 16',
    'appium:platformVersion': process.env.IOS_PLATFORM_VERSION ?? '18.0',
    'appium:app': process.env.IOS_APP_PATH ?? './ios/build/ReeeeecallStudy.app',
    'appium:noReset': false,
    'appium:newCommandTimeout': 240,
  }],
}

import { config as sharedConfig } from './wdio.conf'
import path from 'path'

const APP_PATH = path.resolve(__dirname, 'ios/build/Build/Products/Debug-iphonesimulator/ReeeeecallStudy.app')

export const config: WebdriverIO.Config = {
  ...sharedConfig,

  port: 4723,

  capabilities: [{
    platformName: 'iOS',
    'appium:automationName': 'XCUITest',
    'appium:deviceName': process.env.IOS_DEVICE_NAME ?? 'iPhone 16 Pro',
    'appium:platformVersion': process.env.IOS_PLATFORM_VERSION ?? '18.1',
    'appium:app': process.env.IOS_APP_PATH ?? APP_PATH,
    'appium:noReset': true,
    'appium:newCommandTimeout': 240,
    'appium:wdaLaunchTimeout': 300000,
    'appium:wdaConnectionTimeout': 300000,
  }],
}

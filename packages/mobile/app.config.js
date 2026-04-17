// Dynamic Expo config — app.json을 확장하여 환경변수를 빌드 바이너리에 임베드.
//
// 왜 필요한가:
//   eas build --local은 프로젝트를 임시 폴더에 아카이브하는데,
//   .gitignore에 .env가 있으면 환경변수가 제외됨.
//   process.env.EXPO_PUBLIC_*가 빈 문자열이 되어 Supabase 초기화 실패 → 크래시.
//
// 해결 방식:
//   app.config.js의 extra 필드에 환경변수를 삽입하면 Expo가 빌드 시점에
//   앱 바이너리(Expo.plist / AndroidManifest)에 값을 굽기 때문에
//   어떤 빌드 방식(remote, local, expo run)이든 Constants.expoConfig.extra로
//   항상 접근 가능.
//
// 사용법 (코드에서):
//   import Constants from 'expo-constants'
//   const url = Constants.expoConfig?.extra?.supabaseUrl ?? ''

const baseConfig = require('./app.json')

module.exports = ({ config }) => ({
  ...config,
  ...baseConfig.expo,
  extra: {
    ...baseConfig.expo.extra,
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  },
})

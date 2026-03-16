/**
 * Navigation type definitions.
 * 새 화면 추가 시 해당 ParamList에 키를 추가하면 됩니다.
 */

// Root-level (Auth vs Main 분기)
export type RootStackParamList = {
  Auth: undefined
  Main: undefined
}

// Auth flow screens
export type AuthStackParamList = {
  Login: undefined
  SignUp: undefined
  ForgotPassword: undefined
}

// Main tabs (로그인 후)
export type MainTabParamList = {
  Home: undefined
  Decks: undefined
  Study: undefined
  Marketplace: undefined
  Settings: undefined
}

// Type-safe navigation hook을 위한 선언 병합
declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}

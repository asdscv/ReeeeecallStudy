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
  HomeTab: undefined
  DecksTab: undefined
  StudyTab: undefined
  MarketplaceTab: undefined
  SettingsTab: undefined
}

// Home stack
export type HomeStackParamList = {
  Dashboard: undefined
  StudyHistory: undefined
}

// Decks stack (덱 관련 모든 화면)
export type DecksStackParamList = {
  DecksList: undefined
  DeckDetail: { deckId: string }
  DeckEdit: { deckId?: string }              // undefined = 새 덱 생성
  CardEdit: { deckId: string; cardId?: string } // undefined = 새 카드 생성
  ImportExport: { deckId: string }
  PublishDeck: { deckId: string }
}

// Study stack
export type StudyStackParamList = {
  StudySetup: { deckId?: string }
  StudySession: undefined
  StudySummary: undefined
}

// Marketplace stack
export type MarketplaceStackParamList = {
  MarketplaceHome: undefined
  MarketplaceDetail: { listingId: string }
}

// Settings stack
export type SettingsStackParamList = {
  SettingsHome: undefined
  AIGenerate: undefined
  Paywall: undefined
}

// Type-safe navigation hook을 위한 선언 병합
declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}

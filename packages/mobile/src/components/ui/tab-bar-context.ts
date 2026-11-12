import { createContext, useContext } from 'react'

/**
 * True inside a screen that has the bottom tab bar under it. The bar owns the bottom safe-area
 * inset then, so `Screen` must not pad for it a second time.
 */
export const TabBarVisibleContext = createContext(false)

export function useTabBarVisible(): boolean {
  return useContext(TabBarVisibleContext)
}

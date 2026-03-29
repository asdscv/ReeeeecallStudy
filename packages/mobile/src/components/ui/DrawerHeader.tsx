import { ScreenHeader } from './ScreenHeader'

/** @deprecated Use ScreenHeader with mode="drawer" instead */
export function DrawerHeader({ title }: { title: string }) {
  return <ScreenHeader title={title} mode="drawer" />
}

import { currentSiteAddress } from './site-url'

export const BRAND_NAME = 'Reklue'

// Published articles can still contain the former name. Update their display copy
// without rewriting stored content, email addresses, slugs, or app identities.
// Links to our former domain move to the new host with their paths/queries intact.
const LEGACY_NAME = /(^|[^A-Za-z0-9@/._-])(?:Re[eE]+[cC]all(?:[ -]?[sS]tudy)?|re{2,}call ?study|Recall ?[Ss]tudy|recallstudy|리콜 ?스터디|リコールスタディ)(?![A-Za-z0-9@._/-])/g
const ADDRESS = /((?:https?:\/\/|mailto:)[^\s<>"']+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+)/g

export function withCurrentBrand<T>(value: T): T {
  if (typeof value === 'string') {
    return value.split(ADDRESS).map((part, index) => index % 2 ? currentSiteAddress(part).replace(/\badmin@reeeeecallstudy\.xyz\b/g, 'admin@reklue.com')
      : part.replace(LEGACY_NAME, (_, prefix: string) => prefix + BRAND_NAME)).join('') as T
  }
  if (Array.isArray(value)) return value.map((item) => withCurrentBrand(item)) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, withCurrentBrand(item)]),
    ) as T
  }
  return value
}

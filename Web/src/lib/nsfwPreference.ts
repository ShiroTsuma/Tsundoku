export const nsfwPreferenceStorageKey = 'tsundoku.nsfw-enabled.v1'
export const nsfwBookExclusions = [
  {
    query: '-tag:h-manhwa',
    pattern: /(^|\s)-tag:(?:"h-manhwa"|'h-manhwa'|h-manhwa)(?=\s|$)/i,
  },
  {
    query: '-genre:Adult',
    pattern: /(^|\s)-genre:(?:"Adult"|'Adult'|Adult)(?=\s|$)/i,
  },
  {
    query: '-tag:R-18',
    pattern: /(^|\s)-tag:(?:"R-18"|'R-18'|R-18)(?=\s|$)/i,
  },
] as const

export function isNsfwEnabled() {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    return window.localStorage.getItem(nsfwPreferenceStorageKey) === 'true'
  } catch {
    return false
  }
}

export function setNsfwEnabled(enabled: boolean) {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    window.localStorage.setItem(nsfwPreferenceStorageKey, String(enabled))
    return enabled
  } catch {
    // A blocked localStorage should fail closed and keep NSFW content hidden.
    return false
  }
}

export function withNsfwBookFilter(query?: string) {
  const trimmedQuery = query?.trim() ?? ''

  if (isNsfwEnabled()) {
    return trimmedQuery || undefined
  }

  const missingExclusions = nsfwBookExclusions
    .filter(({ pattern }) => !pattern.test(trimmedQuery))
    .map(({ query: exclusion }) => exclusion)

  if (missingExclusions.length === 0) {
    return trimmedQuery || undefined
  }

  const exclusions = missingExclusions.join(' ')
  return trimmedQuery ? `${exclusions} ${trimmedQuery}` : exclusions
}

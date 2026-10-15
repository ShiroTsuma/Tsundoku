const scrollPositionKeyPrefix = 'tsundoku.books.scroll-position.v1:'

export type BookListNavigationState = {
  bookListReturnTo?: string
}

export function saveBookListScrollPosition(returnTo: string, scrollY: number) {
  window.sessionStorage.setItem(`${scrollPositionKeyPrefix}${returnTo}`, String(scrollY))
}

export function takeBookListScrollPosition(returnTo: string) {
  const key = `${scrollPositionKeyPrefix}${returnTo}`
  const storedValue = window.sessionStorage.getItem(key)
  window.sessionStorage.removeItem(key)

  if (storedValue === null) {
    return null
  }

  const scrollY = Number(storedValue)
  return Number.isFinite(scrollY) && scrollY >= 0 ? scrollY : null
}

export function getBookListReturnTo(state: unknown) {
  if (!state || typeof state !== 'object' || !('bookListReturnTo' in state)) {
    return '/books'
  }

  const returnTo = (state as BookListNavigationState).bookListReturnTo
  return typeof returnTo === 'string' && returnTo.startsWith('/books') ? returnTo : '/books'
}

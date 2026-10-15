import { useState } from 'react'

/** A named search query the user saved from the library list. */
export type SavedView = { name: string; query: string }

export const savedViewsStorageKey = 'tsundoku.books.saved-views.v1'

function readSavedViews(): SavedView[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(savedViewsStorageKey) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is SavedView =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Record<string, unknown>).name === 'string' &&
        typeof (item as Record<string, unknown>).query === 'string',
    )
  } catch {
    return []
  }
}

/** Saved views live in localStorage (per browser) until the API stores them. */
export function useSavedViews() {
  const [views, setViews] = useState<SavedView[]>(readSavedViews)

  function persist(next: SavedView[]) {
    setViews(next)
    try {
      window.localStorage.setItem(savedViewsStorageKey, JSON.stringify(next))
    } catch {
      // Storage can be unavailable (private mode); the views still work for this session.
    }
  }

  return {
    views,
    save: (name: string, query: string) => {
      const trimmed = name.trim()
      if (!trimmed || !query.trim()) return
      persist([...views.filter((view) => view.name !== trimmed), { name: trimmed, query }])
    },
    remove: (name: string) => {
      persist(views.filter((view) => view.name !== name))
    },
  }
}

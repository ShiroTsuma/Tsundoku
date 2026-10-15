/**
 * The one place that decides which EPUB search implementation the app uses.
 *
 * To switch to the real backend, implement `EpubSearchClient` with calls to
 * the Tsundoku API (src/api/http.ts) and export it here instead of the mock.
 * Nothing else in the UI needs to change.
 */
import { createMockEpubSearchClient } from './mockClient'
import type { EpubSearchClient } from './types'

export const epubSearchClient: EpubSearchClient = createMockEpubSearchClient()

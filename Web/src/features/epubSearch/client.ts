/**
 * The one place that decides which EPUB search implementation the app uses.
 *
 * Production uses the authenticated Tsundoku API. Tests inject the mock
 * through EpubSearchClientContext without changing the dialog's appearance.
 */
import { createApiEpubSearchClient } from './apiClient'
import type { EpubSearchClient } from './types'

export const epubSearchClient: EpubSearchClient = createApiEpubSearchClient()

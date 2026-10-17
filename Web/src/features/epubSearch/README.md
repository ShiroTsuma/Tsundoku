# EPUB search & download

Production uses `apiClient.ts`, the authenticated Tsundoku API and a private
Lightnovel Crawler service. `client.ts` remains the single implementation switch;
component tests inject the mock through `EpubSearchClientContext`.

Search creates a durable server job and returns partial results while remaining
sources are searched. Download progress is polled every second. The book panel
restores active jobs after reload and refreshes attachments as files finish.

`types.ts` defines the UI contract. Unknown chapter counts/publication dates
remain unknown. Files can be `ready` for manual review or `added` to a book.
Manual review reuses the existing EPUB import session through Upload EPUB / ZIP.
`downloadPlan.ts` is a preview; the backend validates and freezes the actual plan.

Mocks remain available for component tests, including both checkbox modes.
CSS, style classes and layout are unchanged.

See the [integration/deployment guide](../../../../docs/crawler-integration.md)
for endpoints, scheduling, persistence, source overrides and validation.

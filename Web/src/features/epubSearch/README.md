# EPUB search & download

Production uses `apiClient.ts`, the authenticated Tsundoku API and a private
Lightnovel Crawler service. `client.ts` remains the single implementation switch;
component tests inject the mock through `EpubSearchClientContext`.

Search creates a durable server job and returns partial results while remaining
sources are searched. Download progress is polled every second. The book panel
restores active jobs after reload and refreshes attachments as files finish.

`types.ts` defines the UI contract. Unknown chapter counts/publication dates
remain unknown. Generated files are always validated and added to the book automatically.
`Regenerate affected volumes` extends incomplete volumes using `Chapters per file`,
preserves their titles and replaces the previous attachment after successful import.
Completed volumes remain unchanged. Download history identifies the original chapter
positions and attachments; files from other sources or manual uploads are not replaced.
`downloadPlan.ts` is a preview; the backend validates and freezes the actual plan.

Mocks remain available for component tests.
CSS, style classes and layout are unchanged.

See the [integration/deployment guide](../../../../docs/crawler-integration.md)
for endpoints, scheduling, persistence, source overrides and validation.

# EPUB search & download

This flow finds a book on external sources through a crawler service, lets the user pick a source and a chapter range, and downloads the result as EPUB files that are added to the book.

The UI works today against a **mock**. The real backend (a Tsundoku API in front of a lightnovel-crawler service) does not exist yet.

## Files

| File                   | Role                                                                  | Safe to change?                                       |
| ---------------------- | --------------------------------------------------------------------- | ----------------------------------------------------- |
| `types.ts`             | The contract: request, result and job shapes, plus `EpubSearchClient` | Only together with every implementation and the tests |
| `client.ts`            | **The single switch point.** It exports the client the app uses       | Yes: swap the mock for the real client here           |
| `mockClient.ts`        | In-memory client. Download progress comes from elapsed time           | Yes                                                   |
| `mockData.ts`          | Dummy candidates, delays and per-chapter speed                        | Yes: edit freely to try UI states                     |
| `downloadPlan.ts`      | Pure helpers: clamp a range, split it into files, name the files      | Yes, with `downloadPlan.test.ts`                      |
| `queries.ts`           | React Query hooks. A running download is polled every second          | Rarely                                                |
| `clientContext.ts`     | React context so tests can inject their own client                    | Rarely                                                |
| `EpubSearchDialog.tsx` | The four-step dialog: Search → Choose source → Options → Download     | UI work                                               |

## Switching to the real backend

1. Implement `EpubSearchClient` in a new `apiClient.ts`, using `src/api/http.ts`:
   - `search`: `GET /api/books/{bookId}/epub-search?query=…&scope=…`
   - `startDownload`: `POST /api/books/{bookId}/epub-downloads`
   - `getDownload`: `GET /api/epub-downloads/{jobId}`
   - `cancelDownload`: `POST /api/epub-downloads/{jobId}/cancel`

   These endpoints are proposals; match whatever the API ends up exposing. Map the API DTOs to the types in `types.ts` inside `apiClient.ts`, so the UI never sees raw DTOs.

2. In `client.ts`, export the new client instead of `createMockEpubSearchClient()`.
3. Keep `mockClient.ts` for tests and Storybook-style previews. The dialog tests inject it through `EpubSearchClientContext`.

## Rules

- The UI depends only on `types.ts` and the hooks in `queries.ts`. It never imports `mockClient.ts` or `mockData.ts` directly.
- When a download finishes, the dialog calls `onDownloadFinished` once. The book page uses it to refetch the file list.
- `npm run check` must stay green: strict TypeScript, ESLint with zero warnings, and Prettier.

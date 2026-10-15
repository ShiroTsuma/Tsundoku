# EPUB files and backups

Book details have a compact EPUB summary beside links/notes, showing file count, total size and **View**. View opens a browsing popup with direct individual **Download** actions and a main **Download** selector for choosing multiple files and ZIP/separate format. **Manage** reveals adding, renaming, ordering, sharing and trash; these controls and storage messages stay out of the normal book page. Upload EPUBs or ZIPs containing EPUBs, including subfolders. Review titles, order and selection before saving. ZIPs are extracted; original archives are discarded. Files use `BookFiles.BookId` as a foreign key; book records do not embed file data.

New imports extract first/last content labels from EPUB3 navigation or EPUB2 NCX, preserving table-of-contents order and text (including `V2C1`, prologues and combined chapter labels). Frontmatter and volume containers are skipped; chapter parents with subsections are retained. Relative links are resolved within the archive root. Missing or malformed TOCs show no invented range. Full labels are retained; display can shorten a book-title prefix at a separator. Older stored files keep nullable labels; the migration does not scan existing objects. Apply both `AddBookFiles` and `AddBookFileContents` on deployment.

Library **Export EPUB files** and **Import EPUB archive** are separate from the existing CSV + covers full backup. Export includes selected files and a versioned archive manifest recording book identities, titles, order and SHA-256 hashes. Its default scope includes every book matching the current filter across all pages. Restore matches owned original IDs, then normalized title + content type. Choose an existing target book or skip unmatched files. Restore does not create books, and restored files are private.

Files are private by default. Once a book is published, its owner explicitly selects shared EPUBs. Shared downloads require an authenticated account. Unpublishing, removing a share, or moving a file to trash revokes future download authorization, including prepared ZIPs. Copying a public book does not copy EPUBs. Downloads use one-minute, single-use tickets and native browser streaming.

## Limits and validation

Default `BookFiles` limits:

| Resource | Limit |
| --- | --- |
| Individual EPUB | 100 MiB |
| Book upload | 300 MiB / 100 EPUBs |
| Extracted book archive | 512 MiB / 5,000 entries |
| Expanded EPUB content, ordinary import batch | 1 GiB |
| Owner storage, including trash | 10 GiB |
| Dedicated library EPUB archive | 12 GiB / 50,000 entries |
| Processing / job lifetime | 30 minutes / 2 hours |
| Concurrent operations / active jobs per owner | 2 / 5 |
| Global reserved staging | 24 GiB |
| Trash retention | 30 days |

ZIP/EPUB validation checks paths, links, duplicate archive names, compression ratios, actual expanded bytes, secure XML, container/OPF structure and manifest hashes. This is structural validation without an antivirus service. Existing `BookImports:Security` compression-ratio and suspicious-upload account blocking policies are reused. Existing CSV + covers full backup limits remain unchanged.

Large inputs and output ZIPs stream through bounded temporary files. Durable jobs, storage compensation and periodic cleanup handle interrupted operations. Staging capacity covers uploaded archives and extracted EPUBs together. Ready exports can be resumed or explicitly discarded. Restoring trash removes public sharing. The persistent cleanup queue deletes expired objects and objects belonging to deleted books.

## Deployment and backup

Back up the database and private S3 objects (or local `storage/epubs`) together. A CSV + covers full backup excludes EPUBs. Temporary `storage/epub-staging` must persist across container restarts to keep active jobs consistent; Docker Compose mounts both directories. EPUB objects use the configured private cover S3 bucket, or local storage if S3 is not configured. Do not directly serve EPUB storage or staging directories through nginx.

Configure limits/lifetimes through `BookFiles` in `Api/appsettings.json` or ASP.NET environment variables. Compose exposes `BOOK_FILES_OWNER_STORAGE_BYTES`, `BOOK_FILES_LIBRARY_ARCHIVE_BYTES` and `BOOK_FILES_STAGING_BYTES`. Keep nginx `BOOK_FILES_ARCHIVE_UPLOAD_LIMIT` (default `12289m`) at least the API library archive limit plus 1 MiB multipart overhead. Dedicated upload/download locations disable proxy disk buffering and allow 30-minute transfers.

Apply the `AddBookFiles` EF migration before serving the feature. Compose enables automatic migrations. The implementation session does not migrate a production database.

## Implementation validation (2026-10-13)

- 14 EPUB service/MVC tests and 3 PostgreSQL tests pass, covering ZIP extraction, duplicate content, authorization/revocation, manifests, suspicious archives, storage compensation, constraints, deletion locks, worker limits and atomic cancellation. The MVC test uses a 16-byte form-buffer limit to verify streaming uploads.
- Existing public-book PostgreSQL tests apply all migrations successfully; EF reports no pending model changes.
- All 392 application unit tests and 250 frontend tests pass. Frontend production build, Compose configuration and nginx syntax checks pass.
- All 12 new browser tests pass on desktop, mobile and Xiaomi Pad 6 portrait/landscape, covering selection, native download, ZIP, upload preview and separate library export.
- Full browser suite: 85 pass, 17 device-specific skips, 2 existing tablet analytics snapshot failures (query text differs). Analytics source and those baselines were not changed by this feature.
- Full .NET suite: 392 unit passes; integration 298 passes / 5 failures. All five failures also reproduce in the separate pre-feature `deef68b` worktree: three API factory startup failures on the placeholder DB port, an analytics fixture returning zero books, and an old migration fixture referencing a later `BookCovers.PendingUploadToken` column. The three API tests pass when run with a valid dummy DB connection setting; no external database is used by those SQLite test factories.

A fresh, read-only `gpt-6.1-sol` reviewer at high reasoning reviewed UX, functionality and consistency. Feedback on deletion/import races, cleanup retention, cancellation, partial-import refresh, scaling and Unicode was applied and rechecked. Final review has no outstanding P0/P1/P2 findings. The reviewer did not edit code or run a 50,000-file benchmark. Multi-gigabyte transfers and a live S3 service were not exercised in this session.

## Compact UI revision (2026-10-14)

The inline file-management panel was replaced by the summary/popup flow above. All 21 service tests, 254 frontend tests (plus the subsequently added direct-download test) and 12 browser flow tests pass. PostgreSQL tests applied the contents-label migration successfully. The actual extractor was also checked against all four user-provided Lightnovel Crawler EPUBs; it retained their observed endpoints, including `1 → V5C7`, `Vol1 C1 → 311-312`, `Chapter 1 → Chapter 233` and `Chapter 0 → Chapter 496`. A second read-only Sol 6.1 high UX review supplied fixes for relative TOC paths, named volumes, subsection hierarchy, identifier preservation and cancellation during export creation.

Backend validation uses the separate `EpubUx` build configuration because the running local API locks Debug binaries. The running API was not stopped or migrated by this revision.

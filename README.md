<p align="center">
  <img src="Web/public/favicon.svg" width="72" height="72" alt="Novelki">
</p>

<h1 align="center">Novelki</h1>

<p align="center">
  <strong>Your reading list, chapter history, and EPUB collection. On your own server.</strong><br>
  A self-hosted library for web novels, light novels, manga, and manhwa.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/.NET-10-512BD4?style=flat-square" alt=".NET 10">
  <img src="https://img.shields.io/badge/React-19-149ECA?style=flat-square" alt="React 19">
  <img src="https://img.shields.io/badge/PostgreSQL-4169E1?style=flat-square&amp;logo=postgresql&amp;logoColor=white" alt="PostgreSQL">
  <img src="https://img.shields.io/badge/Status-In_development-D4A373?style=flat-square" alt="In development">
</p>

<p align="center">
  <a href="#features">Features</a> &middot;
  <a href="#quick-start">Quick start</a> &middot;
  <a href="#documentation">Documentation</a> &middot;
  <a href="https://github.com/ShiroTsuma/NovelkiBackend/issues">Report an issue</a>
</p>

---

Novelki brings series from different reading sites into one personal catalog. Track the chapter you reached, keep alternate titles and source links together, and attach EPUBs to the books they belong to. Browse your collection as a table or cover grid, with the same library available on desktop, tablet, and phone.

Run it on your own infrastructure with PostgreSQL and local file storage or an S3-compatible bucket. Each account has a private library; you choose which books and files to share with other users of your instance.

## Features

| Feature                     | Description                                                                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reading progress**        | Record chapter numbers, source labels, and comments. Review your reading history, rate books, and set priorities.                               |
| **A searchable catalog**    | Combine full-text and fuzzy search with field filters, exclusions, wildcards, and suggestions from your library.                                |
| **Book metadata**           | Keep alternate titles, authors, genres, tags, notes, and source links. Import metadata from saved page HTML and fetch or upload covers.         |
| **EPUB management**         | Attach EPUBs or import ZIP archives. Review file details, rename and reorder files, and download individual files or a selection.               |
| **Sharing and discovery**   | Publish book snapshots to your instance's discovery catalog. Copy a published entry into your library and choose which attached EPUBs to share. |
| **Library insights**        | Review reading activity, collection breakdowns, and missing metadata. Carry library filters into the statistics view.                           |
| **Import and export**       | Review CSV imports before saving, export book data with covers, and transfer EPUB collections through dedicated archives.                       |
| **Instance administration** | Manage accounts, authors, tags, and shared dictionaries. Inspect logs, metrics, and traces with the included observability stack.               |

### Less manual entry

Use **Fill from a page** when adding a book: supply the page HTML, review the extracted metadata, and choose the fields to keep. You can edit the result before saving.

<details>
<summary>Supported metadata sources</summary>

- **Web fiction:** NovelUpdates, Royal Road, Scribble Hub, WebNovel, and Wuxiaworld.
- **Manga and anime catalogs:** Anime-Planet, MangaUpdates / Baka-Updates, and AniList.
- **Light novel catalogs and publishers:** RanobeDB, J-Novel Club, Seven Seas, and Yen Press.
- **Japanese fiction:** Syosetu and Kakuyomu.

These integrations parse supplied HTML. Source availability and page structure affect the fields you can import.

</details>

### Search beyond titles

Start with a title or combine filters to find a specific part of your collection:

| Query                                      | Results                                                           |
| ------------------------------------------ | ----------------------------------------------------------------- |
| `author:"Er Gen"`                          | Books by an author.                                               |
| `genre:Fantasy rating:>=8 -status:Dropped` | Highly rated fantasy, excluding dropped books.                    |
| `title:"Lord *"`                           | Titles matching a wildcard.                                       |
| `cover:none`                               | Entries that need a cover.                                        |
| `status:Reading updated:<2026-09-01`       | In-progress books without a progress update since the given date. |

Use quotes for values with spaces, `-` to exclude a match, and `none` to find missing metadata. The library offers a visual filter builder alongside the query editor.

### Share on your terms

Publish a snapshot of a book to make it discoverable on your instance. Other users can copy its catalog information into their own libraries. EPUBs stay private until you select files to share; downloading shared files requires an account. Copying a book does not copy its attachments.

**Development status:** Novelki is under active development. The **Find EPUB** crawler interface currently uses simulated search results and download jobs. Uploading, managing, and downloading your own EPUB files uses the implemented storage API. See the [crawler integration notes](Web/src/features/epubSearch/README.md) for the remaining work.

## Quick start

**Requirements:** Docker with Compose and a PostgreSQL instance reachable from the API container. The committed Compose stack includes the application and monitoring services; provision PostgreSQL separately. Redis is optional.

```sh
git clone https://github.com/ShiroTsuma/NovelkiBackend.git
cd NovelkiBackend
cp .env.example .env
```

On PowerShell, use `Copy-Item .env.example .env` for the last command.

Edit `.env` before starting:

- Set `DB_CONNECTION_STRING` to your PostgreSQL connection string. Use a hostname reachable from Docker; `localhost` inside the API container refers to that container.
- Replace `JWT_KEY` with a long random secret and set `JWT_ISSUER` and `JWT_AUDIENCE` for your instance.
- Clear `REDIS_CONNECTION_STRING` to use the in-memory cache, or point it to your Redis service.
- Clear the `BOOK_COVERS__S3__*` values to use local storage, or configure your private S3-compatible bucket. Covers and EPUBs use the same storage backend.
- Set `ADMIN_EMAIL` to the email you will register with, and replace `GRAFANA_ADMIN_PASSWORD`.

```sh
docker compose up --build -d
```

Open **[https://localhost:8080](https://localhost:8080)** and create an account. The local setup uses a self-signed certificate, so your browser will show a certificate prompt. Compose applies database migrations on startup.

To grant administrator access, register with the configured email, then run `docker compose restart api`. The startup seeder assigns the role to an existing account.

For a public domain, trusted TLS certificates, storage configuration, and service addresses, follow the **[self-hosting guide](docs/self-hosting.md)**.

## Data and backups

Choose the export that matches what you need to move:

| Export              | Contents                                                                            |
| ------------------- | ----------------------------------------------------------------------------------- |
| **CSV**             | Book catalog data for review or transfer.                                           |
| **Full backup ZIP** | CSV book data and cover images. EPUBs are excluded.                                 |
| **EPUB archive**    | Selected EPUB files and a manifest with book references, file order, and checksums. |

For an instance backup, preserve the PostgreSQL database and file storage together. Keep EPUB staging storage across container restarts so active jobs can continue. The [EPUB storage guide](docs/epub-storage.md) covers archive restore, sharing permissions, quotas, and retention.

## Documentation

| Guide                                                        | Contents                                                                             |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| [Self-hosting](docs/self-hosting.md)                         | Docker Compose, configuration, domain and TLS setup, persistence, and monitoring.    |
| [Development](docs/development.md)                           | Local API and frontend setup, project structure, and validation commands.            |
| [EPUB storage](docs/epub-storage.md)                         | Attachments, library archives, access rules, storage limits, and deployment details. |
| [Crawler integration](Web/src/features/epubSearch/README.md) | The EPUB search prototype, client contracts, and backend integration work.           |

## Development

The backend uses **ASP.NET Core on .NET 10**, **Entity Framework Core**, and **PostgreSQL**. The frontend uses **React 19**, **TypeScript**, **Vite**, **Tailwind CSS**, and **TanStack Query**. Authentication uses ASP.NET Core Identity with JWT access and refresh tokens.

Application logic, domain models, and infrastructure live in separate projects. The API exposes versioned routes under `/api/v1`; Swagger is available at `/swagger` in Development. OpenTelemetry connects the API to Grafana, Prometheus, Loki, and Tempo.

To work on the project, install the .NET SDK specified in [`global.json`](global.json), Node.js 24 or later, and PostgreSQL. Follow the [development guide](docs/development.md) for local secrets, migrations, and the test suites.

## Feedback and contributions

Use [GitHub Issues](https://github.com/ShiroTsuma/NovelkiBackend/issues) for bug reports and feature proposals. For a bug, include the commit or branch, deployment method, steps to reproduce, and relevant logs with credentials removed. For changes to an import or parser, include a representative input where possible.

## License

No license has been selected for this project.

# EPUB crawler integration

The standard Compose stack includes the private Linux service. It uses Lightnovel Crawler 4.14.0, pinned to commit
`472e72f680ae8bff8ff7e8a7fd765a91cd0c5a7c`. The browser uses only the
authenticated Tsundoku API. Upstream user/admin/source-editor routes are not exposed.

## Enable on an existing instance

Back up PostgreSQL and EPUB storage before deploying `AddCrawlerIntegration`.
Keep the existing Compose project name, `.env`, storage and named volumes.
On the existing mini-PC the project name remains `novelkibackend`.

Add to the instance `.env`:

```dotenv
CRAWLER_ENABLED=true
CRAWLER_API_KEY=<random secret of at least 32 characters>
```

Generate the secret locally, e.g. with Python's `secrets.token_urlsafe(48)`.
Do not commit it or include it in the frontend build.

```sh
docker compose build api web crawler
docker compose up -d
docker compose ps
```

Use the existing `-p novelkibackend` override if needed. Compose applies the
migration through the existing `Database__AutoMigrate=true` setting.

Neither crawler nor egress proxy publishes host ports. The crawler has only an
internal Docker network; HTTP(S) uses a proxy rejecting private, loopback,
link-local and reserved destinations, including IPv6 and mixed DNS answers.
The proxy connects to validated numeric addresses, allows only ports 80/443
and checks redirect destinations on their next request.

Initial limits: 2 GiB RAM, two CPUs, two engine workers, two downloads globally
and one per owner. Calibre, Tor and translation services are not required.
The multi-stage build excludes Git, compilers and installation caches from the
runtime. Crawler and proxy share the same image, adding no second Linux image.
Sites requiring interactive browser verification can still fail; incomplete
chapters are reported instead of silently producing incomplete EPUBs.

To disable, set `CRAWLER_ENABLED=false`, recreate the API and stop `crawler`
and `crawler-egress`. Preserve `crawler-data` and existing application volumes.

## Downloads and API

Routes below use the existing `/api/v1/book` prefix:

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/{bookId}/epub-searches` | Start a search |
| GET | `/epub-searches/{id}` | Partial results/status |
| POST | `/{bookId}/epub-downloads` | Start an idempotent download |
| GET | `/{bookId}/epub-downloads` | Restore/list recent jobs |
| GET | `/epub-downloads/{id}` | Download progress |
| POST | `/epub-downloads/{id}/cancel` | Request cancellation |

All operations require book ownership. Background starts return 202. Download
requests include a stable `requestKey`; reusing it for different options fails.
The per-owner active-job limit applies to manual search/download jobs, independently
of automatic discovery/scans, so a background backlog cannot block a manual search.

The existing four-step frontend, CSS, style classes and layout remain intact.
Saved links are inspected first only when their host is in the crawler's active
source catalog, including sources without title search. Other saved references
are retained without requests, warnings or inclusion in crawler progress counts.
NovelUpdates and all its subdomains are excluded from the crawler catalog,
direct inspection and egress, even if upstream advertises support for them.
Partial results and progress are returned before the first match. Feedback shows
the current sources, completed/total source counts and saved-link checks. Saved
link failures are visible. Interactive search checks up to four domains at once,
with a three-minute fan-out budget, per-source cancellation and 12-second network
timeouts. Long titles also try a shorter normalized query when no matches are
found. Search first joins a matching active manual/background discovery, including
waiting retries. Otherwise it returns saved metadata (including Success with
warnings) without scheduling crawler work. Durable library snapshots survive
remote-job cleanup, and source counts/indexes use the latest stored scan.
New work starts only when suitable data is missing, the query/scope changes, or
the user chooses Refresh sources. Refresh also joins a matching active search;
transaction locks prevent simultaneous clicks and background discovery from
creating duplicate jobs. All-language discovery can serve English-only requests;
English-only results do not replace all-language discovery. Unknown dates/counts remain unknown.
Search/scan requests read metadata and the chapter index; cover downloads and
chapter-body requests are disabled during this stage.

The backend freezes exact chapter IDs/URLs, validates the selected range and
splits into at most 100 files with the chosen title template. Each EPUB contains
only its selected chapters. Missing content fails the file; completed files
survive failure or cancellation of later work.

With **Add finished files to this book automatically** checked, validated files
are attached privately as they finish. Otherwise open **Upload EPUB / ZIP** and
**Resume existing import** to review and confirm the generated files. This uses
ordinary import sessions and their two-hour lifetime; no upload is repeated.
Storage, structural validation, sharing and duplicate-content rules are reused.
An occupied import slot delays attachment until the other import is resolved.

Jobs persist in PostgreSQL and the crawler's SQLite operation store. Stable
remote/import identifiers, processing leases and reconciliation handle restarts.
Page reload restores an active download. Downloads expire after 24 hours;
ordinary import processing has its separate timeout. API maintenance removes
expired remote outputs; orphan outputs are independently removed after 26 h.
Cached chapter bodies/images expire after seven days; metadata remains. A disk
guard stops work below 512 MiB free. Monitor the crawler volume separately from
the existing bounded EPUB staging area.
API maintenance also compares the crawler's active operation IDs with PostgreSQL
and cancels orphan operations after book/account deletion, including waiting
retries. This normally happens within 30 seconds while the API is running.

Authenticated pages share a global download monitor, including Library, Manage
and Analytics. It shows a toast when a volume becomes available and when the
whole operation finishes, with an Open book action. A completion toast combines
files that finish in the same poll. Manual-review results say ready to review.
Failures also notify; automatic retry pauses do not report a terminal failure.
Notifications remember observed progress per account in local browser storage,
so navigation/reload does not replay old completions. The page must be open;
these are in-app toasts, not operating-system push notifications.

The header's Crawler activity menu is available throughout the authenticated app.
It shows initial library metadata coverage, pending books, running/waiting jobs,
per-job source/chapter progress and retry times. Administrators also have
**Admin → Crawler**, with all-account activity, recent/failed job filters,
pagination and expandable warnings. Owner status is scoped by the authenticated
account; the global endpoint requires Admin authorization in both controller and
service. Status refreshes every five seconds. Metadata discovery waiting on a
durable cooldown releases admission for another book; one book cannot accumulate
multiple active discovery jobs.

Choose source displays summary, progress and retry state separately, with source
issues collapsed under Show details. Candidate titles link to the first returned
source page in a new tab without selecting a source or starting a download.

## Source tracking

Every library novel receives an initial metadata discovery (including chapter
indexes), with newest books first. Interactive work precedes background work.
For books without a tracked source, discovery repeats monthly, except for
Completed and Dropped books. Failed discovery retries after six hours once the
operation's bounded transient retries have been exhausted.

The selected download source and supported novel links are tracked. Search
candidates alone do not enable scans. A newly tracked link without metadata is
inspected immediately. Subsequent scans are independently randomized between
60 and 72 hours. Due tracked scans precede bulk initial/monthly discovery;
interactive searches and downloads take precedence over both. Metadata scans never download chapter bodies.
Identical source URLs across books/accounts can share one metadata refresh.
Removing a link stops tracking unless it remains the selected download source.
Successfully generated EPUBs add their source URL to the book's Links. Search
and background scans share source metadata. Choose source offers Refresh sources;
the existing relative updated date uses the last successful metadata fetch.

## Temporary source failures

The integration owns durable retries for standalone metadata scans, chapter and image requests.
Timeouts, interrupted connections, transient server failures and rate limits
schedule at most five automatic retries: about 1, 3, 9, 27 and 60 minutes, with
jitter. A longer HTTP Retry-After takes precedence. An operation still expires
after 24 hours. Permanent HTTP errors, parser/validation errors, authentication,
paid content and interactive challenges do not trigger these retries.
An interactive browser-verification challenge pauses further requests to that
source for 15 minutes by default across books and jobs, including its `www` alias.
Configure `CRAWLER_VERIFICATION_PAUSE_SECONDS`; a longer server Retry-After takes
precedence. The pause
persists across restarts. Other sources remain eligible; this does not bypass
verification. A failed chapter-index scan identifies one source, not the entire
book search. Title searches make a single pass, retain usable results and finish
with source warnings without waiting for every failed domain to recover. Downloads still fail when their
required source cannot supply the requested content.
Completed searches with source issues are presented as **Success with warnings**.

Cooldowns apply to all operations against the same hostname and persist in
SQLite. Waiting releases the crawler worker; jobs for other domains can proceed.
Searches do not retry the whole job for unavailable domains; tracked source scans
retry independently. Downloads reuse cached chapters and ready files. Cancellation remains available
during a cooldown. The existing UI shows the retry number and remaining time.
The API delays polling the remote job until its retry time, while still handling
cancellation promptly. Container/network outages remain separate API retries.

No VPN or automatic IP rotation is enabled. If VPN routing is added later, route
only crawler egress through it, keep the private-destination checks and a kill
switch, and retain domain cooldowns across endpoint changes. Changing IP must
not reset rate-limit delays or turn authentication/challenge failures into an
unbounded retry loop.

Each owned book/source stores chapter identities and original labels, last
successful scan, next scan, last failure, downloaded coverage and a download
boundary. `NewSinceDownload` counts chapters after that confirmed boundary in
the current source order. Earlier gaps are not marked downloaded. A missing
boundary means an unknown count. Changing source does not transfer numbering
or coverage between translations. Errors preserve the last successful list.

Reading progress is untouched. Availability endpoints, badges and notification
rules based on reading progress remain future work. Metrics use the
`Tsundoku.Crawler` meter for outcomes, queue length and successful-scan age.
Manual downloads take priority over scans; domains are paced independently.

## Preserved Dobytranslations fix

`tools/lncrawl/overrides/dobytranslations.py` preserves the user's local file:
`F:\Tools\Lightnovels\Lightnovel Crawler\_internal\sources\en\d\dobytranslations.py`.
It selects **Free Chapters**, reverses them into reading order, excludes summary
duplicates and clears chapter bodies containing the locked-purchase message.
The copy is identical after newline normalization. Original file SHA-256:
`7a4456cc5f079aa2d3170ce63488371227c39fd72bd643e6ba4f853bdadaab4c`.

The image copies the override over the upstream source and loads it last at
startup, ahead of older source files in the data volume. Automatic source
synchronization is disabled. Keep this override and its regression tests when
upgrading; also review the assertion-checked EPUB-builder patch.

## Validation

```sh
dotnet test Infrastructure.IntegrationTests -c Crawler --filter Crawler
python -m unittest discover -s tools/lncrawl -p test_integration.py
python -m unittest discover -s tools/lncrawl -p test_resilience.py
cd Web
npm run typecheck
npm run lint
npm run format:check
npm run test:run -- --pool=threads --maxWorkers=2
npm run test:layout -- crawler.spec.ts book-files.spec.ts --workers 2
```

`test_sources.py` runs inside the image against the real pinned engine and
preserved local source. The engine remains GPL-3.0 licensed; the image retains
its source and license alongside the integration extension.


## Search source health and administration

Admin > Crawler lists all supported sources with enable/disable and Always include
controls. Settings and rolling 365-day observations persist in crawler SQLite
(`search_source_health`, `search_source_observations`). Historical jobs are not
retroactively converted into quality samples. Only search operations contribute;
EPUB chapter downloads and standalone chapter-index scans are excluded.

Quality decisions exclude rate limiting and local pacing/cooldown waits. Samples
are deduplicated per job, source and half-hour window. Automatic skipping requires
at least six observations spanning an hour and three windows, with failures in at
least three of the last four windows (80% failures within each bad window). Each
window has equal weight so a burst of jobs does not count as persistent failure.
Skipped sources get a shared recovery probe at most every six hours; success
clears the quality decision history while retaining displayed yearly rates.

Saved supported links and Always include bypass adaptive skipping. Manual Disable
search overrides both. Server cooldowns and verification pauses still apply.
Dobytranslations is initially pinned; webnovelover.com initially has search disabled.
These defaults are seeded once and later admin changes persist. Search controls do
not disable an explicitly requested EPUB download or independent tracked scan.

Admin > Crawler separates Activity from Sources with the same segmented control
used by Dictionaries. Start processing / Pause processing controls the live queue
without restarting containers. Only admins can change it. The shared
`/data/processing-state.json` persists the setting across restarts; egress mounts
the crawler volume read-only and checks the same switch before DNS resolution.
The API polls this control-plane state before queue work. Pause preserves jobs,
partial search progress and downloaded files; active network requests may finish.

`CRAWLER_RUN_JOBS` now supplies the initial state only when no saved switch exists.
An admin choice overrides this bootstrap value. To keep a separate local stack
paused, use Pause processing in that stack and keep its bootstrap value false.


## Moving the crawler to another host

The `crawler-data:/data` named Docker volume contains the private SQLite job
store, source quality/settings, cooldowns and generated files. Egress is stateless.
A new host creates a separate empty volume; Compose does not transfer this state.
Stop queue processing and the crawler before copying the entire volume, then
resume only the destination stack. Keep the same API credential/configuration.
Do not delete the old volume until the destination has been verified.

PostgreSQL admission locks and leases prevent concurrent API workers from claiming
the same job at the same instant, but they do not synchronize separate crawler
SQLite stores. A later poll routed to another empty crawler can resubmit that job.
Multiple API instances must target the same crawler service/store. Running independent
local and remote crawler stacks against the same PostgreSQL queue is unsupported;
keep processing paused in the local stack while production processes jobs.


On Docker hosts that reject every container exec with `no-new-privileges`, set
`CRAWLER_NO_NEW_PRIVILEGES=false` in the host .env. The default remains true;
capability dropping, the private crawler network and validated egress still apply.

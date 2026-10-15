# Mock alignment

Every element of the mock ([Novelki Redesign Mock](https://claude.ai/artifact/5dKnWe32vY5JN3p9rV17Xr)), with one decision each:

- **do**: built as in the mock
- **deviate**: built differently, for the reason given
- **later**: not built yet, needs the thing named

If a screen differs from the mock and this file doesn't say why, that's a bug.

## App shell

| Mock | Decision |
| --- | --- |
| Sticky header: brand, Library / Discover / Stats / Manage, Add book (primary) | do |
| NSFW toggle with eye icon | do |
| Search or jump (Ctrl K) | do: command palette with books (title search) and pages |
| Account menu (avatar) | do: avatar initial from the access token, menu with the account name and Log out |
| Phone bottom tab bar | do |
| Base text 14px / 1.45 | do (was 16px) |

## Library list

| Mock | Decision |
| --- | --- |
| Serif "Library" title | do |
| Subtitle "142 books · 13 finished · 36,388 chapters read" | do: whole-library summary (plus average rating) |
| One "Import / Export" menu | do: one menu with Export and Import sections |
| Status tabs with counts and a `status:` hint | do: counts come from the summary of the query without its status token |
| Status tabs + type chips | do, plus a type row the mock doesn't have (requested): chips write `type:`; each row counts against the query without its own token, so the two rows update each other |
| Search field with token pills and a Filters / Query toggle | do: pills are derived from the query text (the only state). Clicking a pill excludes it (`-`) or includes it again, × removes it. Query is the text editor with syntax suggestions in mono; when focus leaves it, the bar goes back to pills |
| Quick filter chips showing their syntax | do |
| "+ Save current as view" | do: views are stored in localStorage (per browser) until the API can store them |
| Page width: the 1440px artboards fill the screen (their 1360px cap never shows) | do, adapted for wide screens: the header and the list fill the screen up to 1440px, then take 85% of it (at most 2400px), centred, with a 32px gutter. Full width on a 3440px screen meant turning your head. Details and the form keep a centred 1440px column (text and fields read badly wider). Checked at 1280, 1440, 1920, 2560 and 3440 with no horizontal scroll |
| Result toolbar: match count, Sort menu, Table / Cards switch, column settings | do: the toolbar sits on the page, not in a panel; Sort is a menu (no native select). "Open in Stats" link added next to the count (keeps the old summary-to-analytics link); card size S / M / L next to the switch in cards view (replaces "cards per row": the grid adds columns while cards fit, so a fixed number never matched what showed). Page sizes round to whole rows of the measured column count |
| Table in its own box (radius 12, sunk background), widths from the mock, title takes the rest | do. Sort arrows show on hover and on the sorted column. The default columns fit at 1280px without sideways scrolling; with optional columns on, the table scrolls inside its box and the sticky actions column casts a shadow over what passes under it. Genre and tag cells (optional, not in the mock) show up to two compact 24px chips on one line plus "+N" |
| Table title cell: cover, title link, author and "· N alt titles" | do (the count lists the titles on hover; author keeps the other-names tooltip) |
| Status badge, Type, Progress (label first, count, bar), Rating | do |
| "Last progress" column | deviate: "Updated" (last modified), because the list API has no last-progress date |
| Row actions "Log progress" + ⋯ (34px) | do: the ⋯ menu has Open details and Edit book and is never clipped by the table |
| Cards: type-coloured placeholder with a serif title, type label, rating chip, status strip, FINISHED stamp | do |
| Card footer: title, author, label + count, "Log" | do |
| Pagination: "Showing x–y", page pills, Previous / Next, below the table without a box | do. Page size and jump-to-page stay (existing features) |
| Phone: compact rows with a log button | do (table view on phones) |
| Tablet (Galaxy Tab S10+) | do: 3 cards per row in portrait; the table keeps its columns |

## Book details

| Mock | Decision |
| --- | --- |
| Back link "Library" | do: returns to the exact filtered list |
| Hero cover: type-coloured placeholder with type label and serif title | do. Clicking it still searches for a cover (or opens the lightbox when there is one); pending or failed cover searches show one line under it |
| Meta row: status badge, type, "by" author link | do: the author links to the library filtered by `author:` |
| Serif title, alternative titles joined by " · " | do |
| Progress card: "Ch. label", count, total or "total unknown", last logged, bar (dashed when total is unknown) | do |
| Rating card with "Rate it" when empty | do: "Rate it" opens the form at the rating field |
| Priority card with "not set" | do |
| Actions: Log progress, Edit, Find EPUB, ⋯ | do: ⋯ holds Search cover and Delete book (with confirmation) |
| Delete book | do: in the ⋯ menu; the old danger panel is gone |
| About | do (Show more / Show less kept); text measure 65ch instead of 760px, see [ux-review.md](ux-review.md) |
| Genres & tags: solid genre chips, outline tag chips, "Show all N" | do: chips link to the library filtered by `genre:` / `tag:`; descriptions still show on hover or focus |
| Reading history timeline | do (the +n / −n delta pill stays: existing feature) |
| EPUB panel header with file count and size | do |
| Running download box: source, file and chapter progress, Details | do: shows a Find EPUB download running in the background; Details reopens its dialog |
| File rows: EPUB icon, title, NEW badge, mono range, size, Shared, download | do: NEW marks files added in the last 7 days |
| Buttons: Find & download, Upload EPUB / ZIP, Download all, Manage | do (Download all only with two or more files) |
| Storage meter | do |
| Links panel | do |
| Notes panel, "No notes yet. Add one" | do |

## Add / Edit form

| Mock | Decision |
| --- | --- |
| Back link and serif "Add book" / "Edit book" | do. Edit goes back to the book (where it was opened from), add to the library, admin to Administration |
| Page subtitle | not in the mock: removed |
| "Fill from a page" banner with input and Parse | deviate: the button opens the existing parse dialog (paste the page HTML, pick fields). The API parses HTML only, so a URL can't be fetched |
| One form card split into Identity, Progress, Your take, Genres & tags, Details | do |
| Title in serif, required | do |
| Alternative titles as removable rows, "+ Add alternative title" | do. The language label: later, the book API stores no language for alternative titles |
| Author with hint | do (search, aliases, Public / Private kept) |
| Type and Status as buttons, status with a coloured dot | do. Statuses keep their library names ("Completed", as in the tabs) instead of the mock's "Finished"; the description lines stay (existing feature) |
| Progress: "Last logged … · history keeps every change" | do (edit mode) |
| Chapters read / Label in source / Total chapters, each with a hint | do |
| "In library" preview with bar | do |
| Rating 1–10 buttons + Clear | do |
| Priority 1–5 buttons, "1 is next up" | do |
| Genres and tags as chip inputs with counts | do |
| ◆ global tag marker | do in tag suggestions. On chosen tags: later, the book API doesn't say which of its tags are global |
| "Show all N" for long tag lists | do: collapses after 12 |
| Description, Private notes ("Only you see these.") | do |
| Links as label + URL rows, "+ Add link" | do: labels are kept now (the old textarea dropped them on save) |
| Cover: placeholder, dropzone (drop, choose a file, paste a URL) | do. Preview and remove stay |
| Public snapshot checkbox | do: listed state from Manage; publishing or unlisting happens on save. Not shown in admin edit |
| Delete book (edit mode) | do, with confirmation. Not in admin edit (the API has no admin delete) |
| Sticky save bar: change state, Cancel, Save changes / Add to library | do: replaces the side-rail save card; on phones it sits above the tab bar |

## Import books

| Mock | Decision |
| --- | --- |
| Dialog 1080px: serif "Import books", subtitle per step, close button | do |
| Source switch: CSV / Full backup (ZIP) / EPUB archive | do: EPUB archive opens the existing EPUB import dialog |
| Dropzone "Drop a CSV file here", limits (50,000 rows, 10 MB, comma or semicolon), Choose file | do: limits match the API settings |
| Column list with required columns in bold, note on `;` lists and JSON columns | do (CSV only) |
| "Start from the template" card | do (CSV only) |
| Review summary: file chip, rows, ready, need fixing, progress bar | do |
| Issues grouped "fix many rows at once": replace a misspelt status, skip duplicates | do: rows are grouped by field and value; status and type groups offer the closest allowed value; every group can drop its rows. Bulk fixes call the existing row update API row by row |
| Tabs Needs fixing / Ready / All rows | do (the API returns every row) |
| Row: line, title, summary (error or "Novel · Reading · Ch. 837"), Fix / Edit, remove icon | do. The field error also shows under its input (WCAG error placement) |
| Row editor: title, author, type, status with suggestions, chapters read, label, total, genres, tags, Save row | do, plus rating, priority, notes and description (existing fields) |
| Footer hint, Cancel import, Drop N invalid rows, Finalize import | do: Finalize stays disabled until every row is ready. The dialog fits the screen and its body scrolls, so the footer is always visible (the mock grows instead). On phones the hint is hidden and the buttons fill the row |
| Cancel confirmation "Discard draft" | do |
| Result: Imported / Skipped cards, info note, skipped lines, imported table with "+ N more", Import another file, Go to library | do (covers are queued for lookup after import, so the note is true); the table shows every imported book in a scroll box instead of "+ N more" |

## Stats

No mock board. Built from the system the mocked screens use; where the dataviz guidelines decide something, that is noted.

| Element | Decision |
| --- | --- |
| Page header | Serif "Stats" (the nav name) with a one-line summary, like Library; no eyebrow |
| Filter row | One row above every chart (dataviz rule): query field in the library's search style, date range button with the preset list, Day / Week / Month segmented control instead of a native select, Apply |
| Tiles | Panels like the details page stats (radius 12, surface, cap label, 26px value); values use proportional figures |
| Page flow | A "This range" band (chapters read, active days, longest streak or best week, books added), then four sections with jump links: Activity (reading and additions in the range), Library (every matching book today), Backlog (priorities, reading time), Housekeeping (missing data, covers, links) |
| Date range | Scopes only the time series (reading activity by progress date, library growth by created date). The library snapshot always covers every matching book, so drilldowns no longer add `created:` filters. Before, every number only counted books added in the range |
| Reading activity | Day bucket: a reading calendar (one square per day, 4-step blue ramp validated as ordinal) next to chapters per weekday; week and month: bars and the running total. Latest reading lists only periods with progress |
| By type | One table per content type (books, chapters read with a share bar, average and median, minutes per chapter editable in place, time read, chapters and hours left in Reading books) replaces the chapter-volume pair of one-bar charts (dataviz: a one-bar chart is a stat) and the separate reading-time card |
| Pace & forecast | New: pace over the range (chapters per calendar day), chapters left in Reading books with a known total (books without one link to `status:Reading total:none`), days to finish and finish date at that pace, hours left from the minutes per chapter. Needs the new per-type `readingBooks`, `readingBooksWithKnownTotal`, `remainingChapters` from the API |
| Data gaps | Metadata completeness becomes a ranked list of missing data, worst first, one line per field with "Fix N"; complete fields collapse into one line. Covers and link sources sit beside it |
| Motion | Charts do not animate when the system asks for reduced motion |
| Chart cards | One panel per chart (radius 14, surface, border); the chart sits directly in the panel, no box inside a box. "View data" is a ghost button; the table uses the library table style |
| Chart colours | Validated with the dataviz palette checker on the chart surface (#1b1c1d): single-series charts use one blue; status charts follow the app's status hues in a passing order (Reading blue, Completed green, On hold orange, Plan to read violet, Dropped red, Unknown neutral grey with its label); other categories use the validated categorical order. The old lavender/teal palette is gone |
| Reading activity, Library growth | Split into two small charts on the same dates (per-bucket values, cumulative total) instead of one chart with two y-axes (dataviz rule: never dual axis) |
| Axes and grid | Hairline grid in `line`, muted tick labels, tooltip in the popover style |

## Discover

No mock board; built from the Library and details system.

| Element | Decision |
| --- | --- |
| Header | Serif "Discover" with a one-line explanation, like Library; no eyebrow |
| Search | Library search field style, full width, with the snapshot count beside it |
| Cards | Horizontal cards in an auto-fill grid: 2:3 cover on the left (the Library's type-coloured placeholder when there is none), title, author, type · chapters, description clamped to three lines (left out when empty instead of a filler sentence), genres and tags as compact chips, footer with snapshot date, Files and Add to library on one line |

## Manage

No mock board; built from the Library and form system.

| Element | Decision |
| --- | --- |
| Header | Serif "Manage" with a one-line explanation |
| Sections | Underline tabs like the status tabs (Tags, Authors, Books) instead of a side rail; the panel heading and eyebrow inside the panel are gone (the tab names the section) |
| Toolbar | Search field, result count, primary Add button on one row |
| Lists | One bordered list box like the library table; rows with name, secondary line, pills, row-size actions |
| Books | Cover thumbnail, title, author · type, Listed / Private pill with the snapshot date. What is missing before a book can be listed is written in the row (not only in a tooltip), with a link to edit the book |
| Dialogs | The shared Dialog (serif title, footer with actions); delete asks inline as before |

# UX review against the ui-ux-pro-max guidelines

The decisions in [mock-alignment.md](mock-alignment.md) checked against the skill's guideline set (`references/quick-reference.md`, `data/ux-guidelines.csv`, WCAG 2.2 items included). Screens checked: library (table and cards), details, form, at 1280–3440 px, tablet and phone.

Backup of the state before this review: branch `backup/redesign-ui-before-ux-review`. The changes below are on `redesign/ux-review`.

## Changed

| Guideline | What was wrong | Change |
| --- | --- | --- |
| `color-contrast` (4.5:1 for text) | `ink-3` (#8a8882) was 4.44:1 on raised surfaces and 3.84:1 on selected ones | `ink-3` is now #96948e: 6.1:1 on the page, 5.2:1 on raised, 4.5:1 on selected |
| `color-contrast`, `disabled-states` | Status tabs and type chips with a count of 0 used the disabled colour (2.8:1) while still clickable | They use `ink-3` with a hover state; only really disabled controls keep the disabled colour |
| `compact-label-overflow`, `chip-collection-reflow`, `hover-vs-tap` | Genre/tag descriptions and the "+N" list opened on hover or focus only; Safari doesn't focus a tapped button, so on iPad and iPhone they never opened | A tap opens them; Esc closes them (WCAG 1.4.13) |
| `focus-not-obscured` (WCAG 2.2 AA) | A focused element could scroll under the sticky header, the phone tab bar or the form's save bar | `scroll-padding-top: 5rem` and `scroll-padding-bottom: 6rem` on the page |
| `focus-not-obscured` | In a table wider than its box, a focused chip or link could sit under the sticky actions column | The table box gets `scroll-padding-inline-end` equal to the actions column |
| `touch-target-size` | Row actions (Log progress, ⋯) were 34 px on touch tablets | 44 px on coarse pointers (the existing `tablet-touch-target` rule); mouse sizes unchanged |
| `web-target-size` (24 px) | The × on a query pill was 22 px | 24 px |
| `readable-font-size` | Fields with 13–15 px text make iOS zoom in on focus | Fields are 16 px on touch screens |
| `line-length` (65–75 characters) | The "About" text was up to 760 px wide, about 100 characters a line | `max-w-prose` (65ch) |

## Checked and fine

- `skip-links`, `focus-states` (2 px ring, 3 px offset), `reduced-motion` (the download stripe stops), `sortable-table` (`aria-sort`), `number-tabular`, `contextual-live-badge-updates` (the match count is a status region), `color-not-only` (status badges carry text, the FINISHED stamp and a check icon), `aria-labels` on icon buttons, `compact-control-semantics` (chips and S/M/L are buttons with `aria-pressed`).
- `horizontal-scroll`: no page scrolls sideways at any width checked. A table with optional columns scrolls inside its own box, which is the guideline's recommended table handling.
- `container-width`: that rule is about reading measure. The library is a data view, so 85% of the screen (at most 2400 px) is fine; text blocks keep their own measure (About at 65ch, details and form at 1440 px).
- `primary-action`: one light-filled button per screen area (Add book, Log progress, Save changes).

## Kept on purpose (your call)

| Guideline | Current state | Why it's kept |
| --- | --- | --- |
| Non-text contrast 3:1 for control borders (WCAG 1.4.11) | Field and button borders (`line-strong`) are 1.7:1 against the page | Fields are recognisable by their label, their fill and the placeholder; a 3:1 border (about #66696f) would make every field and button look outlined, a clear change from the mock. Easy to change in `tokens.css` if strict AA is wanted |
| `readable-font-size` (16 px body on phones) | Body text is 14 px everywhere (mock value) | Dense list app; fields are already 16 px on touch so nothing zooms |
| `line-height` 1.5–1.75 | UI text 1.45 | Applies to reading text; the description uses 1.625 |
| Pill click excludes the filter | The hint is a hover title ("Click to exclude"); screen readers hear "Exclude …"; touch users get no hint | A visible hint on every pill would be clutter; a negated pill turns red and shows its operator, so the result of a tap is obvious and a second tap undoes it |

Quick CORS reality-check: **GitHub Pages doesn't change anything.** CORS is enforced by the browser based on what *the image server* sends in `Access-Control-Allow-Origin`, regardless of where your site is hosted. GH Pages, Netlify, `file://`, `localhost` — all behave identically. Most image hosts (D&D Beyond, Pinterest, random art sites) don't send permissive headers, so `fetch()` → canvas → PDF will fail for almost any pasted URL. Going local doesn't fix it.

Realistic options: (a) drop URL paste entirely, file upload only; (b) accept "URL paste = manually download first, then upload"; (c) tiny proxy worker later.

**Decision: upload-only for v1.** Adding a proxy is a 30-line addition later if it ever feels worth it. Spec drops URL paste from scope.

---

# Paper Mini Generator — SPEC.md

## Goal
Single-page web app that turns uploaded artwork into print-ready PDFs of foldable D&D paper miniatures.

## Core flow
1. User adds rows. Each row = `{ image: File, size: enum, count: number }`.
2. User clicks **Generate PDF**.
3. App produces and downloads a multi-page PDF, A4 portrait by default (Letter toggle).

## Data model

```ts
type DnDSize = 'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'gargantuan';

type Entry = {
  image: File;        // PNG/JPG/WebP, any background
  size: DnDSize;
  count: number;      // 1..N
};
```

## Per-mini layout

Sizing is **fit-to-base-width**. Image is rectangular (no silhouette cut). Back face is the front image, mirrored horizontally.

Base widths (mm):

| Size       | Width |
| ---------- | ----- |
| Tiny       | 12.5  |
| Small      | 25    |
| Medium     | 25    |
| Large      | 50    |
| Huge       | 75    |
| Gargantuan | 100   |

Per-mini unfolded layout, top to bottom:

```
[ tab        ]   ← 8mm tall, full width — back-side tab
[ back image ]   ← image mirrored horizontally, rendered upside-down
[ fold line  ]   ← dotted, 0.2mm light grey
[ front image]   ← image as uploaded, right-side-up
[ tab        ]   ← 8mm tall, full width — front-side tab
```

When folded along the centre line, the two tabs land on top of each other → double thickness for slot bases.

Image height is `source_aspect_ratio × base_width`, **clamped** so it never exceeds `1.5 × base_width`. The base width is the grid footprint and is fixed by the size category. Wide/short images fill the full base width. Tall images that would overflow the height cap are scaled down to fit and become narrower than the base — they are centred horizontally over it (no cropping, aspect preserved). This keeps height monotonic with size: a larger base always permits a taller figure, so a Small mini can never tower over a Large one.

Cut lines: solid 0.2mm light grey rectangle around the full unfolded mini.

## Page composition

- Page: A4 portrait (210 × 297 mm). Letter toggle (216 × 279 mm).
- Margin: 10 mm all sides.
- Gap between minis: 2 mm horizontal and vertical.
- Packing: greedy row-based. Sort entries by size descending. Fill rows left-to-right with minis of compatible heights; new row starts when width overflows. Overflow to next page when height overflows.
- A single mini is never split across pages.

## Output

Vector PDF via `pdf-lib` (or `jsPDF` — implementer's choice).
- Images embedded once per unique upload, placed multiple times by reference.
- Cut lines and fold lines are PDF paths, not raster.
- Filename: `paper-minis-{YYYYMMDD-HHmm}.pdf`.

## Tech stack

- Pure static SPA. No backend.
- Vanilla TS + Vite, or React + Vite (implementer's choice).
- Deploy: any static host (GH Pages, Cloudflare Pages, local `file://` works too).
- No analytics, no telemetry, no external APIs.

## UI (minimum viable)

- Top: list of entry rows. Each row: image thumbnail, size dropdown, count input, remove button.
- "Add row" button.
- Page size toggle (A4 / Letter).
- "Generate PDF" button (disabled when no rows or any row missing an image).
- Optional: live preview of first page as the user adds rows (nice-to-have, not required).

## Out of scope (v1)

- URL paste / fetching remote images (CORS).
- Background removal / silhouette cut.
- Separate front and back artwork upload.
- Integral fold-out feet (separate stand assumed).
- Cloud storage / saved entries / multi-user.

## Open implementation choices (left to implementer)

- React vs vanilla. Either works; vanilla is lighter for this scope.
- `pdf-lib` vs `jsPDF`. `pdf-lib` has cleaner image reuse; `jsPDF` is simpler.
- Whether to render a live HTML preview or only the final PDF.
import type { DnDSize, Entry } from './types';
import { fitImageBox, resolveBaseWidthMm } from './sizes.ts';

// Page and layout constants. These live here (not in pdf.ts) so the packing
// math is a pure, DOM/PDF-free module that both the live page-count estimate
// and the PDF generator share.
export const PAGE_SIZES_MM = {
  a4: { w: 210, h: 297 },
  letter: { w: 216, h: 279 },
} as const;

export type PageSizeKey = keyof typeof PAGE_SIZES_MM;

export const MARGIN_MM = 10;
export const GAP_MM = 2;
export const TAB_HEIGHT_MM = 8;

// A single placed copy of an entry, with its resolved geometry. entryIndex maps
// back to the source entry so callers (the PDF drawer, the warning UI) can
// attribute each mini to its row.
export type PackedMini = {
  entryIndex: number;
  copyIndex: number; // 0-based copy within the entry
  size: DnDSize;
  baseWidthMm: number; // footprint width — outline, tabs, packing
  imageWidthMm: number; // drawn image width (<= baseWidthMm)
  imageHeightMm: number;
  imageOffsetXMm: number; // horizontal offset to center the image over the base
  totalHeightMm: number;
  label?: string;
};

export type PackedRow = { items: PackedMini[]; widthMm: number; heightMm: number };
export type PackedPage = { rows: PackedRow[]; heightMm: number };

// A mini that cannot fit a single page at all, attributed to its entry.
export type SkippedMini = {
  entryIndex: number;
  copyIndex: number;
  baseWidthMm: number;
  totalHeightMm: number;
};

export type PackResult = {
  pages: PackedPage[];
  pageCount: number;
  miniCount: number; // minis actually placed (what will print)
  skipped: SkippedMini[];
  oversizedEntryIndices: number[]; // distinct entries with >=1 skipped mini
};

export type PackOptions = {
  pageSize: PageSizeKey;
  numberDuplicates: boolean;
};

// Expands entries into individual minis with resolved geometry, sorted by base
// width descending, then bin-packs them into rows and pages within the usable
// area. Entries lacking an image's natural dimensions or a valid base width are
// simply omitted (not yet packable); minis too large for a single page are
// reported as skipped rather than silently dropped.
export function packMinis(entries: Entry[], opts: PackOptions): PackResult {
  const { w: pageWmm, h: pageHmm } = PAGE_SIZES_MM[opts.pageSize];
  const usableWmm = pageWmm - MARGIN_MM * 2;
  const usableHmm = pageHmm - MARGIN_MM * 2;

  const minis: PackedMini[] = [];
  entries.forEach((e, entryIndex) => {
    const baseWidthMm = resolveBaseWidthMm(e);
    if (
      baseWidthMm <= 0 ||
      e.count <= 0 ||
      e.naturalWidth == null ||
      e.naturalHeight == null ||
      e.naturalWidth <= 0 ||
      e.naturalHeight <= 0
    ) {
      return; // not packable yet
    }
    const { imageWidthMm, imageHeightMm } = fitImageBox(baseWidthMm, e.naturalWidth, e.naturalHeight);
    const imageOffsetXMm = (baseWidthMm - imageWidthMm) / 2;
    const totalHeightMm = imageHeightMm * 2 + TAB_HEIGHT_MM * 2;
    for (let i = 0; i < e.count; i++) {
      minis.push({
        entryIndex,
        copyIndex: i,
        size: e.size,
        baseWidthMm,
        imageWidthMm,
        imageHeightMm,
        imageOffsetXMm,
        totalHeightMm,
        label: opts.numberDuplicates ? String(i + 1) : undefined,
      });
    }
  });

  // Sort by base width descending so wide minis lead each row — reordering rows
  // in the UI has no effect on output, which is why drag-to-reorder is out of
  // scope.
  minis.sort((a, b) => b.baseWidthMm - a.baseWidthMm);

  const pages: PackedPage[] = [];
  const skipped: SkippedMini[] = [];
  const oversized = new Set<number>();
  let placed = 0;

  let page: PackedPage = { rows: [], heightMm: 0 };
  let row: PackedRow = { items: [], widthMm: 0, heightMm: 0 };

  const flushRow = () => {
    if (row.items.length === 0) return;
    const addedHeight = row.heightMm + (page.rows.length > 0 ? GAP_MM : 0);
    if (page.heightMm + addedHeight > usableHmm) {
      if (page.rows.length > 0) pages.push(page);
      page = { rows: [row], heightMm: row.heightMm };
    } else {
      page.rows.push(row);
      page.heightMm += addedHeight;
    }
    row = { items: [], widthMm: 0, heightMm: 0 };
  };

  for (const mini of minis) {
    if (mini.baseWidthMm > usableWmm || mini.totalHeightMm > usableHmm) {
      skipped.push({
        entryIndex: mini.entryIndex,
        copyIndex: mini.copyIndex,
        baseWidthMm: mini.baseWidthMm,
        totalHeightMm: mini.totalHeightMm,
      });
      oversized.add(mini.entryIndex);
      continue;
    }
    const isFirst = row.items.length === 0;
    const addedWidth = mini.baseWidthMm + (isFirst ? 0 : GAP_MM);
    if (row.widthMm + addedWidth > usableWmm) {
      flushRow();
    }
    const firstNow = row.items.length === 0;
    row.widthMm += mini.baseWidthMm + (firstNow ? 0 : GAP_MM);
    row.items.push(mini);
    if (mini.totalHeightMm > row.heightMm) row.heightMm = mini.totalHeightMm;
    placed++;
  }
  flushRow();
  if (page.rows.length > 0) pages.push(page);

  return {
    pages,
    pageCount: pages.length,
    miniCount: placed,
    skipped,
    oversizedEntryIndices: [...oversized],
  };
}

import {
  PDFDocument,
  PDFImage,
  rgb,
  pushGraphicsState,
  popGraphicsState,
  concatTransformationMatrix,
} from 'pdf-lib';
import type { DnDSize, Entry } from './types';
import { SIZE_RANK, SIZE_WIDTH_MM } from './sizes';

const MM_TO_PT = 72 / 25.4;
const mm = (v: number) => v * MM_TO_PT;

const TAB_HEIGHT_MM = 8;
const MARGIN_MM = 10;
const GAP_MM = 2;
const STROKE_MM = 0.2;
const LIGHT_GREY = rgb(0.7, 0.7, 0.7);
const DASH_ON_MM = 1;
const DASH_OFF_MM = 1;

const PAGE_SIZES_MM = {
  a4: { w: 210, h: 297 },
  letter: { w: 216, h: 279 },
} as const;

export type PageSizeKey = keyof typeof PAGE_SIZES_MM;

type Mini = {
  size: DnDSize;
  widthMm: number;
  imageHeightMm: number;
  totalHeightMm: number;
  pdfImage: PDFImage;
};

type Row = { items: Mini[]; widthMm: number; heightMm: number };
type Page = { rows: Row[]; heightMm: number };

async function fileToImageBytes(
  file: File,
): Promise<{ bytes: Uint8Array; format: 'png' | 'jpg' }> {
  const type = file.type.toLowerCase();
  if (type === 'image/jpeg' || type === 'image/jpg') {
    return { bytes: new Uint8Array(await file.arrayBuffer()), format: 'jpg' };
  }
  if (type === 'image/png') {
    return { bytes: new Uint8Array(await file.arrayBuffer()), format: 'png' };
  }
  // WebP or other → decode via canvas, re-encode to PNG.
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D canvas context');
  ctx.drawImage(bitmap, 0, 0);
  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('canvas.toBlob failed'))),
      'image/png',
    ),
  );
  return { bytes: new Uint8Array(await blob.arrayBuffer()), format: 'png' };
}

async function embedFile(pdf: PDFDocument, file: File): Promise<PDFImage> {
  const { bytes, format } = await fileToImageBytes(file);
  return format === 'jpg' ? pdf.embedJpg(bytes) : pdf.embedPng(bytes);
}

function pack(
  minis: Mini[],
  usableWmm: number,
  usableHmm: number,
): Page[] {
  const pages: Page[] = [];
  let page: Page = { rows: [], heightMm: 0 };
  let row: Row = { items: [], widthMm: 0, heightMm: 0 };

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
    if (mini.widthMm > usableWmm || mini.totalHeightMm > usableHmm) {
      // Doesn't fit on a single page at all — skip with warning.
      console.warn(
        `Mini too large for page (${mini.widthMm}×${mini.totalHeightMm}mm); skipped.`,
      );
      continue;
    }
    const isFirst = row.items.length === 0;
    const addedWidth = mini.widthMm + (isFirst ? 0 : GAP_MM);
    if (row.widthMm + addedWidth > usableWmm) {
      flushRow();
    }
    const firstNow = row.items.length === 0;
    row.widthMm += mini.widthMm + (firstNow ? 0 : GAP_MM);
    row.items.push(mini);
    if (mini.totalHeightMm > row.heightMm) row.heightMm = mini.totalHeightMm;
  }
  flushRow();
  if (page.rows.length > 0) pages.push(page);
  return pages;
}

export async function generatePDF(
  entries: Entry[],
  pageSize: PageSizeKey,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Paper Minis');
  pdf.setCreator('Paper Mini Generator');

  const valid = entries.filter((e) => e.image && e.count > 0);
  if (valid.length === 0) throw new Error('No valid entries to generate.');

  // Embed each unique file once.
  const cache = new Map<File, PDFImage>();
  for (const e of valid) {
    if (!cache.has(e.image!)) {
      cache.set(e.image!, await embedFile(pdf, e.image!));
    }
  }

  // Expand to per-mini list, sorted by size descending.
  const minis: Mini[] = [];
  for (const e of valid) {
    const img = cache.get(e.image!)!;
    const widthMm = SIZE_WIDTH_MM[e.size];
    const aspect = img.height / img.width;
    const imageHeightMm = aspect * widthMm;
    const totalHeightMm = imageHeightMm * 2 + TAB_HEIGHT_MM * 2;
    for (let i = 0; i < e.count; i++) {
      minis.push({ size: e.size, widthMm, imageHeightMm, totalHeightMm, pdfImage: img });
    }
  }
  minis.sort((a, b) => SIZE_RANK[b.size] - SIZE_RANK[a.size]);

  const { w: pageWmm, h: pageHmm } = PAGE_SIZES_MM[pageSize];
  const usableWmm = pageWmm - MARGIN_MM * 2;
  const usableHmm = pageHmm - MARGIN_MM * 2;

  const pages = pack(minis, usableWmm, usableHmm);
  if (pages.length === 0) throw new Error('Nothing fits on a page.');

  for (const page of pages) {
    const pdfPage = pdf.addPage([mm(pageWmm), mm(pageHmm)]);
    let yTopMm = pageHmm - MARGIN_MM;
    for (const row of page.rows) {
      let xMm = MARGIN_MM;
      for (const mini of row.items) {
        drawMini(pdfPage, mini, xMm, yTopMm);
        xMm += mini.widthMm + GAP_MM;
      }
      yTopMm -= row.heightMm + GAP_MM;
    }
  }

  return pdf.save();
}

function drawMini(
  pdfPage: import('pdf-lib').PDFPage,
  mini: Mini,
  xMm: number,
  yTopMm: number,
) {
  const yBottomMm = yTopMm - mini.totalHeightMm;
  const x = mm(xMm);
  const yBottom = mm(yBottomMm);
  const w = mm(mini.widthMm);
  const totalH = mm(mini.totalHeightMm);
  const tab = mm(TAB_HEIGHT_MM);
  const imgH = mm(mini.imageHeightMm);
  const stroke = mm(STROKE_MM);

  // Bottom-up layout in PDF coords:
  //   [0, tab)             front-side tab
  //   [tab, tab+imgH)      front image (right-side-up)
  //   tab+imgH             fold line (centre)
  //   [tab+imgH, tab+2H)   back image (rotated 180°)
  //   [tab+2H, tab*2+2H)   back-side tab

  // Cut outline
  pdfPage.drawRectangle({
    x,
    y: yBottom,
    width: w,
    height: totalH,
    borderColor: LIGHT_GREY,
    borderWidth: stroke,
  });

  // Front image
  pdfPage.drawImage(mini.pdfImage, {
    x,
    y: yBottom + tab,
    width: w,
    height: imgH,
  });

  // Back image — rotated 180° (= mirror horizontal + flip vertical).
  // CTM [-1 0 0 -1 e f] maps (px,py) → (e-px, f-py).
  // For an image drawn at (0,0) sized w×imgH, the four corners map to a
  // rectangle from (e-w, f-imgH) to (e, f). We want that to be the slot
  // [(x, yBottom+tab+imgH), (x+w, yBottom+tab+2*imgH)], so e=x+w, f=yBottom+tab+2*imgH.
  const backTop = yBottom + tab + imgH * 2;
  pdfPage.pushOperators(pushGraphicsState());
  pdfPage.pushOperators(concatTransformationMatrix(-1, 0, 0, -1, x + w, backTop));
  pdfPage.drawImage(mini.pdfImage, { x: 0, y: 0, width: w, height: imgH });
  pdfPage.pushOperators(popGraphicsState());

  // Fold line — dotted, at the unfolded mini's vertical centre.
  const foldY = yBottom + tab + imgH;
  pdfPage.drawLine({
    start: { x, y: foldY },
    end: { x: x + w, y: foldY },
    thickness: stroke,
    color: LIGHT_GREY,
    dashArray: [mm(DASH_ON_MM), mm(DASH_OFF_MM)],
  });
}

export function buildFilename(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `paper-minis-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.pdf`;
}

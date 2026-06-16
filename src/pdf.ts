import {
  PDFDocument,
  PDFFont,
  PDFImage,
  PDFPage,
  StandardFonts,
  rgb,
  pushGraphicsState,
  popGraphicsState,
  concatTransformationMatrix,
} from 'pdf-lib';
import type { Entry } from './types';
import { resolveBaseWidthMm } from './sizes';
import {
  GAP_MM,
  MARGIN_MM,
  PAGE_SIZES_MM,
  TAB_HEIGHT_MM,
  packMinis,
  type PackedMini,
  type PageSizeKey,
} from './packing';

export type { PageSizeKey };

const MM_TO_PT = 72 / 25.4;
const mm = (v: number) => v * MM_TO_PT;

const STROKE_MM = 0.2;
const LIGHT_GREY = rgb(0.7, 0.7, 0.7);
const DASH_ON_MM = 1;
const DASH_OFF_MM = 1;

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

export type GenerateOptions = {
  pageSize: PageSizeKey;
  numberDuplicates: boolean;
};

export async function generatePDF(
  entries: Entry[],
  opts: GenerateOptions,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Paper Minis');
  pdf.setCreator('Paper Mini Generator');

  const valid = entries.filter(
    (e) => e.image && e.count > 0 && resolveBaseWidthMm(e) > 0,
  );
  if (valid.length === 0) throw new Error('No valid entries to generate.');

  const font = await pdf.embedFont(StandardFonts.HelveticaBold);

  // Embed each unique file once, keyed by its position in `valid` so packing's
  // entryIndex maps straight back to the embedded image.
  const images: PDFImage[] = [];
  const cache = new Map<File, PDFImage>();
  for (const e of valid) {
    let img = cache.get(e.image!);
    if (!img) {
      img = await embedFile(pdf, e.image!);
      cache.set(e.image!, img);
    }
    images.push(img);
  }

  // Drive layout off the embedded images' natural pixel dimensions so the PDF
  // and the live page-count estimate use the exact same packing.
  const sized: Entry[] = valid.map((e, i) => ({
    ...e,
    naturalWidth: images[i].width,
    naturalHeight: images[i].height,
  }));

  const { pages } = packMinis(sized, opts);
  if (pages.length === 0) throw new Error('Nothing fits on a page.');

  const { w: pageWmm, h: pageHmm } = PAGE_SIZES_MM[opts.pageSize];
  for (const page of pages) {
    const pdfPage = pdf.addPage([mm(pageWmm), mm(pageHmm)]);
    let yTopMm = pageHmm - MARGIN_MM;
    for (const row of page.rows) {
      let xMm = MARGIN_MM;
      for (const mini of row.items) {
        drawMini(pdfPage, mini, images[mini.entryIndex], xMm, yTopMm, font);
        xMm += mini.baseWidthMm + GAP_MM;
      }
      yTopMm -= row.heightMm + GAP_MM;
    }
  }

  return pdf.save();
}

function drawMini(
  pdfPage: PDFPage,
  mini: PackedMini,
  pdfImage: PDFImage,
  xMm: number,
  yTopMm: number,
  font: PDFFont,
) {
  const yBottomMm = yTopMm - mini.totalHeightMm;
  const x = mm(xMm);
  const yBottom = mm(yBottomMm);
  const w = mm(mini.baseWidthMm);
  const iw = mm(mini.imageWidthMm);
  const offX = mm(mini.imageOffsetXMm);
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

  // Front image — centered horizontally over the base footprint.
  pdfPage.drawImage(pdfImage, {
    x: x + offX,
    y: yBottom + tab,
    width: iw,
    height: imgH,
  });

  // Front label — top-right of front image
  if (mini.label) {
    drawLabelBadge(
      pdfPage,
      mini.label,
      font,
      mini.imageWidthMm,
      mini.imageHeightMm,
      x + offX,
      yBottom + tab,
    );
  }

  // Back image — rotated 180° (= mirror horizontal + flip vertical), centered.
  // CTM [-1 0 0 -1 e f] maps (px,py) → (e-px, f-py).
  // For an image drawn at (0,0) sized iw×imgH, the four corners map to a
  // rectangle from (e-iw, f-imgH) to (e, f). We want that to be the slot
  // [(x+offX, yBottom+tab+imgH), (x+offX+iw, yBottom+tab+2*imgH)], so
  // e=x+offX+iw, f=yBottom+tab+2*imgH.
  const backTop = yBottom + tab + imgH * 2;
  pdfPage.pushOperators(pushGraphicsState());
  pdfPage.pushOperators(
    concatTransformationMatrix(-1, 0, 0, -1, x + offX + iw, backTop),
  );
  pdfPage.drawImage(pdfImage, { x: 0, y: 0, width: iw, height: imgH });
  // Back label — same local coords as front so it lands on the visual
  // top-right of the back face after folding + walking around.
  if (mini.label) {
    drawLabelBadge(pdfPage, mini.label, font, mini.imageWidthMm, mini.imageHeightMm, 0, 0);
  }
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

// Draws a small white badge with a number at the top-right of an
// image-sized box anchored at (boxX, boxY) (bottom-left), in pt.
function drawLabelBadge(
  pdfPage: PDFPage,
  label: string,
  font: PDFFont,
  widthMm: number,
  imageHeightMm: number,
  boxX: number,
  boxY: number,
) {
  const badgeWmm = clamp(widthMm * 0.22, 4, 7);
  const badgeHmm = badgeWmm * 0.85;
  const padMm = Math.min(0.8, widthMm * 0.04);
  const fontSize = mm(badgeHmm * 0.65);

  const bw = mm(badgeWmm);
  const bh = mm(badgeHmm);
  const pad = mm(padMm);
  const bx = boxX + mm(widthMm) - bw - pad;
  const by = boxY + mm(imageHeightMm) - bh - pad;

  pdfPage.drawRectangle({
    x: bx,
    y: by,
    width: bw,
    height: bh,
    color: rgb(1, 1, 1),
    borderColor: rgb(0.4, 0.4, 0.4),
    borderWidth: mm(0.2),
  });

  const textW = font.widthOfTextAtSize(label, fontSize);
  const textH = font.heightAtSize(fontSize, { descender: false });
  pdfPage.drawText(label, {
    x: bx + (bw - textW) / 2,
    y: by + (bh - textH) / 2,
    size: fontSize,
    font,
    color: rgb(0, 0, 0),
  });
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function buildFilename(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `paper-minis-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.pdf`;
}

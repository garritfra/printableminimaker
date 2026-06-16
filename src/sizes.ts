import type { DnDPresetSize, DnDSize, Entry } from './types';

export const SIZE_WIDTH_MM: Record<DnDPresetSize, number> = {
  tiny: 12.5,
  small: 25,
  medium: 25,
  large: 50,
  huge: 75,
  gargantuan: 100,
};

export const SIZE_LABELS: Record<DnDSize, string> = {
  tiny: 'Tiny (12.5 mm)',
  small: 'Small (25 mm)',
  medium: 'Medium (25 mm)',
  large: 'Large (50 mm)',
  huge: 'Huge (75 mm)',
  gargantuan: 'Gargantuan (100 mm)',
  custom: 'Custom…',
};

export const DEFAULT_CUSTOM_WIDTH_MM = 30;

// Resolves the base/footprint width (mm) of an entry: the preset width for a
// D&D size, or the user's custom width. Returns 0 when a custom entry has no
// valid width yet, which callers treat as "not packable".
export function resolveBaseWidthMm(e: Pick<Entry, 'size' | 'customWidthMm'>): number {
  if (e.size === 'custom') return e.customWidthMm != null && e.customWidthMm > 0 ? e.customWidthMm : 0;
  return SIZE_WIDTH_MM[e.size];
}

// A mini's image height is capped at this multiple of its base width. The base
// width is the grid footprint and is fixed by the size category; without a cap,
// a tall image scaled to that width grows unbounded in height, so a Small
// creature with a portrait can tower over a Large one with a landscape image.
// Tying the cap to base width keeps the height monotonic with size: a larger
// base always permits a taller figure.
export const MAX_HEIGHT_RATIO = 1.5;

// Fits an image inside the per-size box (baseWidth × baseWidth*MAX_HEIGHT_RATIO),
// preserving aspect ratio. Wide/short images fill the full base width. Tall
// images are clamped to the max height and become narrower than the base (the
// caller centers them horizontally over the footprint). No cropping.
export function fitImageBox(
  baseWidthMm: number,
  imgWidthPx: number,
  imgHeightPx: number,
): { imageWidthMm: number; imageHeightMm: number } {
  const maxHeightMm = baseWidthMm * MAX_HEIGHT_RATIO;
  const aspect = imgHeightPx / imgWidthPx;
  let imageWidthMm = baseWidthMm;
  let imageHeightMm = aspect * baseWidthMm;
  if (imageHeightMm > maxHeightMm) {
    imageHeightMm = maxHeightMm;
    imageWidthMm = maxHeightMm / aspect;
  }
  return { imageWidthMm, imageHeightMm };
}

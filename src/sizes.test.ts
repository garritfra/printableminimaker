// One-off test (no framework in this project). Run with: node src/sizes.test.ts
import assert from 'node:assert/strict';
import { fitImageBox, MAX_HEIGHT_RATIO, SIZE_WIDTH_MM } from './sizes.ts';

let passed = 0;
const t = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
};

// A wide (landscape) image fills the full base width; height stays small.
t('landscape image fills base width', () => {
  const { imageWidthMm, imageHeightMm } = fitImageBox(50, 1500, 500); // aspect 1/3
  assert.equal(imageWidthMm, 50);
  assert.ok(Math.abs(imageHeightMm - 50 / 3) < 1e-9);
});

// A near-square image is unaffected (height under the cap).
t('square image fits to width', () => {
  const { imageWidthMm, imageHeightMm } = fitImageBox(25, 1000, 1000);
  assert.equal(imageWidthMm, 25);
  assert.equal(imageHeightMm, 25);
});

// A tall portrait is clamped to the per-size max height and becomes narrower
// than the base (centered later), instead of running away in height.
t('tall portrait is clamped to max height', () => {
  const base = 25;
  const { imageWidthMm, imageHeightMm } = fitImageBox(base, 500, 1500); // aspect 3
  const maxH = base * MAX_HEIGHT_RATIO;
  assert.equal(imageHeightMm, maxH);
  assert.ok(imageWidthMm < base, 'tall image should be narrower than the base');
  // aspect preserved
  assert.ok(Math.abs(imageHeightMm / imageWidthMm - 3) < 1e-9);
});

// The core bug: a Small creature with a tall image must never end up taller
// than a Large creature with the same tall image.
t('large is never shorter than small for identical tall art', () => {
  const small = fitImageBox(SIZE_WIDTH_MM.small, 500, 1500);
  const large = fitImageBox(SIZE_WIDTH_MM.large, 500, 1500);
  assert.ok(
    large.imageHeightMm >= small.imageHeightMm,
    `large (${large.imageHeightMm}) should be >= small (${small.imageHeightMm})`,
  );
});

console.log(`\n${passed} passed`);

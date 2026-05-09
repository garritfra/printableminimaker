import type { DnDSize } from './types';

export const SIZE_WIDTH_MM: Record<DnDSize, number> = {
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
};

export const SIZE_RANK: Record<DnDSize, number> = {
  gargantuan: 6,
  huge: 5,
  large: 4,
  medium: 3,
  small: 2,
  tiny: 1,
};

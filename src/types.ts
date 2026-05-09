export type DnDPresetSize = 'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'gargantuan';
export type DnDSize = DnDPresetSize | 'custom';

export type Entry = {
  image: File | null;
  size: DnDSize;
  customWidthMm?: number;
  count: number;
};

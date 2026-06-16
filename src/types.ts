export type DnDPresetSize = 'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'gargantuan';
export type DnDSize = DnDPresetSize | 'custom';

export type Entry = {
  image: File | null;
  size: DnDSize;
  customWidthMm?: number;
  count: number;
  // Natural pixel dimensions of the image, captured on thumbnail load. Drive the
  // live page-count estimate without a second decode. Undefined until loaded.
  naturalWidth?: number;
  naturalHeight?: number;
};

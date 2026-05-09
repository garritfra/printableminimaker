export type DnDSize = 'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'gargantuan';

export type Entry = {
  image: File | null;
  size: DnDSize;
  count: number;
};

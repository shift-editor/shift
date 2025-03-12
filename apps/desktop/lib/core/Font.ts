import { Contour } from './Contour';

export interface Metrics {
  unitsPerEm: number;
  ascender: number;
  descender: number;
  capHeight: number;
  xHeight: number;
}

export interface Glyph {
  name: string;
  contours: Contour[];
}

export interface Font {
  metrics: Metrics;
  glyphs: Map<number, Glyph>;
}

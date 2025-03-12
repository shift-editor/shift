import { ContourPoint } from '@/lib/core/Contour';

export type SegmentType = 'line' | 'cubic';

export type LineSegment = {
  type: 'line';
  points: {
    anchor1: ContourPoint;
    anchor2: ContourPoint;
  };
};

export type CubicSegment = {
  type: 'cubic';
  points: {
    anchor1: ContourPoint;
    control1: ContourPoint;
    control2: ContourPoint;
    anchor2: ContourPoint;
  };
};

export type Segment = LineSegment | CubicSegment;

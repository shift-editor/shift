import { ContourPoint } from '@/lib/core/Contour';

export type SegmentType = 'line' | 'quad' | 'cubic';

export type LineSegment = {
  type: 'line';
  points: {
    anchor1: ContourPoint;
    anchor2: ContourPoint;
  };
};

export type QuadSegment = {
  type: 'quad';
  points: {
    anchor1: ContourPoint;
    control: ContourPoint;
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

export type Segment = LineSegment | QuadSegment | CubicSegment;

/**
 * Snap - Snapping System for Precision Editing
 *
 * Provides infrastructure for snapping points to various targets:
 * - Point snapping: Snap to anchor points, endpoints, midpoints
 * - Line snapping: Snap to lines (perpendicular or nearest point)
 * - Grid snapping: Snap to a regular grid
 * - Angle snapping: Constrain to specific angles from an anchor
 *
 * Architecture:
 * The snapping system is designed to be composable:
 * 1. Define snap targets (points, lines, guides)
 * 2. Call Snap.find() with a point and threshold
 * 3. Get the best snap result (if any)
 *
 * Snap targets have priorities to handle overlapping snaps (e.g., prefer
 * endpoints over midpoints over line snaps).
 *
 * @example
 * ```ts
 * import { Snap, SnapTarget } from '@/lib/geo/Snap';
 *
 * // Define snap targets
 * const targets: SnapTarget[] = [
 *   Snap.pointTarget(endpoint, 'endpoint', 100),
 *   Snap.pointTarget(midpoint, 'midpoint', 50),
 *   Snap.lineTarget(guideLine, 'guide', 25),
 * ];
 *
 * // Find best snap
 * const result = Snap.find(mousePos, targets, threshold);
 * if (result.snapped) {
 *   usePosition(result.point);  // Use snapped position
 * } else {
 *   usePosition(mousePos);      // Use original position
 * }
 *
 * // Grid snapping
 * const gridSnapped = Snap.toGrid(mousePos, gridSize);
 *
 * // Angle constraint (e.g., 45° increments)
 * const angleSnapped = Snap.toAngle(mousePos, anchor, [0, 45, 90, 135, 180], 5);
 * ```
 */

import type { Point2D } from '@/types/math';
import { Vec2 } from './Vec2';
import { Segment, type Segment as SegmentType } from './Segment';

// ============================================
// Types
// ============================================

/**
 * Result of a snap operation.
 */
export interface SnapResult {
  /** Whether snapping occurred */
  snapped: boolean;
  /** The resulting point (snapped if snapped=true, original otherwise) */
  point: Point2D;
  /** The snap target that was matched (null if no snap) */
  target: SnapTarget | null;
  /** Distance from original point to snap point */
  distance: number;
  /** Optional label describing what was snapped to */
  label?: string;
}

/**
 * Base interface for all snap targets.
 */
interface SnapTargetBase {
  /** Unique identifier for this target */
  id: string;
  /** Priority for this target (higher = preferred when equidistant) */
  priority: number;
  /** Optional label for UI display (e.g., "endpoint", "center") */
  label?: string;
}

/**
 * Point snap target - snaps exactly to a point.
 */
export interface PointSnapTarget extends SnapTargetBase {
  type: 'point';
  point: Point2D;
}

/**
 * Line snap target - snaps to nearest point on a line segment.
 */
export interface LineSnapTarget extends SnapTargetBase {
  type: 'line';
  segment: SegmentType;
  /** How to snap to the line */
  mode: 'nearest' | 'perpendicular' | 'endpoint-only';
}

/**
 * Grid snap target - snaps to a regular grid.
 */
export interface GridSnapTarget extends SnapTargetBase {
  type: 'grid';
  /** Grid cell size (both x and y) */
  spacing: number;
  /** Grid origin (default: {x:0, y:0}) */
  origin?: Point2D;
  /** Optional separate y spacing */
  spacingY?: number;
}

/**
 * Angle snap target - constrains to specific angles from an anchor.
 */
export interface AngleSnapTarget extends SnapTargetBase {
  type: 'angle';
  /** The anchor point from which angles are measured */
  anchor: Point2D;
  /** Allowed angles in degrees (e.g., [0, 45, 90, 135, 180, 225, 270, 315]) */
  angles: number[];
  /** Angular tolerance in degrees */
  tolerance: number;
}

/**
 * Extension line snap target - snaps to an infinite extension of a line.
 */
export interface ExtensionSnapTarget extends SnapTargetBase {
  type: 'extension';
  /** A point on the line */
  point: Point2D;
  /** Direction vector of the line (will be normalized) */
  direction: Point2D;
}

/**
 * Union type for all snap targets.
 */
export type SnapTarget =
  | PointSnapTarget
  | LineSnapTarget
  | GridSnapTarget
  | AngleSnapTarget
  | ExtensionSnapTarget;

/**
 * Options for finding snaps.
 */
export interface SnapOptions {
  /** Maximum distance to consider a snap */
  threshold: number;
  /** Only consider targets with these types */
  typeFilter?: SnapTarget['type'][];
  /** Custom filter function */
  filter?: (target: SnapTarget) => boolean;
}

// ============================================
// Snap Namespace
// ============================================

export const Snap = {
  // ============================================
  // Main API
  // ============================================

  /**
   * Find the best snap for a point among the given targets.
   * Returns the snap result with the highest priority snap within threshold.
   */
  find(point: Point2D, targets: SnapTarget[], options: SnapOptions): SnapResult {
    const { threshold, typeFilter, filter } = options;

    let bestResult: SnapResult = {
      snapped: false,
      point,
      target: null,
      distance: Infinity,
    };

    for (const target of targets) {
      // Apply filters
      if (typeFilter && !typeFilter.includes(target.type)) continue;
      if (filter && !filter(target)) continue;

      const result = snapToTarget(point, target);

      if (result.distance > threshold) continue;

      // Check if this is a better snap:
      // 1. Closer distance, or
      // 2. Same distance but higher priority
      const isBetter =
        result.distance < bestResult.distance - 0.001 ||
        (Math.abs(result.distance - bestResult.distance) < 0.001 &&
          target.priority > (bestResult.target?.priority ?? -Infinity));

      if (isBetter) {
        bestResult = {
          snapped: true,
          point: result.point,
          target,
          distance: result.distance,
          label: target.label,
        };
      }
    }

    return bestResult;
  },

  /**
   * Find all snaps within threshold, sorted by distance then priority.
   */
  findAll(
    point: Point2D,
    targets: SnapTarget[],
    options: SnapOptions
  ): SnapResult[] {
    const { threshold, typeFilter, filter } = options;
    const results: SnapResult[] = [];

    for (const target of targets) {
      if (typeFilter && !typeFilter.includes(target.type)) continue;
      if (filter && !filter(target)) continue;

      const result = snapToTarget(point, target);
      if (result.distance <= threshold) {
        results.push({
          snapped: true,
          point: result.point,
          target,
          distance: result.distance,
          label: target.label,
        });
      }
    }

    // Sort by distance, then by priority (descending)
    results.sort((a, b) => {
      const distDiff = a.distance - b.distance;
      if (Math.abs(distDiff) > 0.001) return distDiff;
      return (b.target?.priority ?? 0) - (a.target?.priority ?? 0);
    });

    return results;
  },

  // ============================================
  // Direct Snapping Functions
  // ============================================

  /**
   * Snap a point to a grid.
   */
  toGrid(point: Point2D, spacing: number, origin: Point2D = { x: 0, y: 0 }): Point2D {
    return {
      x: Math.round((point.x - origin.x) / spacing) * spacing + origin.x,
      y: Math.round((point.y - origin.y) / spacing) * spacing + origin.y,
    };
  },

  /**
   * Snap a point to a grid with separate x/y spacing.
   */
  toGridXY(
    point: Point2D,
    spacingX: number,
    spacingY: number,
    origin: Point2D = { x: 0, y: 0 }
  ): Point2D {
    return {
      x: Math.round((point.x - origin.x) / spacingX) * spacingX + origin.x,
      y: Math.round((point.y - origin.y) / spacingY) * spacingY + origin.y,
    };
  },

  /**
   * Constrain a point to specific angles from an anchor.
   * Returns the constrained point if within angular tolerance, otherwise the original.
   *
   * @param point - The point to potentially constrain
   * @param anchor - The anchor point (origin for angle measurement)
   * @param angles - Allowed angles in degrees (0 = right, 90 = up, etc.)
   * @param toleranceDeg - Angular tolerance in degrees
   */
  toAngle(
    point: Point2D,
    anchor: Point2D,
    angles: number[],
    toleranceDeg: number
  ): SnapResult {
    const dx = point.x - anchor.x;
    const dy = point.y - anchor.y;
    const distance = Math.hypot(dx, dy);

    if (distance < 0.001) {
      return { snapped: false, point, target: null, distance: 0 };
    }

    // Current angle in degrees (0 = right, counter-clockwise positive)
    const currentAngle = (Math.atan2(dy, dx) * 180) / Math.PI;

    // Find the closest allowed angle
    let bestAngle = angles[0];
    let bestDiff = Infinity;

    for (const angle of angles) {
      // Normalize angle difference to [-180, 180]
      let diff = currentAngle - angle;
      while (diff > 180) diff -= 360;
      while (diff < -180) diff += 360;

      if (Math.abs(diff) < Math.abs(bestDiff)) {
        bestDiff = diff;
        bestAngle = angle;
      }
    }

    if (Math.abs(bestDiff) <= toleranceDeg) {
      const angleRad = (bestAngle * Math.PI) / 180;
      const snappedPoint = {
        x: anchor.x + distance * Math.cos(angleRad),
        y: anchor.y + distance * Math.sin(angleRad),
      };
      return {
        snapped: true,
        point: snappedPoint,
        target: null,
        distance: Vec2.dist(point, snappedPoint),
        label: `${bestAngle}°`,
      };
    }

    return { snapped: false, point, target: null, distance: 0 };
  },

  /**
   * Project a point onto a line (infinite line, not segment).
   */
  toLine(point: Point2D, linePoint: Point2D, lineDirection: Point2D): Point2D {
    const dir = Vec2.normalize(lineDirection);
    const v = Vec2.sub(point, linePoint);
    const t = Vec2.dot(v, dir);
    return Vec2.add(linePoint, Vec2.scale(dir, t));
  },

  /**
   * Project a point onto the nearest point on a segment.
   */
  toSegment(point: Point2D, segment: SegmentType): Point2D {
    return Segment.closestPoint(segment, point).point;
  },

  // ============================================
  // Target Factories
  // ============================================

  /**
   * Create a point snap target.
   */
  pointTarget(
    point: Point2D,
    id: string,
    priority: number = 0,
    label?: string
  ): PointSnapTarget {
    return { type: 'point', point, id, priority, label };
  },

  /**
   * Create a line snap target.
   */
  lineTarget(
    segment: SegmentType,
    id: string,
    priority: number = 0,
    mode: LineSnapTarget['mode'] = 'nearest',
    label?: string
  ): LineSnapTarget {
    return { type: 'line', segment, id, priority, mode, label };
  },

  /**
   * Create a grid snap target.
   */
  gridTarget(
    spacing: number,
    id: string = 'grid',
    priority: number = 0,
    origin?: Point2D,
    spacingY?: number
  ): GridSnapTarget {
    return { type: 'grid', spacing, id, priority, origin, spacingY };
  },

  /**
   * Create an angle snap target.
   */
  angleTarget(
    anchor: Point2D,
    angles: number[],
    tolerance: number,
    id: string,
    priority: number = 0
  ): AngleSnapTarget {
    return { type: 'angle', anchor, angles, tolerance, id, priority };
  },

  /**
   * Create an extension line snap target.
   */
  extensionTarget(
    point: Point2D,
    direction: Point2D,
    id: string,
    priority: number = 0,
    label?: string
  ): ExtensionSnapTarget {
    return { type: 'extension', point, direction, id, priority, label };
  },

  // ============================================
  // Preset Configurations
  // ============================================

  /**
   * Common angle sets for angle snapping.
   */
  angles: {
    /** 90° increments: 0, 90, 180, 270 */
    orthogonal: [0, 90, 180, 270],
    /** 45° increments: 0, 45, 90, 135, 180, 225, 270, 315 */
    diagonal: [0, 45, 90, 135, 180, 225, 270, 315],
    /** 15° increments */
    fine: Array.from({ length: 24 }, (_, i) => i * 15),
    /** 30° increments */
    coarse: [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330],
  },

  /**
   * Default priority levels for common snap types.
   */
  priorities: {
    /** Highest priority - exact point matches */
    endpoint: 100,
    /** High priority - calculated points */
    intersection: 90,
    /** Medium-high priority - segment midpoints */
    midpoint: 80,
    /** Medium priority - perpendicular/tangent snaps */
    perpendicular: 60,
    /** Lower priority - nearest point on line */
    nearest: 40,
    /** Low priority - grid snaps */
    grid: 20,
    /** Lowest priority - angle constraints */
    angle: 10,
  },
} as const;

// ============================================
// Internal Functions
// ============================================

interface InternalSnapResult {
  point: Point2D;
  distance: number;
}

function snapToTarget(point: Point2D, target: SnapTarget): InternalSnapResult {
  switch (target.type) {
    case 'point':
      return {
        point: target.point,
        distance: Vec2.dist(point, target.point),
      };

    case 'line':
      return snapToLine(point, target);

    case 'grid':
      return snapToGrid(point, target);

    case 'angle':
      return snapToAngle(point, target);

    case 'extension':
      return snapToExtension(point, target);
  }
}

function snapToLine(point: Point2D, target: LineSnapTarget): InternalSnapResult {
  const seg = target.segment;

  switch (target.mode) {
    case 'endpoint-only': {
      const distStart = Vec2.dist(point, seg.p0);
      const distEnd = Vec2.dist(point, seg.p1);
      if (distStart <= distEnd) {
        return { point: seg.p0, distance: distStart };
      }
      return { point: seg.p1, distance: distEnd };
    }

    case 'perpendicular': {
      // Only snap if the perpendicular foot lands on the segment
      const closest = Segment.closestPoint(seg, point);
      // Check if we're at an endpoint (perpendicular might be off segment)
      if (closest.t <= 0 || closest.t >= 1) {
        return { point: point, distance: Infinity };
      }
      return { point: closest.point, distance: closest.distance };
    }

    case 'nearest':
    default: {
      const closest = Segment.closestPoint(seg, point);
      return { point: closest.point, distance: closest.distance };
    }
  }
}

function snapToGrid(point: Point2D, target: GridSnapTarget): InternalSnapResult {
  const origin = target.origin ?? { x: 0, y: 0 };
  const spacingX = target.spacing;
  const spacingY = target.spacingY ?? target.spacing;

  const snapped = {
    x: Math.round((point.x - origin.x) / spacingX) * spacingX + origin.x,
    y: Math.round((point.y - origin.y) / spacingY) * spacingY + origin.y,
  };

  return { point: snapped, distance: Vec2.dist(point, snapped) };
}

function snapToAngle(point: Point2D, target: AngleSnapTarget): InternalSnapResult {
  const result = Snap.toAngle(point, target.anchor, target.angles, target.tolerance);

  if (result.snapped) {
    return { point: result.point, distance: result.distance };
  }

  return { point: point, distance: Infinity };
}

function snapToExtension(point: Point2D, target: ExtensionSnapTarget): InternalSnapResult {
  const snapped = Snap.toLine(point, target.point, target.direction);
  return { point: snapped, distance: Vec2.dist(point, snapped) };
}

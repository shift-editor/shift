/**
 * Core types for the validation package.
 *
 * @module
 */
import type { PointType } from "@shift/types";

/**
 * Minimal shape the point predicates accept. Full `Point` snapshots, domain
 * `Point` objects, and lightweight test stubs all qualify.
 */
export type PointLike = { pointType: PointType };

import type { NamedInstanceId, SourceId } from "@shift/types";
import type { GlyphOutlineTarget } from "../../types/glyphOutline";

/**
 * An ordered set of variation outline targets: sources and named instances,
 * each at most once.
 *
 * @remarks
 * Callers ask whether a source or instance is shown instead of searching the
 * list by kind and id, and read the source or instance ids without narrowing
 * each target.
 */
export class OutlineTargets implements Iterable<GlyphOutlineTarget> {
  static readonly EMPTY = new OutlineTargets([]);

  /** A target's identity: equal for the same source or the same instance. */
  static key(target: GlyphOutlineTarget): string {
    switch (target.kind) {
      case "source":
        return `source:${target.sourceId}`;
      case "instance":
        return `instance:${target.instanceId}`;
    }
  }

  /** The targets in order, keeping the first of any repeated target. */
  static of(targets: Iterable<GlyphOutlineTarget>): OutlineTargets {
    const unique = new Map<string, GlyphOutlineTarget>();
    for (const target of targets) {
      const key = OutlineTargets.key(target);
      if (!unique.has(key)) unique.set(key, target);
    }

    return new OutlineTargets(unique.values().toArray());
  }

  /** Targets for these sources, in order. */
  static sources(sourceIds: Iterable<SourceId>): OutlineTargets {
    return OutlineTargets.of(
      Iterator.from(sourceIds).map((sourceId) => ({ kind: "source", sourceId }) as const),
    );
  }

  /** Targets for these named instances, in order. */
  static instances(instanceIds: Iterable<NamedInstanceId>): OutlineTargets {
    return OutlineTargets.of(
      Iterator.from(instanceIds).map((instanceId) => ({ kind: "instance", instanceId }) as const),
    );
  }

  readonly #targets: readonly GlyphOutlineTarget[];
  readonly #keys: ReadonlySet<string>;

  private constructor(targets: readonly GlyphOutlineTarget[]) {
    this.#targets = targets;
    this.#keys = new Set(targets.map(OutlineTargets.key));
  }

  /** Every target, in order. */
  get all(): readonly GlyphOutlineTarget[] {
    return this.#targets;
  }

  get size(): number {
    return this.#targets.length;
  }

  has(target: GlyphOutlineTarget): boolean {
    return this.#keys.has(OutlineTargets.key(target));
  }

  hasSource(sourceId: SourceId): boolean {
    return this.has({ kind: "source", sourceId });
  }

  hasInstance(instanceId: NamedInstanceId): boolean {
    return this.has({ kind: "instance", instanceId });
  }

  /** The sources among the targets, in order. */
  sources(): SourceId[] {
    return this.#targets.flatMap((target) => (target.kind === "source" ? [target.sourceId] : []));
  }

  /** The named instances among the targets, in order. */
  instances(): NamedInstanceId[] {
    return this.#targets.flatMap((target) =>
      target.kind === "instance" ? [target.instanceId] : [],
    );
  }

  /** These targets followed by `other`'s, each target once. */
  concat(other: OutlineTargets): OutlineTargets {
    return OutlineTargets.of([...this.#targets, ...other.#targets]);
  }

  [Symbol.iterator](): Iterator<GlyphOutlineTarget> {
    return this.#targets[Symbol.iterator]();
  }
}

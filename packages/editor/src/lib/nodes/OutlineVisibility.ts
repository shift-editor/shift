import type { NamedInstanceId, SourceId } from "@shift/types";
import type { OutlineTargetSet } from "../../types/glyphOutline";
import { OutlineTargets } from "./OutlineTargets";

/**
 * One variation section's outline choices: the ids turned on from their rows,
 * and the ids the section's show-all button turned on.
 */
class OutlineGroup<Id> {
  static empty<Id>(): OutlineGroup<Id> {
    return new OutlineGroup(new Set(), new Set(), false);
  }

  private constructor(
    /** Ids turned on from their own rows; they stay on when show-all is turned off. */
    readonly explicit: ReadonlySet<Id>,
    /** Ids show-all turned on, less any hidden from their rows since. */
    readonly group: ReadonlySet<Id>,
    /** Whether show-all is on. */
    readonly active: boolean,
  ) {}

  /** Show-all turned off, or turned on for `ids`. */
  toggleGroup(ids: Iterable<Id>): OutlineGroup<Id> {
    return this.active
      ? new OutlineGroup(this.explicit, new Set(), false)
      : new OutlineGroup(this.explicit, new Set(ids), true);
  }

  withExplicit(explicit: ReadonlySet<Id>): OutlineGroup<Id> {
    return new OutlineGroup(explicit, this.group, this.active);
  }

  withGroup(group: ReadonlySet<Id>): OutlineGroup<Id> {
    return new OutlineGroup(this.explicit, group, this.active);
  }
}

/**
 * Which sources and named instances are drawn as comparison outlines behind
 * the glyph being edited.
 *
 * @remarks
 * Immutable: each toggle returns a new value. A source shows when it is turned
 * on from its row, turned on by the Sources show-all button, or being edited
 * alongside the active source; a source being edited can be hidden from its
 * row, and that choice is forgotten once it stops being edited. The active
 * source is never outlined.
 */
export class OutlineVisibility {
  static readonly NONE = new OutlineVisibility(
    OutlineGroup.empty(),
    OutlineGroup.empty(),
    new Set(),
  );

  readonly #sources: OutlineGroup<SourceId>;
  readonly #instances: OutlineGroup<NamedInstanceId>;
  /** Sources being edited that were hidden from their rows. */
  readonly #hiddenEditing: ReadonlySet<SourceId>;

  private constructor(
    sources: OutlineGroup<SourceId>,
    instances: OutlineGroup<NamedInstanceId>,
    hiddenEditing: ReadonlySet<SourceId>,
  ) {
    this.#sources = sources;
    this.#instances = instances;
    this.#hiddenEditing = hiddenEditing;
  }

  /** Whether the Sources show-all button is on. */
  get sourceGroupActive(): boolean {
    return this.#sources.active;
  }

  /** Whether the Instances show-all button is on. */
  get instanceGroupActive(): boolean {
    return this.#instances.active;
  }

  /**
   * The visibility after clicking a source's row: a shown source is hidden and
   * a hidden one is shown.
   *
   * @param editing - Whether the source is being edited alongside the active source.
   */
  toggleSource(sourceId: SourceId, editing: boolean): OutlineVisibility {
    const sources = this.#sources;
    const explicit = sources.explicit.has(sourceId);
    const showsAsEditing = !explicit && editing && !this.#hiddenEditing.has(sourceId);
    const fromGroup = !explicit && (showsAsEditing || sources.group.has(sourceId));
    const hiddenEditing = editing
      ? this.#hiddenEditing.union(new Set([sourceId]))
      : this.#hiddenEditing;
    const group = without(sources.group, sourceId);

    if (fromGroup) {
      return new OutlineVisibility(sources.withGroup(group), this.#instances, hiddenEditing);
    }
    if (explicit) {
      return new OutlineVisibility(
        sources.withExplicit(without(sources.explicit, sourceId)).withGroup(group),
        this.#instances,
        hiddenEditing,
      );
    }
    return new OutlineVisibility(
      sources.withExplicit(sources.explicit.union(new Set([sourceId]))),
      this.#instances,
      without(this.#hiddenEditing, sourceId),
    );
  }

  /**
   * The visibility after clicking the Sources show-all button: on, it shows
   * `sourceIds`; off, it hides what it showed and keeps sources turned on
   * from their rows.
   */
  toggleSourceGroup(sourceIds: Iterable<SourceId>): OutlineVisibility {
    return new OutlineVisibility(
      this.#sources.toggleGroup(sourceIds),
      this.#instances,
      this.#hiddenEditing,
    );
  }

  /** The visibility after clicking a named instance's row. */
  toggleInstance(instanceId: NamedInstanceId): OutlineVisibility {
    const instances = this.#instances;
    const next = instances.group.has(instanceId)
      ? instances.withGroup(without(instances.group, instanceId))
      : instances.withExplicit(instances.explicit.symmetricDifference(new Set([instanceId])));
    return new OutlineVisibility(this.#sources, next, this.#hiddenEditing);
  }

  /** The visibility after clicking the Instances show-all button. */
  toggleInstanceGroup(instanceIds: Iterable<NamedInstanceId>): OutlineVisibility {
    return new OutlineVisibility(
      this.#sources,
      this.#instances.toggleGroup(instanceIds),
      this.#hiddenEditing,
    );
  }

  /**
   * Forgets row-hidden choices for sources no longer being edited.
   *
   * @returns this value when nothing is forgotten.
   */
  keepHiddenAmong(editingSourceIds: ReadonlySet<SourceId>): OutlineVisibility {
    const hiddenEditing = this.#hiddenEditing.intersection(editingSourceIds);
    if (hiddenEditing.size === this.#hiddenEditing.size) return this;

    return new OutlineVisibility(this.#sources, this.#instances, hiddenEditing);
  }

  /**
   * The source outlines to draw: sources turned on from their rows, then
   * sources being edited, then show-all's, each once and never the active
   * source.
   */
  sourceTargets(
    activeSourceId: SourceId | null,
    editingSourceIds: ReadonlySet<SourceId>,
  ): OutlineTargetSet {
    const editing = editingSourceIds.difference(this.#hiddenEditing);
    const shown = [...this.#sources.explicit, ...editing, ...this.#sources.group].filter(
      (sourceId) => sourceId !== activeSourceId,
    );

    return {
      targets: OutlineTargets.sources(shown),
      inheritedTargets: OutlineTargets.sources(this.#sources.group),
    };
  }

  /** The instance outlines to draw: rows' first, then show-all's, each once. */
  instanceTargets(): OutlineTargetSet {
    return {
      targets: OutlineTargets.instances([...this.#instances.explicit, ...this.#instances.group]),
      inheritedTargets: OutlineTargets.instances(this.#instances.group),
    };
  }
}

function without<Id>(ids: ReadonlySet<Id>, id: Id): ReadonlySet<Id> {
  return ids.difference(new Set([id]));
}

import type { NodeId, SourceId } from "@shift/types";
import {
  computed,
  effect,
  signal,
  track,
  type Effect,
  type Signal,
  type WritableSignal,
} from "../signals/index";
import type { GlyphOutlineTarget, OutlineTargetSet } from "../../types/glyphOutline";
import { OutlineTargets } from "./OutlineTargets";
import { OutlineVisibility } from "./OutlineVisibility";

/** The editor state comparison outlines follow. */
export interface GlyphOutlinesContext {
  /** The source being drawn, which is never outlined. */
  readonly activeSourceIdCell: Signal<SourceId | null>;
  /** Sources being edited together; each is outlined unless hidden from its row. */
  readonly editingSourceIdsCell: Signal<ReadonlySet<SourceId>>;
  /** The glyph node the outlines are drawn around, or null without one. */
  readonly outlinedNodeIdCell: Signal<NodeId | null>;
}

/**
 * Comparison outlines: other sources and named instances drawn behind the
 * glyph being edited.
 *
 * @remarks
 * Holds the session's {@link OutlineVisibility} and derives what to draw from
 * it, the active source, and the sources being edited. The variation panel
 * toggles it; the glyph node reads {@link forNode}. Call {@link dispose} when
 * the editor goes away.
 */
export class GlyphOutlines {
  readonly #context: GlyphOutlinesContext;
  readonly #visibilityCell: WritableSignal<OutlineVisibility> = signal(OutlineVisibility.NONE, {
    name: "glyphNode.outlineVisibility",
  });
  readonly #forgetHidden: Effect;

  /** Source outlines to draw, and those show-all contributes. */
  readonly sourcesCell: Signal<OutlineTargetSet>;
  /** Named instance outlines to draw, and those show-all contributes. */
  readonly instancesCell: Signal<OutlineTargetSet>;
  readonly #allCell: Signal<OutlineTargets>;

  constructor(context: GlyphOutlinesContext) {
    this.#context = context;
    this.sourcesCell = computed(
      () =>
        this.#visibilityCell.value.sourceTargets(
          context.activeSourceIdCell.value,
          context.editingSourceIdsCell.value,
        ),
      { name: "glyphNode.sourceOutlines", equals: sameTargetSet },
    );
    this.instancesCell = computed(() => this.#visibilityCell.value.instanceTargets(), {
      name: "glyphNode.instanceOutlines",
      equals: sameTargetSet,
    });
    this.#allCell = computed(
      () => this.sourcesCell.value.targets.concat(this.instancesCell.value.targets),
      { name: "glyphNode.outlines" },
    );
    // A source hidden from its row while being edited shows again the next
    // time it is edited, so the choice is dropped once it stops being edited.
    this.#forgetHidden = effect(
      () => {
        const activeSourceId = context.activeSourceIdCell.value;
        const editing = context.editingSourceIdsCell.value.difference(new Set([activeSourceId]));
        const visibility = this.#visibilityCell.peek();
        const kept = visibility.keepHiddenAmong(editing);
        if (kept !== visibility) this.#visibilityCell.set(kept);
      },
      { name: "glyphNode.forgetHiddenOutlines" },
    );
  }

  /** The current choices, for the show-all buttons' state. */
  get visibilityCell(): Signal<OutlineVisibility> {
    return this.#visibilityCell;
  }

  /** Shows or hides one outline from its row. The active source is never outlined. */
  toggle(target: GlyphOutlineTarget): void {
    switch (target.kind) {
      case "source":
        this.#toggleSource(target.sourceId);
        return;
      case "instance":
        this.#update((visibility) => visibility.toggleInstance(target.instanceId));
        return;
    }
  }

  /** Clicks the Sources show-all button for `targets`, the sources it lists. */
  toggleSourceGroup(targets: OutlineTargets): void {
    const shown = this.sourcesCell.peek().targets;
    const sourceIds = targets.sources().filter((sourceId) => !shown.hasSource(sourceId));
    this.#update((visibility) => visibility.toggleSourceGroup(sourceIds));
  }

  /** Clicks the Instances show-all button for `targets`, the instances it lists. */
  toggleInstanceGroup(targets: OutlineTargets): void {
    const shown = this.instancesCell.peek().targets;
    const instanceIds = targets.instances().filter((instanceId) => !shown.hasInstance(instanceId));
    this.#update((visibility) => visibility.toggleInstanceGroup(instanceIds));
  }

  /**
   * The outlines to draw around a glyph node, sources first; tracks every input.
   *
   * @returns An empty list for any node but the one outlines are drawn around.
   */
  forNode(nodeId: NodeId): readonly GlyphOutlineTarget[] {
    track(this.#context.outlinedNodeIdCell);
    if (this.#context.outlinedNodeIdCell.peek() !== nodeId) return [];

    track(this.#allCell);
    return this.#allCell.peek().all;
  }

  dispose(): void {
    this.#forgetHidden.dispose();
  }

  #toggleSource(sourceId: SourceId): void {
    if (sourceId === this.#context.activeSourceIdCell.peek()) return;

    const editing = this.#context.editingSourceIdsCell.peek().has(sourceId);
    this.#update((visibility) => visibility.toggleSource(sourceId, editing));
  }

  #update(change: (visibility: OutlineVisibility) => OutlineVisibility): void {
    this.#visibilityCell.set(change(this.#visibilityCell.peek()));
  }
}

function sameTargetSet(a: OutlineTargetSet, b: OutlineTargetSet): boolean {
  return sameTargets(a.targets, b.targets) && sameTargets(a.inheritedTargets, b.inheritedTargets);
}

function sameTargets(a: OutlineTargets, b: OutlineTargets): boolean {
  return (
    a.size === b.size &&
    a.all.every((target, index) => {
      const other = b.all[index];
      return other !== undefined && OutlineTargets.key(target) === OutlineTargets.key(other);
    })
  );
}

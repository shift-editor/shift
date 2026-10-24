import type { GlyphId } from "@shift/types";

/** How a click combines with the current selection. */
export interface SelectionModifiers {
  /** Extends from the anchor to the clicked member (Shift). */
  readonly range: boolean;
  /** Adds or removes the clicked member alone (⌘ or Ctrl). */
  readonly toggle: boolean;
}

/**
 * The members selected in a group preview, in member order, with the member
 * a range extends from (`anchor`) and the one last moved to (`focus`).
 *
 * @remarks
 * Immutable: every change returns a new selection over the same members.
 * When the group's members change, {@link withMembers} carries the selection
 * over to them.
 */
export class MemberSelection {
  readonly members: readonly GlyphId[];
  /** The selected members, in member order. */
  readonly ids: readonly GlyphId[];
  readonly anchor: GlyphId | null;
  readonly focus: GlyphId | null;
  readonly #memberSet: ReadonlySet<GlyphId>;
  readonly #selected: ReadonlySet<GlyphId>;

  private constructor(
    members: readonly GlyphId[],
    memberSet: ReadonlySet<GlyphId>,
    selected: ReadonlySet<GlyphId>,
    anchor: GlyphId | null,
    focus: GlyphId | null,
  ) {
    this.members = members;
    this.#memberSet = memberSet;
    this.#selected = selected;
    this.ids = members.filter((member) => selected.has(member));
    this.anchor = anchor;
    this.focus = focus;
  }

  /** Nothing selected among `members`. */
  static empty(members: readonly GlyphId[]): MemberSelection {
    return new MemberSelection(members, new Set(members), new Set(), null, null);
  }

  get isEmpty(): boolean {
    return this.#selected.size === 0;
  }

  has(member: GlyphId): boolean {
    return this.#selected.has(member);
  }

  /** Nothing selected among the same members. */
  clear(): MemberSelection {
    return this.isEmpty ? this : MemberSelection.empty(this.members);
  }

  /**
   * The selection after clicking `member`, or empty space when it is null:
   * a plain click selects only it, Shift selects the range from the anchor,
   * and ⌘ or Ctrl adds or removes it.
   */
  click(member: GlyphId | null, modifiers: SelectionModifiers): MemberSelection {
    if (member === null) {
      return modifiers.range || modifiers.toggle ? this : this.clear();
    }
    if (modifiers.range && this.#isMember(this.anchor)) {
      return this.#with(this.#range(this.anchor, member), this.anchor, member);
    }
    if (modifiers.toggle) {
      return this.#with(this.#selected.symmetricDifference(new Set([member])), member, member);
    }
    return this.#with(new Set([member]), member, member);
  }

  /** The selection while dragging from `anchor` to `member`: the members between them. */
  drag(anchor: GlyphId, member: GlyphId): MemberSelection {
    return this.#with(this.#range(anchor, member), anchor, member);
  }

  /**
   * The selection after an arrow key: the focus moves one member, stopping at
   * either end, selecting only it, or with `extend` (Shift) the range from the
   * anchor to it. With nothing focused, it starts at the first member.
   */
  step(offset: -1 | 1, extend: boolean): MemberSelection {
    const first = this.members[0];
    if (first === undefined) return this.clear();
    const focusIndex = this.focus === null ? -1 : this.members.indexOf(this.focus);
    if (focusIndex === -1) return this.#with(new Set([first]), first, first);

    const nextIndex = Math.min(Math.max(focusIndex + offset, 0), this.members.length - 1);
    const next = this.members[nextIndex] ?? first;
    if (extend && this.#isMember(this.anchor)) {
      return this.#with(this.#range(this.anchor, next), this.anchor, next);
    }
    return this.#with(new Set([next]), next, next);
  }

  /** Every member, anchored at the first. */
  all(): MemberSelection {
    return this.#with(this.#memberSet, this.members[0] ?? null, this.members.at(-1) ?? null);
  }

  /** The selection carried over to `members`, without glyphs that are no longer members. */
  withMembers(members: readonly GlyphId[]): MemberSelection {
    if (members === this.members) return this;
    const memberSet = new Set(members);
    const kept = (id: GlyphId | null) => (id !== null && memberSet.has(id) ? id : null);
    return new MemberSelection(
      members,
      memberSet,
      this.#selected.intersection(memberSet),
      kept(this.anchor),
      kept(this.focus),
    );
  }

  #with(
    selected: ReadonlySet<GlyphId>,
    anchor: GlyphId | null,
    focus: GlyphId | null,
  ): MemberSelection {
    return new MemberSelection(this.members, this.#memberSet, selected, anchor, focus);
  }

  #isMember(id: GlyphId | null): id is GlyphId {
    return id !== null && this.#memberSet.has(id);
  }

  #range(from: GlyphId, to: GlyphId): ReadonlySet<GlyphId> {
    const a = this.members.indexOf(from);
    const b = this.members.indexOf(to);
    return new Set(this.members.slice(Math.min(a, b), Math.max(a, b) + 1));
  }
}

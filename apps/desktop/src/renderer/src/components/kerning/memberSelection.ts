import type { GlyphId } from "@shift/types";

/**
 * The members selected in a group preview, in member order, with the
 * member a range extends from (`anchor`) and the one last moved to (`focus`).
 */
export interface MemberSelection {
  readonly ids: readonly GlyphId[];
  readonly anchor: GlyphId | null;
  readonly focus: GlyphId | null;
}

export const NO_MEMBERS_SELECTED: MemberSelection = { ids: [], anchor: null, focus: null };

/** How a click combines with the current selection. */
export interface SelectionModifiers {
  /** Extends from the anchor to the clicked member (Shift). */
  readonly range: boolean;
  /** Adds or removes the clicked member alone (⌘ or Ctrl). */
  readonly toggle: boolean;
}

/**
 * The selection after clicking `member`, or empty space when it is null:
 * a plain click selects only it, Shift selects the range from the anchor,
 * and ⌘ or Ctrl adds or removes it.
 */
export function clickSelection(
  members: readonly GlyphId[],
  current: MemberSelection,
  member: GlyphId | null,
  modifiers: SelectionModifiers,
): MemberSelection {
  if (member === null) {
    return modifiers.range || modifiers.toggle ? current : NO_MEMBERS_SELECTED;
  }
  if (modifiers.range && current.anchor !== null && members.includes(current.anchor)) {
    return {
      ids: memberRange(members, current.anchor, member),
      anchor: current.anchor,
      focus: member,
    };
  }
  if (modifiers.toggle) {
    const ids = current.ids.includes(member)
      ? current.ids.filter((id) => id !== member)
      : inMemberOrder(members, [...current.ids, member]);
    return { ids, anchor: member, focus: member };
  }
  return { ids: [member], anchor: member, focus: member };
}

/** The selection while dragging from `anchor` to `member`: the members between them. */
export function dragSelection(
  members: readonly GlyphId[],
  anchor: GlyphId,
  member: GlyphId,
): MemberSelection {
  return { ids: memberRange(members, anchor, member), anchor, focus: member };
}

/**
 * The selection after an arrow key: the focus moves one member, stopping at
 * either end, selecting only it, or with `extend` (Shift) the range from the
 * anchor to it. With nothing selected, it starts at the first member.
 */
export function stepSelection(
  members: readonly GlyphId[],
  current: MemberSelection,
  offset: -1 | 1,
  extend: boolean,
): MemberSelection {
  const first = members[0];
  if (first === undefined) return NO_MEMBERS_SELECTED;
  const focusIndex = current.focus === null ? -1 : members.indexOf(current.focus);
  if (focusIndex === -1) return { ids: [first], anchor: first, focus: first };

  const next = members[Math.min(Math.max(focusIndex + offset, 0), members.length - 1)] ?? first;
  if (extend && current.anchor !== null && members.includes(current.anchor)) {
    return { ids: memberRange(members, current.anchor, next), anchor: current.anchor, focus: next };
  }
  return { ids: [next], anchor: next, focus: next };
}

/** Every member, anchored at the first. */
export function selectAllMembers(members: readonly GlyphId[]): MemberSelection {
  const first = members[0] ?? null;
  return { ids: [...members], anchor: first, focus: members.at(-1) ?? null };
}

/** The selection without glyphs that are no longer members. */
export function retainMembers(
  selection: MemberSelection,
  members: readonly GlyphId[],
): MemberSelection {
  const ids = selection.ids.filter((id) => members.includes(id));
  if (ids.length === selection.ids.length) return selection;
  const kept = (id: GlyphId | null) => (id !== null && members.includes(id) ? id : null);
  return { ids, anchor: kept(selection.anchor), focus: kept(selection.focus) };
}

function memberRange(members: readonly GlyphId[], from: GlyphId, to: GlyphId): GlyphId[] {
  const a = members.indexOf(from);
  const b = members.indexOf(to);
  return members.slice(Math.min(a, b), Math.max(a, b) + 1);
}

function inMemberOrder(members: readonly GlyphId[], ids: readonly GlyphId[]): GlyphId[] {
  return members.filter((member) => ids.includes(member));
}

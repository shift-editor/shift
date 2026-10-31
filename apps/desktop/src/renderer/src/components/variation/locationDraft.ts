import type { Axis, AxisId } from "@shift/types";

/** The fields of a create-source or create-instance form, as typed. */
export interface LocationDraftValues {
  readonly name: string;
  /** Axis coordinates as typed, keyed by axis id. */
  readonly location: Readonly<Record<string, string>>;
}

/** An existing source or instance a draft must not duplicate. */
interface NamedEntry {
  readonly name: string;
}

/** An issue a creation form can report: on the name, one axis, or the location as a whole. */
export type DraftIssue =
  | { readonly kind: "name"; readonly message: string }
  | { readonly kind: "axis"; readonly axisId: AxisId; readonly message: string }
  | { readonly kind: "location"; readonly message: string };

/** A draft's name problem: missing, or already taken. */
type NameIssue = Extract<DraftIssue, { kind: "name" }>;

/**
 * A new source or named instance as the user is typing it: a name and one
 * coordinate per axis.
 *
 * @remarks
 * Both creation forms validate the same way: the name must be present and
 * unused, each coordinate must be a number, and no existing entry may sit at
 * the same location. Each form adds its own location rule and messages.
 */
export class LocationDraft {
  readonly #values: LocationDraftValues;

  constructor(values: LocationDraftValues) {
    this.#values = values;
  }

  /** The name without surrounding whitespace, as it would be saved. */
  get name(): string {
    return this.#values.name.trim();
  }

  /** The typed coordinate on `axis`; NaN when the field is empty or not a number. */
  coordinate(axis: Axis): number {
    const input = this.#values.location[axis.id];
    return input?.trim() ? Number(input) : Number.NaN;
  }

  /** The first axis whose coordinate is not a number, or null when all are. */
  invalidAxis(axes: readonly Axis[]): Axis | null {
    return axes.find((axis) => !Number.isFinite(this.coordinate(axis))) ?? null;
  }

  /** Every axis's coordinate, or null when any is not a number. */
  coordinates(axes: readonly Axis[]): Record<AxisId, number> | null {
    if (this.invalidAxis(axes)) return null;

    return Object.fromEntries(axes.map((axis) => [axis.id, this.coordinate(axis)])) as Record<
      AxisId,
      number
    >;
  }

  /**
   * The problem with the draft's name, or null when it is present and unused.
   *
   * @param noun - What is being created, with its article: `"a source"`, `"an instance"`.
   * @param existing - Entries whose names the draft must not reuse.
   */
  nameIssue(noun: string, existing: readonly NamedEntry[]): NameIssue | null {
    const name = this.name;
    if (!name) return { kind: "name", message: `Enter ${noun} name` };
    if (!existing.some((entry) => entry.name === name)) return null;

    const capitalized = noun.charAt(0).toUpperCase() + noun.slice(1);
    return { kind: "name", message: `${capitalized} named “${name}” already exists` };
  }
}

/**
 * The validation issue a creation form shows, asked for by kind.
 *
 * @remarks
 * Shaped like `scene.only(kind)`: `issues.of("name")` is the issue when it is
 * a name issue and null otherwise, so each field reads its own issue without
 * narrowing.
 */
export class DraftIssues<Issue extends DraftIssue> {
  /** The issue to show; null while validation is hidden or the draft is valid. */
  readonly shown: Issue | null;

  constructor(shown: Issue | null) {
    this.shown = shown;
  }

  /** The shown issue when it is of `kind`, else null. */
  of<K extends Issue["kind"]>(kind: K): Extract<Issue, { kind: K }> | null {
    if (this.shown?.kind !== kind) return null;

    return this.shown as Extract<Issue, { kind: K }>;
  }

  /** The shown axis issue when it targets `axisId`, else null. */
  forAxis(axisId: AxisId): Extract<Issue, { kind: "axis" }> | null {
    const issue: DraftIssue | null = this.shown;
    if (issue?.kind !== "axis" || issue.axisId !== axisId) return null;

    return this.shown as Extract<Issue, { kind: "axis" }>;
  }
}

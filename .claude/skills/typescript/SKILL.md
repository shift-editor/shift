---
name: typescript
description: Canonical rules for writing and reviewing TypeScript in Shift's packages and desktop app. Use whenever you add or change `.ts`/`.tsx` code that defines a domain type, a lookup by id, a collection field, a scene node kind, a cross-object `?.` chain, a `filter`/`map`/`find` chain, a spread, a cast, or data arriving over IPC, MCP or JSON. Load `signals` as well for reactive code and `jsdoc` for documentation comments.
---

# /typescript — How TypeScript is written in Shift

TypeScript makes `{ points?: … }`, `?.` and `?? []` free to write, so a vague type never pays for itself; every caller does. An audit found 350 `?? null` / `?? []` fallbacks, about 70 hand-written "take the first item" sequences and 95 calls that filtered the scene again for what they wanted. Each was a caller making up for a type or owner that did not answer its question. The rules below put the answer on the type, once.

## The rule

**When callers repeat the same fallback, filter or chain, the type they are reading is missing a method or is shaped wrong.** Fix the type, then call it by name.

## Collections

- **A collection field is never optional.** An empty collection means "none". `PositionTargets` carries `points` and `anchors` always, so readers write `targets.points`, not `targets.points ?? []`, and ask `targets.hasAnchors`. Keep an optional collection only where absence differs from empty (an option that falls back to a default, a wire field mirroring Rust's `Option<Vec<_>>`), and say why in the disable comment. Enforced by `shift/no-optional-collection-field`.
- **Lookups return `T | null`, never `undefined`.** Hold id-keyed collections in `EntityMap` from `@shift/types`: `get` returns `null`, `require` throws a named `EntityNotFoundError` when absence is a bug for that caller, and `where(predicate)` filters in insertion order. Expose indexes as `ReadonlyEntityMap`. Enforced by `shift/no-map-get-to-null`; `no-mutable-collection-field` treats `EntityMap` fields like `Map` fields.
- **Prove "at least one" in the type.** When a list is never empty, type it `readonly [T, ...T[]]` and read `list[0]` without a fallback.
- **Use the built-ins before spreading.** Query an iterator directly (`map.values().filter(…).toArray()`; `.some`/`.every`/`.find` need no array), copy-sort with `toSorted`, merge sets with `union`/`intersection`/`difference`, group with `Map.groupBy`. Enforced by `shift/prefer-iterator-helpers`.
- **A combined collection used in several places is a type.** `ThemeCatalog` builds the shipped-then-user theme list once; `KerningGroups.atPosition` sorts once per change. Spread to build a value once, not at every read.

## Order and subsets

**A sort or filter written at a call site means the collection is missing a method.** When an order is part of the domain (kerning groups by name, recent documents newest first), the owning type keeps it, and callers read it already ordered. When a subset has a name ("the external axes", "the root contours", "the one glyph node"), the owner exposes it, as a `computed` when it is reactive (see `signals`), so no caller filters.

```ts
// Before: every caller sorts and filters, each with its own inline comparator.
const groups = groupsById
  .values()
  .filter((group) => group.position === position)
  .toArray()
  .sort((a, b) => a.name.localeCompare(b.name));
const axes = useAxes().filter((axis) => axis.role === "external");

// After: the owners hold the order and the subset.
const groups = kerning.groups.atPosition(position); // Map.groupBy over toSorted(byName), once per change
const axes = useExternalAxes(); // font.externalAxesCell, a computed
```

- **Name every order.** Pass a named comparator to `sort`/`toSorted`: `ascending`, `descending`, `alphabetical`, `byName`, `comparing(key, order)` and `orderBy(...)` from `@shift/types`, `byAxis(axis)` from `@shift/geo`, or a comparator named next to the type it orders (`newestFirst`, `byMappingInput(axis)`). Enforced by `shift/no-inline-comparator`.
- **Match typed names through `NameQuery`.** A search field's text becomes `NameQuery.from(text)` (trimmed; an empty query matches everything; `{ prefix: "@" }` drops a typed marker), and the list asks `query.filter(items)`, `query.matches(item)` or `query.filterBy(items, (item) => [item.displayName])`, never `x.name.toLowerCase().includes(lower)`.
- **Sort once, where the collection changes,** not at every read. An immutable owner sorts in its constructor (`KerningGroups`); a reactive owner sorts in a `computed`.

## List and set invariants

**When an edit to a list or set must re-establish an invariant (unique, ordered, capped, keyed), the invariant belongs to a type or named function, not to each call site.**

```ts
// Before: every edit filters, re-adds, sorts and slices to keep the list valid.
const remaining = entries.filter((entry) => !sameDocument(entry, visit));
entries = [{ ...visit, openedAt }, ...remaining].sort(newestFirst).slice(0, LIMIT);

// After: the list keeps one entry per document, newest first, capped.
entries = entries.touch(visit, (previous) => ({ ...previous, ...visit, openedAt }));
```

- **Recency lists** use `RecentList` from `@shift/types`: `of(items, rules)`, `find`, `touch`, `update`, `remove`, `where`.
- **Keyed lists** use `upsertBy`, `replaceBy` and `removeBy` from `@shift/types` instead of `findIndex`, copy and assign, or `map((x) => (x.id === id ? f(x) : x))`. A domain rule beyond the key gets a named function, such as `withIndependentMapping` in `@shift/editor/variation`.
- **Sets in React state** use `useMemberSet`, never a copied `Set` toggled in each handler.
- **Stored JSON lists** read through `parseEach(schema, text)`, which keeps each valid entry and reads anything malformed as empty.

## Owners answer questions

- **When a `?.` chain crosses two objects, the first object is missing a method.** `editor.glyphForId(id)?.layerForSource(sourceId) ?? null` is `editor.layerForGlyph(id, sourceId)`. Add the method to the owner, next to the data, and use it everywhere.
- **When the same `filter`/`find` appears in two places, it becomes a method** on the type that owns the collection: `scene.only(kind)` for "the one node of this kind" (null with none or several), `scene.first(kind)` for "the first in scene order". Enforced by `shift/prefer-scene-only`.
- **Prefer a method or a small class over a free function whose first parameter is the domain object.** A free function is right for pure numeric helpers with no owner (`wrapIndex` in `@shift/geo`, enforced for cyclic indexing by `shift/no-manual-index-wrap`).

## Extensible kinds

- **Kinds that packages may add are open registries, not closed unions.** `SceneNodeKinds` and `NodeDefinitionByKind` are interfaces; `ShiftNode`, `NodeKind` and `NodeOfKind<K>` derive from them, and a package registers a kind by declaration merging on `@shift/editor/types`.
- **Ask a definition what a node offers instead of switching on built-in kinds.** Commands reach text through `NodeDefinition.textItems`, so a new kind works with select-all without editing it. Inside one definition a discriminated union is right; outside `lib/nodes/`, avoid `node.kind === "glyph"` where a capability would do.

## Types

- **Brand values in one place.** Mint or convert ids with the `as<Brand>` helpers from `@shift/types` (`asPointId`, `asGlyphId`, …), never `as PointId` (enforced by `shift/brand-cast-via-helper`). Locations use `asExternalAxisLocation` / `asDesignAxisLocation`.
- **Parse at the boundary.** Data from IPC, MCP, JSON or `localStorage` is `unknown` until a zod schema or a type guard accepts it; derive the TypeScript type from the schema (`z.input<typeof schema>`) instead of writing an interface beside it. Never cast untrusted data.
- **Check tables with `satisfies`.** `const capabilities = { … } satisfies Record<string, CapabilityDefinition>` checks every entry and keeps literal key types, so dispatch needs no `as never`.
- **Make switches exhaustive.** End a `switch` on a union with `default: assertNever(value)`, so a new member fails to compile at every switch that forgot it.
- **Never re-declare a generated shape.** Import it from `@shift/types`; derive views in `packages/types/src/domain.ts`.

## Review checklist

- [ ] No optional collection field without a reason in its disable comment.
- [ ] No `Map.get(…) ?? null` on a class's own collection; id-keyed collections are `EntityMap`.
- [ ] No `nodesOfKind(kind)[0]`, `const [node] = nodesOfKind(kind)` or `nodesOfKind(kind).length === 1`.
- [ ] No `?.` chain across two objects where the owner could answer; no `filter`/`find` repeated across files.
- [ ] No `[...x.values()].filter(…)`, no `[...array].sort(…)` where `toSorted` fits.
- [ ] No inline comparator in `sort`/`toSorted`; no sort or named filter repeated at call sites where the owner could keep it.
- [ ] No `as <Brand>`; no cast of untrusted data; no hand-written interface duplicating a zod schema or a generated type.
- [ ] Every `switch` on a union is exhaustive.
- [ ] `pnpm lint:check`, `pnpm typecheck` and the affected tests pass.

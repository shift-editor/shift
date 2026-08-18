---
name: jsdoc
description: Add or revise source-level JSDoc for Shift APIs. Use this skill before writing or editing documentation comments for exported classes, methods, constructors, domain data structures, render frames, reactive state, or any API where caller intent, side effects, lifetime, ownership, or nullability are easy to misunderstand.
---

# /jsdoc — Source API Contracts

Write JSDoc as the stable public contract a caller needs without reading the implementation.

JSDoc comments must sit immediately before the documented symbol and use `/** ... */` so tooling can parse them. Follow the standard tag vocabulary from <https://jsdoc.app/about-getting-started>, adapted for TypeScript source.

## Why this matters

- **VS Code hover** renders the first line in bold and the rest as body. A one-sentence contract on line 1 is the single highest-leverage thing you can write.
- **TypeScript already encodes shape.** JSDoc is for what types can't say: ownership, lifetime, mutation, side effects, side-channel reactivity, nullability semantics, performance class, call ordering.
- **Code review** is the second reader. Reviewers should be able to judge a call site against the doc without opening the implementation.

## Runbook

1. Identify the audience: caller, implementer, renderer, tool author, or maintainer.
2. State the stable contract in one short opening sentence.
3. Add details only for ownership, lifetime, reactivity, mutation, side effects, nullability, performance, or call ordering. Put long detail under `@remarks`.
4. Use tags for callable APIs:
   - Add `@param` for every public constructor, method, or function parameter, and make the text describe the parameter's role, constraint, ownership, or valid range.
   - Add `@returns` when a method returns a value, nullable result, created object, snapshot, or read-only view.
   - Add `@throws {ErrorType} when …` for every observable failure mode (custom error class, semantic Error).
   - Do not add `@returns void`; describe the side effect in prose instead.
5. Cross-reference siblings with `@see {@link OtherSymbol}` (one tag per related symbol).
6. Add `@example` only when the intended call flow, ordering, or output is not obvious from the signature.
7. Re-read the comment and delete implementation trivia, current call-site anecdotes, and unstable examples.

## Hard Style Rules

- **One-line contract.** First sentence is a verb phrase (`Returns…`, `Applies…`, `Triggers…`), ending with a period. No "This function…".
- **`@remarks` for the long explanation.** If you need more than one sentence of context, demote it under `@remarks` so the hover summary stays clean.
- **`@param name - description` documents meaning, not type.** For public callable APIs, include the tag and make it earn its place by describing role, constraint, ownership, valid range, or call-order semantics.
- **`@returns` documents _meaning_, never "void".** Drop the tag entirely for void returns; describe the side effect in the summary instead. Use `@returns` to clarify ownership ("a fresh array; caller owns it"), nullability semantics ("null when the glyph has no contours, not when it's missing"), or that the result is a snapshot vs a live reactive view.
- **Document side effects, lifetime, and reactivity.** TypeScript can't encode "runs after render", "mutates the Glyph signal", "JS-only — does not call NAPI", "transfers ownership of the buffer". That is exactly what JSDoc is for.
- **Stable terms over current implementation names.** Document the concept, not today's wiring.
- **No warnings, no scolding.** State the contract directly.
- **Do not document private helpers** unless they encode a non-obvious invariant.
- **Do not name current callers** ("used by FooManager") — rots fast.
- **Never use JSDoc as a TODO list.** That belongs in commits, issues, or `// TODO` comments.

## What To Document

Document where the type signature is silent. If the type fully encodes the contract, write nothing. Otherwise, prioritize these dimensions:

- **Effects** — purity, mutation of arguments, mutation of shared state, I/O.
- **Ownership** — who owns the return value, who may mutate it, aliasing with internal state.
- **Identity vs value** — handles/refs/IDs that look like the loaded object but aren't; snapshots vs live views.
- **Nullability semantics** — what `null` / `undefined` / empty actually _means_ (absent, error, not-yet-loaded, end-of-stream).
- **Resolution semantics** — strict vs fallback, find vs find-or-create, exact vs nearest.
- **Lifetime and ordering** — preconditions, disposal, idempotence, what makes the result go stale.
- **Failure modes** — which errors, under which conditions; whether failure is observable or swallowed.
- **Concurrency and context** — thread, render phase, re-entrancy, async cancellation behavior.
- **Performance class** — Big-O, hot-path safety, sync-vs-async cost, when a convenient method is wrong.

Pick only the dimensions that apply. Do not force every doc to address all of them.

## Tag Reference Card (TS-first)

| Tag                       | Use it when                                                                 | Example                                                               |
| ------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `@param name - desc`      | Every public param. Document the constraint, not the type.                  | `@param glyph - must be loaded (not a GlyphRef)`                      |
| `@returns desc`           | Nullable / created / snapshot / read-only / non-obvious return.             | `@returns null when no source is active; never throws.`               |
| `@throws {Err} when …`    | Every observable failure mode. Always type + condition.                     | `@throws {GlyphNotLoadedError} when called on a ref-only glyph.`      |
| `@example`                | Call order, setup, or output carries the lesson.                            | See below — fenced ts, imports, `// Output:` line.                    |
| `@remarks`                | Long explanation that would bloat the summary.                              | One short paragraph; not multi-paragraph essays.                      |
| `@see {@link Foo}`        | One tag per related sibling API.                                            | `@see {@link createDraft}`                                            |
| `@deprecated <migration>` | Always with replacement or removal reason.                                  | `@deprecated Use draft.setPositions instead — avoids NAPI per frame.` |
| `@template T - desc`      | Generic with a _semantic_ constraint that isn't obvious from the signature. | `@template T - coordinate-space tag; controls bound interpretation.`  |

### Avoid in TypeScript

These re-encode information TS already owns. Including them is noise and risks drift.

- `@type`, `@typedef`, `@property` — TS variable annotations, `type`, and `interface` are the source of truth.
- `@class`, `@constructor`, `@extends`, `@implements`, `@function`, `@method` — the declaration shape says this.
- `{Type}` annotations inside `@param` / `@returns` — never write `@param {string} name`. Document meaning; TS owns the type.

### Skip in app code

These are doc-generator ceremony for published packages. Shift is not a published package; do not write these in app code.

- `@since`, `@public`, `@beta`, `@alpha`, `@experimental`, `@category`
- `@author`, `@version`, `@copyright`
- date-fns-style `@name`/`@summary`/`@description` triples

## Tag Format

In TypeScript files, omit JSDoc type annotations. Let TypeScript own the type; let JSDoc own meaning.

```ts
/**
 * Snapshot of state required to redraw the scene layer.
 *
 * Building this frame establishes the reactive dependencies for the scene
 * output. Drawing code consumes the frame as plain data.
 *
 * @param dependencies - Values that invalidate or describe one scene redraw.
 */
constructor(dependencies: SceneFrameDependencies) {}
```

For functions with multiple parameters, document each parameter by role:

```ts
/**
 * Converts a screen-space pointer into editor coordinate spaces.
 *
 * @param screen - Pointer position in canvas pixels.
 * @param drawOffset - Glyph-local offset applied by the current editor view.
 * @returns Coordinates in screen, scene, and glyph-local space.
 */
function resolveCoordinates(
  screen: Point2D,
  drawOffset: Point2D,
): Coordinates {}
```

When failure paths are observable, document them with `@throws`:

```ts
/**
 * Loads a glyph by handle. Resolves once the source is hydrated.
 *
 * @param handle - identity returned by {@link glyphHandleForUnicode}.
 * @returns the loaded glyph; never a {@link GlyphRef}.
 * @throws {GlyphNotFoundError} when the handle does not resolve in the active font.
 * @see {@link glyphHandleForUnicode}
 */
async function loadGlyph(handle: GlyphHandle): Promise<Glyph> {}
```

When deprecating, name the replacement:

```ts
/**
 * @deprecated Use {@link draft.setPositions} — `bridge.setNodePositions` sends
 *   one NAPI call per point and causes ~450ms frames on dense glyphs.
 */
function setNodePositions(updates: NodePositionUpdate[]): void {}
```

## Examples — the rules

Examples must be runnable assertions, not decoration.

- **Always fenced and language-tagged** with ` ```ts `. VS Code highlights inside fences.
- **Self-contained.** Include imports. The reader should be able to paste the snippet and have it compile.
- **Show expected output** with a `// Output:` or `// =>` comment when the value carries the lesson.
- **Short.** 8–12 lines is the typical good length; 25 is the ceiling. If it doesn't fit, the example is the wrong shape.
- **One concept per `@example`.** Multiple `@example` blocks are fine and better than one mega-block.

A good example for a Shift API:

````ts
/**
 * Begins a JS-only edit of the active glyph. Pair with {@link GlyphDraft.finish}
 * to persist, or {@link GlyphDraft.discard} to revert.
 *
 * @returns a draft scoped to the active glyph; `null` when no glyph is loaded.
 *
 * @example
 * ```ts
 * const draft = editor.createDraft();
 * if (!draft) return;
 *
 * for (const update of dragFrame) {
 *   draft.setPositions(update); // JS-only; no NAPI
 * }
 *
 * draft.finish("translate");    // syncs once, records undo
 * ```
 */
createDraft(): GlyphDraft | null {}
````

When TS inference is non-obvious, annotate the type position inline (Effect pattern):

````ts
/**
 * @example
 * ```ts
 * //      ┌─── Option<Glyph>
 * //      ▼
 * const result = font.glyphForUnicode(0x41);
 * ```
 */
````

Avoid examples that depend on hidden setup, test fixtures, or implicit globals.

## Overloads

- **Per-overload JSDoc** when parameter _meanings_ differ. (This is the TS standard-library convention.) Copy the contract on each signature; do not put one block on the implementation signature.
- **Top-overload JSDoc only** when the contract is identical and only the type shape differs. The implementation signature stays bare.

```ts
/**
 * Resolves a glyph from its Unicode codepoint.
 * @param codepoint - the Unicode scalar value.
 */
function glyphFor(codepoint: number): Glyph | null;
/**
 * Resolves a glyph from its handle.
 * @param handle - identity from a prior lookup; cheaper than codepoint resolution.
 */
function glyphFor(handle: GlyphHandle): Glyph | null;
function glyphFor(arg: number | GlyphHandle): Glyph | null {
  /* impl */
}
```

## Anti-Patterns (bad → good)

### `@returns void`

```ts
// ❌
/** @returns void */
clear(): void {}

// ✅ describe the side effect; drop @returns entirely
/** Clears all queued render frames. Idempotent. */
clear(): void {}
```

### Re-stating the signature in prose

```ts
// ❌
/**
 * @param glyph - the glyph
 * @param index - the index
 */

// ✅ document the constraint
/**
 * @param glyph - must be loaded (not a {@link GlyphRef}).
 * @param index - zero-based contour index; -1 selects the outer hull.
 */
```

### Multi-paragraph summary

```ts
// ❌ VS Code hover becomes a wall of text
/**
 * This function is used to set positions. It is part of the GlyphDraft API and
 * is used during drag operations. It does not call NAPI. It must be paired
 * with either finish() or discard().
 */

// ✅ one-line contract + @remarks
/**
 * Updates JS-side glyph positions; pair with {@link finish} or {@link discard}.
 *
 * @remarks
 * JS-only — does not call NAPI. Use during drag hot path; call `finish()` once
 * at gesture end to sync to Rust, or `discard()` to revert.
 */
```

### Naming current callers

```ts
// ❌ rots fast
/** Called by GlyphSidebar and TransformPanel. */

// ✅ describe what it produces
/** Returns the active glyph's tight bounds, accounting for sidebearings. */
```

### Bare `@deprecated`

```ts
// ❌
/** @deprecated */
function oldThing() {}

// ✅ name the replacement or the reason
/** @deprecated Use {@link newThing} — removes the legacy 2D-only path. */
function oldThing() {}
```

### `@example` for trivial calls

````ts
// ❌ noise
/**
 * @example
 * ```ts
 * const id = glyph.id;
 * ```
 */
get id(): string {}

// ✅ no @example; the name is the whole story
get id(): string {}
````

### Examples that depend on hidden setup

````ts
// ❌ what is `editor`?
/** @example editor.commit(); */

// ✅ self-contained
/**
 * @example
 * ```ts
 * const editor = createTestEditor();
 * await editor.loadGlyph("A");
 * editor.commit();
 * ```
 */
````

### General "do not" list

- API dumps covering every accessor.
- Long examples that obscure the method being documented.
- Compat wrappers or aliases that hide which API should be used.
- Rewriting behavior while documenting unless the user requested the API fix too.
- Describing bugs, migrations, or "currently used by X" in API docs.
- Listing concrete state variants as examples when the actual contract is broader.
- Documenting private helpers with full `@param`/`@returns`/`@example` blocks — a one-line summary is enough.
- Mixing `{Type}`-style JSDoc with TSDoc tags in the same module; pick one (in TS, drop `{Type}`).

## Quick Checklist

Before saving, scan your doc against this list:

- [ ] First line is one sentence, verb-phrase, ends with a period.
- [ ] No `@type`, `@typedef`, or `{Type}` annotations.
- [ ] No `@returns void`. Side effect described in summary.
- [ ] Every observable failure has `@throws {Type} when …`.
- [ ] `@example` (if present) has imports, is fenced ` ```ts `, and shows output when it carries the lesson.
- [ ] No current-caller name-drops, no migration notes, no TODOs.
- [ ] No ceremony tags (`@since`, `@public`, `@category`, `@author`).
- [ ] If deprecated, the replacement or reason is named.

# ADR 0002: Inspector subjects and sections

- **Status:** Proposed
- **Date:** 2026-10-07

## Context

The glyph sidebar decided what it described by counting glyph nodes: exactly one glyph node meant "that glyph", anything else meant nothing. Thirteen editor operations used the same check. Text runs broke the assumption: in Text mode the sidebar should describe the glyph at the caret, at run level it should describe the selected run glyphs, and while editing outlines it should describe the entered glyph.

Resolving that in the sidebar produced a precedence cascade (Text mode, then run-level selection, then the entered glyph) and put model writes — the loop over layers, undo labels, skipped layers — in the presentation layer. Every new mode or node type, such as images, would have to be slotted into that cascade.

Shift also has two selections that intentionally stay separate: Text mode's caret range (`TextEditing` anchor and focus) and the run-level item selection (`editor.selection`). Leaving Text mode does not carry its range into the run-level selection.

## Decision

The inspector describes a **subject**, which is distinct from the selection.

- **Selection** is what operations act on. It stays per mode, as today.
- **Subject** is what the inspector describes: one node, plus optional parts of it (item ids, point ids). Empty parts mean the node itself.

```ts
interface Subject {
  readonly node: ShiftNode;
  readonly parts: readonly ShiftId[];
}
```

### The active mode supplies the subject

Each tool answers `subject()`; `Editor.subjectCell` reads the active tool's answer. A tool without its own answer inherits the default: the single entered node, with no parts.

| Mode                       | Subject                                                             |
| -------------------------- | ------------------------------------------------------------------- |
| Text mode, collapsed caret | the run, plus the glyph item after the caret (before it at the end) |
| Text mode, range           | the run, plus the glyph items in the range                          |
| Select, run level          | the run, plus the selected run glyphs                               |
| Select, editing a glyph    | the entered glyph node; selecting points does not change it         |
| Any other tool             | the entered node                                                    |

The subject is derived, not stored. Its inputs — text editing, selection, and editing scope — are session records that undo already restores, so the subject follows undo without its own record or synchronising writes.

### Node definitions turn a subject into sections

`NodeDefinition.inspect(node, parts)` returns the inspector sections for its kind. The sidebar renders whatever sections the subject's node returns; it holds no mode logic and no kind checks.

```ts
type InspectorSection = { kind: "glyphMetrics"; metrics: GlyphMetricsTarget };
// later: | { kind: "image"; image: ImageTarget }
```

- `GlyphNodeDefinition` returns glyph metrics for its glyph.
- `TextRunNodeDefinition` returns glyph metrics for the glyphs of the given items, each glyph once.

### Sections own their reads and writes

A section carries a target object that owns everything about its data, in the same shape as `TransformTarget`:

- live values, with a value shown only when every target agrees;
- whether it is editable;
- writes, applied to every target as one undo step.

Targets are built in `lib/`, never in `ui/`. The UI renders values and calls the target's writes; it never touches layers, sources, or transactions.

### Editor operations take the entered node

Operations that place or change geometry inside a glyph (`addComponent`, `selectAll`, `insertContent`, booleans, Pen, Shape) act on the entered glyph node through `Editing.node(kind)`: the one entered node of a kind, or null. They do not count nodes in the scene.

## Consequences

- A new node type joins the inspector by implementing `inspect` and returning its own section kind; its tool supplies a subject only if the default does not fit.
- The sidebar's precedence cascade and its model writes are removed.
- The inspector shows several glyphs at once; differing values show empty and an edit applies to all of them.
- In Text mode, selecting or creating a source no longer creates a layer for the glyph edited before Text mode, because nothing is entered.

## Related documentation

- [Editor facade and selection](../../../packages/editor/src/lib/editor/docs/DOCS.md)
- [Tools and behaviors](../../../packages/editor/src/lib/tools/docs/DOCS.md)
- [Text runs and editing](../../../packages/editor/src/lib/text/docs/DOCS.md)

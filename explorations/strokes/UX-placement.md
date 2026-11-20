# Stroke UX placement (exploration sketch)

**Status:** placement notes only — **no product UI** in this task. Kostya alignment before any renderer work (see [ROADMAP.md](./ROADMAP.md) §Alignment gates).

## Open questions

| Question | Notes |
| -------- | ----- |
| **Menu dialog** | Classic “Outline stroke…” modal (width, caps, joins, preview, OK/Cancel). Familiar from Illustrator/Figma; good for destructive A1 and one-shot bake (A2.2). |
| **Left panel** | Persistent stroke inspector while a skeleton is selected — natural home for **live** stroke (A2.1): width, cap/join, miter, “live vs baked” state. |
| **Canvas context menu** | Fast path for selection-based commands; likely hosts **Outline stroke**, **Offset path**, and **Expand stroke** when `com.shift.stroke` marks skeletons. |

No decision yet; these can coexist (panel for edit, context menu for verbs, menu for discoverability).

## A1 intents → probable entry points (non-final)

| Intent | Role today | Likely UI homes (guess) |
| ------ | ---------- | ------------------------ |
| **`OutlineStroke`** | Destructive bake with explicit style in the command | Context menu “Outline stroke…”, app menu Path → Outline stroke; dialog collects width/caps/joins. |
| **`OffsetContour`** | Closed path grow/shrink | Context menu “Offset path…”, same dialog pattern as product offset-path roadmap. |

## A2 live stroke → probable entry points (non-final)

| API / intent | Role | Likely UI homes (guess) |
| ------------ | ---- | ------------------------ |
| **`SetLiveStroke`** | Writes skeleton role + `outlineStyle` to `com.shift.stroke` | Panel toggle “Live stroke”, or first apply from stroke dialog (“Keep editable”). |
| **`GlyphLayer::stroke_outlines_for_preview()`** | Read-time outlines for canvas overlay | Renderer pass (A3.2); not a menu item. |
| **`BakeStrokeOutlines`** | Removes skeleton, installs fills, drops lib entry | Context menu “Expand stroke outline”, export guard, or explicit “Bake” in panel. |

## Data the UI must surface

- **Selection:** one or more **contour ids** on the active layer (not point-level for A2 v1).
- **Style:** width, cap, join, miter limit (`OutlineStrokeStyle`); later `styleId` presets (F0.2 / B4).
- **Mode:** live (skeleton + lib) vs baked (fill contours only).
- **Tolerance:** solver flattening (likely advanced/hidden; CLI exposes `--tolerance` for QA).
- **Preview:** skeleton visible; generated outline distinct (A3.2).

## Explicit non-goals for this document

- No wireframes, no Electron menu implementation, no WASM bridge DTOs.
- No pen/nib UI (streams B/C).
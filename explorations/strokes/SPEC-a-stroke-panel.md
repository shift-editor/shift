# Spec: `a-stroke-panel`

**Branch:** `explore/strokes`  
**Module:** [SPEC-map.md](./SPEC-map.md) → `a-stroke-panel`  
**ROADMAP:** A3.1 (UI half)  
**Last revised:** 2026-11-20  
**Status:** D1–D3 decided 2026-11-20; waiting on Tasos's go to start P1

**Scope line from Tasos:** reuse existing UI patterns, invent no UI that does not exist, follow the app's design philosophy. Tasos polishes the visuals afterwards. So this module ships the _structure and behaviour_ in existing components, not the final look.

## Verified starting point

Checked against the code on 2026-11-20.

| Fact                                                                                                                                                                                                                                                                                                           | Where                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| The five `glyph.stroke.*` commands, one availability function (with reasons) and the Glyph › Stroke menu exist. The menu runs them with fixed styles: width 20, round cap, round join, miter 4; offset distance 10.                                                                                            | `lib/commands/strokeCommands.ts`, `strokeAvailability.ts`, `strokeMenuCommand.ts`     |
| The preview is real-time and draws a solved fill plus a hairline edge.                                                                                                                                                                                                                                         | `a-stroke-preview` T1–T6, commit `096a3aca7`                                          |
| **No read returns a contour's stored style.** `liveStrokeContours` returns ids only. The sidebar cannot show current width, cap or join without a new Rust read.                                                                                                                                               | `Font.liveStrokeContours`, `GlyphLayer::live_stroke_contour_ids`                      |
| `OutlineStrokeStyle` has **one** `cap`, not a start cap and an end cap. UX-spec's "separate start and end icon groups" does not match the data.                                                                                                                                                                | `crates/shift-font/src/stroke/style.rs`                                               |
| "Outlines only" is not a state the engine can report: an expanded stroke is a plain contour. The mode readout in UX-spec has two real states, dynamic and not.                                                                                                                                                 | UX-spec § Attribute editing                                                           |
| The right sidebar is a list of `SidebarGroup`s in `RightSidebar.tsx`: Kerning, Handle, Boolean + Transform + Scale, Anchor, Text, Features.                                                                                                                                                                    | `components/editor/RightSidebar.tsx`                                                  |
| Existing sidebar controls to reuse: `SidebarSection` (title + `actions` slot), `SidebarNumberField` (label, `placeholder` for a mixed value, Enter/blur commit, Escape cancel), `IconButton` (`pressed` toggle, tooltip, `aria-disabled`), `SidebarPicker`, and a `Row` of label + control (in `TextSection`). | `components/editor/sidebar-right/`                                                    |
| A section's header `+` and `⋯` actions open a `Menu` beside the sidebar (`SidebarActionButton`, `useSidebarPanelAnchor`).                                                                                                                                                                                      | `components/variation/CreateAxisMenu.tsx`, `ui` skill                                 |
| Dialogs: Base UI `Dialog` with `variant="panel"`, a title row with ✕, a fields area and a row of actions (`SetSidebearingsDialog`). Opening one from a native-menu command goes through renderer state (`glyph.addComponent` → `SettingsNavigationProvider`).                                                  | `components/home/SetSidebearingsDialog.tsx`, `context/SettingsNavigationProvider.tsx` |
| The canvas context menu is a flat list; items appear conditionally (`Decompose Components`) or disabled (`Make First Point`).                                                                                                                                                                                  | `components/editor/CanvasContextMenu.tsx`                                             |
| Sidebar components have **no** component tests. Tests live on logic (`componentPicker.test.ts`, `fontFeatures.test.ts`) and behaviour (`TestEditor`).                                                                                                                                                          | `components/editor/`                                                                  |
| Tone of reasons: refused stroke commands already return a `reason`, and `notify(reason)` shows it.                                                                                                                                                                                                             | `strokeMenuCommand.ts`, `notify.ts`                                                   |

## Roadmap check

| Roadmap / UX-spec item                                               | In this module?           | Note                                                                                                  |
| -------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------- |
| A3.1 width                                                           | Yes                       | Sidebar number field                                                                                  |
| A3.1 caps                                                            | Yes                       | One cap per stroke; row only when the selection has an open dynamic contour                           |
| A3.1 joins                                                           | Yes                       | Row of three                                                                                          |
| A3.1 miter limit                                                     | Yes                       | Only while join is Miter                                                                              |
| A3.1 "panel" menus: apply, expand, expand…, offset…, remove          | Yes                       | Menu, sidebar, context menu. Dialogs per D1                                                           |
| A3.2 follow-ups: preview read errors reach the UI                    | No, `a-stroke-preview` T7 | Still open there; needed before sign-off                                                              |
| A1.2 offset has no product UI                                        | Yes                       | One dialog                                                                                            |
| Mode readout "Dynamic / Outlines only / Mixed"                       | Partly                    | Dynamic / plain / mixed, shown by which controls appear, not a label                                  |
| Stroke **position** (−100 % left … +100 % right)                     | **Yes, after `a-stroke-position`** | One `SidebarNumberField` row between Width and Join (percent), plus a direction cue. See D3          |
| Preset picker, Settings defaults, shortcuts, dashes, tolerance field | No                        | UX-spec defers them; presets are `a-stroke-presets`                                                   |
| "Show which source a width belongs to" (UX-spec)                     | No                        | The whole sidebar edits the active source and says so elsewhere. Revisit with `a-stroke-interp-spike` |
| Warning in Expand when a glyph has several sources                   | No                        | Wording waits for the interpolation spike                                                             |

## ASSUMPTIONS I'M MAKING

1. **Rust owns the answer to "what style does this contour have".** Add one engine read, generated like `live_stroke_contours`. TypeScript does not parse `com.shift.stroke`.
2. **One style per operation** (UX-spec #3). A field edit applies to every selected _dynamic_ contour. When their values differ, the field shows "Mixed" and a commit sets that one field on all of them, keeping each contour's other fields.
3. **No stroke tool and no new left-sidebar panel** (UX-spec out of scope).
4. **The new style of an added stroke is the last style set this session**, else round, width 20 (the menu's default today). Not persisted; Settings defaults come later.
5. **Disabled controls use `aria-disabled` and keep their tooltip** (`ui` skill). Clicking one shows the availability reason through `notify`, so nothing fails silently.
6. **Tests are on logic and behaviour**, as the codebase does today. A pure view-model function carries the section's rules; commands are tested through `TestEditor`.

## Objective

Make everything the stroke commands can do reachable and editable from the editor UI, using the components the app already has, so Tasos can play with strokes end to end and then polish the look.

**Success looks like:** select an open contour, press `+` in the Stroke section and see a stroke; change width, cap and join and see the preview follow; expand it, undo, remove it; select a closed contour and offset it. Every control that cannot run says why when pressed.

## What gets added

### 1. Stroke section (right sidebar)

A new `SidebarGroup` after the Boolean/Transform group and before Anchor. Hidden while the Text tool is active, or when no selected contour resolves to an editable layer.

| State of the selection         | Shows                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| Only plain contours            | Title row with `+` (Add dynamic stroke). No fields                                         |
| ≥1 dynamic contour             | Title row with `+` (only if some selected contour is plain) and `⋯`; then the fields below |
| Preview font / inactive source | Same layout, controls `aria-disabled`                                                      |

Fields, top to bottom, all on existing components (Position is added once `a-stroke-position` lands; it is a percent field, −100 … +100, 0 centred):

| Control     | Component                              | Rule                                                                     |
| ----------- | -------------------------------------- | ------------------------------------------------------------------------ |
| Width       | `SidebarNumberField`, label "W"        | Commit sets width; ≤ 0 is refused with the engine's reason               |
| Position    | `SidebarNumberField`, label "P", percent | −100 … +100, 0 centred, negative left of the path direction             |
| Join        | `Row` + three `IconButton`s, `pressed` | Bevel, Miter, Round                                                      |
| Miter limit | `SidebarNumberField` in a `Row`        | Only while the shown join is Miter; > 0                                  |
| Cap         | `Row` + three `IconButton`s            | Butt, Square, Round. Only when the selection has an open dynamic contour |

Each commit is one undo step, "Update dynamic stroke", through one new command (see 6).

### 2. Section menu `⋯`

A `Menu` opening beside the sidebar. Items are the existing commands: **Expand Stroke**, **Remove Dynamic Stroke**, **Offset Contour…** (and **Expand Stroke…** if D1 keeps it). Each is unavailable with a reason when the availability function says so.

### 3. Canvas context menu

Flat items after "Make First Point", shown only when they would run, as `Decompose Components` is: **Add Dynamic Stroke**, **Expand Stroke**, **Remove Dynamic Stroke**, **Offset Contour…**.

### 4. Native menu

Same ids and labels. `Apply Dynamic Stroke` runs with the last-set style (assumption 4). Commands with `…` open their dialog through renderer state, as `glyph.addComponent` does.

### 5. Dialogs

| Dialog                                 | Fields                                                          | Notes                                                                   |
| -------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Offset Contour…**                    | Distance (signed), Join, Miter limit when Miter                 | Any contour (`a-stroke-position`); sign by path direction; one `Dialog variant="panel"` like Set Sidebearings |
| **Expand Stroke…** (only if D1 = keep) | Width, Join, Miter limit, Cap, checkbox "Keep contour editable" | Same shared style block as the sidebar                                  |

Dialog errors show inline (`text-error`), as Set Sidebearings does.

### 6. Behaviour, not UI

- **Engine read** `live_strokes(layer)` → `{ contourId, style }` list, replacing `live_stroke_contours` in the TS API (the id list stays derivable). `Font.liveStrokes(layerId)` tracks `revision("layers")` as `liveStrokeContours` does.
- **`updateStrokeStyle(editor, patch)`** command: merges the patch into each selected dynamic contour's style and calls `setLiveStroke` once per distinct result, in one transaction.
- **`resolveStrokeSelection`** gains each dynamic contour's style, so the sidebar and the availability function read one source.
- **A pure section view model** (selection → which controls, shown values, "Mixed" flags) so the rules are unit tested without React.

### 7. Assets

Six small SVG icons for caps and joins (`assets/sidebar-right/`). Placeholders: Tasos redraws them in the UI follow-up.

## Not in this module

- Presets, Settings defaults, shortcuts, dashes, tolerance control, nib, width tool.
- Surfacing a failed preview solve (`a-stroke-preview` T7) and text-run behaviour (T8).
- Export correctness (`a-stroke-export`).
- Visual polish: spacing, colours, the faint fill, icon drawing. Tasos, after this ships.

## Decisions

| #   | Decision                                                                     | Recommendation                                                                                                                                                                              | Why                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Keep the two style dialogs (`Apply…`, `Expand…`) from UX-spec, or drop them? | **Drop both.** `Apply Dynamic Stroke` adds a stroke with the last style; style is edited live in the sidebar; `Expand Stroke` is the only expand. Keep `Offset Contour…` as the one dialog. | UX-spec wanted the dialogs because there was no live preview. Now the preview follows every edit. It also removes the "Expand Stroke vs Expand Stroke…" confusion: the one thing `Expand…` added (outline a plain contour in one step with a chosen style) is "add, adjust, expand". The `expandWithStyle` command stays for agents and tests, out of the menus                        |
| D2  | Cap and join as icon rows (six new SVGs), or as `SidebarPicker` text values? | **Icon rows.**                                                                                                                                                                              | Matches the text-alignment row and UX-spec. The picker opens a searchable panel, too heavy for three choices. Icons are placeholders for your polish                                                                                                                                                                                                                                   |
| D3  | Inside / outside / middle: defer, or plan a Rust module first?               | **Defer, and add `a-stroke-position` to the map.**                                                                                                                                          | The solver strokes centred only. Revised: designers draw a straight line and want the stroke on one side of it, for icons and for type. Glyphs already does this (Offset Curve `Position`, side set by path direction), so the module covers open and closed contours. The spike is done and decided, and the panel is built after it: it gets a Position row and Offset Contour… accepts any contour |

## Testing

| Layer                  | What                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rust                   | The new read returns each dynamic contour's stored style; none for a plain one; follows an edit and an undo                                                              |
| Command (`TestEditor`) | `updateStrokeStyle`: one field changes, the others stay per contour; mixed styles stay distinct; one undo step; refused width leaves the document and returns the reason |
| View model (unit)      | Which controls show for none / all / mixed dynamic selections, open and closed; "Mixed" flags; disabled states                                                           |
| Behaviour              | Menu and context-menu items run the right command or open the dialog; unavailable ones notify the reason                                                                 |
| Manual (you)           | Checkpoint D: sidebar, `⋯`, context menu, native menu, Offset dialog, preview following edits                                                                            |

No test asserts class names or component nesting (`ui` skill).

## Boundaries

- **Always:** reuse `@shift/ui` wrappers and the sidebar components; semantic theme tokens; icon-only controls get an accessible name and a tooltip; run `pnpm format:files`, `pnpm lint:check`, `pnpm typecheck`.
- **Ask first:** any new shared component in `packages/ui`, any new theme token, any new `CommandId`.
- **Never:** import Base UI in the app; add a TypeScript copy of a Rust rule; use native `disabled` on a control that keeps a tooltip; style the preview fill (that is the polish pass).

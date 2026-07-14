# Shift Roadmap

This roadmap has two layers:

- **Release roadmap:** the default order of work for shipping usable versions.
- **Feature inventory:** the broader backlog of implemented, planned, and experimental work.

The release roadmap wins when priorities conflict. Exploration is still useful, but every release should have one clear promise and a small set of acceptance tests.

## Current Stage

Current repo state: `0.0.1-dev` / pre-alpha source development.

Current capability level: roughly `0.2.x-alpha` feature maturity. Core editing work is significantly ahead of release infrastructure, so the first public binary does not need to start at `0.1.0` if the changelog honestly explains what already exists.

Recommended first public binary: `0.2.0-alpha.1`.

Why:

- Basic vector editing, selection, undo/redo, delete, clipboard, segment hover, snapping pieces, transform tools, glyph thumbnails/search, boolean operations, and some variable/text work already exist.
- Public release basics are not done yet: no release tags, no root changelog, no release workflow, no signed/notarized binary, no published artifacts, and version files disagree.

## Release Roadmap

### 0.2.0-alpha.1 — First Installable Editing Alpha

Promise: a tester can install Shift, launch it, open a font, and try the existing core editor without building from source.

Scope:

- GitHub Release with release notes and checksums.
- Version files aligned.
- Root `CHANGELOG.md`.
- macOS artifact, signed and notarized if possible.
- Windows and Linux artifacts if CI can produce them without derailing the release.
- README and `shift.graphics` use the same alpha language.
- Known limitations documented prominently.
- Existing editor workflows are not blocked by obvious packaging/native-module issues.

Acceptance tests:

- Download the release artifact on a clean macOS machine.
- Launch the app without Gatekeeper workarounds, or clearly label the build as unsigned if signing is deferred.
- Open a UFO/TTF/OTF.
- Select a glyph, edit points, undo/redo, copy/paste, and close the app.

### 0.3.0-alpha — Persistence And Export Alpha

Promise: a tester can use Shift on a toy font and verify save/reopen/export behavior.

Scope:

- UFO save and Save As are reliable enough for alpha testing.
- Dirty state and close/quit save prompts are trustworthy.
- Reopen after save preserves expected glyph edits.
- TTF/OTF export path exists for simple fonts.
- Export errors are visible and actionable.
- Round-trip tests cover representative UFO edits.
- Data-loss risks are documented.

Acceptance tests:

- Open UFO, edit glyph, save, quit, reopen, verify edit.
- Save As to a new UFO and reopen it.
- Export a simple TTF/OTF and install or inspect it externally.
- Try saving a non-writable source format and verify Shift forces Save As.

### 0.4.0-alpha — Glyph Workflow Alpha

Promise: a tester can work across multiple glyphs without fighting navigation or glyph metadata.

Scope:

- Recent files are functional.
- Glyph grid supports the common navigation path.
- Glyph add, duplicate, delete, and rename basics.
- Unicode/name editing basics.
- Open Recent and core File/Glyph menu items.
- Keyboard navigation in the grid.
- Basic validation for empty/missing/problem glyphs if cheap.

Acceptance tests:

- Open a font, find a glyph by name/unicode/character, edit it, move to another glyph, return to the first.
- Add or duplicate a glyph and save/reopen.
- Rename or edit unicode metadata and verify the result survives save/reopen where supported.

### 0.5.0-alpha — Drawing Workflow Depth

Promise: contour editing feels useful beyond simple point movement.

Scope:

- Boolean operations are stabilized in the UI.
- Remove overlap or path direction cleanup, whichever is more valuable first.
- Shape tools for rectangle/ellipse if they support real glyph work.
- Better point/segment indicators: extrema, open endpoints, smooth tangent lines, or equivalent.
- Measurement/guides if they unblock precision work.
- Zoom to selection / center glyph.

Acceptance tests:

- Draw overlapping contours, run boolean/remove-overlap workflow, save/reopen.
- Build a simple glyph from shapes and manual point edits.
- Use precision aids to align or measure a contour without guessing.

### 0.6.0-alpha — Components And Accents Alpha

Promise: Shift can represent and edit composite glyph workflows at an alpha level.

Scope:

- Component data model and snapshots.
- Add component to glyph.
- Move/transform component.
- Render component bounds/ghosting.
- Decompose component.
- Basic anchors.
- Simple accented glyph generation path.

Acceptance tests:

- Build an accented glyph from a base and mark component.
- Move/transform a component and save/reopen.
- Decompose a component and continue editing outlines.

### 0.7.0-alpha — Variable Font Alpha

Promise: Shift can inspect and test variable font/designspace workflows, even if editing is incomplete.

Scope:

- Designspace loading is user-facing.
- Master switching.
- Add/remove or copy master workflow if feasible.
- Interpolation preview is reliable enough for tester feedback.
- Named instances.
- Instance export for simple cases.
- Compatibility errors are understandable.

Acceptance tests:

- Open designspace, switch masters, preview interpolation.
- Detect incompatible glyphs and show a useful message.
- Export or generate a simple instance.

### 0.8.0-alpha — Spacing And Proofing Alpha

Promise: a tester can evaluate glyphs in text context.

Scope:

- Sidebearing handles or numeric sidebearing editing.
- Spacing strings and presets.
- Preview/proofing panel.
- Waterfall view.
- Basic kerning preview or editing if ready.
- HarfBuzz shaping preview if the plumbing is ready.

Acceptance tests:

- Edit spacing for a glyph while viewing it in context.
- Save/reopen spacing changes.
- Preview a sample string at multiple sizes.

### 0.9.0-beta.1 — Beta Candidate

Promise: a type designer can complete a small real task end-to-end, and the beta line is primarily about fixing bugs.

Scope:

- Feature freeze for the 1.0 core workflow.
- Packaging works on the supported platforms.
- macOS signing/notarization is mandatory.
- Windows/Linux packaging status is clearly documented.
- Documentation for install, open, edit, save, export, and known limitations.
- Crash/diagnostic story or at least useful error reporting.
- File-format/data-loss risks have explicit tests.

Acceptance tests:

- Complete a small real project from install to exported font.
- Verify clean install on each supported platform.
- Verify release notes, changelog, and website match the actual release state.

### 1.0.0 — Stable

Promise: Shift is a production-quality font editor for the documented core workflow.

Scope:

- Main workflow is dependable: install, open/create, edit, save/reopen, export.
- Documentation is sufficient for non-contributors.
- Compatibility and file-format expectations are explicit.
- Update path exists or the absence of auto-update is intentional and documented.
- Known critical data-loss issues are fixed.

## Priority Rules

Use these rules when deciding what to work on next:

1. If the current milestone has a broken acceptance test, fix that before adding unrelated feature surface.
2. Prefer work that completes an end-to-end workflow over work that adds isolated capability.
3. Keep experimental work behind the current release promise unless it directly reduces release risk.
4. Patch releases fix regressions only; minor releases add a new workflow promise.
5. Beta means feature freeze for the beta line, not a larger feature bucket.

## Flexible Exploration Backlog

These are allowed to jump around when energy is high, but they should not silently become release blockers:

- Components and accents.
- Variable fonts.
- Spacing and kerning.
- OpenType feature editing.
- Scripting.
- AI/MCP integration.
- Collaboration.
- Advanced rendering/performance work.

## Current Implementation Status

### ✅ Completed Features

#### Core Rust Library (shift-core)

**Data Model**

- [x] Font container with metadata, global UPM, stable metric definitions, and per-source metric values
- [x] Glyph structure with unicode indexing, contours, and x-advance
- [x] Contour with open/closed state and point list
- [x] Point with on-curve/off-curve type, smooth flag, and position
- [x] Entity ID system (ContourId, PointId) for stable references
- [x] Vec2 math utilities

**Edit Operations**

- [x] Glyph layer mutation ownership model for glyph editing
- [x] Add/remove points
- [x] Move points (single and batch)
- [x] Add/remove contours
- [x] Open/close contours
- [x] Toggle smooth property on points
- [x] Insert point before existing point (for bezier construction)

**Pattern-Based Editing**

- [x] Rule matching system with pattern templates
- [x] Rules: MoveRightHandle, MoveLeftHandle, MoveBothHandles
- [x] Rules: MaintainTangencyRight, MaintainTangencyLeft
- [x] Automatic tangency maintenance for smooth points
- [x] Pattern expansion for rule matching

**Font I/O**

- [x] UFO format loading (via norad library)
- [x] Binary font loading (TTF/OTF via skrifa library)
- [x] Stable `.shift` package identity with package-instance working document bindings
- [x] FontLoader with adaptor pattern for extensibility
- [x] Font compilation to binary (via fontc)

**Serialization**

- [x] Snapshot types (GlyphSnapshot, ContourSnapshot, PointSnapshot)
- [x] TypeScript type generation via ts-rs
- [x] JSON serialization for cross-language communication
- [x] CommandResult pattern for operation responses

#### Node.js Native Bindings (shift-node)

- [x] FontEngine NAPI class
- [x] Font loading from file path
- [x] Edit session lifecycle (start/end)
- [x] Point operations via NAPI
- [x] Contour operations via NAPI
- [x] Snapshot retrieval (JSON and native object variants)
- [x] Unified edit operation with automatic rule matching

#### Frontend Application

**Architecture**

- [x] Electron desktop app (main/preload/renderer)
- [x] React with TypeScript
- [x] Tailwind CSS styling
- [x] Zustand state management
- [x] React Router navigation

**NativeBridge TypeScript Layer**

- [x] EditingManager - point and contour mutations
- [x] SessionManager - session lifecycle
- [x] InfoManager - font metadata access
- [x] HistoryManager - undo/redo structure
- [x] IOManager - file operations structure
- [x] Reactive signals for snapshot state

**Editor System**

- [x] Editor controller class
- [x] Scene with reactive path building from snapshots
- [x] Viewport with coordinate transforms (screen ↔ UPM)
- [x] Pan and zoom (wheel + tool)
- [x] Zoom to cursor position (Cmd+/Cmd-)
- [x] SelectionManager for point selection state
- [x] FrameHandler for batched redraws
- [x] Command pattern infrastructure
- [x] Reactive signals for state management

**Drawing Tools**

- [x] Pen tool with state machine
  - [x] Click to place anchor points
  - [x] Drag to create bezier handles
  - [x] Click on first point to close contour
  - [x] Custom pen cursor
  - [x] Select tool with state machine
  - [x] Click to select single point
  - [x] Shift+click to toggle in selection
  - [x] Box selection (drag on empty space)
  - [x] Drag to move selected points (with undo support)
  - [x] Arrow keys to nudge (small/medium/large increments)
  - [x] Double-click to toggle smooth
- [x] Hand tool for panning
- [x] Tool switching via toolbar or keyboard shortcuts (v, p, h, s, space)

**Rendering**

- [x] Path2D abstraction for platform independence
- [x] Segment parsing (line, quadratic, cubic bezier)
- [x] Handle rendering with state (idle, hovered, selected)
- [x] Handle types: corner, smooth, control, first, last, direction indicator
- [x] Guide lines (ascender, cap height, x-height, baseline, descender, sidebearings)
- [x] Bounding rectangle for multi-point selection
- [x] Contour direction indicator
- [x] Fill/stroke mode toggle

**UI Components**

- [x] EditorView canvas with layered rendering
- [x] GlyphGrid overview (Adobe Latin 1 charset)
- [x] Toolbar with tool icons and tooltips
- [x] Metrics display (cursor position)
- [x] Custom cursor for pen tool
- [x] Titlebar, NavigationPane, SidePane structure

**Undo/Redo**

- [x] CommandHistory with reactive signals (canUndo, canRedo)
- [x] Batching support (beginBatch/endBatch for grouped operations)
- [x] Wire `Cmd+Z` → `CommandHistory.undo()`
- [x] Wire `Cmd+Shift+Z` → `CommandHistory.redo()`
- [x] Menu items for Undo/Redo (Edit menu integration)
- [x] All point operations create proper Commands (Add, Move, Remove)

**Delete Operations**

- [x] `Delete` / `Backspace` key → `removePoints()` on selection
- [x] Menu item for Delete (Edit menu integration)

---

## 🚧 In Progress / Partial Implementation

- [x] Font file opening in app (loader exists, UI integration needed)
- [x] Shape tool (placeholder only)

---

## 📋 Planned Features

### Phase 0: Complete Basic Vector Editing ⭐ Priority

**Clipboard Operations**

- [x] `Cmd+C` - copy selected points (serialize to clipboard)
- [x] `Cmd+X` - cut (copy + delete)
- [x] `Cmd+V` - paste (same position as copied)
- [x] Support pasting between glyphs
- [x] SVG path import (paste SVG from Figma, Illustrator, etc.)

**Selection Improvements**

- [x] `Cmd+A` - select all points in glyph
- [x] `Escape` - deselect all
- [x] Double-click on segment → select entire contour

---

### Phase 1: Interactive Feedback & Indicators

**Segment Hit Testing**

- [x] Hit testing for bezier segments (not just points)
- [x] Calculate nearest point on curve (parametric)
- [x] Configurable hover threshold

**Segment Hover Rendering**

- [x] Track `hoveredSegmentId` in Select tool state
- [x] Highlight hovered segment (different stroke color/width)
- [x] Show control handles when hovering near curve
- [x] Cursor change on segment hover (crosshair)

**Point Insertion**

- [x] Click on hovered segment → insert point at t parameter
- [ ] Preview point position while hovering
- [ ] Alt+click to split segment
- [x] Option+click upgrade segment

**Visual Indicators**

- [ ] Extrema point markers
- [ ] Inflection point markers
- [ ] Curvature comb visualization (optional)
- [ ] Open contour endpoint markers
- [ ] Smooth point tangent lines

**Additional Drawing Tools**

- [ ] Ruler tool (measure distance/angle between points)
- [ ] Knife tool (cut contours at intersection)
- [ ] Bend curves with mouse (drag segment to reshape)
- [ ] Shape tool: rectangles with corner radius
- [ ] Shape tool: circles and ellipses
- [ ] Shape tool: regular polygons (triangle, pentagon, etc.)

---

### Phase 2: Snapping & Precision

**Grid System**

- [ ] Configurable grid (spacing, subdivisions)
- [ ] Snap to grid toggle (`G` key)
- [ ] Visual grid overlay (optional)

**Metric Snapping**

- [x] Snap to baseline, x-height, cap height, ascender, descender
- [ ] Snap to sidebearings (0, xAdvance)
- [x] Visual indicator when snapped

**Point Snapping**

- [x] Snap to other points in glyph
- [ ] Snap to horizontal/vertical alignment
- [ ] Smart guides (temporary alignment lines)

**Angle Constraint**

- [x] Hold `Shift` to constrain to 0°/45°/90°
- [x] Perpendicular constraint for smooth points

**Measurement & Guidelines**

- [ ] Measurement tool (measure distance/angle between any two points)
- [ ] Draggable global guidelines
- [ ] Per-glyph local guidelines
- [ ] Guideline snapping

**Tools Panel (Sidebar)**

- [x] Align tools (left, center, right, top, middle, bottom)
- [x] Distribute tools (horizontal, vertical spacing)
- [x] Transform panel (move X/Y, scale, rotate, skew/shear)
- [x] Numeric input fields for precise transforms
- [x] Flip horizontal/vertical
- [x] Rotate 90°/180°

---

### Phase 3: Grid Panel & Glyph Management

**Grid Panel Improvements**

- [x] Glyph thumbnails (render actual outlines)
- [x] Visual indicator: empty vs. has content
- [ ] Grid zoom (cell size slider)
- [ ] List view alternative
- [x] Search by glyph name, unicode, or character
- [ ] Filter: show only empty / filled / charset subset
- [ ] Multi-select glyphs in grid
- [ ] Right-click context menu
- [ ] Keyboard navigation (arrows, Enter to open)

**Character Set Management**

- [ ] Multiple charset definitions (Adobe Latin 1-5, Google Fonts Latin, etc.)
- [ ] Charset selector dropdown
- [ ] Custom charset creation
- [ ] Language coverage checker

**Glyph Operations**

- [ ] Add glyph (by unicode or name)
- [ ] Duplicate glyph
- [ ] Delete glyph (with component usage warning)
- [ ] Generate from template (accented letters)

**Unicode & Naming**

- [x] Unicode character database (`@shift/glyph-info` — glyph names, categories, decomposition, charsets, FTS5 search)
- [ ] Editable unicode codepoint in glyph info panel
- [ ] Support multiple unicodes per glyph
- [ ] Unencoded glyphs (`.notdef`, ligatures)
- [x] AGL (Adobe Glyph List) name lookup
- [ ] Rename glyph with cascade

---

### Phase 3.5: Contour Operations

**Boolean Operations**

- [x] Union (merge overlapping contours)
- [x] Subtract (cut one contour from another)
- [x] Intersect (keep only overlapping area)
- [x] Difference (XOR - exclude overlap)

**Path Cleanup**

- [ ] Remove overlap (flatten to non-overlapping paths)
- [ ] Correct path direction (outer clockwise, inner counter-clockwise)
- [ ] Reverse contour direction
- [ ] Remove redundant points (on-curve points on straight lines)

**Path Modification**

- [ ] Offset path (grow/shrink contours)
- [ ] Round corners (add curves at corners)
- [ ] Add corners (convert smooth to corner)
- [ ] Simplify path (reduce point count while maintaining shape)

---

### Phase 4: Components (Composite Glyphs)

**Data Model**

- [ ] ComponentRef structure (glyph reference, transform, metrics flag)
- [ ] Add components array to Glyph struct
- [ ] Snapshot serialization for components

**Component Creation**

- [ ] Drag glyph from grid as component
- [ ] Component picker modal
- [ ] Quick add: `Cmd+Shift+C` → type glyph name

**Component Editing**

- [ ] Move/transform components in editor
- [ ] Numeric transform inputs in panel
- [ ] "Use my metrics" toggle
- [ ] Reorder components (stacking)

**Component Display**

- [ ] Render components dimmed/ghosted
- [ ] Show component bounds
- [ ] Jump to base glyph (double-click)

**Decomposition**

- [ ] Decompose single component → local contours
- [ ] Decompose all → flatten glyph
- [ ] Decompose on export option

**Anchors**

- [ ] Define named anchors (top, bottom, ogonek)
- [ ] Visual anchor editor
- [ ] Mark-to-base positioning

---

### Phase 5: Variable Fonts

**Designspace Support**

- [x] Load `.designspace` files
- [x] Parse axis definitions (wght, wdth, ital, custom)
- [x] Persist continuous/discrete axes and axis value labels
- [x] Round-trip independent and cross-axis mappings
- [x] Named instances

**Masters Editing**

- [x] Master list panel
- [ ] Switch between masters
- [ ] Add/remove masters
- [ ] Copy glyph between masters

**Interpolation**

- [x] Compatibility checker (point/contour count)
- [x] Interpolation preview slider
- [x] Per-source standard metric interpolation and MVAR compilation
- [ ] Intermediate master insertion
- [ ] Extrapolation warning

**Instance Generation**

- [x] Explicit named-instance IR, persistence, and `fvar` compilation
- [ ] Instance preview panel
- [ ] Batch instance export
- [x] STAT table generation

---

### Phase 5.5: Spacing & Kerning

**Sidebearing Editing**

- [ ] Draggable sidebearing handles in editor
- [ ] Numeric sidebearing input in glyph info panel
- [ ] Link sidebearings (left = right)
- [ ] Copy metrics from another glyph

**Spacing View**

- [x] Text layout view (multiple glyphs on same canvas)
- [x] Double-click glyph in text view to edit
- [ ] Spacing string presets (HOHOHOnnnooo, etc.)
- [ ] Custom spacing strings
- [ ] Adjust spacing while viewing in context

**Kerning Editor**

- [ ] Visual kerning pair editor
- [ ] Kern class management (group similar letters)
- [ ] Kerning preview in context
- [ ] Import/export kerning data
- [ ] Auto-kerning suggestions

**Metrics Classes**

- [ ] Width classes (glyphs that share metrics)
- [ ] Sync metrics across class members
- [ ] Metrics inheritance

---

### Phase 6: Font I/O & Build Pipeline

**Loading Improvements**

- [x] File → Open dialog (UFO, TTF, OTF)
- [ ] Drag-and-drop font files
- [ ] Recent files list
- [ ] Variable font axis reading from binary

**Saving**

- [ ] UFO write-back (preserve unmodified files)
- [ ] Auto-save drafts
- [ ] Backup on save
- [ ] Modified indicator in title bar

**Compilation**

- [ ] Incremental compilation (only changed glyphs)
- [ ] Background compilation (non-blocking)
- [ ] Progress indicator
- [ ] Error/warning panel with clickable locations
- [ ] Output format selection (TTF, OTF, WOFF, WOFF2)

**Hinting & Shaping**

- [ ] Auto-hinting via ttfautohint
- [ ] HarfBuzz shaping preview
- [ ] OpenType feature testing
- [ ] Pixel preview at multiple ppem sizes

---

### Phase 6.5: Preview & Proofing

**Preview Panel**

- [ ] Preview glyph in context with other glyphs
- [ ] Configurable preview strings (before/after current glyph)
- [ ] Real-time update as glyph is edited
- [ ] Multiple preview lines
- [ ] Preview size slider

**Waterfall View**

- [ ] Same text at multiple sizes (12, 16, 24, 36, 48, 72pt)
- [ ] Configurable size list
- [ ] Pixel rendering preview (simulated rasterization)

**Sample Text & Proofing**

- [ ] Sample text presets (pangrams, language samples)
- [ ] Custom sample text input
- [ ] Adhesion text (show only glyphs that exist)
- [ ] Dark mode preview (light-on-dark testing)

**Comparison Tools**

- [ ] Compare similar glyphs side-by-side (n/m, o/c, b/d)
- [ ] Overlay glyphs for comparison
- [ ] Compare across masters (variable fonts)

---

### Phase 6.6: OpenType Features

**Feature Editor**

- [ ] Visual GSUB rule editor (substitutions)
- [ ] Visual GPOS rule editor (positioning)
- [ ] Feature code syntax highlighting
- [ ] Feature code validation/error checking

**Common Features**

- [ ] Ligature editor (ffi, fl, etc.)
- [ ] Stylistic alternates management
- [ ] Small caps mapping
- [ ] Oldstyle/lining figures toggle
- [ ] Fractions builder

**Feature Testing**

- [ ] Live feature preview toggle
- [ ] Test specific features in isolation
- [ ] Language/script selector for testing

---

### Phase 7: UI Polish

**Landing Page**

- [x] Welcome screen on app launch
- [ ] Recent files list
- [x] New font / Open font buttons
- [ ] Quick start templates

**Multi-Tab Editing**

- [ ] Multiple glyph tabs open simultaneously
- [ ] Tab bar with glyph names/characters
- [ ] Close/reorder tabs
- [ ] Keyboard shortcuts to switch tabs (Cmd+1-9, Cmd+Shift+[ ])
- [ ] Tab context menu (close others, close all)

**Glyph Info Sidebar**

- [x] Unicode codepoint display/edit
- [x] Glyph name
- [x] Advance width (x-advance)
- [x] Left/right sidebearings
- [ ] Vertical metrics (if applicable)
- [ ] Kerning pairs involving this glyph
- [ ] Component list (if composite)
- [ ] Contour/point count summary

**Inspector Panel**

- [ ] Selected point coordinates (editable)
- [ ] Point type toggle
- [ ] Contour info (point count, closed/open)
- [ ] Transform inputs (panel)

**Menu System**

- File: New, Open, Open Recent, Close, Save, Save As, Revert, Export, Quit
- Edit: Undo, Redo, Cut, Copy, Paste, Delete, Select All, Deselect
- Glyph: Previous, Next, Go to..., Add, Duplicate, Delete, Reverse Contours
- Point: Convert to Corner/Smooth, Add, Delete, Align, Distribute
- View: Zoom In/Out, Fit, Show Grid, Show Guides, Show Metrics
- Font: Font Info, Metrics, Kerning, Features
- Window: Glyph Grid, Preview, Spacing
- Debug: Toggle Debug Overlay, Show IDs, Performance Stats
- Help: Documentation, Shortcuts, About

**Debug Menu**

- [x] Toggle debug overlay
- [ ] Point/contour ID labels
- [ ] Performance statistics (fps, render time)
- [ ] Snapshot JSON inspector
- [ ] Force redraw

**Preferences Panel**

- [ ] General (auto-save, default UPM)
- [ ] Editor (grid size, snap threshold, handle size)
- [ ] Appearance (theme, colors)
- [ ] Shortcuts (customizable keybindings)

**Workflow Improvements**

- [ ] Zoom to selection (fit view to selected points)
- [ ] Center glyph in view
- [ ] Lock layers (prevent accidental edits)
- [ ] Template/background layer (reference image)
- [ ] Find/replace contours (search for shape, replace with another)
- [ ] Glyph notes/comments (annotations per glyph)
- [ ] Multiple selection across glyphs (batch edit)

**Validation & Quality**

- [ ] Validation panel (check for common issues)
- [ ] Open path detection
- [ ] Wrong direction warning
- [ ] Missing extrema points
- [ ] Overlapping points detection
- [ ] Outline consistency checker

---

### Phase 8: Distribution

**macOS**

- [ ] Signed `.app` bundle
- [ ] `.dmg` installer
- [ ] Notarization
- [ ] Universal binary (Intel + Apple Silicon)
- [ ] Auto-updater (Sparkle)

**Windows**

- [ ] NSIS or WiX installer
- [ ] Code signing
- [ ] Auto-updater

**Linux**

- [ ] AppImage
- [ ] .deb package
- [ ] .rpm package

**Release Infrastructure**

- [x] GitHub Actions CI/CD
- [ ] Automated changelog
- [ ] Version bumping workflow
- [ ] Crash reporting

---

## 🔮 Future / Experimental

### Scripting

**TypeScript/JavaScript Scripting**

- [ ] Script runner panel (paste & run)
- [ ] Script library (save/load)
- [ ] Typed API with autocomplete
- [ ] Script marketplace/sharing

**Script API Surface**

```typescript
interface ShiftScriptContext {
  font: FontAPI;
  selection: SelectionAPI;
  ui: { alert, prompt, progress };
  geometry: { distance, pointOnBezier, ... };
}
```

### Collaboration

**Phase 1: File Sync**

- [ ] Conflict detection on load
- [ ] Merge UI for conflicts

**Phase 2: Lock-Based**

- [ ] "User A is editing glyph X" locks
- [ ] Real-time presence indicators

**Phase 3: CRDT (Advanced)**

- [ ] Yjs or Automerge integration
- [ ] Peer-to-peer or relay server

### AI Integration

**MCP Server**

- [ ] Expose Shift as MCP server
- [ ] Tools: getGlyph, movePoint, addContour, exportPreview
- [ ] Claude can read/write font data

**AI-Assisted Features**

- [ ] Auto-spacing suggestions
- [ ] Consistency checker ("these curves have different tension")
- [ ] Interpolation compatibility helper
- [ ] Style matching ("make this glyph match the weight")

**Cowork Mode (Experimental)**

- [ ] Real-time AI observation
- [ ] Suggestions as you draw
- [ ] Candidate glyph generation

---

## 📊 Version Milestones

The authoritative milestone plan is the release roadmap at the top of this file. This section is a compact index.

### v0.2-alpha — First Installable Editing Alpha

- Release infrastructure and installable binaries.
- Existing core vector editing exposed to testers.
- Clear alpha limitations.

### v0.3-alpha — Persistence And Export Alpha

- Save/reopen loop.
- Save As and dirty state.
- Basic TTF/OTF export.
- Round-trip tests.

### v0.4-alpha — Glyph Workflow Alpha

- Recent files.
- Better glyph grid navigation.
- Glyph add/duplicate/delete/rename.
- Unicode/name editing basics.

### v0.5-alpha — Drawing Workflow Depth

- Stabilized boolean/path operations.
- Shape and precision workflow improvements.
- Better contour indicators and validation basics.

### v0.6-alpha — Components And Accents Alpha

- Component data model.
- Component editing/rendering/decomposition.
- Anchors.
- Accented glyph generation basics.

### v0.7-alpha — Variable Font Alpha

- User-facing designspace workflow.
- Master switching.
- Interpolation preview.
- Named instances and simple instance export.

### v0.8-alpha — Spacing And Proofing Alpha

- Sidebearing editing.
- Spacing strings.
- Preview/proofing panel.
- Waterfall view.

### v0.9-beta — Beta Candidate

- Feature freeze for the 1.0 core workflow.
- Cross-platform packaging.
- Documentation.
- File-format and data-loss hardening.

### v1.0 — Stable Release

- Production-quality documented core workflow.
- Signed distributions.
- Clear compatibility and update posture.

---

## 🔧 Technical Debt & Improvements

**Testing**

- [ ] Increase Rust unit test coverage
- [ ] Integration tests for native bindings
- [ ] Frontend component tests
- [ ] E2E tests (Playwright)
- [ ] Visual regression tests

**Performance**

- [ ] WebGL/GPU path rendering
- [ ] Off-screen canvas for grid thumbnails
- [ ] Web Workers for computation
- [ ] Virtual scrolling for large glyph sets
- [ ] Snapshot diffing for minimal redraws

**Developer Experience**

- [ ] Native module hot reload
- [ ] State persistence across reloads
- [ ] Component storybook
- [ ] Mock NativeBridge for frontend dev

**Code Quality**

- [x] Oxlint for linting
- [x] tsgo for type checking
- [x] Pre-commit hooks (format, lint, typecheck, test)
- [ ] Remove debug logging from production
- [x] Consolidate duplicate types
- [ ] Document public APIs
- [ ] Architecture decision records

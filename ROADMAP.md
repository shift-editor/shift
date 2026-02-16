# Shift Feature Roadmap

## Current Implementation Status

### ✅ Completed Features

#### Core Rust Library (shift-core)

**Data Model**

- [x] Font container with metadata (family, style, version) and metrics (UPM, ascender, descender, cap height, x-height)
- [x] Glyph structure with unicode indexing, contours, and x-advance
- [x] Contour with open/closed state and point list
- [x] Point with on-curve/off-curve type, smooth flag, and position
- [x] Entity ID system (ContourId, PointId) for stable references
- [x] Vec2 math utilities

**Edit Operations**

- [x] EditSession ownership model for glyph editing
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

**FontEngine TypeScript Layer**

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

- [ ] Union (merge overlapping contours)
- [ ] Subtract (cut one contour from another)
- [ ] Intersect (keep only overlapping area)
- [ ] Difference (XOR - exclude overlap)

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

- [ ] Load `.designspace` files
- [ ] Parse axis definitions (wght, wdth, ital, custom)
- [ ] Named instances

**Masters Editing**

- [ ] Master list panel
- [ ] Switch between masters
- [ ] Add/remove masters
- [ ] Copy glyph between masters

**Interpolation**

- [ ] Compatibility checker (point/contour count)
- [ ] Interpolation preview slider
- [ ] Intermediate master insertion
- [ ] Extrapolation warning

**Instance Generation**

- [ ] Instance preview panel
- [ ] Batch instance export
- [ ] STAT table generation

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

- [ ] GitHub Actions CI/CD
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

### v0.1 - Alpha (MVP)

- Basic bezier drawing ✓
- Point selection and manipulation ✓
- Undo/redo ✓
- Delete points ✓
- Open/save UFO files
- Export to TTF

### v0.2 - Beta

- Full editing toolkit (copy/paste ✓, snapping)
- Segment hover/highlighting
- Grid panel improvements (thumbnails, search)
- Glyph add/delete/rename

### v0.3 - Components

- Component system
- Anchors
- Accented glyph generation

### v0.4 - Variable Fonts

- Designspace support
- Master switching
- Interpolation preview

### v0.5 - Professional

- Full menu system
- Preferences
- Incremental compilation
- HarfBuzz preview

### v1.0 - Stable Release

- Production ready
- Full documentation
- Signed distributions
- Auto-updates
- Scripting v1

### Post-1.0

- Collaboration features
- AI integration
- Plugin ecosystem

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
- [ ] Mock FontEngine for frontend dev

**Code Quality**

- [x] Oxlint for linting
- [x] tsgo for type checking
- [x] Pre-commit hooks (format, lint, typecheck, test)
- [ ] Remove debug logging from production
- [x] Consolidate duplicate types
- [ ] Document public APIs
- [ ] Architecture decision records

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
- [x] SelectionManager for point selection state
- [x] FrameHandler for batched redraws
- [x] Command pattern infrastructure

**Drawing Tools**
- [x] Pen tool with state machine
  - [x] Click to place anchor points
  - [x] Drag to create bezier handles
  - [x] Click on first point to close contour
- [x] Select tool
  - [x] Click to select single point
  - [x] Shift+click to toggle in selection
  - [x] Box selection (drag on empty space)
  - [x] Drag to move selected points
  - [x] Arrow keys to nudge (small/medium/large increments)
  - [x] Double-click to toggle smooth
- [x] Hand tool for panning
- [x] Tool switching via toolbar or keyboard shortcuts

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

---

## 🚧 In Progress / Partial Implementation

- [ ] Undo/redo (CommandHistory exists, needs wiring to shortcuts)
- [ ] Font file opening in app (loader exists, UI integration needed)
- [ ] Shape tool (placeholder only)

---

## 📋 Planned Features

### Phase 0: Complete Basic Vector Editing ⭐ Priority

**Undo/Redo Wiring**
- [ ] Wire `Cmd+Z` → `CommandHistory.undo()`
- [ ] Wire `Cmd+Shift+Z` → `CommandHistory.redo()`
- [ ] Ensure all operations create proper Commands
- [ ] Visual feedback in UI ("Undo Move Point")

**Delete Operations**
- [ ] `Delete` / `Backspace` key → `removePoints()` on selection
- [ ] Handle deleting entire contour when last point removed

**Clipboard Operations**
- [ ] `Cmd+C` - copy selected points (serialize to clipboard)
- [ ] `Cmd+X` - cut (copy + delete)
- [ ] `Cmd+V` - paste at cursor position
- [ ] Paste in place (same coordinates)
- [ ] Support pasting between glyphs

**Selection Improvements**
- [ ] `Cmd+A` - select all points in glyph
- [ ] `Escape` - deselect all
- [ ] Double-click on segment → select entire contour

---

### Phase 1: Interactive Feedback & Indicators

**Segment Hit Testing**
- [ ] Hit testing for bezier segments (not just points)
- [ ] Calculate nearest point on curve (parametric)
- [ ] Configurable hover threshold

**Segment Hover Rendering**
- [ ] Track `hoveredSegmentId` in Select tool state
- [ ] Highlight hovered segment (different stroke color/width)
- [ ] Show control handles when hovering near curve
- [ ] Cursor change on segment hover (crosshair)

**Point Insertion**
- [ ] Click on hovered segment → insert point at t parameter
- [ ] Preview point position while hovering
- [ ] Alt+click to split segment

**Visual Indicators**
- [ ] Extrema point markers
- [ ] Inflection point markers
- [ ] Curvature comb visualization (optional)
- [ ] Open contour endpoint markers
- [ ] Smooth point tangent lines

---

### Phase 2: Snapping & Precision

**Grid System**
- [ ] Configurable grid (spacing, subdivisions)
- [ ] Snap to grid toggle (`G` key)
- [ ] Visual grid overlay (optional)

**Metric Snapping**
- [ ] Snap to baseline, x-height, cap height, ascender, descender
- [ ] Snap to sidebearings (0, xAdvance)
- [ ] Visual indicator when snapped

**Point Snapping**
- [ ] Snap to other points in glyph
- [ ] Snap to horizontal/vertical alignment
- [ ] Smart guides (temporary alignment lines)

**Angle Constraint**
- [ ] Hold `Shift` to constrain to 0°/45°/90°
- [ ] Perpendicular constraint for smooth points

---

### Phase 3: Grid Panel & Glyph Management

**Grid Panel Improvements**
- [ ] Glyph thumbnails (render actual outlines)
- [ ] Visual indicator: empty vs. has content
- [ ] Grid zoom (cell size slider)
- [ ] List view alternative
- [ ] Search by glyph name, unicode, or character
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
- [ ] Editable unicode codepoint in glyph info panel
- [ ] Support multiple unicodes per glyph
- [ ] Unencoded glyphs (`.notdef`, ligatures)
- [ ] AGL (Adobe Glyph List) name lookup
- [ ] Rename glyph with cascade

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

### Phase 6: Font I/O & Build Pipeline

**Loading Improvements**
- [ ] File → Open dialog (UFO, TTF, OTF)
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

### Phase 7: UI Polish

**Inspector Panel**
- [ ] Selected point coordinates (editable)
- [ ] Point type toggle
- [ ] Contour info (point count, closed/open)
- [ ] Transform inputs

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
- [ ] Toggle debug overlay
- [ ] Point/contour ID labels
- [ ] Performance statistics (fps, render time)
- [ ] Snapshot JSON inspector
- [ ] Force redraw

**Preferences Panel**
- [ ] General (auto-save, default UPM)
- [ ] Editor (grid size, snap threshold, handle size)
- [ ] Appearance (theme, colors)
- [ ] Shortcuts (customizable keybindings)

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
- Undo/redo (wired)
- Delete points
- Open/save UFO files
- Export to TTF

### v0.2 - Beta
- Full editing toolkit (copy/paste, snapping)
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
- [ ] Remove debug logging from production
- [ ] Consolidate duplicate types
- [ ] Document public APIs
- [ ] Architecture decision records

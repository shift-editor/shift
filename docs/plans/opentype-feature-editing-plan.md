# OpenType Feature Editing: Design & Implementation Plan

## Executive Summary

This document outlines a plan for implementing live, incremental OpenType feature editing with real-time shaping preview in Shift. The goal is to integrate Google Fonts' **fontations** ecosystem (fontc, fea-rs) for compilation and **HarfRust** for shaping, providing a modern Rust-native toolchain.

**Key References:**
- [fontc (Google Fonts)](https://github.com/googlefonts/fontc) - Rust font compiler
- [fontations](https://github.com/googlefonts/fontations) - Rust font parsing/writing libraries
- [HarfRust](https://github.com/harfbuzz/harfrust) - Pure Rust port of HarfBuzz
- [fea-rs](https://crates.io/crates/fea-rs) - OpenType feature file parser
- [OFFED](https://typedrawers.com/discussion/5524/offed-open-type-fea-ture-file-editor-for-linux-desktop) - Similar project (Tauri + Leptos + fontc + rustybuzz)
- [FontGoggles](https://fontgoggles.org/) - UI inspiration for feature testing

---

## Current State Analysis

### What Shift Already Has

| Component | Status | Location |
|-----------|--------|----------|
| fontc dependency | v0.2.0 | `shift-core/Cargo.toml` |
| skrifa dependency | v0.32.0 | `shift-core/Cargo.toml` |
| `compile_font()` | Working | `shift-core/src/binary.rs:192` |
| `FeatureData` struct | Minimal | `shift-ir/src/features.rs` |
| UFO feature.fea loading | Working | `shift-backends/src/ufo/reader.rs` |
| NAPI bindings | Extensive | `shift-node/src/font_engine.rs` |
| Monaco editor | Not integrated | N/A |
| Shaping | Not implemented | ROADMAP Phase 6.6 |

### Current `FeatureData` (Minimal)

```rust
// shift-ir/src/features.rs
pub struct FeatureData {
    fea_source: Option<String>,
}
```

This stores raw `.fea` source but provides no parsing, validation, or structured access.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND (Electron/React)                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐   │
│  │  Monaco Editor   │  │  Feature Toggle  │  │   Shaping Preview    │   │
│  │  (FEA syntax)    │  │  Panel           │  │   (Text + Glyphs)    │   │
│  └────────┬─────────┘  └────────┬─────────┘  └──────────┬───────────┘   │
│           │                     │                       │               │
│           └─────────────────────┼───────────────────────┘               │
│                                 │                                       │
│                          ┌──────▼──────┐                                │
│                          │FeatureEngine│ (TypeScript)                   │
│                          └──────┬──────┘                                │
│                                 │                                       │
└─────────────────────────────────┼───────────────────────────────────────┘
                                  │ NAPI
┌─────────────────────────────────┼───────────────────────────────────────┐
│                           BACKEND (Rust)                                 │
├─────────────────────────────────┼───────────────────────────────────────┤
│                                 │                                       │
│  ┌──────────────────────────────▼──────────────────────────────────┐    │
│  │                        shift-node (NAPI)                         │    │
│  │  • parse_fea() → AST + errors                                   │    │
│  │  • validate_fea() → diagnostics                                 │    │
│  │  • compile_features() → TTF bytes                               │    │
│  │  • shape_text() → glyph positions                               │    │
│  │  • get_feature_tags() → available features                      │    │
│  └──────────────────────────────┬──────────────────────────────────┘    │
│                                 │                                       │
│  ┌──────────────────────────────▼──────────────────────────────────┐    │
│  │                        shift-core                                │    │
│  │                                                                  │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │    │
│  │  │  fea-rs     │  │   fontc     │  │      harfrust           │  │    │
│  │  │  (parser)   │  │  (compiler) │  │      (shaping)          │  │    │
│  │  └─────────────┘  └─────────────┘  └─────────────────────────┘  │    │
│  │                                                                  │    │
│  └──────────────────────────────────────────────────────────────────┘    │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Tooling Evaluation

### fontc as a Library

**Viability: HIGH**

fontc is designed as a collection of crates that can be used programmatically:

| Crate | Purpose | Use Case |
|-------|---------|----------|
| `fontir` | Intermediate representation | Parse sources into IR |
| `fontbe` | Backend compilation | Convert IR to binary tables |
| `fea-rs` | Feature file parser | Parse/validate `.fea` code |
| `ufo2fontir` | UFO → IR | Load UFO sources |

**Current Shift Usage** (`binary.rs:192`):
```rust
pub fn compile_font(path: &str, build_dir: &Path, output_name: &str) -> Result<(), String> {
    let mut args = fontc::Args::new(build_dir, PathBuf::from(path));
    args.output_file = Some(PathBuf::from(output_name));
    let timer = JobTimer::new(Instant::now());
    fontc::run(args, timer)
}
```

This is the CLI-style usage. For incremental compilation, we need to use the lower-level crates directly.

### fea-rs for Parsing

**Viability: HIGH**

fea-rs provides:
- **Lexer + Parser**: Tokenization and AST construction
- **Error Recovery**: Continues parsing after errors, collects diagnostics
- **AST Access**: Typed nodes for traversal
- **Validation**: Semantic checking
- **Compilation**: Direct to GSUB/GPOS tables

Key API entry point is the `Compiler` struct.

### HarfRust vs rustybuzz

| Aspect | HarfRust | rustybuzz |
|--------|----------|-----------|
| Origin | Official port from HarfBuzz team | Independent port by @nicoulaj |
| Font Parsing | Uses `read-fonts` (fontations) | Uses `ttf-parser` |
| Performance | <25% slower than C HarfBuzz | Comparable |
| Unsafe Code | None | None |
| Ecosystem Fit | Aligns with fontations | Separate ecosystem |
| Maturity | Newer, matches HB v12.3.0 | More mature |

**Recommendation: HarfRust**

HarfRust integrates better with the fontations ecosystem (shared `read-fonts` crate), aligning with Google Fonts' direction. OFFED uses rustybuzz, but HarfRust is the strategic choice for new projects.

### Incremental Compilation

**Assessment: Start with Full Recompilation**

Fontc doesn't expose explicit incremental compilation APIs. OFFED's approach is:
1. Full recompilation on each change (fontc is fast)
2. Background compilation in separate process/thread
3. Cache compiled TTF bytes for shaping

Given fontc's speed (written in Rust, optimized), full recompilation may be acceptable for interactive use. Profile first, then optimize if needed.

**Potential Incremental Strategy** (future):
- Cache fontir IR
- Only recompile changed features (GSUB/GPOS tables)
- Glyph outlines rarely change during feature editing

---

## UI Design

### Panel Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Shift - Font Editor                                              [─][□][×] │
├─────────────────────────────────────────────────────────────────────────┤
│ File  Edit  View  Font  Features  Help                                  │
├─────────────────────────────────────────────────────────────────────────┤
│        │                                                                │
│  Glyph │  ┌────────────────────────────────────────────────────────┐   │
│  Grid  │  │  Glyph Editor / Preview Pane                          │   │
│        │  │                                                        │   │
│   A    │  │                                                        │   │
│   B    │  │                                                        │   │
│   C    │  └────────────────────────────────────────────────────────┘   │
│  ...   │                                                                │
│        │  ┌────────────────────────────────────────────────────────┐   │
│        │  │  Feature Editor (Monaco) + Shaping Preview             │   │
│        │  │  ┌──────────────────────┬─────────────────────────────┐│   │
│        │  │  │ # Features           │  Preview: "office"          ││   │
│        │  │  │                      │                             ││   │
│        │  │  │ feature liga {       │  o f f i c e  →  o ffi c e  ││   │
│        │  │  │   sub f f i by ffi;  │       ↓                     ││   │
│        │  │  │ } liga;              │  [liga] [kern] [calt] ...   ││   │
│        │  │  │                      │                             ││   │
│        │  │  └──────────────────────┴─────────────────────────────┘│   │
│        │  │  Errors: (none)                                        │   │
│        │  └────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### Feature Toggle Panel (FontGoggles-Inspired)

```
┌─────────────────────────────────────────────────────┐
│ OpenType Features                            [⟳]    │
├─────────────────────────────────────────────────────┤
│                                                     │
│  GSUB (Substitution)                                │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐          │
│  │liga │ │calt │ │dlig │ │smcp │ │ss01 │          │
│  │ ✓  │ │ ○  │ │ ✗  │ │ ○  │ │ ○  │          │
│  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘          │
│                                                     │
│  GPOS (Positioning)                                 │
│  ┌─────┐ ┌─────┐ ┌─────┐                           │
│  │kern │ │mark │ │mkmk │                           │
│  │ ✓  │ │ ✓  │ │ ○  │                           │
│  └─────┘ └─────┘ └─────┘                           │
│                                                     │
│  Legend: ✓ On (green)  ○ Default  ✗ Off (red)     │
│  Click to cycle: Default → On → Off → Default      │
└─────────────────────────────────────────────────────┘
```

### Monaco Editor Configuration

```typescript
// FEA language definition for Monaco
const feaLanguage: monaco.languages.IMonarchLanguage = {
  tokenizer: {
    root: [
      [/feature\s+\w+/, 'keyword.feature'],
      [/lookup\s+\w+/, 'keyword.lookup'],
      [/sub|substitute/, 'keyword.gsub'],
      [/pos|position/, 'keyword.gpos'],
      [/by/, 'keyword.by'],
      [/from/, 'keyword.from'],
      [/@\w+/, 'variable.class'],
      [/\\[\w.]+/, 'entity.glyph'],
      [/#.*$/, 'comment'],
      [/;/, 'delimiter'],
      [/{|}/, 'delimiter.bracket'],
    ],
  },
};

// Register language
monaco.languages.register({ id: 'fea' });
monaco.languages.setMonarchTokensProvider('fea', feaLanguage);
```

---

## Implementation Phases

### Phase 1: Foundation (Core Infrastructure)

**Goal**: Add fea-rs and harfrust dependencies, create basic NAPI bindings

**Tasks**:

1. **Add Dependencies** (`shift-core/Cargo.toml`)
   ```toml
   fea-rs = "0.22"     # Latest version
   harfrust = "0.4"    # Or latest
   ```

2. **Create `shift-core/src/features/` Module**
   ```
   features/
   ├── mod.rs          # Module exports
   ├── parser.rs       # fea-rs wrapper for parsing
   ├── validator.rs    # Semantic validation
   ├── compiler.rs     # Feature compilation
   └── shaper.rs       # HarfRust wrapper
   ```

3. **Expand `FeatureData` in `shift-ir`**
   ```rust
   pub struct FeatureData {
       fea_source: Option<String>,
       // Cached parse results (optional, for performance)
       cached_ast: Option<ParsedFeatures>,
       // Compilation errors from last compile
       last_errors: Vec<FeaError>,
   }

   pub struct FeaError {
       pub line: u32,
       pub column: u32,
       pub message: String,
       pub severity: ErrorSeverity,
   }

   pub enum ErrorSeverity { Error, Warning, Info }
   ```

4. **NAPI Bindings** (`shift-node/src/features.rs`)
   ```rust
   #[napi]
   pub fn parse_fea(source: String) -> ParseResult { ... }

   #[napi]
   pub fn validate_fea(source: String, glyph_names: Vec<String>) -> Vec<Diagnostic> { ... }

   #[napi]
   pub fn compile_features(
       ufo_path: String,
       fea_source: String,
       output_path: String
   ) -> CompileResult { ... }
   ```

**Deliverables**:
- [ ] fea-rs integration with error extraction
- [ ] Basic compile_features NAPI method
- [ ] Unit tests for parser wrapper

---

### Phase 2: Monaco Editor Integration

**Goal**: Integrate Monaco with FEA syntax highlighting and error markers

**Tasks**:

1. **Install Monaco** (`apps/desktop`)
   ```bash
   pnpm add monaco-editor @monaco-editor/react
   ```

2. **Create FEA Language Definition**
   - Syntax highlighting (keywords, comments, glyph references)
   - Bracket matching
   - Auto-indentation

3. **Create `FeatureEditor` Component**
   ```typescript
   // src/components/features/FeatureEditor.tsx
   interface FeatureEditorProps {
     source: string;
     onChange: (source: string) => void;
     errors: FeaError[];
     onCompile: () => void;
   }
   ```

4. **Error Markers**
   ```typescript
   // Convert FeaError to Monaco marker
   const markers = errors.map(err => ({
     severity: monaco.MarkerSeverity.Error,
     startLineNumber: err.line,
     startColumn: err.column,
     endLineNumber: err.line,
     endColumn: err.column + 10,
     message: err.message,
   }));
   monaco.editor.setModelMarkers(model, 'fea', markers);
   ```

5. **Debounced Validation**
   - Parse on every keystroke (fast, <10ms)
   - Validate on 300ms debounce
   - Compile on explicit action or 1s debounce

**Deliverables**:
- [ ] Monaco editor with FEA syntax highlighting
- [ ] Real-time error markers
- [ ] FeatureEditor React component

---

### Phase 3: Shaping Integration

**Goal**: Add HarfRust shaping with live preview

**Tasks**:

1. **Create Shaper Wrapper** (`shift-core/src/features/shaper.rs`)
   ```rust
   pub struct Shaper {
       font_data: Vec<u8>,  // Compiled TTF
   }

   impl Shaper {
       pub fn shape(&self, text: &str, features: &[FeatureSetting]) -> ShapingResult {
           // Use harfrust::Face and harfrust::shape()
       }
   }

   pub struct ShapingResult {
       pub glyphs: Vec<ShapedGlyph>,
       pub clusters: Vec<ClusterInfo>,
   }

   pub struct ShapedGlyph {
       pub glyph_id: u16,
       pub glyph_name: String,
       pub x_advance: i32,
       pub y_advance: i32,
       pub x_offset: i32,
       pub y_offset: i32,
       pub cluster: u32,
   }
   ```

2. **NAPI Shaping Method**
   ```rust
   #[napi]
   pub fn shape_text(
       font_bytes: Buffer,
       text: String,
       features: Vec<FeatureSetting>,
       script: Option<String>,
       language: Option<String>,
   ) -> ShapingResult { ... }
   ```

3. **Create `ShapingPreview` Component**
   ```typescript
   interface ShapingPreviewProps {
     text: string;
     onTextChange: (text: string) => void;
     shapedGlyphs: ShapedGlyph[];
     availableFeatures: FeatureTag[];
     enabledFeatures: Set<string>;
     onFeatureToggle: (tag: string) => void;
   }
   ```

4. **Glyph Rendering in Preview**
   - Use existing `GlyphPreview` component pattern
   - Show before/after comparison
   - Highlight substitutions visually

**Deliverables**:
- [ ] HarfRust shaping wrapper
- [ ] shape_text NAPI binding
- [ ] ShapingPreview component with glyph display

---

### Phase 4: Feature Toggle Panel

**Goal**: FontGoggles-style feature toggle UI

**Tasks**:

1. **Extract Features from Compiled Font**
   ```rust
   #[napi]
   pub fn get_font_features(font_bytes: Buffer) -> Vec<FeatureInfo> {
       // Read GSUB/GPOS tables, extract feature tags
   }

   pub struct FeatureInfo {
       pub tag: String,           // e.g., "liga"
       pub table: String,         // "GSUB" or "GPOS"
       pub name: Option<String>,  // Friendly name if available
       pub lookup_count: u32,
   }
   ```

2. **Create `FeatureTogglePanel` Component**
   ```typescript
   type FeatureState = 'default' | 'enabled' | 'disabled';

   interface FeatureTogglePanelProps {
     gsubFeatures: FeatureInfo[];
     gposFeatures: FeatureInfo[];
     featureStates: Map<string, FeatureState>;
     onToggle: (tag: string, state: FeatureState) => void;
   }
   ```

3. **Three-State Toggle Logic**
   - Click cycles: default → enabled → disabled → default
   - Option+click reverses: default → disabled → enabled → default
   - Visual: gray (default), green (enabled), red (disabled)

4. **Connect to Shaping**
   ```typescript
   const features = Array.from(featureStates.entries())
     .filter(([_, state]) => state !== 'default')
     .map(([tag, state]) => ({
       tag,
       value: state === 'enabled' ? 1 : 0,
     }));
   ```

**Deliverables**:
- [ ] Feature extraction from compiled font
- [ ] FeatureTogglePanel component
- [ ] Integration with shaping preview

---

### Phase 5: Full Integration & Polish

**Goal**: Wire everything together, optimize performance

**Tasks**:

1. **Create `FeaturesPanel` Container**
   ```typescript
   // Combines Monaco editor + Preview + Toggles
   const FeaturesPanel: React.FC = () => {
     const [feaSource, setFeaSource] = useState('');
     const [compiledFont, setCompiledFont] = useState<Uint8Array | null>(null);
     const [errors, setErrors] = useState<FeaError[]>([]);
     const [previewText, setPreviewText] = useState('office ffi');

     // Compilation effect
     useEffect(() => {
       const compile = debounce(async () => {
         const result = await engine.compileFeatures(feaSource);
         setCompiledFont(result.fontBytes);
         setErrors(result.errors);
       }, 1000);
       compile();
     }, [feaSource]);

     // ... render Monaco + Preview + Toggles
   };
   ```

2. **Background Compilation**
   - Run fontc in a Rust thread or Node Worker
   - Show progress indicator during compilation
   - Cancel previous compilation if source changes

3. **Performance Optimizations**
   - Cache compiled TTF between sessions
   - Only recompile when FEA changes
   - Debounce shaping updates
   - Virtual scroll for large feature lists

4. **Error UX**
   - Clickable errors jump to line in Monaco
   - Inline error decorations
   - Error panel below editor

5. **Persistence**
   - Save FEA source back to UFO on Cmd+S
   - Track dirty state
   - Auto-save draft

**Deliverables**:
- [ ] Complete FeaturesPanel integration
- [ ] Background compilation with progress
- [ ] Error navigation
- [ ] Persistence to UFO

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           User Types in Monaco                           │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  1. Parse FEA (immediate, <10ms)                                         │
│     fea-rs lexer + parser → AST + parse errors                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  2. Validate (debounced 300ms)                                           │
│     Check glyph names exist, class definitions, etc.                    │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  3. Compile (debounced 1s or explicit Cmd+B)                             │
│     fontc: UFO + FEA → TTF bytes                                        │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  4. Shape Preview Text                                                   │
│     HarfRust: TTF + text + feature settings → positioned glyphs         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  5. Render Glyphs                                                        │
│     Display shaped glyphs with visual cluster mapping                   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## API Design

### TypeScript API (`FeatureEngine`)

```typescript
// packages/types/src/features.ts

export interface FeaError {
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
  code?: string;
}

export interface ParseResult {
  success: boolean;
  errors: FeaError[];
  featureTags: string[];  // Extracted feature tags
}

export interface CompileResult {
  success: boolean;
  fontBytes: Uint8Array | null;
  errors: FeaError[];
  warnings: FeaError[];
  duration_ms: number;
}

export interface ShapedGlyph {
  glyphId: number;
  glyphName: string;
  xAdvance: number;
  yAdvance: number;
  xOffset: number;
  yOffset: number;
  cluster: number;
}

export interface ShapingResult {
  glyphs: ShapedGlyph[];
  direction: 'ltr' | 'rtl';
  script: string;
}

export interface FeatureSetting {
  tag: string;
  value: number;  // 0 = off, 1 = on, 2+ = alternate
}

// FontEngine extensions
export interface FeatureEngine {
  parseFea(source: string): Promise<ParseResult>;

  validateFea(
    source: string,
    glyphNames: string[]
  ): Promise<FeaError[]>;

  compileFeatures(
    ufoPath: string,
    feaSource: string,
    outputPath: string
  ): Promise<CompileResult>;

  shapeText(
    fontBytes: Uint8Array,
    text: string,
    features: FeatureSetting[],
    script?: string,
    language?: string
  ): Promise<ShapingResult>;

  getFontFeatures(fontBytes: Uint8Array): Promise<FeatureInfo[]>;
}
```

### Rust NAPI Bindings

```rust
// shift-node/src/features.rs

#[napi(object)]
pub struct FeaError {
    pub line: u32,
    pub column: u32,
    pub end_line: Option<u32>,
    pub end_column: Option<u32>,
    pub message: String,
    pub severity: String,
    pub code: Option<String>,
}

#[napi]
pub fn parse_fea(source: String) -> ParseResult {
    use fea_rs::parse::SourceMap;
    // ... implementation
}

#[napi]
pub fn compile_features(
    ufo_path: String,
    fea_source: String,
    output_path: String,
) -> CompileResult {
    // Write fea_source to temp file
    // Call fontc with modified args
    // Return compiled bytes and errors
}

#[napi]
pub fn shape_text(
    font_bytes: Buffer,
    text: String,
    features: Vec<FeatureSetting>,
    script: Option<String>,
    language: Option<String>,
) -> ShapingResult {
    use harfrust::{Face, shape};
    // ... implementation
}
```

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| fea-rs API changes | Medium | Medium | Pin version, wrap API |
| HarfRust missing features | Low | Low | Arabic fallback not needed for Latin |
| Compilation too slow | Low | High | Background compile, progress UI |
| Monaco bundle size | Medium | Low | Dynamic import, code splitting |
| Memory usage (compiled fonts) | Medium | Medium | LRU cache, cleanup on glyph edit |

---

## Incremental Compilation (Future)

While starting with full recompilation, here's a future optimization path:

1. **Cache IR**: Store fontir representation
2. **Feature-Only Recompile**: When only FEA changes, rebuild GSUB/GPOS tables only
3. **Glyph-Level Invalidation**: Track which glyphs changed, recompile affected lookups
4. **Hot Swap Tables**: Replace individual tables in compiled font without full rebuild

This aligns with OFFED's documented approach: "Incremental compilation: fontc recompiles only changed glyphs/features."

---

## Testing Strategy

### Unit Tests (Rust)

```rust
#[test]
fn parse_simple_ligature() {
    let source = "feature liga { sub f i by fi; } liga;";
    let result = parse_fea(source);
    assert!(result.success);
    assert!(result.errors.is_empty());
    assert!(result.feature_tags.contains(&"liga".to_string()));
}

#[test]
fn parse_error_recovery() {
    let source = "feature liga { sub f i by; } liga;"; // missing glyph
    let result = parse_fea(source);
    assert!(!result.success);
    assert!(!result.errors.is_empty());
}

#[test]
fn shape_with_ligature() {
    let font_bytes = compile_test_font_with_liga();
    let result = shape_text(
        font_bytes,
        "office".to_string(),
        vec![FeatureSetting { tag: "liga".to_string(), value: 1 }],
        None,
        None,
    );
    // Should have 5 glyphs: o, ffi, c, e (fi ligature applied)
    assert_eq!(result.glyphs.len(), 4);
}
```

### Integration Tests

1. **Round-trip**: Edit FEA → Compile → Shape → Verify output
2. **Error Display**: Introduce syntax error → Verify Monaco marker
3. **Feature Toggle**: Toggle liga → Verify shaping changes

### E2E Tests (Playwright)

1. Open font with features
2. Edit feature code
3. Verify preview updates
4. Toggle feature off
5. Verify preview reflects change

---

## Timeline Estimate

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 1: Foundation | 1-2 weeks | fea-rs, harfrust docs |
| Phase 2: Monaco | 1 week | Phase 1 |
| Phase 3: Shaping | 1-2 weeks | Phase 1 |
| Phase 4: Toggle Panel | 1 week | Phase 3 |
| Phase 5: Integration | 1-2 weeks | All phases |

**Total: 5-8 weeks** for full feature parity with FontGoggles-style testing.

---

## References

### Documentation
- [OpenType Feature File Specification](https://adobe-type-tools.github.io/afdko/OpenTypeFeatureFileSpecification.html)
- [fea-rs Documentation](https://docs.rs/fea-rs/latest/fea_rs/)
- [HarfRust Repository](https://github.com/harfbuzz/harfrust)
- [fontc Architecture](https://github.com/googlefonts/fontc)

### Prior Art
- [OFFED](https://typedrawers.com/discussion/5524/offed-open-type-fea-ture-file-editor-for-linux-desktop) - Rust + Tauri + Leptos, very similar goals
- [FontGoggles](https://fontgoggles.org/) - macOS app, UI inspiration
- [Glyphs App](https://glyphsapp.com/) - Commercial, feature editor reference

### OpenType Registries (1.9.1)
- 187 script tags
- 680 language tags (ISO 639-3)
- 126 feature tags

---

## Appendix: OFFED Architecture Reference

OFFED uses a three-layer architecture that's worth studying:

```
Layer 1: offed-core (Pure Rust)
├── UFO/FEA models
├── No I/O, no UI

Layer 2: offed-tauri (Backend)
├── File system access
├── fontc orchestration (sidecar binary)
├── Compilation management

Layer 3: offed-wasm (Frontend)
├── Leptos UI
├── rustybuzz canvas (WASM)
├── Reactive editor
```

**Key Insight**: They embed fontc as a sidecar binary rather than using it as a library. This provides process isolation and simpler error handling. Consider this if library integration proves complex.

---

## Conclusion

Shift already has strong foundations with fontc and skrifa. Adding fea-rs for parsing and HarfRust for shaping completes the Rust-native toolchain. The main work is:

1. **Wrap fea-rs** for parsing/validation with error extraction
2. **Integrate HarfRust** for shaping preview
3. **Build Monaco UI** with FEA language support
4. **Create feature toggle panel** (FontGoggles-inspired)
5. **Connect everything** with proper debouncing and caching

The OFFED project demonstrates this is achievable with modern Rust tooling. Shift's existing NAPI infrastructure makes the integration path clear.

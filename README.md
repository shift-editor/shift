# Shift

A font editor built with Electron, React, and Rust.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [pnpm](https://pnpm.io/) (v9+)
- [Rust](https://rustup.rs/) (stable)

## Getting Started

```bash
# Install dependencies
pnpm install

# Build the native Rust module
pnpm build:native

# Start development server
pnpm dev
```

## Commands

### Development

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start the Electron app in development mode |
| `pnpm dev:app` | Start with watch mode for auto-reload |

### Build

| Command | Description |
|---------|-------------|
| `pnpm build:native` | Build the Rust native module (release) |
| `pnpm build:native:debug` | Build the Rust native module (debug) |
| `pnpm package` | Package the app for distribution |
| `pnpm make` | Create distributable installers |

### Code Quality

| Command | Description |
|---------|-------------|
| `pnpm typecheck` | Run TypeScript type checking |
| `pnpm lint` | Run ESLint and auto-fix issues |
| `pnpm lint:check` | Run ESLint without auto-fixing |
| `pnpm format` | Format code with Prettier |
| `pnpm format:check` | Check code formatting |

### Testing

| Command | Description |
|---------|-------------|
| `pnpm test:native` | Run Rust unit tests |

### Maintenance

| Command | Description |
|---------|-------------|
| `pnpm clean` | Remove all build artifacts and node_modules |
| `pnpm check-deps` | Check for unused dependencies |

## Project Structure

```
shift/
├── crates/                 # Rust crates
│   ├── shift-core/         # Core font editing logic
│   └── shift-node/         # Node.js NAPI bindings
├── src/
│   ├── main/               # Electron main process
│   ├── preload/            # Electron preload scripts
│   └── renderer/           # React frontend
│       └── src/
│           ├── engine/     # Font engine (Rust interface)
│           ├── editor/     # Canvas editor
│           ├── tools/      # Drawing tools
│           ├── graphics/   # Rendering backends
│           ├── types/      # TypeScript types
│           └── components/ # React components
└── scripts/                # Build scripts
```

## Architecture

- **Rust (shift-core)**: Font data structures and editing algorithms
- **NAPI (shift-node)**: Exposes Rust to Node.js via native bindings
- **Electron**: Desktop app shell with main/renderer process model
- **React**: UI components and state management
- **CanvasKit**: WebAssembly-based canvas rendering (migrating to 2D canvas)

## License

MIT

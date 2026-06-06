<div align="center">
  <p align="center">
    <img width=150 src="https://github.com/user-attachments/assets/521e2732-341d-441d-bb6d-bf7bcdccf764" />
    <h1 align="center"><b>Shift</b></h1>
    <p>A modern, cross-platform font editor built with TypeScript and Rust, focused on bringing contemporary technologies and design principles to type design.</p>
    <img width="2320" height="1456" alt="image" src="https://github.com/user-attachments/assets/9a2ed77a-66c0-4881-a632-c7831d9dc420" />


  </p>
</div>

## Why Shift?

Shift aims to redefine font editing by combining the power of Rust for performance-critical tasks with the flexibility of web-based UI technologies. Whether you're a type designer or a developer, Shift offers a fresh approach to creating and editing fonts with a focus on speed, precision, and extensibility.

> [!IMPORTANT]
> Shift is in a pre-alpha state and is currently only suitable for developers interested in contributing to the project

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                         Desktop App                          │
│  Electron shell  ←→  React UI  ←→  TypeScript Editor         │
└───────────────────────────────┬──────────────────────────────┘
                                │ IPC / native bridge
┌───────────────────────────────┴──────────────────────────────┐
│                         Rust Crates                          │
│  shift-bridge      transport adapter                         │
│  shift-workspace   open working state                        │
│  shift-font        live font authoring model                 │
│  shift-store       SQLite working store                      │
│  shift-source      .shift source package IO                  │
└──────────────────────────────────────────────────────────────┘
```

The desktop app owns shell and editor interaction. Rust owns the live font authoring model, durable working state, source package IO, and native transport boundary.

`shift-font` is the core Rust object model:

- `Font` owns glyphs, sources, axes, metadata, and font-level data.
- `Source` is an editable designspace position with a name and location.
- `Glyph` is a glyph concept identified by `GlyphId`.
- `GlyphLayer` is authored editable data for one glyph at one source.

Stable IDs are identity. Names and Unicode values are editable metadata.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [pnpm](https://pnpm.io/) (v9+)
- [Rust](https://rustup.rs/) (stable)

### Quick Start

```bash
git clone https://github.com/shift-editor/shift.git
cd shift

pnpm install
pnpm build:native
pnpm dev
```

## Roadmap

See [ROADMAP.md](ROADMAP.md) for current implementation status and planned features. We are planning to ship a production grade font editor.

## Community

Join our [Discord server](https://discord.gg/582FxBdNH7) to ask questions, report bugs, or contribute!

## License

[GNU General Public License (GPL) v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)

Copyright © 2026 Kostya Farber. All rights reserved.

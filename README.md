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

> [!WARNING]
> Shift is an unstable Developer Preview. Versioned Alpha builds are for early testing, not production font work. Work on copies and retain independent backups. Installable builds are published through [GitHub Releases](https://github.com/shift-editor/shift/releases); the latest complete development snapshot is available as [Shift Nightly](https://github.com/shift-editor/shift/releases/tag/nightly).

Linux versioned releases are available through signed [APT and DNF repositories](docs/releases.md#linux-installation), with DEB, RPM, and AppImage direct downloads retained as alternatives.

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
│  shift-store       canonical SQLite documents and recovery   │
│  shift-cli         document authoring and inspection CLI     │
└──────────────────────────────────────────────────────────────┘
```

The desktop app owns shell and editor interaction. Rust owns the live font authoring model, canonical SQLite documents, durable recovery state, and native transport boundary.

`shift-font` is the core Rust object model:

- `Font` owns glyphs, sources, axes, metadata, and font-level data.
- `Source` is an editable designspace position with a name and location.
- `Glyph` is a glyph concept identified by `GlyphId`.
- `GlyphLayer` is authored editable data for one glyph at one source.

Stable IDs are identity. Names and Unicode values are editable metadata.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v24)
- [pnpm](https://pnpm.io/) (v11)
- [Rust](https://rustup.rs/) (stable)

### Quick Start

```bash
git clone https://github.com/shift-editor/shift.git
cd shift

pnpm install
pnpm dev
```

`pnpm dev` builds the Rust addon in debug mode. Use `pnpm dev:release` for representative performance, or `pnpm dev:watch` / `pnpm dev:watch:release` to rebuild the addon when Rust changes.

### Command-line inspection

The `shift` CLI can inspect canonical SQLite `.shift` documents without modifying them:

```bash
cargo run -p shift-cli -- inspect path/to/Family.shift
cargo run -p shift-cli -- inspect --view axes path/to/Family.shift
cargo run -p shift-cli -- inspect --json path/to/Family.shift
```

See [crates/shift-cli/README.md](crates/shift-cli/README.md) for the supported views and development commands.

## Roadmap

See [ROADMAP.md](ROADMAP.md) for current implementation status and planned features. We are planning to ship a production grade font editor.

## Security and signing

Windows releases are currently unsigned while Shift applies for open-source code signing. See the [code signing policy](CODE_SIGNING_POLICY.md) for the signing scope, release controls, team roles, and network/privacy disclosures.

Security vulnerabilities can be reported privately to [Kostya Farber](mailto:kostya.farber@gmail.com).

## Community

Join our [Discord server](https://discord.gg/582FxBdNH7) to ask questions, report bugs, or contribute!

## License

[GNU General Public License v3.0 only (`GPL-3.0-only`)](https://www.gnu.org/licenses/gpl-3.0.en.html)

Copyright © 2026 Kostya Farber.

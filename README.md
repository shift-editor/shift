<div align="center">
  <p align="center">
    <img width=150 src="https://github.com/user-attachments/assets/521e2732-341d-441d-bb6d-bf7bcdccf764" />
    <h1 align="center"><b>Shift</b></h1>
    <p>A modern, cross-platform font editor built with TypeScript and Rust, focused on bringing contemporary technologies and design principles to type design.</p>
  <img width="1710" height="1073" alt="image" src="https://github.com/user-attachments/assets/2b4f762d-3ca8-4b3e-b445-9c0588c6fa45" />
  </p>
</div>

## Why Shift?

Shift aims to redefine font editing by combining the power of Rust for performance-critical tasks with the flexibility of web-based UI technologies. Whether you're a type designer or a developer, Shift offers a fresh approach to creating and editing fonts with a focus on speed, precision, and extensibility.

> [!IMPORTANT]
> Shift is in a pre-alpha state and is currently only suitable for developers interested in contributing to the project

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Frontend                           │
│  React UI  ←→  Editor  ←→  Canvas 2D Renderer           │
└────────────────────────┬────────────────────────────────┘
                         │ IPC / NAPI
┌────────────────────────┴────────────────────────────────┐
│                       Backend                           │
│  shift-node (N-API bindings)  ←→  shift-core (Rust)     │
└─────────────────────────────────────────────────────────┘
```

The frontend handles UI and rendering via Electron, while all font data and editing operations live in Rust. Communication happens through native Node.js bindings, keeping performance-critical work off the main thread.

See [docs/editor-integration.md](docs/editor-integration.md) for detailed architecture

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

## License

[GNU General Public License (GPL) v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)

Copyright © 2025 Kostya Farber. All rights reserved.

<div align="center">
  <p align="center">
    <img width=150 src="https://github.com/user-attachments/assets/521e2732-341d-441d-bb6d-bf7bcdccf764" />
    <h1 align="center"><b>Shift</b></h1
>
    <p>A modern, cross-platform font editor built with TypeScript and Rust, focused on bringing contemporary technologies and design principles to type design.</p>
  </p>
</div>

## Why Shift?

Shift aims to redefine font editing by combining the power of Rust for performance-critical tasks with the flexibility of web-based UI technologies. Whether you're a type designer or a developer, Shift offers a fresh approach to creating and editing fonts with a focus on speed, precision, and extensibility.

> [!IMPORTANT]
> Shift is in a pre-alpha state and is currently only suitable for developers interested in contributing to the project

## Architecture

Shift uses the Tauri framework:

- **UI**: Uses React and Vite for components around the canvas
- **Rendering**: Webview based UI utilising the HTML canvas and rendered with CanvasKit (Skia) for high-quality graphics
- **State management**: Zustland for global React state mangement
- **Backend**: Rust for high-intensive operations and font related processing

## Getting Started

### Prerequisites

- **Rust** (1.70 or later): [Install Rust](https://www.rust-lang.org/tools/install)
- **Bun** (1.0 or later): [Install Bun](https://bun.sh/docs/installation)
- **System Dependencies**:
  - **Windows**: Microsoft Visual C++ Build Tools, WebView2
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`)
  - **Linux**: WebKit2GTK (`libwebkit2gtk-4.0-dev`) and build essentials

### Quick Start

1. **Clone the repository**:

```bash
git clone https://github.com/shift-editor/shift.git
cd shift
```

2. **Install dependencies**:

```bash
bun install
```

3. **Run the development server**:

```bash
bun dev:app
```

### Build for Production

```bash
bun build:app

```

### Common Issues

- If you encounter build errors, ensure you have all system dependencies installed
- For Linux users, make sure WebKit2GTK development libraries are installed
- For detailed troubleshooting, check the [Tauri docs](https://v1.tauri.app/v1/guides/getting-started/prerequisites/)

## Development Roadmap

We aim to implement the typical features present in font editors such as FontForge, Glyphs, RobotFont etc.

## License

[GNU General Public License (GPL) v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)

Copyright © 2025 Kostya Farber. All rights reserved.

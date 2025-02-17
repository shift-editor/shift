# Shift

> [!IMPORTANT]
> Shift is in a pre-alpha state and is currently only suitable for developers interested in contributing to the project

A modern, cross-platform font editor built with Rust and web technologies, focused on bringing contemporary technologies and design principles to type design.

## Architecture
Shift uses the Tauri framework:

* UI: Uses React and Vite for components around the canvas
* Rendering: Webview based UI utilising the HTML canvas and rendered with CanvasKit (Skia) for high-quality graphics
* State management: Zustland for global React state mangement
* Backend: Rust for high-intensive operations and font related processing

## Development Roadmap
We aim to implement features seen in typical font editors such as FontForge, Glyphs, RobotFont etc.

## License
GNU General Public License (GPL) v3.0

Copyright © 2025 Kostya Farber. All rights reserved.

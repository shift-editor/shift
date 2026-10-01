<div align="center">
  <p align="center">
    <img width="250" alt="image" src="https://github.com/user-attachments/assets/5ed51bda-3e29-40f2-b87d-9309f2366bf1" />
    <h1 align="center"><b>Shift</b></h1>
    <p>A font editor built for variable fonts.</p>
    <p>
      <a href="https://shift.graphics">Download</a>
      ·
      <a href="https://shift.graphics/releases">Release notes</a>
      ·
      <a href="https://discord.gg/582FxBdNH7">Discord</a>
    </p>
    <img width="2400" height="1600" alt="image" src="https://github.com/user-attachments/assets/592962c3-f198-4e53-af61-460a592b05f0" />
  </p>
</div>

**Shift is a free, open-source font editor for macOS, Windows, and Linux, available now in alpha.**

Shift opens `.shift` documents, UFO, Designspace, and Glyphs sources (use **Save as Shift** to edit them), and TTF/OTF fonts for viewing. It exports TrueType, including variable fonts.

> [!WARNING]
> Work on copies of your fonts and keep backups. Workflows and file details will change between alpha releases.

## Download

Download Shift for macOS, Windows, and Linux from [shift.graphics](https://shift.graphics) or [GitHub Releases](https://github.com/shift-editor/shift/releases). On Linux, install from the [APT or DNF repositories](docs/releases.md#linux-installation) to get updates. For the latest development build, use [Shift Nightly](https://github.com/shift-editor/shift/releases/tag/nightly).

## Status

| Area                                     | Status  |
| ---------------------------------------- | :-----: |
| Drawing and editing outlines             |   ✅    |
| Variable fonts: axes, sources, instances |   ✅    |
| Components                               |   ✅    |
| Opening UFO, Designspace, and Glyphs     |   ✅    |
| Exporting TrueType                       |   ✅    |
| Kerning                                  | Planned |
| Text proofing                            | Planned |

Found a bug? Use **Help → Report a Problem** in the app, or ask on [Discord](https://discord.gg/582FxBdNH7).

## Development

Shift is an Electron app with a TypeScript editor and a Rust core. You need [Node.js](https://nodejs.org/) 24, [pnpm](https://pnpm.io/) 11, and stable [Rust](https://rustup.rs/).

```bash
git clone https://github.com/shift-editor/shift.git
cd shift
pnpm install
pnpm dev
```

| Command            | What it does                                                  |
| ------------------ | ------------------------------------------------------------- |
| `pnpm dev`         | Build the native addon in debug mode and start the app        |
| `pnpm dev:release` | Same with a release build, for performance work               |
| `pnpm test`        | Run the test suites                                           |
| `pnpm check`       | Lint, typecheck, dead-code checks, and tests; run before a PR |
| `pnpm package`     | Build an installable app                                      |

### Repository layout

- `apps/desktop`: Electron app and React UI
- `packages/editor`: tools, rendering, and editor state
- `crates/shift-bridge`: native bridge between TypeScript and Rust
- `crates/shift-workspace`: open documents and editing sessions
- `crates/shift-font`: the font model and editing behavior
- `crates/shift-store`: `.shift` files and recovery
- `crates/shift-backends`, `crates/fontsrc`: importing and exporting UFO, Designspace, Glyphs, and TrueType

See [docs/architecture](docs/architecture/index.md) for how the code is organized.

## Security and signing

Windows releases are currently unsigned while Shift applies for open-source code signing. See the [code signing policy](CODE_SIGNING_POLICY.md) for the signing scope, release controls, team roles, and network/privacy disclosures.

Security vulnerabilities can be reported privately to [Kostya Farber](mailto:kostya.farber@gmail.com).

## License

Shift is dual-licensed under either of

- [MIT license](LICENSE-MIT)
- [Apache License, Version 2.0](LICENSE-APACHE)

at your option. Unless you explicitly state otherwise, any contribution you submit for inclusion in Shift is licensed as above, without any additional terms or conditions.

Third-party fonts, data, and code bundled with Shift keep their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

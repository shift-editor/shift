# App icons

The editable Icon Composer sources are:

- `icon.icon` — release
- `nightly.icon` — nightly

Open them from the repository root:

```bash
open -a "Icon Composer" "$PWD/icons/icon.icon"
open -a "Icon Composer" "$PWD/icons/nightly.icon"
```

After saving either source, regenerate every checked-in macOS, Windows, Linux, document, and favicon asset:

```bash
pnpm generate:icons
```

Generation requires macOS, Xcode 26 or newer, and ImageMagick. Do not edit the generated PNG, ICNS, or ICO files directly.

The `.shift` document artwork is generated from `shift-document.svg` by `scripts/icons.sh`. macOS receives versioned `shift-document-badge` renditions in `shift-document.xcassets` and composites them onto its standard folded document shape. macOS caches that composition by UTI, so a shipped artwork refresh must version the macOS document type identifier as well as the badge asset name. Windows receives `shift-document.ico`; Linux receives the size-specific `shift-document` PNGs.

## electron-builder configuration

`apps/desktop/electron-builder.config.ts` selects the distribution-matched assets:

- macOS: `icon.icon` / `nightly.icon`
- Windows and NSIS: `icon.ico` / `nightly.ico`
- Linux and runtime APIs: `icon.png` / `nightly.png`
- `.shift` documents: macOS system-composed `shift-document-badge-v2` under `app.shift.document.v2`; Windows `shift-document.ico`; Linux size-specific PNGs

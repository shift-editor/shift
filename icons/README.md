# App icons

The editable Icon Composer sources are:

- `icon.icon` — release
- `nightly.icon` — nightly

Open them from the repository root:

```bash
open -a "Icon Composer" "$PWD/icons/icon.icon"
open -a "Icon Composer" "$PWD/icons/nightly.icon"
```

After saving either source, regenerate every checked-in macOS, Windows, Linux, and favicon asset:

```bash
pnpm generate:icons
```

Generation requires macOS, Xcode 26 or newer, and ImageMagick. Do not edit the generated PNG, ICNS, or ICO files directly.

## electron-builder configuration

`apps/desktop/electron-builder.config.ts` selects the distribution-matched assets:

- macOS: `icon.icon` / `nightly.icon`
- Windows and NSIS: `icon.ico` / `nightly.ico`
- Linux and runtime APIs: `icon.png` / `nightly.png`

# Desktop releases

Shift ships one versioned desktop product. Internal Rust crates and JavaScript packages are not released separately and retain independent component versions.

## Distribution states

| State     | Product identity | Bundle ID           | Data root       | Publication                   |
| --------- | ---------------- | ------------------- | --------------- | ----------------------------- |
| `release` | Shift            | `app.shift`         | `Shift`         | Draft, then GitHub prerelease |
| `nightly` | Shift Nightly    | `app.shift.nightly` | `Shift Nightly` | Rolling GitHub prerelease     |

`SHIFT_DISTRIBUTION` accepts only `release` or `nightly` during a build. Release and Nightly have separate application identities, data roots, and update-feed paths. A failed build does not advance its update feed.

An Alpha is a public Developer Preview, not a stability claim or tester invitation. Alpha, Beta, and Developer Preview are GitHub prerelease metadata and release-title language; they are not part of the product version. Continue to warn testers to work on copies and keep independent backups.

## Versions

Every installable binary uses one numeric three-component version. The same value appears in the root and desktop `package.json`, packaged application metadata, macOS `CFBundleShortVersionString` and `CFBundleVersion`, electron-builder manifests, Windows NSIS installers, and the About panel.

```sh
pnpm version:check
pnpm version:set 0.1.1
```

Versioned releases advance normally as `0.1.1`, `0.1.2`, and so on. Before 1.0, Release Please bumps the patch for ordinary changes; a deliberate milestone change uses a `Release-As: MAJOR.MINOR.PATCH` footer. Nightlies use `0.<GITHUB_RUN_NUMBER>.<GITHUB_RUN_ATTEMPT>`, for example `0.321.1`. The Nightly workflow resolves that value once before its build matrix.

Release tags add `v`, such as `v0.1.1`. GitHub releases remain marked as prereleases even though binary versions are numeric. The initial changelog boundary is commit `788ba986410b4d2837e9d269ff8938b1dbc5aa9a`.

Use Conventional Commit prefixes. `feat`, `fix`, and `perf` appear in the public changelog. Other valid prefixes remain hidden. Curate the first Developer Preview overview and known issues rather than relying on generated entries alone.

## Packaging and updates

| Target              | Package/update policy                                                                |
| ------------------- | ------------------------------------------------------------------------------------ |
| macOS arm64/x64     | Signed and notarized ZIP for automatic updates; DMG for manual installation          |
| Windows Nightly x64 | Unsigned per-user NSIS installer and automatic updates for installed N → N+1 testing |
| Windows Release x64 | Manual GitHub downloads until Authenticode signing is configured                     |
| Linux x64           | Manual GitHub downloads (`.deb` / `.rpm`)                                            |

electron-updater compares the aligned numeric versions, verifies generated SHA-512 metadata, downloads packages, verifies macOS code signatures and configured Windows Authenticode publishers, and installs/relaunches. Metadata hashes detect package corruption; they do **not** authenticate an unsigned Windows publisher. Do not treat Windows automatic updates as production-ready until Authenticode signing and installed verification are complete.

electron-builder generates architecture-specific `latest-mac.yml` files for exact versioned ZIP assets and `latest.yml` for the Windows Nightly NSIS installer. GitHub Pages hosts only these fixed Release/Nightly metadata files; GitHub Releases hosts the binaries and differential-update blockmaps.

The app waits 30 seconds before its first automatic check to avoid competing with startup, then checks every four hours. Automatic current/error results are quiet. Manual checks report current/download states. A downloaded update offers **Restart and Update** / Later, is not silently installed on ordinary quit, and cannot restart until every document accepts and commits close.

## Workflows

- `release-please.yml` maintains a draft release pull request. Merging it creates a numeric version tag and draft GitHub release, then invokes `release-desktop.yml`.
- `release-desktop.yml` validates `vMAJOR.MINOR.PATCH`, builds macOS arm64/x64 ZIPs and DMGs, a Windows x64 per-user NSIS installer, and Linux x64 packages, smoke-tests packaged applications, uploads checksums/assets, publishes the GitHub prerelease, then advances the Release feed.
- `nightly.yml` resolves one `0.RUN.ATTEMPT` version, builds the same matrix, and updates the rolling Nightly prerelease only after every build succeeds. It retains exact versioned macOS ZIP and Windows NSIS/blockmap update assets plus stable human-download ZIP, DMG, installer, DEB, and RPM names.
- `prepare-update-feed.mjs` performs the one monotonic candidate-version check, stages electron-builder's generated metadata into fixed Pages paths, and rewrites artifact paths to absolute GitHub Release asset URLs. It does not create immutable feed-history directories.

Release and Nightly feed publication share one concurrency group. Binary assets become public before a feed advances. The feed job checks out or creates the `update-feeds` branch, preserves `.nojekyll` and the other distribution directory, updates only its channel, and pushes the branch. GitHub Pages serves it at `https://shift-editor.github.io/shift/updates`.

A separate feed job allows feed deployment to be retried from retained workflow artifacts without rebuilding binaries. The first successful deployment creates `update-feeds`; later deployments update one channel directory.

The Release Please workflow mints a short-lived token from the repository-scoped Shift Release Please GitHub App so generated pull requests trigger normal CI.

## GitHub configuration

| Variable                       | Purpose                                     |
| ------------------------------ | ------------------------------------------- |
| `RELEASE_PLEASE_APP_CLIENT_ID` | Public client ID for the Release Please App |

| Secret                           | Purpose                                                  |
| -------------------------------- | -------------------------------------------------------- |
| `RELEASE_PLEASE_APP_PRIVATE_KEY` | Private key used to mint installation tokens for one run |
| `APPLE_CERTIFICATE`              | Base64-encoded Developer ID Application `.p12`           |
| `APPLE_CERTIFICATE_PASSWORD`     | Password protecting the `.p12`                           |
| `APPLE_ID`                       | Apple Developer account login used by `notarytool`       |
| `APPLE_APP_SPECIFIC_PASSWORD`    | Apple ID app-specific password                           |
| `APPLE_TEAM_ID`                  | Paid Apple Developer Program team ID                     |

Never put private keys or signing credentials in repository files, workflow inputs, artifacts, or logs. macOS release and Nightly jobs fail when signing credentials are absent.

## Setup and required QA

1. Add the Apple signing/notarization secrets.
2. Run a desktop workflow once to create `update-feeds`.
3. Configure GitHub Pages to publish the root of `update-feeds`.
4. Confirm packaged Release and Nightly builds contact only their matching feed paths.
5. Perform real installed N → N+1 tests on macOS arm64/x64 and unsigned Windows Nightly x64, including Save, Don't Save, Cancel, Later, and **Restart and Update**.
6. Keep Windows Release on manual downloads until Authenticode signing and installed update verification are complete.

Electron update orchestration has no worthwhile unit test without mocking Electron, native dialogs, and electron-updater. Pure tests cover feed selection, canonical versions, generated metadata validation, feed preparation, and Nightly asset retention; installed update behavior remains required manual QA.

## Rollback

- Disable a workflow from the Actions page to stop automation.
- A failed versioned build remains a private draft release; fix and rerun it before publication.
- Never delete or reuse a published numeric version tag. Correct it with the next version.
- A failed Nightly build or feed deployment leaves the previous feed active. Republish a complete later Nightly rather than editing a feed in place.
- If assets publish but feed deployment fails, rerun the feed job from retained artifacts. Clients continue using the previous feed until deployment succeeds.

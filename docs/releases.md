# Desktop releases

Shift ships one versioned desktop product. Internal Rust crates and JavaScript packages are not released separately and retain independent component versions.

## Distribution states

| State     | Product identity | Bundle ID           | Data root       | Publication                                                |
| --------- | ---------------- | ------------------- | --------------- | ---------------------------------------------------------- |
| `release` | Shift            | `app.shift`         | `Shift`         | Draft, then GitHub prerelease                              |
| `nightly` | Shift Nightly    | `app.shift.nightly` | `Shift Nightly` | Rolling GitHub prerelease and immutable R2 updater archive |

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

| Target              | Package/update policy                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| macOS arm64/x64     | Signed and notarized ZIP for automatic updates; DMG for manual installation                                         |
| Windows Nightly x64 | Unsigned per-user NSIS installer and automatic updates for installed N → N+1 testing                            |
| Windows Release x64 | Manual GitHub downloads until Authenticode signing is configured                                                |
| Linux Nightly x64   | Unsigned direct GitHub downloads (`.deb`, `.rpm`, and AppImage)                                                 |
| Linux Release x64   | Signed RPM and checksum manifest; direct downloads plus signed APT/DNF repositories and an AppImage             |

Packaged builds register `.shift` as a Shift Document with shared document artwork. Release is the preferred handler; Nightly remains an alternate so installing it does not take document ownership from Release. macOS composites the Shift badge onto its standard document shape from bundle metadata and the packaged asset catalog, Windows uses per-user NSIS registry entries, and Linux DEB/RPM packages install `application/x-shift-document` metadata and hicolor MIME icons.

electron-updater compares the aligned numeric versions, verifies generated SHA-512 metadata, downloads packages, verifies macOS code signatures and configured Windows Authenticode publishers, and installs/relaunches. Metadata hashes detect package corruption; they do **not** authenticate an unsigned Windows publisher. Do not treat Windows automatic updates as production-ready until Authenticode signing and installed verification are complete.

electron-builder generates architecture-specific `latest-mac.yml` files for exact versioned ZIP assets and `latest.yml` for the Windows Nightly NSIS installer. GitHub Pages hosts the fixed Release/Nightly metadata files. Versioned Release binaries and their differential-update blockmaps remain on GitHub Releases. Nightly metadata instead references immutable updater packages under `nightly/<full-commit>/` in Cloudflare R2. Because electron-updater cannot derive a previous blockmap URL across commit-addressed directories, Nightly updates fall back to full package downloads; Release differential updates are unchanged.

Linux Release packages use the dedicated `Shift Package Signing` RSA-4096 key. The RPM carries an embedded signature, and the signed `SHA256SUMS.asc` authenticates every direct-download Linux format, including DEB and AppImage. The Release DEB embeds the public key and APT source as Debian conffiles so a direct install enrolls in authenticated APT updates; Nightly DEBs never enroll in the Release repository. APT authenticates package hashes through `InRelease`; DNF checks both the RPM signature and the detached `repomd.xml` signature. The public key is published as `shift-repository.gpg` with the GitHub release and at `https://packages.shift.graphics/keys/shift-repository.gpg`.

The app waits 30 seconds before its first automatic check to avoid competing with startup, then checks every four hours. Automatic current/error results are quiet. A native-framed update window asks for consent before downloading, then replaces those choices with byte and percentage progress that can be canceled. Download completion replaces progress with **Restart and Install** / Later, is not silently installed on ordinary quit, and cannot restart until every document accepts and commits close.

## Linux installation

APT users can download a Release DEB from the GitHub release and install it directly:

```sh
sudo apt install ./Shift-<version>-Linux-x64.deb
sudo apt update
```

The DEB installs the scoped repository key and deb822 source definition, so later versions arrive through ordinary APT upgrades. `apt remove shift` leaves that configuration available; `apt purge shift` removes it. Users who prefer to configure the repository before installing Shift can do so explicitly:

```sh
sudo install -d -m 755 /etc/apt/keyrings
curl -fsSL https://packages.shift.graphics/keys/shift-repository.gpg \
  | sudo tee /etc/apt/keyrings/shift-repository.gpg >/dev/null
curl -fsSL https://packages.shift.graphics/config/shift.sources \
  | sudo tee /etc/apt/sources.list.d/shift.sources >/dev/null
sudo apt update
sudo apt install shift
```

DNF users install the repository definition, which enables both package and repository-metadata signature checks:

```sh
sudo curl -fsSL \
  https://packages.shift.graphics/config/shift.repo \
  -o /etc/yum.repos.d/shift.repo
sudo dnf install shift
```

The AppImage remains a direct-download alternative. Verify it through the release's `SHA256SUMS` and `SHA256SUMS.asc`, make it executable, and run it without installing a repository.

## Workflows

- `release-please.yml` maintains a draft release pull request. Merging it creates a numeric version tag and draft GitHub release, then invokes `release-desktop.yml`.
- `release-desktop.yml` validates `vMAJOR.MINOR.PATCH`, builds macOS arm64/x64 ZIPs and DMGs, a Windows x64 per-user NSIS installer, and Linux x64 DEB/RPM/AppImage packages, smoke-tests packaged applications, signs the Release RPM and checksum manifest, uploads the GitHub prerelease, publishes signed APT/DNF repositories, then advances the Release feed.
- `nightly-after-merge.yml` dispatches `nightly.yml` after a pull request labeled `release: nightly` merges into `main`. Closing an unmerged pull request or merging one without the label does nothing.
- `nightly.yml` runs from that dispatch, its daily schedule, or a manual dispatch. It resolves one `0.RUN.ATTEMPT` version and builds the same matrix. After every build succeeds, it archives versioned updater assets in the immutable R2 prefix `nightly/<full-commit>/`, replaces the rolling GitHub prerelease's friendly download aliases, and advances the feed to the exact R2 prefix. A commit whose R2 manifest and feed are already active is skipped.
- `installed-app-screenshots.yml` is a macOS x64, Windows x64, and Linux x64 review workflow that runs when its harness changes, when `ci: installed app screenshots` is applied to a same-repository pull request, or when manually dispatched for a specified pull request. Label-triggered runs and fresh manual captures check out that pull request's head commit; a manual dispatch can instead publish artifacts from an existing capture run. The workflow builds and installs Release packages, captures the installed launcher, document, application menu, native dialog, and `.shift` activation, and retains screenshots, registration metadata, and resolved document icons as 14-day Actions artifacts. For same-repository pull requests, it also publishes only the expected PNGs under `installed-app-screenshots/pr-<number>/run-<id>/` in the dedicated screenshot R2 bucket and renders their direct public URLs in collapsed scenario sections within a sticky review comment. Its non-published capture package alone enables Electron's Node CLI inspector for Playwright; Release and Nightly packages keep that fuse disabled.
- `prepare-update-feed.mjs` performs the one monotonic candidate-version check and stages electron-builder's generated metadata into fixed Pages paths. Release asset URLs continue to target their versioned GitHub release; Nightly URLs target the candidate's immutable R2 prefix. It does not create feed-history directories.

The Linux repository follows `built → signed → active`. `built` means the complete x64 artifact set passed its packaged-app smoke test. `signed` means the RPM, APT `Release`, DNF `repomd.xml`, and direct-download checksum manifest have signatures from the configured repository key. `active` means the public APT `InRelease` and DNF metalink reference that signed release.

APT uploads immutable package and by-hash content before replacing the single signed `InRelease` root. DNF stores each complete repository under `rpm/releases/<version>/x86_64/`; the stable `rpm/release/x86_64/metalink.xml` activates one immutable version. Activation saves the preceding roots, updates the DNF metalink and APT `InRelease`, verifies both through the public domain, and installs Shift in clean Ubuntu and Fedora containers. Any failure during activation or installation restores the preceding roots. Nightlies never enter either native repository.

Release and Nightly feed publication share one concurrency group. Binary assets become public before a feed advances. The feed job checks out or creates the `update-feeds` branch, preserves `.nojekyll` and the other distribution directory, updates only its channel, and pushes the branch. GitHub Pages serves it at `https://shift-editor.github.io/shift/updates`.

A separate feed job allows a failed feed deployment to be retried from the original run's retained workflow artifacts without rebuilding binaries. The first successful deployment creates `update-feeds`; later deployments update one channel directory. Nightly publication follows `built → uploaded → active → retired → deleted`: the R2 manifest is uploaded last, a complete prefix becomes active only when the feed references it, and a newer feed retires the previous prefix. After the feed advances, pruning makes the GitHub release match the authoritative friendly asset set and deletes retired R2 prefixes older than 14 days. The active R2 prefix is exempt even if Nightly publication stops. A failed prune leaves the active feed and binaries intact.

The Release Please workflow mints a short-lived token from the repository-scoped Shift Release Please GitHub App so generated pull requests trigger normal CI.

## GitHub configuration

| Variable                           | Purpose                                                                    |
| ---------------------------------- | -------------------------------------------------------------------------- |
| `RELEASE_PLEASE_APP_CLIENT_ID`     | Public client ID for the Release Please App                                |
| `CLOUDFLARE_ACCOUNT_ID`            | Cloudflare account containing the R2 buckets                               |
| `R2_RELEASE_BUCKET`                | Release R2 bucket; production uses `shift-releases`                        |
| `R2_RELEASE_BASE_URL`              | HTTPS custom-domain base URL exposing the release bucket                   |
| `R2_SCREENSHOT_BUCKET`             | Screenshot R2 bucket; production uses `shift-screenshots`                  |
| `R2_SCREENSHOT_BASE_URL`           | HTTPS origin exposing public installed-app screenshots                     |
| `LINUX_PACKAGE_BASE_URL`           | Linux repository origin; production uses `https://packages.shift.graphics` |
| `LINUX_REPOSITORY_GPG_FINGERPRINT` | Full fingerprint of the dedicated Linux repository signing key             |

| Secret                             | Purpose                                                        |
| ---------------------------------- | -------------------------------------------------------------- |
| `RELEASE_PLEASE_APP_PRIVATE_KEY`   | Private key used to mint installation tokens for one run       |
| `APPLE_CERTIFICATE`                | Base64-encoded Developer ID Application `.p12`                 |
| `APPLE_CERTIFICATE_PASSWORD`       | Password protecting the `.p12`                                 |
| `APPLE_ID`                         | Apple Developer account login used by `notarytool`             |
| `APPLE_APP_SPECIFIC_PASSWORD`      | Apple ID app-specific password                                 |
| `APPLE_TEAM_ID`                    | Paid Apple Developer Program team ID                           |
| `R2_ACCESS_KEY_ID`                 | Release-bucket S3 access key with object read/write permission |
| `R2_SECRET_ACCESS_KEY`             | Release-bucket S3 secret access key                            |
| `R2_SCREENSHOT_ACCESS_KEY_ID`      | Bucket-scoped screenshot S3 access key                         |
| `R2_SCREENSHOT_SECRET_ACCESS_KEY`  | Bucket-scoped screenshot S3 secret access key                  |
| `LINUX_REPOSITORY_GPG_PRIVATE_KEY` | ASCII-armored private Linux repository signing key             |
| `LINUX_REPOSITORY_GPG_PASSPHRASE`  | Passphrase protecting the Linux repository signing key         |

Never put private keys or signing credentials in repository files, workflow inputs, artifacts, or logs. macOS release and Nightly jobs fail when signing credentials are absent.

## Setup and required QA

1. Add the Apple signing/notarization secrets.
2. Create the Standard-storage R2 bucket `shift-releases`. Do not configure a bucket lifecycle rule; workflow pruning protects the active build.
3. Attach a production custom domain to the release bucket and configure its three R2 variables and two R2 secrets above.
4. Create the dedicated Standard-storage bucket `shift-screenshots`, attach `screenshots.shift.graphics`, and configure the two screenshot variables and bucket-scoped object read/write secrets above. Add a lifecycle rule that deletes objects under `installed-app-screenshots/` after 14 days; do not apply it to the release bucket.
5. Attach `packages.shift.graphics` to the release bucket and set `LINUX_PACKAGE_BASE_URL` to that HTTPS origin.
6. Create a dedicated RSA-4096 key whose identity is exactly `Shift Package Signing`. Keep an offline backup, add its armored private key and passphrase as repository secrets, and configure its full fingerprint as `LINUX_REPOSITORY_GPG_FINGERPRINT`.
7. Run a desktop workflow once to create `update-feeds` and the Linux repositories.
8. Configure GitHub Pages to publish the root of `update-feeds`.
9. Confirm packaged Release and Nightly builds contact only their matching feed paths, and that Nightly metadata references the expected full commit in R2.
10. Confirm the repository job installs the exact candidate version in its clean Ubuntu and Fedora containers. After a second versioned release exists, perform an installed N → N+1 APT and DNF upgrade test.
11. Perform real installed N → N+1 tests on macOS arm64/x64 and unsigned Windows Nightly x64, including download consent, full-download fallback, progress, download cancellation and retry, Save, Don't Save, Later, and **Restart and Install**.
12. Keep Windows Release on manual downloads until Authenticode signing and installed update verification are complete.

Electron update orchestration has no worthwhile unit test without mocking Electron, native dialogs, and electron-updater. Pure tests cover feed selection, canonical versions, generated metadata validation, feed preparation, and Nightly asset partitioning; installed update behavior and retention pruning remain required manual QA.

## Rollback

- Disable a workflow from the Actions page to stop automation.
- A failed versioned build remains a private draft release; fix and rerun it before publication.
- Never delete or reuse a published numeric version tag. Correct it with the next version.
- A failed Nightly build or feed deployment leaves the previous feed active. Republish a complete later Nightly rather than editing a feed in place.
- If R2 assets and GitHub aliases publish but feed deployment fails, rerun the failed feed job from the original run's retained artifacts. A full workflow rerun refuses to overwrite the complete immutable R2 prefix. Clients continue using the previous feed until deployment succeeds, and pruning does not run.
- If Linux repository preparation or inactive upload fails, fix and rerun the repository job; neither activation root changed. Activation and clean-container failures restore the preceding APT `InRelease` and DNF metalink. Never rewrite a published version directory.
- If Nightly pruning fails after the feed advances, rerun the prune job. Do not move the feed backward or delete the active commit's R2 prefix.

# Desktop releases

Shift ships one versioned desktop product. Internal Rust crates and JavaScript packages are not released separately and retain independent component versions.

## Distribution states

| State     | Product identity | Bundle ID           | Data root       | Publication                   |
| --------- | ---------------- | ------------------- | --------------- | ----------------------------- |
| `release` | Shift            | `app.shift`         | `Shift`         | Draft, then GitHub prerelease |
| `nightly` | Shift Nightly    | `app.shift.nightly` | `Shift Nightly` | Rolling GitHub prerelease     |

`SHIFT_DISTRIBUTION` accepts only `release` or `nightly` during a build. A commit on `main` may produce a Nightly. Merging a Release Please pull request creates an alpha tag and a draft GitHub release. A complete Nightly matrix advances the mutable `nightly` tag and replaces the human-download assets on one public prerelease while retaining versioned ZIP/NUPKG update assets. A failed matrix leaves the previous Nightly untouched. Nightly builds never promote themselves into versioned releases, and the release workflow rejects stable tags until the stable transition is deliberately enabled.

Development builds append ` Dev` to their product identity. An explicit Electron `--user-data-dir` switch always wins, allowing E2E and manual tests to own isolated state.

## Publication and invitations

An Alpha is a permanent, public Developer Preview, not a claim that the invited-tester workflow is ready. Publish Alpha snapshots early enough to exercise tagging, signing, packaging, checksums, installation, and upgrade behavior. Continue to make rapid and breaking UI, API, and document changes, but never silently corrupt or reinterpret user work; refuse unsupported documents explicitly.

Invitations are a separate communication decision. Invite testers to whichever current Alpha or Nightly passes the stronger product gate. The first invited build does not need to be `alpha.1`, and publishing an Alpha or rolling Nightly does not require a website announcement or waitlist message. A public but unadvertised Nightly link is not access control; a genuinely gated update channel requires a separate design for issuing and revoking access.

## Versions

The root and desktop `package.json` files carry the product version and must agree. Check or update them with:

```sh
pnpm version:check
pnpm version:set 0.1.0-alpha.1
```

Release Please owns normal version changes. `.release-please-manifest.json` starts at `0.1.0-alpha.0`, so the first tagged release is `v0.1.0-alpha.1`. Nightlies use versions such as `0.1.0-nightly20260817r0000000320a0001`: the UTC date, ten-digit workflow run, and four-digit attempt remain lexically ordered after electron-winstaller's NuGet conversion, and reruns receive distinct immutable versions. The initial changelog boundary is commit `788ba986410b4d2837e9d269ff8938b1dbc5aa9a`, immediately before the release foundation; older project history is not imported into the first release notes.

Use Conventional Commit prefixes on commits and pull requests. `feat`, `fix`, and `perf` entries appear in the generated public changelog. `refactor`, `docs`, `test`, `build`, `ci`, `style`, and `chore` remain valid commit types but stay hidden from public release notes. Before publishing the first Alpha, add a short curated overview and known-issues section to its Release Please pull request; generated entries alone do not describe the existing product.

### Version maturity policy

A product version has the form `MAJOR.MINOR.PATCH-MATURITY.SEQUENCE`. The package version omits the `v` used by its Git tag: package `1.0.0-rc.3` is tagged `v1.0.0-rc.3`.

Build track and release maturity are independent. Nightly is a temporary build track that runs alongside versioned releases; it is not a maturity before Alpha. Versioned releases progress from Alpha to Beta to RC to Stable. Stable versions have no maturity suffix.

Before 1.0, Shift uses:

- the minor number for a deliberate product milestone;
- the prerelease sequence for published iterations within that milestone; and
- the patch number for fixes to an already-published stable version.

Consequently, ordinary work within the Alpha 1 milestone advances `0.1.0-alpha.1` to `0.1.0-alpha.2`, not to a new minor version. A meaningfully expanded scope, deliberate document-compatibility boundary, or newly declared preview milestone starts `0.2.0-alpha.1`. Version numbers do not measure completion percentage, time elapsed, or the number of merged features.

The intended path toward the first stable release is:

```text
0.1.0-alpha.N    Developer Preview iterations
0.2.0-alpha.N    later preview milestone, when explicitly declared
1.0.0-beta.N     v1 scope is feature-complete
1.0.0-rc.N       v1 release candidates
1.0.0            first stable release
```

Maturity transitions are human product gates; Release Please must not infer them from commit types. Force a new milestone or maturity with an explicit `Release-As` footer, for example `Release-As: 0.2.0-alpha.1` or `Release-As: 1.0.0-beta.1`. Within the selected maturity, Release Please increments the sequence when its release pull request is merged.

Do not move backward in maturity for the same target version. If scope reopens substantially, select a new target milestone. After 1.0, fixes increment the patch version, backward-compatible features increment the minor version, and breaking changes increment the major version.

## Workflows

- `release-please.yml` maintains a draft release pull request. Merging it creates an alpha tag and a draft GitHub release, then calls the desktop release workflow with that exact tag. `force-tag-creation` materializes the tag immediately because GitHub otherwise delays tags for draft releases.
- `release-desktop.yml` is a reusable and manually dispatchable workflow that builds the draft alpha or beta release for macOS arm64/x64, Windows x64, and Linux x64. It refuses an already-public release or an existing immutable feed version before clobbering assets, builds the native bridge on each runner, smoke-tests the packaged app, uploads checksums and desktop artifacts, and only then publishes the GitHub prerelease. A failed build leaves the release private and draft.
- `nightly.yml` builds the same platform matrix as Shift Nightly on a schedule or by manual dispatch. Each platform keeps a 14-day workflow artifact for diagnostics. After every platform packages and smoke-tests successfully, a final job rejects commits behind the current Nightly tag and verifies that the proposed native feed version advances before updating the mutable tag or assets. A failed matrix or stale rerun cannot alter the public Nightly.
- Before mutating a public release, `check-update-feed-version.sh` fetches the authoritative `update-feeds` branch, fails closed on remote errors, rejects duplicate immutable versions, and verifies that the proposed native feed version increases. After publication, `publish-update-feed.sh` rechecks the remote and updates the branch. `prepare-update-feed.mjs` recognizes electron-winstaller's NuGet-normalized prerelease filenames, retains immutable versioned Squirrel manifests, and atomically replaces the fixed Release or Nightly native feed files. GitHub Pages serves the branch at `https://shift-editor.github.io/shift/updates`; a feed failure leaves the previously deployed native feeds usable.

The Release Please workflow mints a short-lived installation token from the repository-scoped Shift Release Please GitHub App. Unlike the default workflow token, the App token lets generated pull requests trigger normal CI without depending on an expiring personal token. The desktop build is called directly from the successful release-creation job rather than relying on a second GitHub event.

## GitHub Actions variable

| Variable                       | Purpose                                      |
| ------------------------------ | -------------------------------------------- |
| `RELEASE_PLEASE_APP_CLIENT_ID` | Public client ID for the Release Please App |

## GitHub secrets

| Secret                           | Purpose                                                  |
| -------------------------------- | -------------------------------------------------------- |
| `RELEASE_PLEASE_APP_PRIVATE_KEY` | Private key used to mint installation tokens for one run |
| `APPLE_CERTIFICATE`              | Base64-encoded Developer ID Application `.p12`           |
| `APPLE_CERTIFICATE_PASSWORD`     | Password protecting the `.p12`                           |
| `APPLE_ID`                       | Apple Developer account login used by `notarytool`       |
| `APPLE_APP_SPECIFIC_PASSWORD`    | Apple ID app-specific password, not the account password |
| `APPLE_TEAM_ID`                  | Paid Apple Developer Program team ID                     |

Do not put App private keys or signing credentials in repository files, workflow inputs, artifacts, or logs. macOS release and Nightly jobs fail if signing credentials are absent; they never silently publish unsigned macOS builds. Windows Nightlies use Squirrel's native updater while unsigned for initial N → N+1 testing; acquire an Authenticode certificate before treating Windows updates as production-ready.

## Signing setup

1. In Keychain Access, export the Developer ID Application certificate and private key as a password-protected `.p12`.
2. Base64-encode the file without line wrapping and store it as `APPLE_CERTIFICATE`.
3. Create an Apple ID app-specific password for notarization.
4. Add all secrets under repository **Settings → Secrets and variables → Actions**.
5. Run `Nightly Desktop` manually and verify both `codesign` and stapler validation succeed.

## Update-feed setup

1. Run a release workflow once to create the `update-feeds` branch.
2. Configure GitHub Pages to deploy from the root of `update-feeds`.
3. Confirm packaged Release and Nightly builds reach only their matching native feed paths.
4. Perform real N → N+1 installation tests on macOS arm64/x64 and Windows x64 before inviting testers.

The compiled default feed root is `https://shift-editor.github.io/shift/updates`. Override `SHIFT_UPDATE_BASE_URL` consistently in the build and publication environments only when moving the whole feed.

## Application flow

The main process owns an `UpdateState` state machine and configures Electron `autoUpdater` with the fixed native Squirrel feed for the compiled Release or Nightly distribution, platform, and architecture. Automatic checks are delayed and quiet; Check for Updates lives in the macOS application menu and Windows/Linux Help menu. Linux opens the matching downloads page. A downloaded update cannot restart until the existing document lifecycle completes Save / Don't Save / Cancel confirmation. Cleanup remains deferred until `before-quit-for-update` begins finalization ahead of Electron's window teardown, so an earlier installation failure can restore ordinary guards without disconnecting the user's session; a committed exit still discards drafts the user chose not to save.

## Rollback

- Disable a workflow from the Actions page to stop automation without deleting configuration.
- Revert the release-preparation commit to restore the previous package and application identity behavior.
- A failed versioned build remains a private draft release. Fix the release workflow and rerun it for the existing tag; do not publish incomplete assets.
- Never delete or reuse a published version tag. Correct it with the next prerelease version.
- A failed Nightly build leaves the previous public Nightly in place. Roll back a bad published Nightly by republishing a known-good commit to the mutable `nightly` tag; never move or reuse a versioned release tag. Shift Nightly requires no release-channel data migration because it has a separate application identity and data root.
- If binary publication succeeds but update-feed publication fails, clients continue using the previous native feed. Recover from the original retained workflow artifacts with `publish-update-feed.sh`; do not rerun or clobber the now-public versioned release. Revert a bad `update-feeds` commit rather than editing an immutable version directory in place.

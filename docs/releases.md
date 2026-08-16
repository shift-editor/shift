# Desktop releases

Shift ships one versioned desktop product. Internal Rust crates and JavaScript packages are not released separately and retain independent component versions.

## Distribution states

| State     | Product identity | Bundle ID           | Data root       | Publication                   |
| --------- | ---------------- | ------------------- | --------------- | ----------------------------- |
| `release` | Shift            | `app.shift`         | `Shift`         | Draft, then GitHub prerelease |
| `nightly` | Shift Nightly    | `app.shift.nightly` | `Shift Nightly` | Rolling GitHub prerelease     |

`SHIFT_DISTRIBUTION` accepts only `release` or `nightly` during a build. A commit on `main` may produce a Nightly. Merging a Release Please pull request creates an alpha tag and a draft GitHub release. A complete Nightly matrix advances the mutable `nightly` tag and replaces the assets on one public prerelease; a failed matrix leaves the previous Nightly untouched. Nightly builds never promote themselves into versioned releases, and the release workflow rejects stable tags until the stable transition is deliberately enabled.

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

Release Please owns normal version changes. `.release-please-manifest.json` starts at `0.1.0-alpha.0`, so the first tagged release is `v0.1.0-alpha.1`. The initial changelog boundary is commit `788ba986410b4d2837e9d269ff8938b1dbc5aa9a`, immediately before the release foundation; older project history is not imported into the first release notes.

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
- `release-desktop.yml` is a reusable and manually dispatchable workflow that builds the draft alpha or beta release for macOS arm64/x64, Windows x64, and Linux x64. It builds the native bridge on each runner, smoke-tests the packaged app, uploads checksums and desktop artifacts, and only then publishes the GitHub prerelease. A failed build leaves the release private and draft.
- `nightly.yml` builds the same platform matrix as Shift Nightly on a schedule or by manual dispatch. Each platform keeps a 14-day workflow artifact for diagnostics. After every platform packages and smoke-tests successfully, a final job updates the mutable `nightly` tag and replaces the stable-name assets and checksums on the single public **Shift Nightly** prerelease. A failed matrix cannot alter the public Nightly.

The Release Please workflow uses `RELEASE_PLEASE_TOKEN` rather than the default workflow token so its generated pull requests trigger normal CI. The desktop build is called directly from the successful release-creation job rather than relying on a second GitHub event.

## GitHub secrets

| Secret                        | Purpose                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `RELEASE_PLEASE_TOKEN`        | Fine-grained personal access token allowed to create pull requests, tags, and releases and trigger workflows |
| `APPLE_CERTIFICATE`           | Base64-encoded Developer ID Application `.p12`                                                               |
| `APPLE_CERTIFICATE_PASSWORD`  | Password protecting the `.p12`                                                                               |
| `APPLE_ID`                    | Apple Developer account login used by `notarytool`                                                           |
| `APPLE_APP_SPECIFIC_PASSWORD` | Apple ID app-specific password, not the account password                                                     |
| `APPLE_TEAM_ID`               | Paid Apple Developer Program team ID                                                                         |

Do not put signing credentials in repository files, workflow inputs, artifacts, or logs. macOS release and Nightly jobs fail if signing credentials are absent; they never silently publish unsigned macOS builds. Windows builds remain unsigned until a certificate is acquired.

## Signing setup

1. In Keychain Access, export the Developer ID Application certificate and private key as a password-protected `.p12`.
2. Base64-encode the file without line wrapping and store it as `APPLE_CERTIFICATE`.
3. Create an Apple ID app-specific password for notarization.
4. Add all secrets under repository **Settings → Secrets and variables → Actions**.
5. Run `Nightly Desktop` manually and verify both `codesign` and stapler validation succeed.

## Rollback

- Disable a workflow from the Actions page to stop automation without deleting configuration.
- Revert the release-preparation commit to restore the previous package and application identity behavior.
- A failed versioned build remains a private draft release. Fix the release workflow and rerun it for the existing tag; do not publish incomplete assets.
- Never delete or reuse a published version tag. Correct it with the next prerelease version.
- A failed Nightly build leaves the previous public Nightly in place. Roll back a bad published Nightly by republishing a known-good commit to the mutable `nightly` tag; never move or reuse a versioned release tag. Shift Nightly requires no release-channel data migration because it has a separate application identity and data root.

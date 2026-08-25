# Code signing policy

## Current status

Shift's Windows artifacts are currently unsigned. This policy defines the controls that will apply to versioned Windows releases after the project is accepted for SignPath Foundation's open-source code-signing service. Nightly builds remain outside the initial signing scope.

For releases signed under this policy: Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).

## Signing scope

The signing scope is limited to Shift's versioned Windows release artifacts:

- the Shift application executable built from this repository; and
- the per-user NSIS installer containing that executable.

Signed files must identify the product as `Shift` and use the numeric version from the corresponding `vMAJOR.MINOR.PATCH` Git tag. Shift does not submit unrelated software, locally produced binaries, or Nightly artifacts for signing under this policy.

## Source and build integrity

Signed artifacts must:

1. originate from the public [`shift-editor/shift`](https://github.com/shift-editor/shift) repository;
2. be built by the repository's versioned release workflow on GitHub-hosted runners;
3. correspond to the exact immutable release tag being published;
4. pass the repository's required tests and packaged-application smoke test; and
5. be manually approved for signing before publication.

The SignPath GitHub integration verifies the workflow origin of submitted artifacts. Signing credentials are restricted to the release workflow and are never stored in source files, workflow artifacts, release assets, or logs.

## Team roles

The project currently has one maintainer, so the required roles are held by the same person:

- **Committer:** [Kostya Farber](https://github.com/kostyafarber)
- **Reviewer:** [Kostya Farber](https://github.com/kostyafarber)
- **Signing approver:** [Kostya Farber](https://github.com/kostyafarber)

Changes proposed by people without commit access require review by a committer. Changes to build workflows, release configuration, dependencies, or this policy receive the same review as application source changes. Every signing request requires an explicit decision by the signing approver.

## Privacy and network access

Shift does not include analytics, advertising, account services, cloud document storage, or usage telemetry. Font and Shift document contents remain on the user's computer unless the user exports or copies them through an explicit operating-system action.

Eligible packaged builds automatically request release metadata from Shift's HTTPS update feed shortly after startup and periodically while the application remains open. If an update is available, Shift downloads the package from the project's GitHub Releases or Cloudflare R2 distribution only after the user consents. These services receive the network information ordinarily exposed by an HTTPS request, such as the source IP address and user agent; Shift does not add font, document, or usage data to the request.

User-initiated actions may open the Shift release page in the default browser. No other project-operated network transfer is part of normal editor use.

## Reporting concerns

Report suspected signing-policy violations or compromised release artifacts privately to [Kostya Farber](mailto:kostya.farber@gmail.com). Report ordinary release problems through the [public issue tracker](https://github.com/shift-editor/shift/issues).

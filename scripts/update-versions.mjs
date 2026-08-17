/** Converts product SemVer to the NuGet-compatible form used by electron-winstaller. */
export function squirrelPackageVersion(version) {
  const [withoutBuildMetadata] = version.split("+");
  const [mainVersion, ...prerelease] = withoutBuildMetadata.split("-");
  return prerelease.length === 0
    ? mainVersion
    : `${mainVersion}-${prerelease.join("-").replaceAll(".", "")}`;
}

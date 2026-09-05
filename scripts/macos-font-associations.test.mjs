import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import test from "node:test";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, "..");
const configUrl = pathToFileURL(
  path.join(repositoryRoot, "apps/desktop/electron-builder.config.ts"),
).href;
const shiftDocumentTypeIdentifier = "app.shift.document.v2";
const sourceFontExtensions = ["ttf", "otf", "glyphs", "glyphspackage", "ufo", "designspace"];

async function loadMacosDocumentTypes(distribution) {
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      `import importedConfig from ${JSON.stringify(configUrl)}; const config = importedConfig.default ?? importedConfig; process.stdout.write(JSON.stringify(config.mac?.extendInfo?.CFBundleDocumentTypes));`,
    ],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        SHIFT_BUILD_ARCH: "x64",
        SHIFT_DISTRIBUTION: distribution,
      },
    },
  );

  return JSON.parse(stdout);
}

function findShiftDocumentType(documentTypes) {
  return documentTypes.find(({ LSItemContentTypes }) =>
    LSItemContentTypes?.includes(shiftDocumentTypeIdentifier),
  );
}

function findExtensionType(documentTypes, extension) {
  return documentTypes.find(({ CFBundleTypeExtensions }) =>
    CFBundleTypeExtensions?.includes(extension),
  );
}

test("macOS Release owns Shift documents and alternates for font sources", async () => {
  const documentTypes = await loadMacosDocumentTypes("release");

  assert.equal(findShiftDocumentType(documentTypes)?.LSHandlerRank, "Owner");
  for (const extension of sourceFontExtensions) {
    const sourceType = findExtensionType(documentTypes, extension);
    assert.equal(sourceType?.CFBundleTypeRole, "Viewer", `unexpected .${extension} role`);
    assert.equal(sourceType?.LSHandlerRank, "Alternate", `unexpected .${extension} rank`);
  }

  const binaryFontType = findExtensionType(documentTypes, "ttf");
  assert.deepEqual(binaryFontType?.LSItemContentTypes, [
    "public.truetype-ttf-font",
    "public.opentype-font",
  ]);
  assert.equal(findExtensionType(documentTypes, "ufo")?.LSTypeIsPackage, true);
  assert.equal(findExtensionType(documentTypes, "glyphspackage")?.LSTypeIsPackage, true);
});

test("macOS Nightly remains alternate for Shift documents and font sources", async () => {
  const documentTypes = await loadMacosDocumentTypes("nightly");

  assert.equal(findShiftDocumentType(documentTypes)?.LSHandlerRank, "Alternate");
  for (const extension of sourceFontExtensions) {
    assert.equal(
      findExtensionType(documentTypes, extension)?.LSHandlerRank,
      "Alternate",
      `unexpected .${extension} rank`,
    );
  }
});

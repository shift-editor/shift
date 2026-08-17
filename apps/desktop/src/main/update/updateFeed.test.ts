import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseUpdateEnvelope, validateUpdateFeedSource } from "./updateFeed";
import type { Update, UpdateFeedTarget } from "./types";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const target: UpdateFeedTarget = {
  distribution: "release",
  version: "0.1.0-alpha.1",
  platform: "darwin",
  architecture: "arm64",
  publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
};
const payload = {
  schemaVersion: 1,
  distribution: "release",
  version: "0.1.0-alpha.2",
  publishedAt: "2026-08-16T12:00:00.000Z",
  releaseUrl: "https://github.com/shift-editor/shift/releases/tag/v0.1.0-alpha.2",
  artifacts: [
    {
      platform: "darwin",
      architecture: "arm64",
      feedUrl:
        "https://shift-editor.github.io/shift/updates/release/0.1.0-alpha.2/darwin/arm64/RELEASES.json",
      url: "https://github.com/shift-editor/shift/releases/download/v0.1.0-alpha.2/Shift.zip",
      sha256: "a".repeat(64),
    },
  ],
};

function envelope(value: object, key: KeyObject = privateKey): string {
  const bytes = Buffer.from(JSON.stringify(value));
  return JSON.stringify({
    payload: bytes.toString("base64"),
    signature: sign(null, bytes, key).toString("base64"),
  });
}

describe("signed application update descriptors", () => {
  it("selects the exact same-channel platform artifact", () => {
    const update = parseUpdateEnvelope(envelope(payload), target);

    expect(update?.version).toBe("0.1.0-alpha.2");
    expect(update?.artifact.platform).toBe("darwin");
    expect(update?.artifact.architecture).toBe("arm64");
  });

  it("binds the native macOS feed to the signed artifact", () => {
    const update = parseUpdateEnvelope(envelope(payload), target)!;
    const feed = JSON.stringify({
      url: update.artifact.url,
      name: update.version,
      notes: "",
      pub_date: update.publishedAt,
      sha256: update.artifact.sha256,
      size: 1024,
    });

    expect(() => validateUpdateFeedSource(update, feed)).not.toThrow();
    expect(() => validateUpdateFeedSource(update, feed.replace("Shift.zip", "Other.zip"))).toThrow(
      "does not match the signed descriptor",
    );
  });

  it("binds the Windows RELEASES entry to the signed artifact", () => {
    const update: Update = {
      ...parseUpdateEnvelope(envelope(payload), target)!,
      artifact: { ...payload.artifacts[0], platform: "win32", architecture: "x64" },
    };
    const releases = `${"A".repeat(40)} ${update.artifact.url} 1024\n`;

    expect(() => validateUpdateFeedSource(update, releases)).not.toThrow();
    expect(() =>
      validateUpdateFeedSource(
        update,
        releases.replace(update.artifact.url, "https://example.com/bad.nupkg"),
      ),
    ).toThrow("does not match the signed descriptor");
  });

  it("returns no candidate for a non-increasing version", () => {
    const current = { ...payload, version: target.version };

    expect(parseUpdateEnvelope(envelope(current), target)).toBeNull();
  });

  it("rejects a cross-channel descriptor", () => {
    const nightly = { ...payload, distribution: "nightly" };

    expect(() => parseUpdateEnvelope(envelope(nightly), target)).toThrow(
      "expected release, received nightly",
    );
  });

  it("rejects a descriptor signed by another key", () => {
    const otherKey = generateKeyPairSync("ed25519").privateKey;

    expect(() => parseUpdateEnvelope(envelope(payload, otherKey), target)).toThrow(
      "signature is invalid",
    );
  });

  it("rejects duplicate artifacts for one platform", () => {
    const duplicate = { ...payload, artifacts: [payload.artifacts[0], payload.artifacts[0]] };

    expect(() => parseUpdateEnvelope(envelope(duplicate), target)).toThrow(
      "Expected one darwin-arm64 update artifact, found 2",
    );
  });

  it("rejects non-HTTPS artifact URLs", () => {
    const artifact = { ...payload.artifacts[0], url: "http://example.com/Shift.zip" };
    const unsafe = { ...payload, artifacts: [artifact] };

    expect(() => parseUpdateEnvelope(envelope(unsafe), target)).toThrow("Expected an HTTPS URL");
  });
});

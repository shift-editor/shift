import { createPublicKey, verify } from "node:crypto";
import semver from "semver";
import { z } from "zod";
import type { Update, UpdateFeedTarget } from "./types";

const MAX_ENVELOPE_BYTES = 128 * 1024;
const base64Schema = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/);
const httpsUrlSchema = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === "https:", "Expected an HTTPS URL");

const artifactSchema = z
  .object({
    platform: z.enum(["darwin", "win32"]),
    architecture: z.enum(["arm64", "x64"]),
    feedUrl: httpsUrlSchema,
    url: httpsUrlSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

const payloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    distribution: z.enum(["release", "nightly"]),
    version: z.string(),
    publishedAt: z.string().datetime({ offset: true }),
    releaseUrl: httpsUrlSchema,
    artifacts: z.array(artifactSchema).min(1),
  })
  .strict();

const envelopeSchema = z
  .object({
    payload: base64Schema,
    signature: base64Schema,
  })
  .strict();

const macFeedSchema = z
  .object({
    url: httpsUrlSchema,
    name: z.string(),
    notes: z.string(),
    pub_date: z.string().datetime({ offset: true }),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    size: z.number().int().positive(),
  })
  .strict();

/** Loads and verifies the current candidate for one compiled Shift distribution. */
export async function loadUpdate(
  feedBaseUrl: string,
  target: UpdateFeedTarget,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): Promise<Update | null> {
  const baseUrl = feedBaseUrl.endsWith("/") ? feedBaseUrl : `${feedBaseUrl}/`;
  const descriptorUrl = new URL(`${target.distribution}/channel.json`, baseUrl);
  if (descriptorUrl.protocol !== "https:") {
    throw new Error("Update feed must use HTTPS");
  }

  const response = await fetcher(descriptorUrl, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Update feed returned HTTP ${response.status}`);
  }

  const source = await response.text();
  if (Buffer.byteLength(source) > MAX_ENVELOPE_BYTES) {
    throw new Error("Update feed exceeded the maximum descriptor size");
  }

  return parseUpdateEnvelope(source, target);
}

/** Confirms the native Squirrel feed still names the artifact bound by the signed descriptor. */
export async function validateUpdateFeed(
  update: Update,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): Promise<void> {
  const feedUrl =
    update.artifact.platform === "darwin"
      ? update.artifact.feedUrl
      : new URL("RELEASES", `${update.artifact.feedUrl.replace(/\/$/, "")}/`).toString();
  const response = await fetcher(feedUrl, {
    cache: "no-store",
    headers: { Accept: update.artifact.platform === "darwin" ? "application/json" : "text/plain" },
  });
  if (!response.ok) throw new Error(`Native update feed returned HTTP ${response.status}`);

  const source = await response.text();
  if (Buffer.byteLength(source) > MAX_ENVELOPE_BYTES) {
    throw new Error("Native update feed exceeded the maximum size");
  }

  validateUpdateFeedSource(update, source);
}

/** Validates the native feed response against its signed update candidate. */
export function validateUpdateFeedSource(update: Update, source: string): void {
  switch (update.artifact.platform) {
    case "darwin": {
      const feed = macFeedSchema.parse(JSON.parse(source));
      if (
        feed.name !== update.version ||
        feed.url !== update.artifact.url ||
        feed.sha256 !== update.artifact.sha256
      ) {
        throw new Error("macOS update feed does not match the signed descriptor");
      }
      return;
    }
    case "win32": {
      const lines = source.trim().split("\n");
      if (lines.length !== 1) throw new Error("Windows update feed must contain one full package");

      const fields = lines[0]!.trim().split(/\s+/);
      if (
        fields.length !== 3 ||
        !/^[A-Fa-f0-9]{40}$/.test(fields[0]!) ||
        fields[1] !== update.artifact.url ||
        !/^\d+$/.test(fields[2]!)
      ) {
        throw new Error("Windows update feed does not match the signed descriptor");
      }
      return;
    }
  }
}

/** Verifies a signed descriptor and selects its exact platform artifact. */
export function parseUpdateEnvelope(source: string, target: UpdateFeedTarget): Update | null {
  const envelope = envelopeSchema.parse(JSON.parse(source));
  const payloadBytes = decodeBase64("payload", envelope.payload);
  const signature = decodeBase64("signature", envelope.signature);
  const publicKey = createPublicKey({
    key: decodeBase64("public key", target.publicKey),
    format: "der",
    type: "spki",
  });

  if (!verify(null, payloadBytes, publicKey, signature)) {
    throw new Error("Update descriptor signature is invalid");
  }

  const payload = payloadSchema.parse(JSON.parse(payloadBytes.toString("utf8")));
  if (payload.distribution !== target.distribution) {
    throw new Error(
      `Update distribution mismatch: expected ${target.distribution}, received ${payload.distribution}`,
    );
  }

  if (!semver.valid(payload.version) || !semver.valid(target.version)) {
    throw new Error("Update descriptor or installed application has an invalid semantic version");
  }

  if (!semver.gt(payload.version, target.version)) return null;

  const artifacts = payload.artifacts.filter(
    (artifact) =>
      artifact.platform === target.platform && artifact.architecture === target.architecture,
  );
  if (artifacts.length !== 1) {
    throw new Error(
      `Expected one ${target.platform}-${target.architecture} update artifact, found ${artifacts.length}`,
    );
  }

  return {
    distribution: payload.distribution,
    version: payload.version,
    publishedAt: payload.publishedAt,
    releaseUrl: payload.releaseUrl,
    artifact: artifacts[0]!,
  };
}

function decodeBase64(name: string, value: string): Buffer {
  const decoded = Buffer.from(value, "base64");
  const normalizedInput = value.replace(/=+$/, "");
  const normalizedOutput = decoded.toString("base64").replace(/=+$/, "");
  if (decoded.length === 0 || normalizedInput !== normalizedOutput) {
    throw new Error(`Update descriptor ${name} is not valid base64`);
  }

  return decoded;
}

import { verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import semver from "semver";

/** Requires a proposed channel version to exceed the existing signed pointer. */
export async function assertChannelAdvances(channelPath, distribution, nextVersion, publicKey) {
  let source;
  try {
    source = await readFile(channelPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }

  const envelope = JSON.parse(source);
  if (typeof envelope.payload !== "string" || typeof envelope.signature !== "string") {
    throw new Error("Existing update channel has an invalid envelope");
  }
  const payloadBytes = decodeBase64("channel payload", envelope.payload);
  const signature = decodeBase64("channel signature", envelope.signature);
  if (!verify(null, payloadBytes, publicKey, signature)) {
    throw new Error("Existing update channel signature is invalid");
  }

  const payload = JSON.parse(payloadBytes.toString("utf8"));
  if (payload.distribution !== distribution) {
    throw new Error(`Existing update channel distribution is not ${distribution}`);
  }
  if (!semver.valid(payload.version) || !semver.gt(nextVersion, payload.version)) {
    throw new Error(
      `Update channel must advance from ${payload.version} to a newer version, received ${nextVersion}`,
    );
  }
}

function decodeBase64(name, value) {
  const decoded = Buffer.from(value, "base64");
  if (
    decoded.length === 0 ||
    decoded.toString("base64").replace(/=+$/, "") !== value.replace(/=+$/, "")
  ) {
    throw new Error(`Update ${name} is not valid base64`);
  }
  return decoded;
}

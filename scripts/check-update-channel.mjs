import { createPublicKey } from "node:crypto";
import { assertChannelAdvances } from "./update-channel.mjs";

const [channelPath, distribution, version] = process.argv.slice(2);
if (!channelPath || !distribution || !version) {
  throw new Error(
    "Usage: check-update-channel.mjs <channel-file> <distribution> <proposed-version>",
  );
}
if (distribution !== "release" && distribution !== "nightly") {
  throw new Error(`Expected release or nightly distribution, received: ${distribution}`);
}

const publicKeySource = process.env.SHIFT_UPDATE_PUBLIC_KEY;
if (!publicKeySource) throw new Error("SHIFT_UPDATE_PUBLIC_KEY is required");
const publicKey = createPublicKey({
  key: Buffer.from(publicKeySource, "base64"),
  format: "der",
  type: "spki",
});
await assertChannelAdvances(channelPath, distribution, version, publicKey);

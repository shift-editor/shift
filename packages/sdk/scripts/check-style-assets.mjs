import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stylePath = resolve(packageRoot, "dist/style.css");
const style = await readFile(stylePath, "utf8");
const urls = [...style.matchAll(/url\((?:"|')?([^"')]+)(?:"|')?\)/g)].map((match) => match[1]);

if (urls.length === 0) throw new Error("SDK stylesheet does not reference any packaged assets");

for (const url of urls) {
  if (/^(?:data:|https?:)/.test(url)) continue;
  if (url.startsWith("/")) throw new Error(`SDK stylesheet contains an absolute asset URL: ${url}`);

  await access(resolve(dirname(stylePath), url));
}

console.log(`Verified ${urls.length} relative SDK stylesheet assets`);

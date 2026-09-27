import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stylePath = resolve(packageRoot, "dist/style.css");
const fontsPath = resolve(packageRoot, "dist/fonts.css");
const [style, fonts] = await Promise.all([
  readFile(stylePath, "utf8"),
  readFile(fontsPath, "utf8"),
]);

if (style.includes("@font-face"))
  throw new Error("style.css must not register fonts; use fonts.css");
if (/(^|[},])\*,:before,:after,::backdrop\{/.test(style)) {
  throw new Error("style.css contains an unscoped universal Tailwind reset");
}
if (/var\(--(?:color|spacing|radius|text)-?[a-z0-9-]*[,)]/.test(style)) {
  throw new Error("style.css reads an unprefixed theme variable a host could override");
}

const urls = [...fonts.matchAll(/url\((?:"|')?([^"')]+)(?:"|')?\)/g)].map((match) => match[1]);
if (urls.length === 0) throw new Error("fonts.css does not reference any packaged font assets");

for (const url of urls) {
  if (/^(?:data:|https?:)/.test(url)) continue;
  if (url.startsWith("/")) throw new Error(`fonts.css contains an absolute asset URL: ${url}`);

  await access(resolve(dirname(fontsPath), url));
}

console.log(`Verified scoped SDK styles and ${urls.length} relative font assets`);

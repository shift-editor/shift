const entries = ["index.js", "ui.js"];

for (const entry of entries) {
  await import(new URL(`../dist/${entry}`, import.meta.url));
}

console.log(`Verified SSR-safe SDK imports (${entries.join(", ")})`);

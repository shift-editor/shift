// Profiles the packaged desktop app the way a user drives it, and prints what to fix.
//
// Launches a packaged build (never the dev server: React's development build
// dominates its profiles), opens a font and glyph, runs a scenario with real
// input, then reports frame times, React renders per commit with the hook or
// context that started each one, and a source-mapped CPU profile.
//
// Build first with `pnpm profile:build` so the bundle keeps source maps and
// component names. See .agents/skills/perf/SKILL.md.
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(import.meta.dirname, "..");
const desktopRoot = path.join(repoRoot, "apps/desktop");

const { values: options } = parseArgs({
  options: {
    font: { type: "string" },
    glyph: { type: "string", default: "A" },
    scenario: { type: "string", default: "scrub" },
    axis: { type: "string", default: "Weight" },
    seconds: { type: "string", default: "8" },
    app: { type: "string" },
    cpu: { type: "string" },
    "keep-open": { type: "boolean", default: false },
  },
});

// `editor` scenarios run on an open glyph with the render counter installed.
const SCENARIOS = {
  scrub: { run: scrub, editor: true },
  undo: { run: undoRedo, editor: true },
  open: { run: openFont, editor: false },
};
if (!options.font) usage("--font is required");
if (!SCENARIOS[options.scenario]) usage(`unknown scenario ${options.scenario}`);

const executablePath = options.app ? path.resolve(options.app) : packagedExecutable();
const fontPath = path.resolve(options.font);
const seconds = Number(options.seconds);

// A throwaway profile keeps runs reproducible and leaves the user's recents and
// recovery documents alone.
const userDataDir = mkdtempSync(path.join(os.tmpdir(), "shift-profile-"));
// Packaged builds disable Node's inspector fuse, so Playwright's Electron launcher
// cannot attach. Chromium's remote debugging port still works.
const port = String(9300 + Math.floor(Math.random() * 500));
const launchedAt = Date.now();
const appOutput = [];
const app = spawn(
  executablePath,
  [`--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`, fontPath],
  {
    // Main logs per-page atlas acquisition timings when this is set.
    env: { ...process.env, SHIFT_PROFILE_SLUG_ATLAS: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
for (const stream of [app.stdout, app.stderr]) {
  stream.on("data", (chunk) => appOutput.push(...String(chunk).split("\n").filter(Boolean)));
}
const browser = await connect(port);

try {
  const page = await documentWindow(browser);
  const scenario = SCENARIOS[options.scenario];
  if (scenario.editor) {
    await page.waitForFunction(() => window.shift?.font, null, { timeout: 120_000 });
    await openGlyphByName(page, options.glyph);

    // React reads the DevTools hook once, at startup, so install it and reload.
    await page.context().addInitScript({ content: `(${installRenderCounter.toString()})()` });
    await page.reload();
    await page.waitForFunction(() => window.shift?.font && window.__shiftRenders, null, {
      timeout: 120_000,
    });
    await waitForEditor(page);
  }

  const report = await scenario.run(page);
  printReport(report);
  if (report.cpuProfile) {
    const profilePath = options.cpu ?? path.join(userDataDir, `${options.scenario}.cpuprofile`);
    writeFileSync(profilePath, JSON.stringify(report.cpuProfile));
    console.log(`\nCPU profile: ${profilePath} (open in Chrome DevTools > Performance)`);
    printCpuProfile(report.cpuProfile);
  }
  if (options["keep-open"]) await new Promise(() => {});
} finally {
  if (!options["keep-open"]) {
    await browser.close();
    app.kill();
  }
}

async function connect(port) {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch (error) {
      if (Date.now() > deadline || app.exitCode !== null) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

async function documentWindow(browser) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const page = browser
      .contexts()[0]
      ?.pages()
      .find((candidate) => /#\/(home|editor)/.test(candidate.url()));
    if (page) return page;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("the document window never opened");
}

/** Drags an axis slider end to end for `seconds` with real pointer events. */
async function scrub(page) {
  const sliders = page.getByRole("slider");
  if ((await sliders.count()) === 0) {
    await page.getByRole("tab", { name: "Variations" }).click();
  }
  const thumb = page.getByRole("slider", { name: options.axis });
  await thumb.waitFor({ timeout: 10_000 });
  await thumb.scrollIntoViewIfNeeded();
  const track = await thumb.locator("xpath=ancestor::*[@data-orientation][1]").boundingBox();
  const handle = await thumb.boundingBox();
  if (!track || !handle) throw new Error(`the ${options.axis} slider is not visible`);

  return measure(page, async () => {
    const y = handle.y + handle.height / 2;
    const left = track.x + 4;
    const right = track.x + track.width - 4;
    let x = handle.x + handle.width / 2;
    let direction = 1;
    await page.mouse.move(x, y);
    await page.mouse.down();
    const end = Date.now() + seconds * 1000;
    while (Date.now() < end) {
      x += (direction * track.width) / 60;
      if (x > right || x < left) {
        direction = -direction;
        x = Math.min(right, Math.max(left, x));
      }
      await page.mouse.move(x, y);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
  });
}

/** Runs `drive` while recording frames, React commits, and a CPU profile. */
async function measure(page, drive) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
  await page.evaluate(() => {
    window.__shiftRenders.start();
    window.__shiftFrames = [];
    let last = performance.now();
    const tick = (now) => {
      window.__shiftFrames.push(now - last);
      last = now;
      if (window.__shiftFrames) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await cdp.send("Profiler.start");
  const result = await drive();
  const { profile } = await cdp.send("Profiler.stop");
  const { frames, renders } = await page.evaluate(() => {
    const frames = window.__shiftFrames.slice(5);
    window.__shiftFrames = null;
    return { frames, renders: window.__shiftRenders.stop() };
  });
  return { ...result, frames, renders, cpuProfile: profile };
}

/** Times launch to font loaded, first grid frame, and every glyph resident. */
async function openFont(page) {
  const milestones = {};
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline && !milestones["all glyphs resident"]) {
    const state = await page
      .evaluate(() => {
        const canvas = document.querySelector("[data-grid-readiness]");
        return {
          loaded: window.shift?.font.loadedCell.peek() ?? false,
          readiness: canvas?.dataset.gridReadiness ?? null,
          resident: canvas?.dataset.fullyResident === "true",
          glyphs: canvas?.dataset.residentGlyphCount ?? null,
        };
      })
      .catch(() => ({}));
    const elapsed = Date.now() - launchedAt;
    if (state.loaded) milestones["font loaded"] ??= elapsed;
    if (state.readiness && state.readiness !== "Initial")
      milestones["first grid frame"] ??= elapsed;
    if (state.resident) milestones["all glyphs resident"] ??= `${elapsed} (${state.glyphs} glyphs)`;
    await page.waitForTimeout(50);
  }
  return { milestones };
}

/** Edits every point of the glyph, then times repeated undo and redo round trips. */
async function undoRedo(page) {
  const samples = Number(options.seconds);
  return measure(page, async () => {
    const times = await page.evaluate(async (count) => {
      const editor = window.shift.editor;
      editor.selectAll();
      const pointIds = editor.selection.ids.filter((id) => id.startsWith("point"));
      const layer = editor.layerForGeometry({ points: pointIds });
      if (!layer) throw new Error("the glyph has no editable layer");
      const coordinator = editor.font.editCoordinator;
      const undo = [];
      const redo = [];
      for (let index = 0; index < count; index++) {
        const selected = new Set(pointIds);
        const updates = layer.geometry.allPoints
          .filter((point) => selected.has(point.id))
          .map((point) => ({ kind: "point", id: point.id, x: point.x + 1, y: point.y }));
        layer.previewPositionPatch(updates);
        layer.applyPositionPatch(updates);
        await coordinator.settled();

        let start = performance.now();
        await coordinator.undo();
        undo.push(performance.now() - start);
        start = performance.now();
        await coordinator.redo();
        redo.push(performance.now() - start);
      }
      return { undo, redo, points: pointIds.length };
    }, samples);
    return { timings: { [`undo (${times.points} points)`]: times.undo, redo: times.redo } };
  });
}

function printReport({ frames, renders, milestones, timings }) {
  console.log(`\n${options.scenario} · ${path.basename(fontPath)} · ${options.glyph}`);
  if (milestones) {
    for (const [name, at] of Object.entries(milestones))
      console.log(`${String(at).padStart(8)}ms  ${name}`);
    const atlas = appOutput.filter((line) => line.includes("slug-atlas"));
    if (atlas.length) console.log(`\nAtlas acquisition (main process):\n${atlas.join("\n")}`);
    return;
  }
  for (const [name, values] of Object.entries(timings ?? {})) {
    const sorted = [...values].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    console.log(
      `${name}: median ${median.toFixed(0)}ms, max ${sorted.at(-1).toFixed(0)}ms over ${values.length}`,
    );
  }
  const sorted = [...frames].sort((a, b) => a - b);
  const at = (q) => sorted[Math.floor(q * (sorted.length - 1))]?.toFixed(1);
  const slow = frames.filter((frame) => frame > 33.4).length;
  console.log(
    `frames ${frames.length}: p50 ${at(0.5)}ms  p90 ${at(0.9)}ms  p99 ${at(0.99)}ms  over 33ms: ${slow}`,
  );
  console.log(
    `react: ${renders.commits} commits, ${renders.perCommit} component renders per commit`,
  );
  console.log("\nRenders started by (component ← what changed):");
  for (const [start, count] of renders.starts) console.log(String(count).padStart(6), start);
}

function printCpuProfile(profile) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map();
  for (const node of profile.nodes)
    for (const child of node.children ?? []) parents.set(child, node.id);

  const mapper = sourceMapper(profile);
  const labels = new Map();
  const label = (id) => {
    if (!labels.has(id)) labels.set(id, mapper(nodes.get(id).callFrame));
    return labels.get(id);
  };

  const self = new Map();
  const inclusive = new Map();
  let busy = 0;
  profile.samples.forEach((id, index) => {
    const own = label(id);
    if (own === "(idle)" || own === "(program)") return;
    const time = profile.timeDeltas[index] ?? 0;
    busy += time;
    self.set(own, (self.get(own) ?? 0) + time);
    const seen = new Set();
    for (let current = id; current; current = parents.get(current)) {
      const name = label(current);
      if (seen.has(name)) continue;
      seen.add(name);
      inclusive.set(name, (inclusive.get(name) ?? 0) + time);
    }
  });

  const top = (map, count, keep = () => true) =>
    [...map]
      .filter(([name]) => keep(name))
      .sort((a, b) => b[1] - a[1])
      .slice(0, count)
      .map(([name, time]) => `${String(Math.round(time / 1000)).padStart(6)}ms  ${name}`)
      .join("\n");
  const ownCode = (name) => !name.includes("node_modules/") && /\.(tsx?|rs)\b/.test(name);

  console.log(`\nmain thread busy ${Math.round(busy / 1000)}ms of ${seconds * 1000}ms`);
  console.log(`\nTop self time:\n${top(self, 15)}`);
  console.log(`\nTop inclusive time in Shift code:\n${top(inclusive, 25, ownCode)}`);
}

/** Maps minified renderer frames back to source when the build kept source maps. */
function sourceMapper(profile) {
  const { TraceMap, originalPositionFor } = require("@jridgewell/trace-mapping");
  const assets = path.join(desktopRoot, ".vite/renderer/main_window/assets");
  const maps = new Map();
  const mapFor = (url) => {
    const file = path.basename(new URL(url).pathname);
    if (!maps.has(file)) {
      const mapPath = path.join(assets, `${file}.map`);
      maps.set(file, existsSync(mapPath) ? new TraceMap(readFileSync(mapPath, "utf8")) : null);
    }
    return maps.get(file);
  };
  if (
    !profile.nodes.some((node) => node.callFrame.url.endsWith(".js") && mapFor(node.callFrame.url))
  ) {
    console.log("\n(no source maps found: build with `pnpm profile:build` for source names)");
  }

  return ({ functionName, url, lineNumber, columnNumber }) => {
    if (!url) return functionName || "(native)";
    const map = url.endsWith(".js") ? mapFor(url) : null;
    if (!map) return `${functionName || "(anonymous)"} ${path.basename(url)}:${lineNumber + 1}`;
    const original = originalPositionFor(map, { line: lineNumber + 1, column: columnNumber });
    const source = (original.source ?? "?")
      .replace(/^.*node_modules\/(\.pnpm\/[^/]+\/node_modules\/)?/, "node_modules/")
      .replace(/^(\.\.\/)+/, "");
    return `${original.name ?? functionName ?? "(anonymous)"} ${source}:${original.line}`;
  };
}

/**
 * Counts component renders per React commit, attributing each re-rendered
 * subtree to the hook state or context change that started it. Runs in the page.
 */
function installRenderCounter() {
  const COMPONENT_TAGS = new Set([0, 1, 11, 14, 15]);
  const PERFORMED_WORK = 1;
  const starts = new Map();
  const state = { active: false, commits: 0, renders: 0 };
  const nameOf = (fiber) => {
    const type = fiber.type;
    if (!type || typeof type === "string") return null;
    const inner = type.render || type.type || type;
    return type.displayName || inner.displayName || inner.name || null;
  };
  const contextName = (dependency) => {
    if (dependency.context.displayName) return dependency.context.displayName;
    const value = dependency.memoizedValue;
    if (value && typeof value === "object") return `{${Object.keys(value).slice(0, 4).join(",")}}`;
    return typeof value;
  };
  const reasons = (fiber) => {
    const previous = fiber.alternate;
    const found = [];
    // Hook slots, in order. useSignalState (useSyncExternalStore) takes two slots.
    if (fiber.tag !== 1) {
      let a = previous.memoizedState;
      let b = fiber.memoizedState;
      for (let slot = 0; a && b && slot < 100; slot++) {
        const value = b.memoizedState;
        const isEffect = value && typeof value === "object" && "deps" in value && "create" in value;
        if (!isEffect && b.queue && !Object.is(a.memoizedState, value)) found.push(`hook#${slot}`);
        a = a.next;
        b = b.next;
      }
    }
    let a = previous.dependencies?.firstContext;
    let b = fiber.dependencies?.firstContext;
    for (; a && b; a = a.next, b = b.next) {
      if (!Object.is(a.memoizedValue, b.memoizedValue)) found.push(`context ${contextName(b)}`);
    }
    return found.join(" ") || "?";
  };
  // React leaves PerformedWork set on fibers in subtrees it skipped, so only walk
  // into children it reconciled this commit (their child pointer changed).
  const visit = (first, parentRendered) => {
    for (let fiber = first; fiber; fiber = fiber.sibling) {
      const mounted = !fiber.alternate;
      const isComponent = COMPONENT_TAGS.has(fiber.tag);
      const rendered = isComponent && (mounted || (fiber.flags & PERFORMED_WORK) !== 0);
      if (rendered) {
        state.renders++;
        if (!parentRendered) {
          const key = `${nameOf(fiber) ?? "(anonymous)"}  ←  ${mounted ? "mount" : reasons(fiber)}`;
          starts.set(key, (starts.get(key) ?? 0) + 1);
        }
      }
      if (fiber.child && (mounted || fiber.child !== fiber.alternate.child)) {
        visit(fiber.child, isComponent ? rendered : parentRendered);
      }
    }
  };

  const hook = (window.__REACT_DEVTOOLS_GLOBAL_HOOK__ ??= {
    renderers: new Map(),
    supportsFiber: true,
    inject(renderer) {
      const id = this.renderers.size + 1;
      this.renderers.set(id, renderer);
      return id;
    },
    onScheduleFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
  });
  hook.onCommitFiberRoot = (_id, root) => {
    if (!state.active) return;
    state.commits++;
    const current = root.current;
    if (current.alternate && current.child === current.alternate.child) return;
    visit(current.child, false);
  };
  window.__shiftRenders = {
    start() {
      starts.clear();
      Object.assign(state, { active: true, commits: 0, renders: 0 });
    },
    stop() {
      state.active = false;
      return {
        commits: state.commits,
        perCommit: Math.round(state.renders / Math.max(1, state.commits)),
        starts: [...starts].sort((a, b) => b[1] - a[1]).slice(0, 25),
      };
    },
  };
}

async function openGlyphByName(page, name) {
  const glyphId = await page.evaluate(async (glyphName) => {
    const font = window.shift.font;
    const record = font.glyphRecords().find((glyph) => glyph.name === glyphName);
    if (!record) throw new Error(`no glyph named ${glyphName}`);
    await font.loadGlyph(record.id);
    window.location.hash = `#/editor/${encodeURIComponent(record.id)}`;
    return record.id;
  }, name);
  await page.waitForURL(new RegExp(`#/editor/${encodeURIComponent(glyphId)}$`));
  await waitForEditor(page);
}

async function waitForEditor(page) {
  await page.getByTestId("editor-shell").waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);
}

function packagedExecutable() {
  const out = path.join(desktopRoot, "out", `${process.platform}-${process.arch}`);
  const candidates =
    {
      linux: [path.join(out, "linux-unpacked/shift")],
      darwin: readdirSafe(out)
        .filter((dir) => dir.startsWith("mac"))
        .map((dir) => path.join(out, dir, "Shift.app/Contents/MacOS/Shift")),
      win32: [path.join(out, "win-unpacked/Shift.exe")],
    }[process.platform] ?? [];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) usage(`no packaged app in ${out}; run \`pnpm profile:build\` or pass --app`);
  return found;
}

function readdirSafe(directory) {
  return existsSync(directory) ? readdirSync(directory) : [];
}

function usage(problem) {
  console.error(`${problem}

Usage: pnpm profile:desktop --font <path> [--glyph A] [--scenario scrub] [--axis Weight]
                            [--seconds 8] [--cpu out.cpuprofile] [--app <executable>] [--keep-open]`);
  process.exit(1);
}

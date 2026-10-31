// Fails when a fast task starts depending on a slow build again. typecheck once
// waited on the release shift-bridge and wasm builds for their declarations, so
// any Rust change cost about 97 s before a type was checked. `pnpm typecheck`
// now runs the declaration tasks (`shift-bridge#types`, `@shift/wasm#types`)
// first and typecheck takes their output as inputs. See the perf skill's
// "build and check loop" section.
import { execFileSync } from "node:child_process";
import process from "node:process";

/** Each rule: a turbo run, and the tasks its graph must not contain. */
const rules = [
  {
    run: ["typecheck"],
    forbidden: [
      "shift-bridge#build",
      "shift-bridge#build:debug",
      "shift-bridge#build:e2e",
      "@shift/wasm#build",
      "@shift/wasm#build:debug",
      "@shift/wasm#build:e2e",
    ],
    why: "typecheck needs only declarations; take them as inputs from shift-bridge#types or @shift/wasm#types",
  },
];

let failed = false;
for (const rule of rules) {
  const plan = JSON.parse(
    execFileSync("pnpm", ["exec", "turbo", "run", ...rule.run, "--dry=json"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }),
  );
  const tasks = new Set(plan.tasks.map((task) => task.taskId));
  for (const task of rule.forbidden.filter((id) => tasks.has(id))) {
    console.error(`turbo run ${rule.run.join(" ")} includes ${task}: ${rule.why}`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log("Task graph: typecheck and app builds skip the slow builds.");

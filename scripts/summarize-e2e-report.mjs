/**
 * Summarizes a Playwright JSON report: failed, flaky (passed only on retry), and slow tests.
 *
 * Writes Markdown to `$GITHUB_STEP_SUMMARY` when set (stdout otherwise) and emits a GitHub
 * `::warning` annotation for each flaky test so retry passes stay visible on green runs.
 *
 * Usage: node scripts/summarize-e2e-report.mjs <report.json> [--slow-ms=20000]
 */
import fs from "node:fs";

const [reportPath, ...options] = process.argv.slice(2);
if (!reportPath) {
  console.error("Usage: summarize-e2e-report.mjs <report.json> [--slow-ms=20000]");
  process.exit(2);
}

const slowMs = Number(
  options.find((option) => option.startsWith("--slow-ms="))?.slice(10) ?? 20_000,
);
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const tests = collectTests(report);

const failed = tests.filter((test) => test.status === "unexpected");
const flaky = tests.filter((test) => test.status === "flaky");
const slow = tests
  .filter((test) => test.duration >= slowMs)
  .sort((a, b) => b.duration - a.duration)
  .slice(0, 15);

for (const test of flaky) {
  console.info(
    `::warning file=apps/desktop/e2e/${test.file},line=${test.line},title=Flaky E2E test::` +
      `[${test.project}] ${test.title} passed only after ${test.attempts - 1} retry`,
  );
}

const summary = [
  "## Desktop E2E results",
  "",
  table("Project", ["Passed", "Flaky", "Failed", "Skipped"], countsByProject(tests)),
  "",
  section("Failed", failed, (test) => test.error),
  section("Flaky — passed only on retry", flaky, (test) => test.error),
  section(`Slow — at least ${slowMs / 1000} s`, slow, (test) => `${formatSeconds(test.duration)}`),
].join("\n");

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
} else {
  console.info(summary);
}

function collectTests(json) {
  const collected = [];
  const visit = (suite, file) => {
    const suiteFile = suite.file ?? file;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        const results = test.results ?? [];
        const firstFailure = results.find((result) => result.status !== "passed");
        collected.push({
          file: suiteFile,
          line: spec.line,
          title: spec.title,
          project: test.projectName,
          status: test.status,
          attempts: results.length,
          duration: results.reduce((total, result) => total + result.duration, 0),
          error: firstLine(firstFailure?.error?.message ?? firstFailure?.errors?.[0]?.message),
        });
      }
    }
    for (const child of suite.suites ?? []) visit(child, suiteFile);
  };
  for (const suite of json.suites ?? []) visit(suite, suite.file);
  return collected;
}

function countsByProject(all) {
  const rows = new Map();
  for (const test of all) {
    const row = rows.get(test.project) ?? [0, 0, 0, 0];
    switch (test.status) {
      case "expected":
        row[0]++;
        break;
      case "flaky":
        row[1]++;
        break;
      case "unexpected":
        row[2]++;
        break;
      default:
        row[3]++;
    }
    rows.set(test.project, row);
  }
  return [...rows].sort(([a], [b]) => a.localeCompare(b));
}

function table(label, headers, rows) {
  return [
    `| ${label} | ${headers.join(" | ")} |`,
    `| --- | ${headers.map(() => "---:").join(" | ")} |`,
    ...rows.map(([name, values]) => `| ${name} | ${values.join(" | ")} |`),
  ].join("\n");
}

function section(title, entries, detail) {
  if (entries.length === 0) return `### ${title}\n\nNone.\n`;

  const lines = entries.map((test) => {
    const note = detail(test);
    return `- \`[${test.project}] ${test.file}:${test.line}\` ${test.title}${note ? ` — ${note}` : ""}`;
  });
  return [`### ${title}`, "", ...lines, ""].join("\n");
}

function firstLine(message) {
  if (!message) return "";
  // Playwright error messages carry ANSI colour codes.
  const plain = message.replace(/\u001b\[[0-9;]*m/g, "").trim();
  return plain.split("\n")[0].slice(0, 200).replaceAll("|", "\\|");
}

function formatSeconds(milliseconds) {
  return `${(milliseconds / 1000).toFixed(1)} s`;
}

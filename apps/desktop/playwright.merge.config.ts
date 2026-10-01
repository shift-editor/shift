import { defineConfig } from "@playwright/test";

/**
 * Merges blob reports recorded by macOS, Linux, and Windows shards.
 *
 * Each runner records its own absolute test directory, so `merge-reports` needs one
 * shared `testDir` to rebase test paths. Reporters are chosen on the command line.
 */
export default defineConfig({
  testDir: "./e2e",
});

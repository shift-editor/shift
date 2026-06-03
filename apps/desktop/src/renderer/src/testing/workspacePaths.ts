import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function testStorePath(label: string): string {
  return join(mkdtempSync(join(tmpdir(), `shift-${label}-`)), "working.sqlite");
}

export function testSourcePath(label: string): string {
  return join(mkdtempSync(join(tmpdir(), `shift-${label}-`)), "TestFont.shift");
}

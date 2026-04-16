#!/usr/bin/env python3
# Usage: python3 scripts/context-drift-check.py
"""
context-drift-check.py — validate documentation freshness and link integrity.

Run from repo root:
    python scripts/context-drift-check.py

Exit code 0 = clean, 1 = issues found.
"""

import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# All known DOCS.md locations (must match routing index)
EXPECTED_DOCS = [
    "crates/shift-core/docs/DOCS.md",
    "crates/shift-backends/docs/DOCS.md",
    "crates/shift-ir/docs/DOCS.md",
    "crates/shift-node/docs/DOCS.md",
    "apps/desktop/src/main/docs/DOCS.md",
    "apps/desktop/src/preload/docs/DOCS.md",
    "apps/desktop/src/shared/bridge/docs/DOCS.md",
    "apps/desktop/src/renderer/src/bridge/docs/DOCS.md",
    "apps/desktop/src/renderer/src/lib/editor/docs/DOCS.md",
    "apps/desktop/src/renderer/src/lib/tools/docs/DOCS.md",
    "apps/desktop/src/renderer/src/lib/graphics/docs/DOCS.md",
    "apps/desktop/src/renderer/src/lib/transform/docs/DOCS.md",
    "apps/desktop/src/renderer/src/lib/commands/docs/DOCS.md",
    "apps/desktop/src/renderer/src/lib/reactive/docs/DOCS.md",
    "packages/types/docs/DOCS.md",
    "packages/geo/docs/DOCS.md",
    "packages/font/docs/DOCS.md",
    "packages/ui/docs/DOCS.md",
    "packages/validation/docs/DOCS.md",
    "packages/rules/docs/DOCS.md",
]

ROUTING_INDEX = "docs/architecture/index.md"

# Common type names that appear in markdown but aren't project symbols
SKIP_SYMBOLS = {
    "String", "Vec", "Option", "None", "HashMap", "JSON", "Float64Array",
    "Array", "Map", "Set", "Promise", "Error", "Boolean", "Number",
    "Object", "Function", "Symbol", "RegExp", "Date", "Math",
    "Readonly", "Partial", "Omit", "Pick", "Record",
    "React", "TypeScript", "JavaScript", "Rust", "Electron", "Node",
    "Canvas", "WebGL", "NAPI", "CSS", "HTML", "DOM",
}


def source_dir_for_doc(doc_path: str) -> str:
    """Given 'crates/shift-core/docs/DOCS.md', return 'crates/shift-core/src'."""
    parts = Path(doc_path).parts
    docs_idx = parts.index("docs")
    module_dir = Path(*parts[:docs_idx])
    # Rust crates have src/, TS modules have the parent dir itself
    src_dir = module_dir / "src"
    if (REPO_ROOT / src_dir).exists():
        return str(src_dir)
    return str(module_dir)


def last_commit_date(path: str) -> str | None:
    """Return ISO date of most recent commit touching path, or None."""
    result = subprocess.run(
        ["git", "log", "-1", "--format=%aI", "--", path],
        capture_output=True, text=True, cwd=REPO_ROOT,
    )
    return result.stdout.strip() or None


def check_missing_docs() -> list[str]:
    """Check that all expected DOCS.md files exist."""
    issues = []
    for doc in EXPECTED_DOCS:
        if not (REPO_ROOT / doc).exists():
            issues.append(f"MISSING: {doc}")
    return issues


def check_broken_links(doc_path: str) -> list[str]:
    """Check markdown links in a doc resolve to real files."""
    issues = []
    full_path = REPO_ROOT / doc_path
    if not full_path.exists():
        return issues
    content = full_path.read_text()
    doc_dir = full_path.parent

    # Match markdown links: [text](path) but not URLs
    for match in re.finditer(r'\[([^\]]+)\]\(([^)]+)\)', content):
        link_text, link_target = match.group(1), match.group(2)
        if link_target.startswith(("http://", "https://", "#")):
            continue
        # Strip any anchor fragment
        target_path = link_target.split("#")[0]
        if not target_path:
            continue
        resolved = (doc_dir / target_path).resolve()
        if not resolved.exists():
            issues.append(f"BROKEN LINK in {doc_path}: [{link_text}]({link_target})")
    return issues


def check_freshness(doc_path: str) -> list[str]:
    """Flag docs that are stale relative to their source code."""
    issues = []
    doc_date = last_commit_date(doc_path)
    if not doc_date:
        issues.append(f"NO COMMITS: {doc_path} has no git history")
        return issues

    src_dir = source_dir_for_doc(doc_path)
    src_date = last_commit_date(src_dir)
    if not src_date:
        return issues

    # Compare dates (ISO format sorts lexicographically)
    if doc_date < src_date:
        issues.append(
            f"STALE: {doc_path} (doc: {doc_date[:10]}, "
            f"source: {src_date[:10]}) — source changed after doc"
        )
    return issues


def check_symbols(doc_path: str) -> list[str]:
    """Spot-check that backtick-quoted type/function names exist in codebase."""
    issues = []
    full_path = REPO_ROOT / doc_path
    content = full_path.read_text()

    # Extract backtick-quoted symbols that look like type/class names (PascalCase)
    symbols = set(re.findall(r'`([A-Z][a-zA-Z0-9]+)`', content))
    symbols -= SKIP_SYMBOLS

    for symbol in sorted(symbols):
        result = subprocess.run(
            ["git", "grep", "-l", symbol, "--", "*.ts", "*.rs", "*.tsx"],
            capture_output=True, text=True, cwd=REPO_ROOT,
        )
        if not result.stdout.strip():
            issues.append(f"DEAD SYMBOL in {doc_path}: `{symbol}` not found in codebase")
    return issues


def main():
    all_issues: list[str] = []

    # Phase 1: missing docs
    print("Checking for missing docs...")
    all_issues.extend(check_missing_docs())

    # Phase 2: per-doc checks
    for doc in EXPECTED_DOCS:
        if not (REPO_ROOT / doc).exists():
            continue
        print(f"  Checking {doc}...")
        all_issues.extend(check_broken_links(doc))
        all_issues.extend(check_freshness(doc))
        all_issues.extend(check_symbols(doc))

    # Phase 3: check routing index
    print(f"Checking routing index ({ROUTING_INDEX})...")
    if (REPO_ROOT / ROUTING_INDEX).exists():
        all_issues.extend(check_broken_links(ROUTING_INDEX))
    else:
        all_issues.append(f"MISSING: {ROUTING_INDEX}")

    # Report
    print()
    if all_issues:
        print(f"Found {len(all_issues)} issue(s):\n")
        for issue in all_issues:
            print(f"  - {issue}")
        sys.exit(1)
    else:
        print("All docs clean.")
        sys.exit(0)


if __name__ == "__main__":
    main()

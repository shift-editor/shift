#!/usr/bin/env python3
# Usage: python3 scripts/context-drift-check.py [--json]
"""
context-drift-check.py — validate documentation freshness, structure, and link integrity.

Run from repo root:
    python3 scripts/context-drift-check.py          # human-readable output
    python3 scripts/context-drift-check.py --json    # structured JSON output

Exit code 0 = clean, 1 = issues found.
"""

from __future__ import annotations

import json as json_mod
import re
import subprocess
import sys
from pathlib import Path

from markdown_it import MarkdownIt

REPO_ROOT = Path(__file__).resolve().parent.parent
MD_PARSER = MarkdownIt("commonmark")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

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

# Required H2 sections in every DOCS.md (order-independent)
REQUIRED_SECTIONS = {
    "Architecture Invariants",
    "Codemap",
    "Key Types",
    "How it works",
    "Verification",
    "Related",
}

# Sections that should be present but are only a warning if missing
RECOMMENDED_SECTIONS = {
    "Workflow recipes",
    "Gotchas",
}

# Common type names that appear in markdown but aren't project symbols
SKIP_SYMBOLS = {
    "String", "Vec", "Option", "None", "HashMap", "JSON", "Float64Array",
    "Array", "Map", "Set", "Promise", "Error", "Boolean", "Number",
    "Object", "Function", "Symbol", "RegExp", "Date", "Math",
    "Readonly", "Partial", "Omit", "Pick", "Record",
    "React", "TypeScript", "JavaScript", "Rust", "Electron", "Node",
    "Canvas", "WebGL", "NAPI", "CSS", "HTML", "DOM",
}


# ---------------------------------------------------------------------------
# Issue type
# ---------------------------------------------------------------------------

class Issue:
    """A single validation issue with severity and category."""

    def __init__(self, category: str, severity: str, doc: str, message: str):
        self.category = category  # missing | broken_link | stale | dead_symbol | structure | command
        self.severity = severity  # error | warning
        self.doc = doc
        self.message = message

    def __str__(self) -> str:
        prefix = "WARN" if self.severity == "warning" else self.category.upper().replace("_", " ")
        return f"{prefix}: {self.message}"

    def to_dict(self) -> dict:
        return {
            "category": self.category,
            "severity": self.severity,
            "doc": self.doc,
            "message": self.message,
        }


# ---------------------------------------------------------------------------
# AST helpers
# ---------------------------------------------------------------------------

def parse_doc(path: Path) -> list:
    """Parse a markdown file and return its token list."""
    return MD_PARSER.parse(path.read_text())


def extract_headings(tokens: list) -> list[tuple[int, str]]:
    """Extract (level, text) pairs from parsed tokens."""
    headings: list[tuple[int, str]] = []
    for i, token in enumerate(tokens):
        if token.type == "heading_open":
            level = int(token.tag[1])  # h1 -> 1, h2 -> 2, etc.
            # The next token is the inline content
            if i + 1 < len(tokens) and tokens[i + 1].type == "inline":
                headings.append((level, tokens[i + 1].content))
    return headings


def extract_links(tokens: list) -> list[tuple[str, str]]:
    """Extract (text, href) pairs for non-URL links from parsed tokens."""
    links: list[tuple[str, str]] = []
    for token in tokens:
        if not token.children:
            continue
        children = token.children
        i = 0
        while i < len(children):
            child = children[i]
            if child.type == "link_open":
                href = child.attrs.get("href", "") if child.attrs else ""
                # Collect link text from subsequent children until link_close
                text_parts = []
                i += 1
                while i < len(children) and children[i].type != "link_close":
                    text_parts.append(children[i].content)
                    i += 1
                text = "".join(text_parts)
                if href and not href.startswith(("http://", "https://", "#")):
                    links.append((text, href))
            i += 1
    return links


def extract_code_inline_by_section(tokens: list) -> dict[str, list[str]]:
    """Extract inline code spans grouped by their enclosing H2 section.

    Returns {"section_name": [code, ...], ...}. Tokens before any H2
    go under the key "".
    """
    result: dict[str, list[str]] = {}
    current_section = ""
    for i, token in enumerate(tokens):
        if token.type == "heading_open" and token.tag == "h2":
            if i + 1 < len(tokens) and tokens[i + 1].type == "inline":
                current_section = tokens[i + 1].content
        if not token.children:
            continue
        for child in token.children:
            if child.type == "code_inline":
                result.setdefault(current_section, []).append(child.content)
    return result


def extract_fenced_blocks(tokens: list) -> list[tuple[str, str]]:
    """Extract (language, content) pairs from fenced code blocks."""
    blocks: list[tuple[str, str]] = []
    for token in tokens:
        if token.type == "fence":
            lang = token.info.strip().split()[0] if token.info.strip() else ""
            blocks.append((lang, token.content))
    return blocks


# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------

def check_missing_docs() -> list[Issue]:
    """Check that all expected DOCS.md files exist."""
    issues = []
    for doc in EXPECTED_DOCS:
        if not (REPO_ROOT / doc).exists():
            issues.append(Issue("missing", "error", doc, f"{doc} does not exist"))
    return issues


def check_broken_links(doc_path: str, tokens: list) -> list[Issue]:
    """Check that markdown links resolve to real files."""
    issues = []
    doc_dir = (REPO_ROOT / doc_path).parent
    for text, href in extract_links(tokens):
        target = href.split("#")[0]
        if not target:
            continue
        resolved = (doc_dir / target).resolve()
        if not resolved.exists():
            issues.append(Issue(
                "broken_link", "error", doc_path,
                f"[{text}]({href}) — target does not exist",
            ))
    return issues


def check_freshness(doc_path: str) -> list[Issue]:
    """Flag docs that are stale relative to their source code."""
    issues = []
    doc_date = _last_commit_date(doc_path)
    if not doc_date:
        issues.append(Issue(
            "stale", "warning", doc_path,
            f"{doc_path} has no git history",
        ))
        return issues

    src_dir = _source_dir_for_doc(doc_path)
    src_date = _last_commit_date(src_dir)
    if not src_date:
        return issues

    if doc_date < src_date:
        issues.append(Issue(
            "stale", "warning", doc_path,
            f"doc last touched {doc_date[:10]}, source last touched {src_date[:10]}",
        ))
    return issues


def check_symbols(doc_path: str, tokens: list, symbol_index: dict[str, bool]) -> list[Issue]:
    """Verify backtick-quoted PascalCase symbols exist in the codebase.

    Symbols that appear only in "Workflow recipes" sections are skipped,
    since those sections contain placeholder names like `MyState`.
    """
    issues = []
    codes_by_section = extract_code_inline_by_section(tokens)

    # Sections where placeholder/example symbols are expected
    recipe_sections = {"Workflow recipes", "Gotchas"}

    # Collect symbols from non-recipe sections
    symbols: set[str] = set()
    recipe_only: set[str] = set()

    for section, codes in codes_by_section.items():
        for code in codes:
            for match in re.findall(r"\b([A-Z][a-zA-Z0-9]+)\b", code):
                if match in SKIP_SYMBOLS:
                    continue
                if section in recipe_sections:
                    recipe_only.add(match)
                else:
                    symbols.add(match)

    # Symbols appearing only in recipe sections are not checked
    recipe_only -= symbols

    for symbol in sorted(symbols):
        if symbol not in symbol_index:
            symbol_index[symbol] = _symbol_exists(symbol)
        if not symbol_index[symbol]:
            issues.append(Issue(
                "dead_symbol", "error", doc_path,
                f"`{symbol}` not found in codebase",
            ))
    return issues


def check_structure(doc_path: str, tokens: list) -> list[Issue]:
    """Validate that the doc has all required sections."""
    issues = []
    headings = extract_headings(tokens)
    h2_names = {name for level, name in headings if level == 2}

    for section in REQUIRED_SECTIONS:
        if section not in h2_names:
            issues.append(Issue(
                "structure", "error", doc_path,
                f"missing required section: ## {section}",
            ))

    for section in RECOMMENDED_SECTIONS:
        if section not in h2_names:
            issues.append(Issue(
                "structure", "warning", doc_path,
                f"missing recommended section: ## {section}",
            ))

    # Check that there is exactly one H1
    h1s = [name for level, name in headings if level == 1]
    if len(h1s) == 0:
        issues.append(Issue("structure", "error", doc_path, "no H1 heading"))
    elif len(h1s) > 1:
        issues.append(Issue("structure", "error", doc_path, f"multiple H1 headings: {h1s}"))

    return issues


def check_commands(doc_path: str, tokens: list, valid_commands: dict) -> list[Issue]:
    """Verify pnpm/cargo commands referenced in docs are valid.

    Checks both fenced code blocks and inline code spans.
    """
    issues = []

    # Collect all command-like strings from code blocks and inline code
    command_strings: list[str] = []
    for lang, content in extract_fenced_blocks(tokens):
        if lang in ("bash", "sh", "shell", ""):
            command_strings.extend(content.strip().splitlines())
    for codes in extract_code_inline_by_section(tokens).values():
        command_strings.extend(codes)

    seen: set[str] = set()
    for line in command_strings:
        line = line.strip().lstrip("$").strip()
        issue = _check_single_command(line, valid_commands, doc_path)
        if issue and issue.message not in seen:
            seen.add(issue.message)
            issues.append(issue)

    return issues


def _check_single_command(line: str, valid_commands: dict, doc_path: str) -> Issue | None:
    """Check a single command line for invalid pnpm/cargo references."""
    pnpm_scripts: dict[str, set[str]] = valid_commands["pnpm"]
    cargo_packages: set[str] = valid_commands["cargo"]

    # pnpm --filter <pkg> <script>
    m = re.match(r"pnpm\s+--filter\s+['\"]?([^'\"!\s]+)['\"]?\s+(\S+)", line)
    if m:
        pkg, script = m.group(1), m.group(2)
        if pkg not in pnpm_scripts:
            return Issue("command", "error", doc_path, f"unknown pnpm package: `{pkg}`")
        if script not in pnpm_scripts[pkg] and script not in ("run",):
            return Issue("command", "warning", doc_path, f"`{pkg}` has no script `{script}`")
        return None

    # pnpm <script> (root-level)
    m = re.match(r"pnpm\s+(?:run\s+)?(\S+)", line)
    if m:
        script = m.group(1)
        # Skip pnpm subcommands that aren't scripts
        if script in ("--filter", "install", "add", "remove", "exec", "dlx", "vitest",
                       "turbo", "prettier", "--", "-r", "--recursive"):
            return None
        root_scripts = pnpm_scripts.get("__root__", set())
        if script not in root_scripts and not script.startswith("-"):
            return Issue("command", "warning", doc_path, f"no root script `{script}` in package.json")
        return None

    # pnpm vitest run <path> — always valid (vitest handles its own paths)
    if line.startswith("pnpm vitest"):
        return None

    # cargo test -p <package>
    m = re.match(r"cargo\s+\w+.*?(?:-p|--package)\s+(\S+)", line)
    if m:
        pkg = m.group(1)
        if pkg not in cargo_packages:
            return Issue("command", "error", doc_path, f"unknown cargo package: `{pkg}`")
        return None

    return None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _source_dir_for_doc(doc_path: str) -> str:
    """Map a DOCS.md path to its source directory."""
    parts = Path(doc_path).parts
    docs_idx = parts.index("docs")
    module_dir = Path(*parts[:docs_idx])
    src_dir = module_dir / "src"
    if (REPO_ROOT / src_dir).exists():
        return str(src_dir)
    return str(module_dir)


def _last_commit_date(path: str) -> str | None:
    """Return ISO date of most recent commit touching path, or None."""
    result = subprocess.run(
        ["git", "log", "-1", "--format=%aI", "--", path],
        capture_output=True, text=True, cwd=REPO_ROOT,
    )
    return result.stdout.strip() or None


def _symbol_exists(symbol: str) -> bool:
    """Check if a symbol exists anywhere in the codebase source files."""
    result = subprocess.run(
        ["git", "grep", "-lq", symbol, "--", "*.ts", "*.rs", "*.tsx"],
        capture_output=True, text=True, cwd=REPO_ROOT,
    )
    return result.returncode == 0


def _load_valid_commands() -> dict:
    """Build a lookup of valid pnpm scripts and cargo packages."""
    pnpm: dict[str, set[str]] = {}

    # Root package.json scripts
    root_pkg = REPO_ROOT / "package.json"
    if root_pkg.exists():
        data = json_mod.loads(root_pkg.read_text())
        pnpm["__root__"] = set(data.get("scripts", {}).keys())

    # Workspace package.json scripts
    for pkg_json in sorted(REPO_ROOT.glob("packages/*/package.json")):
        data = json_mod.loads(pkg_json.read_text())
        name = data.get("name", "")
        if name:
            pnpm[name] = set(data.get("scripts", {}).keys())

    for pkg_json in sorted(REPO_ROOT.glob("apps/*/package.json")):
        data = json_mod.loads(pkg_json.read_text())
        name = data.get("name", "")
        if name:
            pnpm[name] = set(data.get("scripts", {}).keys())

    # Also index the napi crate by its npm name
    node_pkg = REPO_ROOT / "crates" / "shift-node" / "package.json"
    if node_pkg.exists():
        data = json_mod.loads(node_pkg.read_text())
        name = data.get("name", "")
        if name:
            pnpm[name] = set(data.get("scripts", {}).keys())

    # Cargo workspace packages
    cargo_packages: set[str] = set()
    for cargo_toml in sorted(REPO_ROOT.glob("crates/*/Cargo.toml")):
        content = cargo_toml.read_text()
        m = re.search(r'name\s*=\s*"([^"]+)"', content)
        if m:
            cargo_packages.add(m.group(1))

    return {"pnpm": pnpm, "cargo": cargo_packages}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    json_output = "--json" in sys.argv
    all_issues: list[Issue] = []
    symbol_index: dict[str, bool] = {}
    valid_commands = _load_valid_commands()

    if not json_output:
        print("Loading command index...")
        pnpm_count = sum(len(v) for v in valid_commands["pnpm"].values())
        print(f"  {pnpm_count} pnpm scripts across {len(valid_commands['pnpm'])} packages")
        print(f"  {len(valid_commands['cargo'])} cargo packages")
        print()

    # Phase 1: missing docs
    if not json_output:
        print("Checking for missing docs...")
    all_issues.extend(check_missing_docs())

    # Phase 2: per-doc checks
    for doc in EXPECTED_DOCS:
        full_path = REPO_ROOT / doc
        if not full_path.exists():
            continue
        if not json_output:
            print(f"  Checking {doc}...")

        tokens = parse_doc(full_path)
        all_issues.extend(check_broken_links(doc, tokens))
        all_issues.extend(check_freshness(doc))
        all_issues.extend(check_symbols(doc, tokens, symbol_index))
        all_issues.extend(check_structure(doc, tokens))
        all_issues.extend(check_commands(doc, tokens, valid_commands))

    # Phase 3: routing index
    if not json_output:
        print(f"Checking routing index ({ROUTING_INDEX})...")
    index_path = REPO_ROOT / ROUTING_INDEX
    if index_path.exists():
        tokens = parse_doc(index_path)
        all_issues.extend(check_broken_links(ROUTING_INDEX, tokens))
    else:
        all_issues.append(Issue("missing", "error", ROUTING_INDEX, f"{ROUTING_INDEX} does not exist"))

    # Report
    if json_output:
        output = {
            "total": len(all_issues),
            "errors": len([i for i in all_issues if i.severity == "error"]),
            "warnings": len([i for i in all_issues if i.severity == "warning"]),
            "by_category": {},
            "issues": [i.to_dict() for i in all_issues],
        }
        for issue in all_issues:
            output["by_category"].setdefault(issue.category, 0)
            output["by_category"][issue.category] += 1
        print(json_mod.dumps(output, indent=2))
    else:
        print()
        errors = [i for i in all_issues if i.severity == "error"]
        warnings = [i for i in all_issues if i.severity == "warning"]
        if errors or warnings:
            if errors:
                print(f"Found {len(errors)} error(s):\n")
                for issue in errors:
                    print(f"  - {issue}")
            if warnings:
                print(f"\nFound {len(warnings)} warning(s):\n")
                for issue in warnings:
                    print(f"  - {issue}")
            sys.exit(1)
        else:
            print("All docs clean.")
            sys.exit(0)


if __name__ == "__main__":
    main()

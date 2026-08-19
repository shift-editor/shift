#!/usr/bin/env python3
# Usage: python3 scripts/context-drift-check.py [--json | --codemap <doc>]
"""
context-drift-check.py — validate documentation freshness, structure, and link integrity.

Run from repo root:
    python3 scripts/context-drift-check.py                   # human-readable output
    python3 scripts/context-drift-check.py --json            # structured JSON output
    python3 scripts/context-drift-check.py --codemap <doc>   # print a module's real
                                                             # tree for codemap curation

DOCS.md files are auto-discovered; each needs a reviewed attestation near the top:
    <!-- reviewed: 2026-08-18 review-every: 90d -->
Bumping that date (after actually re-reading the doc against source) is the only
way to clear staleness — doc commits alone no longer reset the clock.

Exit code 0 = clean, 1 = issues found.
"""

from __future__ import annotations

import json as json_mod
import re
import subprocess
import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# DOCS.md files are discovered from the tree (tracked + untracked), never
# listed by hand: a hardcoded list silently exempts new modules.
def discover_docs() -> list[str]:
    result = subprocess.run(
        [
            "git", "ls-files", "--cached", "--others", "--exclude-standard",
            "*docs/DOCS.md",
        ],
        capture_output=True, text=True, cwd=REPO_ROOT,
    )
    return sorted(line for line in result.stdout.splitlines() if line.strip())


ROUTING_INDEX = "docs/architecture/index.md"

# Review attestation frontmatter, e.g.:
#   <!-- reviewed: 2026-08-18 review-every: 90d -->
# The reviewed date is an explicit human/agent attestation that the doc was
# checked against source; bumping it is the only way to clear staleness.
REVIEWED_RE = re.compile(
    r"<!--\s*reviewed:\s*(\d{4}-\d{2}-\d{2})(?:\s+review-every:\s*(\d+)d)?\s*-->"
)
DEFAULT_REVIEW_DAYS = 90

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
        return f"{prefix}: {self.doc}: {self.message}"

    def to_dict(self) -> dict:
        return {
            "category": self.category,
            "severity": self.severity,
            "doc": self.doc,
            "message": self.message,
        }


@dataclass
class MarkdownToken:
    """Small token shape for the markdown constructs this checker needs."""

    type: str
    tag: str = ""
    info: str = ""
    content: str = ""
    children: list["MarkdownToken"] | None = None
    attrs: dict[str, str] | None = None


# ---------------------------------------------------------------------------
# AST helpers
# ---------------------------------------------------------------------------

def parse_doc(path: Path) -> list:
    """Parse a markdown file and return the token list used by this checker."""
    tokens: list[MarkdownToken] = []
    in_fence = False
    fence_marker = ""
    fence_info = ""
    fence_content: list[str] = []

    for line in path.read_text().splitlines():
        stripped = line.lstrip()
        fence_match = re.match(r"^(```+|~~~+)\s*(.*)$", stripped)

        if in_fence:
            if fence_match and fence_match.group(1).startswith(fence_marker[0]):
                tokens.append(MarkdownToken(
                    type="fence",
                    info=fence_info,
                    content="\n".join(fence_content),
                ))
                in_fence = False
                fence_marker = ""
                fence_info = ""
                fence_content = []
            else:
                fence_content.append(line)
            continue

        if fence_match:
            in_fence = True
            fence_marker = fence_match.group(1)
            fence_info = fence_match.group(2).strip()
            fence_content = []
            continue

        heading_match = re.match(r"^(#{1,6})\s+(.+?)\s*#*\s*$", stripped)
        if heading_match:
            level = len(heading_match.group(1))
            content = heading_match.group(2).strip()
            tokens.append(MarkdownToken(type="heading_open", tag=f"h{level}"))
            tokens.append(MarkdownToken(
                type="inline",
                content=content,
                children=_parse_inline(content),
            ))
            continue

        if stripped:
            tokens.append(MarkdownToken(
                type="inline",
                content=stripped,
                children=_parse_inline(stripped),
            ))

    if in_fence:
        tokens.append(MarkdownToken(
            type="fence",
            info=fence_info,
            content="\n".join(fence_content),
        ))

    return tokens


def _parse_inline(text: str) -> list[MarkdownToken]:
    """Parse links and inline code spans from a single markdown line."""
    children: list[MarkdownToken] = []
    i = 0

    while i < len(text):
        if text[i] == "`":
            end = text.find("`", i + 1)
            if end == -1:
                children.append(MarkdownToken(type="text", content=text[i:]))
                break
            children.append(MarkdownToken(type="code_inline", content=text[i + 1:end]))
            i = end + 1
            continue

        if text[i] == "[":
            label_end = text.find("]", i + 1)
            if label_end != -1 and label_end + 1 < len(text) and text[label_end + 1] == "(":
                href_end = text.find(")", label_end + 2)
                if href_end != -1:
                    label = text[i + 1:label_end]
                    href = text[label_end + 2:href_end]
                    children.append(MarkdownToken(type="link_open", attrs={"href": href}))
                    children.append(MarkdownToken(type="text", content=label))
                    children.append(MarkdownToken(type="link_close"))
                    i = href_end + 1
                    continue

        next_code = text.find("`", i)
        next_link = text.find("[", i)
        stops = [pos for pos in (next_code, next_link) if pos != -1]
        end = min(stops) if stops else len(text)
        children.append(MarkdownToken(type="text", content=text[i:end]))
        i = end

    return children



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

def check_routing_inventory(docs: list[str], index_tokens: list) -> list[Issue]:
    """Every discovered DOCS.md must be reachable from the routing index."""
    issues = []
    index_dir = (REPO_ROOT / ROUTING_INDEX).parent
    routed: set[Path] = set()
    for _text, href in extract_links(index_tokens):
        target = href.split("#")[0]
        if target:
            routed.add((index_dir / target).resolve())
    for doc in docs:
        if (REPO_ROOT / doc).resolve() not in routed:
            issues.append(Issue(
                "missing", "error", ROUTING_INDEX,
                f"{doc} is not routed from the index",
            ))
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
    """Flag docs that are stale relative to their source code or overdue for review.

    A `<!-- reviewed: YYYY-MM-DD review-every: Nd -->` attestation is the
    authoritative freshness signal: staleness compares source activity against
    the reviewed date, and reviews expire after their window. Docs without an
    attestation fall back to git-date comparison and are asked to add one.
    """
    issues = []
    reviewed, review_days = _parse_reviewed(doc_path)

    if reviewed:
        overdue = (date.today() - reviewed).days - review_days
        if overdue > 0:
            issues.append(Issue(
                "stale", "warning", doc_path,
                f"review overdue by {overdue}d (reviewed {reviewed}, window {review_days}d)",
            ))
        src_date = _last_source_commit_date(doc_path)
        if src_date and src_date[:10] > reviewed.isoformat():
            issues.append(Issue(
                "stale", "warning", doc_path,
                f"source touched {src_date[:10]}, after last review {reviewed}",
            ))
        return issues

    issues.append(Issue(
        "stale", "warning", doc_path,
        "missing `<!-- reviewed: YYYY-MM-DD -->` attestation",
    ))
    if _has_worktree_changes(doc_path):
        return issues

    doc_date = _last_commit_date(doc_path)
    if not doc_date:
        return issues

    src_date = _last_source_commit_date(doc_path)
    if src_date and doc_date < src_date:
        issues.append(Issue(
            "stale", "warning", doc_path,
            f"doc last touched {doc_date[:10]}, source last touched {src_date[:10]}",
        ))
    return issues


def _parse_reviewed(doc_path: str) -> tuple[date | None, int]:
    """Extract the reviewed attestation from the top of a doc."""
    head = "\n".join((REPO_ROOT / doc_path).read_text().splitlines()[:5])
    m = REVIEWED_RE.search(head)
    if not m:
        return None, DEFAULT_REVIEW_DAYS
    reviewed = date.fromisoformat(m.group(1))
    days = int(m.group(2)) if m.group(2) else DEFAULT_REVIEW_DAYS
    return reviewed, days


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
    h2_by_fold = {name.casefold(): name for name in h2_names}

    def missing(section: str, severity: str) -> None:
        found = h2_by_fold.get(section.casefold())
        if found is not None:
            issues.append(Issue(
                "structure", severity, doc_path,
                f"section '## {found}' is miscapitalized (expected '## {section}')",
            ))
        else:
            article = "required" if severity == "error" else "recommended"
            issues.append(Issue(
                "structure", severity, doc_path,
                f"missing {article} section: ## {section}",
            ))

    for section in REQUIRED_SECTIONS:
        if section not in h2_names:
            missing(section, "error")

    for section in RECOMMENDED_SECTIONS:
        if section not in h2_names:
            missing(section, "warning")

    # Check that there is exactly one H1
    h1s = [name for level, name in headings if level == 1]
    if len(h1s) == 0:
        issues.append(Issue("structure", "error", doc_path, "no H1 heading"))
    elif len(h1s) > 1:
        issues.append(Issue("structure", "error", doc_path, f"multiple H1 headings: {h1s}"))

    return issues


def check_codemap(doc_path: str, tokens: list) -> list[Issue]:
    """Verify every path in the Codemap tree exists on disk.

    Codemaps are curated (key files only), so this checks presence of what is
    listed, never completeness. Indentation defines nesting; the root line
    resolves against the module directory or the repo root, whichever matches.
    """
    issues = []
    block = _codemap_block(tokens)
    if block is None:
        return issues

    module_dir = _module_dir_for_doc(doc_path)
    stack: list[tuple[int, Path]] = []  # (indent, resolved dir)

    for raw in block.splitlines():
        if not raw.strip() or raw.strip().startswith(("…", "...")):
            continue
        line = re.sub(r"[│├└─┬]+", " ", raw)
        name = line.strip().split()[0]
        if not re.match(r"^[\w.@/-]+$", name):
            continue
        indent = len(line) - len(line.lstrip())

        while stack and stack[-1][0] >= indent:
            stack.pop()

        if not stack:
            root = _resolve_codemap_root(name, module_dir)
            if root is None:
                issues.append(Issue(
                    "codemap", "error", doc_path,
                    f"codemap root `{name}` does not resolve to a directory",
                ))
                return issues
            stack.append((indent, root))
            continue

        path = stack[-1][1] / name.rstrip("/")
        if name.endswith("/"):
            if not path.is_dir():
                issues.append(Issue(
                    "codemap", "error", doc_path,
                    f"codemap directory `{name}` does not exist",
                ))
            stack.append((indent, path))
        elif not path.is_file():
            issues.append(Issue(
                "codemap", "error", doc_path,
                f"codemap entry `{path.relative_to(REPO_ROOT)}` does not exist",
            ))
    return issues


def _codemap_block(tokens: list) -> str | None:
    """Return the first fenced block inside the Codemap section, if any."""
    in_codemap = False
    for i, token in enumerate(tokens):
        if token.type == "heading_open" and token.tag == "h2":
            name = tokens[i + 1].content if i + 1 < len(tokens) else ""
            in_codemap = name.casefold() == "codemap"
        elif token.type == "fence" and in_codemap:
            return token.content
    return None


def _resolve_codemap_root(name: str, module_dir: Path) -> Path | None:
    """Map a codemap root line to a real directory."""
    rel = name.rstrip("/")
    candidates = []
    if str(module_dir.relative_to(REPO_ROOT)).endswith(rel):
        candidates.append(module_dir)
    candidates += [REPO_ROOT / rel, module_dir / rel]
    # Codemaps may root a tree at a sibling module (cross-module context);
    # resolve against each ancestor up to the repo root.
    ancestor = module_dir
    while ancestor != REPO_ROOT:
        ancestor = ancestor.parent
        candidates.append(ancestor / rel)
    for candidate in candidates:
        if candidate.is_dir():
            return candidate
    return None


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
    """Check a single command line for invalid pnpm/cargo/vitest references."""
    pnpm_scripts: dict[str, set[str]] = valid_commands["pnpm"]
    cargo_packages: set[str] = valid_commands["cargo"]

    # vitest invocations (npx vitest / pnpm vitest / bare vitest): validate
    # long flags against the installed CLI so Jest-isms don't linger in docs.
    if re.match(r"(?:npx\s+|pnpm\s+(?:exec\s+)?)?vitest\b", line):
        known_flags = valid_commands["vitest_flags"]
        if known_flags:
            for flag in re.findall(r"--[A-Za-z][\w-]*", line):
                if flag not in known_flags:
                    return Issue(
                        "command", "error", doc_path,
                        f"vitest does not accept `{flag}`",
                    )
        return None

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

def _module_dir_for_doc(doc_path: str) -> Path:
    """Absolute directory of the module a DOCS.md documents."""
    parts = Path(doc_path).parts
    docs_idx = parts.index("docs")
    return REPO_ROOT / Path(*parts[:docs_idx])


def _source_dir_for_doc(doc_path: str) -> str:
    """Map a DOCS.md path to its source directory."""
    module_dir = _module_dir_for_doc(doc_path).relative_to(REPO_ROOT)
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


def _last_source_commit_date(doc_path: str) -> str | None:
    """Most recent commit touching the module's source, excluding its docs.

    For modules without a src/ split the docs directory sits inside the
    source path, and a doc commit must not count as source activity.
    """
    src_dir = _source_dir_for_doc(doc_path)
    docs_dir = str(Path(doc_path).parent)
    result = subprocess.run(
        ["git", "log", "-1", "--format=%aI", "--", src_dir, f":(exclude){docs_dir}"],
        capture_output=True, text=True, cwd=REPO_ROOT,
    )
    return result.stdout.strip() or None


def _has_worktree_changes(path: str) -> bool:
    """Return whether a path differs from the current commit."""
    result = subprocess.run(
        ["git", "status", "--porcelain", "--", path],
        capture_output=True, text=True, cwd=REPO_ROOT,
    )
    return bool(result.stdout.strip())


def _symbol_exists(symbol: str) -> bool:
    """Check tracked and untracked source files in the current worktree."""
    result = subprocess.run(
        [
            "git",
            "grep",
            "--untracked",
            "--fixed-strings",
            "-lq",
            symbol,
            "--",
            ":(glob)**/*.ts",
            ":(glob)**/*.tsx",
            ":(glob)**/*.rs",
        ],
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
    node_pkg = REPO_ROOT / "crates" / "shift-bridge" / "package.json"
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

    return {"pnpm": pnpm, "cargo": cargo_packages, "vitest_flags": _load_vitest_flags()}


def _load_vitest_flags() -> set[str]:
    """Long flags accepted by the installed vitest CLI (empty when unavailable)."""
    vitest = REPO_ROOT / "node_modules" / ".bin" / "vitest"
    if not vitest.exists():
        return set()
    result = subprocess.run(
        [str(vitest), "--help"], capture_output=True, text=True, cwd=REPO_ROOT,
    )
    if result.returncode != 0:
        return set()
    return set(re.findall(r"(--[A-Za-z][\w-]*)", result.stdout))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def print_codemap_tree(doc_path: str) -> None:
    """Print the module's real source tree as ground truth for codemap curation."""
    module_dir = _module_dir_for_doc(doc_path)
    skip_dirs = {"docs", "node_modules", "target", "dist", "__snapshots__", "fixtures"}

    def walk(directory: Path, prefix: str) -> None:
        entries = sorted(
            [e for e in directory.iterdir() if not e.name.startswith(".")],
            key=lambda e: (e.is_file(), e.name),
        )
        for entry in entries:
            if entry.is_dir():
                if entry.name in skip_dirs:
                    continue
                print(f"{prefix}{entry.name}/")
                walk(entry, prefix + "  ")
            else:
                print(f"{prefix}{entry.name}")

    print(f"{module_dir.relative_to(REPO_ROOT)}/  (actual tree — curate, don't paste)")
    walk(module_dir, "  ")


def main():
    if "--codemap" in sys.argv:
        print_codemap_tree(sys.argv[sys.argv.index("--codemap") + 1])
        return

    json_output = "--json" in sys.argv
    all_issues: list[Issue] = []
    symbol_index: dict[str, bool] = {}
    valid_commands = _load_valid_commands()
    docs = discover_docs()

    if not json_output:
        print("Loading command index...")
        pnpm_count = sum(len(v) for v in valid_commands["pnpm"].values())
        print(f"  {pnpm_count} pnpm scripts across {len(valid_commands['pnpm'])} packages")
        print(f"  {len(valid_commands['cargo'])} cargo packages")
        print(f"  {len(valid_commands['vitest_flags'])} vitest flags")
        print(f"  {len(docs)} DOCS.md files discovered")
        print()

    # Phase 1: per-doc checks
    for doc in docs:
        if not json_output:
            print(f"  Checking {doc}...")

        tokens = parse_doc(REPO_ROOT / doc)
        all_issues.extend(check_broken_links(doc, tokens))
        all_issues.extend(check_freshness(doc))
        all_issues.extend(check_symbols(doc, tokens, symbol_index))
        all_issues.extend(check_structure(doc, tokens))
        all_issues.extend(check_codemap(doc, tokens))
        all_issues.extend(check_commands(doc, tokens, valid_commands))

    # Phase 2: routing index — links resolve, and every doc is routed
    if not json_output:
        print(f"Checking routing index ({ROUTING_INDEX})...")
    index_path = REPO_ROOT / ROUTING_INDEX
    if index_path.exists():
        tokens = parse_doc(index_path)
        all_issues.extend(check_broken_links(ROUTING_INDEX, tokens))
        all_issues.extend(check_routing_inventory(docs, tokens))
    else:
        all_issues.append(Issue("missing", "error", ROUTING_INDEX, f"{ROUTING_INDEX} does not exist"))

    # Report
    if json_output:
        errors = [i for i in all_issues if i.severity == "error"]
        warnings = [i for i in all_issues if i.severity == "warning"]
        output = {
            "total": len(all_issues),
            "errors": len(errors),
            "warnings": len(warnings),
            "by_category": {},
            "issues": [i.to_dict() for i in all_issues],
        }
        for issue in all_issues:
            output["by_category"].setdefault(issue.category, 0)
            output["by_category"][issue.category] += 1
        print(json_mod.dumps(output, indent=2))
        sys.exit(1 if errors or warnings else 0)
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
            # --ci gates only on mechanically certain problems; freshness
            # warnings are advisory so unrelated PRs never block on them.
            sys.exit(1 if errors or "--ci" not in sys.argv else 0)
        else:
            print("All docs clean.")
            sys.exit(0)


if __name__ == "__main__":
    main()

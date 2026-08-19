#!/usr/bin/env python3
# Usage: python3 scripts/check-invariants.py [--json]
"""
check-invariants.py — enforce documented architecture invariants as CI rules.

Each rule has a stable id; DOCS.md invariants cite it as
"Enforced by: scripts/check-invariants.py (<rule-id>)". A rule failing here
means the invariant prose in the docs still holds and the CODE regressed —
fix the code (or, if the architecture deliberately changed, update the rule
and the citing doc in the same commit).

Exit code 0 = all invariants hold, 1 = violations.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------------------
# Rules
# ---------------------------------------------------------------------------

# napi-boundary: the NAPI runtime may only be linked by the bridge crate and
# the wire DTO crate. Everything else talks to Rust through those boundaries,
# which is what keeps the FFI surface auditable and the domain crates portable.
NAPI_CRATES = {"napi", "napi-derive", "napi-build"}
NAPI_ALLOWED_DEPENDENTS = {"shift-bridge", "shift-wire"}

# geo-dependency-free: @shift/geo is a leaf library — zero runtime
# dependencies, and non-test sources import only sibling files. This is what
# makes its pure-function guarantee reviewable at a glance.
GEO_DIR = "packages/geo"

# glyph-state-deps: @shift/glyph-state depends on exactly @shift/types and
# @shift/geo. Readers over GlyphStructure + Float64Array must not grow
# renderer, workspace, or IO dependencies.
GLYPH_STATE_DIR = "packages/glyph-state"
GLYPH_STATE_ALLOWED = {"@shift/types", "@shift/geo"}

TEST_ONLY_IMPORTS = {"vitest"}


def check_napi_boundary() -> list[str]:
    result = subprocess.run(
        ["cargo", "metadata", "--format-version", "1", "--no-deps"],
        capture_output=True, text=True, cwd=REPO_ROOT,
    )
    if result.returncode != 0:
        return [f"napi-boundary: cargo metadata failed: {result.stderr.strip()[:200]}"]
    metadata = json.loads(result.stdout)
    violations = []
    for package in metadata["packages"]:
        if package["name"] in NAPI_ALLOWED_DEPENDENTS:
            continue
        for dep in package["dependencies"]:
            if dep["name"] in NAPI_CRATES:
                violations.append(
                    f"napi-boundary: crate `{package['name']}` depends on "
                    f"`{dep['name']}` — only {sorted(NAPI_ALLOWED_DEPENDENTS)} may link NAPI"
                )
    return violations


IMPORT_RE = re.compile(r"""(?:from|import)\s+["']([^."'][^"']*)["']""")


def _external_imports(package_dir: str) -> list[tuple[Path, str, bool]]:
    """(file, specifier, is_test_file) for every non-relative import.

    Self-references (the package's own name) are skipped — they only occur in
    JSDoc usage examples, not real imports.
    """
    own_name = json.loads((REPO_ROOT / package_dir / "package.json").read_text()).get("name")
    found = []
    for source in sorted((REPO_ROOT / package_dir / "src").rglob("*.ts")):
        is_test = ".test." in source.name
        for specifier in IMPORT_RE.findall(source.read_text()):
            if specifier == own_name:
                continue
            found.append((source, specifier, is_test))
    return found


def check_geo_dependency_free() -> list[str]:
    violations = []
    manifest = json.loads((REPO_ROOT / GEO_DIR / "package.json").read_text())
    if manifest.get("dependencies"):
        violations.append(
            f"geo-dependency-free: {GEO_DIR}/package.json declares runtime "
            f"dependencies: {sorted(manifest['dependencies'])}"
        )
    for source, specifier, is_test in _external_imports(GEO_DIR):
        if is_test and specifier in TEST_ONLY_IMPORTS:
            continue
        violations.append(
            f"geo-dependency-free: {source.relative_to(REPO_ROOT)} imports "
            f"`{specifier}` — geo sources import nothing external"
        )
    return violations


def check_glyph_state_deps() -> list[str]:
    violations = []
    manifest = json.loads((REPO_ROOT / GLYPH_STATE_DIR / "package.json").read_text())
    declared = set(manifest.get("dependencies", {}))
    if declared != GLYPH_STATE_ALLOWED:
        violations.append(
            f"glyph-state-deps: {GLYPH_STATE_DIR}/package.json dependencies are "
            f"{sorted(declared)}, expected exactly {sorted(GLYPH_STATE_ALLOWED)}"
        )
    for source, specifier, is_test in _external_imports(GLYPH_STATE_DIR):
        if is_test and specifier in TEST_ONLY_IMPORTS:
            continue
        root = "/".join(specifier.split("/")[:2]) if specifier.startswith("@") else specifier.split("/")[0]
        if root not in GLYPH_STATE_ALLOWED:
            violations.append(
                f"glyph-state-deps: {source.relative_to(REPO_ROOT)} imports "
                f"`{specifier}` — allowed roots: {sorted(GLYPH_STATE_ALLOWED)}"
            )
    return violations


RULES = {
    "napi-boundary": check_napi_boundary,
    "geo-dependency-free": check_geo_dependency_free,
    "glyph-state-deps": check_glyph_state_deps,
}


def main() -> None:
    json_output = "--json" in sys.argv
    all_violations: dict[str, list[str]] = {}
    for rule_id, rule in RULES.items():
        violations = rule()
        if violations:
            all_violations[rule_id] = violations

    if json_output:
        print(json.dumps({
            "rules": sorted(RULES),
            "violations": all_violations,
        }, indent=2))
    else:
        for rule_id in RULES:
            status = "FAIL" if rule_id in all_violations else "ok"
            print(f"  [{status}] {rule_id}")
        for violations in all_violations.values():
            for violation in violations:
                print(f"    - {violation}")
    sys.exit(1 if all_violations else 0)


if __name__ == "__main__":
    main()

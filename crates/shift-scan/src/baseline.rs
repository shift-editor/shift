//! The ratchet: each kind's count per crate and scope (`src` for library
//! and binary code, `tests` for test code), checked in as `baseline.json`
//! with one line per crate, like `clippy-ratchet.json`. `--check` fails when
//! any count differs: a rise lists every hit in that crate and scope, a fall
//! asks for `--update`. `--update` rewrites the file from the tree.

#![expect(
    clippy::print_stdout,
    reason = "the ratchet reports its result on stdout"
)]

use std::collections::BTreeMap;
use std::fmt;
use std::path::Path;

use serde_json::Value;

use crate::finding::{Finding, Kind, Scope};

/// Where the baseline lives, from the repository root.
pub(crate) const BASELINE: &str = "crates/shift-scan/baseline.json";
/// What lowers the baseline after a fix.
const UPDATE_COMMAND: &str = "pnpm scan:rust --update";

/// Why the baseline could not be read or written.
#[derive(Debug)]
pub(crate) enum BaselineError {
    Io(std::io::Error),
    Json(serde_json::Error),
    /// A kind the scanner doesn't know.
    UnknownKind(String),
    /// A scope other than `src` and `tests`.
    UnknownScope(String),
}

impl fmt::Display for BaselineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(f, "{BASELINE}: {error}"),
            Self::Json(error) => write!(f, "{BASELINE}: {error}"),
            Self::UnknownKind(name) => write!(f, "{BASELINE}: no kind is named {name}"),
            Self::UnknownScope(name) => write!(f, "{BASELINE}: no scope is named {name}"),
        }
    }
}

/// The scanner reports its failures as text on stderr.
impl From<BaselineError> for String {
    fn from(error: BaselineError) -> Self {
        error.to_string()
    }
}

/// One kind's count in one crate and scope.
type Key = (Kind, String, Scope);

/// Each kind's findings per crate and scope, and where the tree's are.
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct Counts {
    counts: BTreeMap<Key, usize>,
    places: BTreeMap<Key, Vec<String>>,
}

/// One kind in one crate and scope whose count moved.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Change {
    pub(crate) key: Key,
    pub(crate) before: usize,
    pub(crate) after: usize,
}

impl fmt::Display for Change {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let (kind, crate_name, scope) = &self.key;
        write!(
            f,
            "{kind} in {crate_name} ({scope}): {} -> {}",
            self.before, self.after
        )
    }
}

/// The counts that rose and fell against the baseline, and the kinds with no
/// hits left anywhere.
#[derive(Debug, Default)]
pub(crate) struct Comparison {
    pub(crate) rose: Vec<Change>,
    pub(crate) fell: Vec<Change>,
    pub(crate) cleared: Vec<Kind>,
}

impl Comparison {
    fn changes(&self) -> impl Iterator<Item = &Change> {
        self.rose.iter().chain(&self.fell)
    }
}

impl Counts {
    pub(crate) fn of(findings: &[Finding]) -> Self {
        let mut counts = Self::default();
        for finding in findings {
            let key = (finding.kind, finding.crate_name(), finding.kind.scope());
            *counts.counts.entry(key.clone()).or_default() += 1;
            let place = format!("{}:{}", finding.path.display(), finding.line);
            counts.places.entry(key).or_default().push(place);
        }
        counts
    }

    fn count(&self, key: &Key) -> usize {
        self.counts.get(key).copied().unwrap_or(0)
    }

    pub(crate) fn read(path: &Path) -> Result<Self, BaselineError> {
        let text = std::fs::read_to_string(path).map_err(BaselineError::Io)?;
        let value: Value = serde_json::from_str(&text).map_err(BaselineError::Json)?;
        Self::from_json(value)
    }

    fn from_json(value: Value) -> Result<Self, BaselineError> {
        let named: BTreeMap<String, BTreeMap<String, BTreeMap<String, usize>>> =
            serde_json::from_value(value).map_err(BaselineError::Json)?;
        let mut counts = Self::default();
        for (name, crates) in named {
            let kind = Kind::parse(&name).ok_or(BaselineError::UnknownKind(name))?;
            for (crate_name, scopes) in crates {
                for (scope, count) in scopes.into_iter().filter(|(_, count)| *count > 0) {
                    let scope = Scope::parse(&scope).ok_or(BaselineError::UnknownScope(scope))?;
                    counts
                        .counts
                        .insert((kind, crate_name.clone(), scope), count);
                }
            }
        }
        Ok(counts)
    }

    /// The file text: every kind by name, one line per crate with hits.
    fn format(&self) -> String {
        let mut names = Kind::ALL;
        names.sort_by_key(|kind| kind.as_str());
        let kinds: Vec<_> = names
            .iter()
            .map(|kind| {
                let mut crates: BTreeMap<&str, (usize, usize)> = BTreeMap::new();
                for ((counted, crate_name, scope), count) in &self.counts {
                    if counted != kind {
                        continue;
                    }
                    let entry = crates.entry(crate_name).or_default();
                    match scope {
                        Scope::Src => entry.0 = *count,
                        Scope::Tests => entry.1 = *count,
                    }
                }
                let lines: Vec<_> = crates
                    .iter()
                    .map(|(crate_name, (src, tests))| {
                        format!("    \"{crate_name}\": {{ \"src\": {src}, \"tests\": {tests} }}")
                    })
                    .collect();
                let body = if lines.is_empty() {
                    "{}".to_string()
                } else {
                    format!("{{\n{}\n  }}", lines.join(",\n"))
                };
                format!("  \"{kind}\": {body}")
            })
            .collect();
        format!("{{\n{}\n}}\n", kinds.join(",\n"))
    }

    /// How `self` (the tree) moved from `baseline`.
    pub(crate) fn compare(&self, baseline: &Self) -> Comparison {
        let mut keys: Vec<&Key> = self.counts.keys().chain(baseline.counts.keys()).collect();
        keys.sort_unstable();
        keys.dedup();
        let mut comparison = Comparison::default();
        for key in keys {
            let change = Change {
                key: key.clone(),
                before: baseline.count(key),
                after: self.count(key),
            };
            if change.after > change.before {
                comparison.rose.push(change);
            } else if change.after < change.before {
                comparison.fell.push(change);
            }
        }
        comparison.cleared = Kind::ALL
            .into_iter()
            .filter(|kind| !self.counts.keys().any(|(counted, _, _)| counted == kind))
            .collect();
        comparison
    }

    /// Writes the tree's counts as the new baseline, naming what moved. A
    /// missing baseline is written from scratch.
    pub(crate) fn update(&self) -> Result<(), BaselineError> {
        let baseline = match Self::read(Path::new(BASELINE)) {
            Err(BaselineError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {
                Self::default()
            }
            read => read?,
        };
        let comparison = self.compare(&baseline);
        for change in comparison.changes() {
            println!("{change}");
        }
        std::fs::write(BASELINE, self.format()).map_err(BaselineError::Io)?;
        println!("Updated {BASELINE}");
        Self::print_cleared(&comparison);
        Ok(())
    }

    /// Compares the tree with the baseline and says whether every count is
    /// at it. A rise lists every hit of that kind in that crate and scope.
    pub(crate) fn check(&self) -> Result<bool, BaselineError> {
        let comparison = self.compare(&Self::read(Path::new(BASELINE))?);
        for change in &comparison.rose {
            eprintln!("rose: {change}");
            for place in self.places.get(&change.key).into_iter().flatten() {
                eprintln!("  {place}");
            }
        }
        for change in &comparison.fell {
            eprintln!("fell: {change}");
        }
        Self::print_cleared(&comparison);
        if !comparison.rose.is_empty() {
            eprintln!("New shift-scan hits. Fix them; the baseline never goes up.");
            return Ok(false);
        }
        if !comparison.fell.is_empty() {
            eprintln!("Fewer hits than the baseline. Lower it: {UPDATE_COMMAND}");
            return Ok(false);
        }
        println!("shift-scan: {} kinds at their baseline", Kind::ALL.len());
        Ok(true)
    }

    fn print_cleared(comparison: &Comparison) {
        for kind in &comparison.cleared {
            println!("{kind} has no hits left: it can become a hard rule");
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    fn finding(kind: Kind, path: &str) -> Finding {
        Finding {
            path: PathBuf::from(path),
            line: 1,
            kind,
            detail: String::new(),
        }
    }

    fn key(kind: Kind, crate_name: &str) -> Key {
        (kind, crate_name.to_string(), kind.scope())
    }

    #[test]
    fn counts_are_per_kind_per_crate_and_scope() {
        let counts = Counts::of(&[
            finding(Kind::GetPrefix, "crates/shift-font/src/ir/contour.rs"),
            finding(Kind::GetPrefix, "crates/shift-font/src/ir/font.rs"),
            finding(Kind::LongTest, "crates/shift-font/src/ir/font.rs"),
        ]);
        assert_eq!(counts.count(&key(Kind::GetPrefix, "shift-font")), 2);
        assert_eq!(
            counts.count(&(Kind::LongTest, "shift-font".to_string(), Scope::Tests)),
            1
        );
        assert_eq!(counts.count(&key(Kind::IterSuffix, "shift-font")), 0);
    }

    #[test]
    fn a_rise_and_a_fall_are_both_named() {
        let baseline = Counts::of(&[
            finding(Kind::GetPrefix, "crates/a/src/lib.rs"),
            finding(Kind::GetPrefix, "crates/a/src/lib.rs"),
        ]);
        let tree = Counts::of(&[
            finding(Kind::GetPrefix, "crates/a/src/lib.rs"),
            finding(Kind::LeakedStatic, "crates/b/src/lib.rs"),
        ]);
        let comparison = tree.compare(&baseline);
        let rose: Vec<_> = comparison.rose.iter().map(ToString::to_string).collect();
        let fell: Vec<_> = comparison.fell.iter().map(ToString::to_string).collect();
        assert_eq!(rose, ["leaked-static in b (src): 0 -> 1"]);
        assert_eq!(fell, ["get-prefix in a (src): 2 -> 1"]);
        assert!(comparison.cleared.contains(&Kind::CrateHeader));
        assert!(!comparison.cleared.contains(&Kind::GetPrefix));
    }

    #[test]
    fn the_baseline_reads_back_what_it_wrote() {
        let counts = Counts::of(&[finding(Kind::CrateHeader, "crates/a/src/lib.rs")]);
        let text = counts.format();
        assert!(
            text.contains("  \"crate-header\": {\n    \"a\": { \"src\": 1, \"tests\": 0 }\n  },")
        );
        assert!(text.contains("  \"get-prefix\": {},"));
        let read = Counts::from_json(serde_json::from_str(&text).unwrap()).unwrap();
        assert_eq!(read.counts, counts.counts);
    }

    #[test]
    fn an_unknown_kind_is_rejected() {
        let json: Value = serde_json::from_str(r#"{"no-such-kind": {"a": {"src": 1}}}"#).unwrap();
        assert!(matches!(
            Counts::from_json(json),
            Err(BaselineError::UnknownKind(name)) if name == "no-such-kind"
        ));
    }
}

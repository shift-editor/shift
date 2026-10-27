use std::fmt;
use std::path::PathBuf;

/// What a finding points at. Each is a prompt for a reviewer, not an error:
/// some free functions are right as they are.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Kind {
    /// A free function whose first argument is a type of the same crate.
    MethodCandidate,
    /// The same public method name and arity on three or more types.
    TraitCandidate,
    /// A method chain of six or more steps.
    LongChain,
    /// The same error built by `ok_or_else` or `map_err` three or more times in
    /// one file, which a helper trait or a `From` impl would say once.
    RepeatedErrorMapping,
    /// A `From`/`TryFrom` impl whose struct literal reads four or more fields
    /// straight off its parameter.
    FieldCopyConversion,
}

impl Kind {
    pub(crate) const ALL: [Self; 5] = [
        Self::MethodCandidate,
        Self::TraitCandidate,
        Self::LongChain,
        Self::RepeatedErrorMapping,
        Self::FieldCopyConversion,
    ];

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::MethodCandidate => "method-candidate",
            Self::TraitCandidate => "trait-candidate",
            Self::LongChain => "long-chain",
            Self::RepeatedErrorMapping => "repeated-error-mapping",
            Self::FieldCopyConversion => "field-copy-conversion",
        }
    }

    pub(crate) fn parse(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|kind| kind.as_str() == name)
    }
}

impl fmt::Display for Kind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// One place worth a look, with what was seen there.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct Finding {
    pub(crate) path: PathBuf,
    pub(crate) line: usize,
    pub(crate) kind: Kind,
    pub(crate) detail: String,
}

impl fmt::Display for Finding {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{}:{}\t{}\t{}",
            self.path.display(),
            self.line,
            self.kind,
            self.detail
        )
    }
}

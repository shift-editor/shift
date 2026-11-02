use std::fmt;
use std::path::{Component, Path, PathBuf};

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
    /// A function body alike one elsewhere in the workspace: the same tokens
    /// or the same arithmetic, which one owner should compute once.
    DuplicateBody,
    /// `collect::<Vec<_>>()` where the field, argument or return type already
    /// fixes the collection, or only to call `into_boxed_slice`.
    CollectTurbofish,
    /// A struct or enum whose field or variant names are the same as another
    /// type's, or at least 80% of the larger one's.
    DuplicateType,
    /// A struct or enum name defined more than once across the workspace.
    TypeNameCollision,
    /// A public function named `get_*`: a lookup is the noun.
    GetPrefix,
    /// A public function named `*_iter`: the plural is the collection.
    IterSuffix,
    /// An associated `with_*` function without `self`: `with_<field>` is a
    /// builder step, `new` or `with_id` constructs.
    CtorWithPrefix,
    /// A `FooId` parameter named `foo`, the name of the value it identifies.
    IdParamName,
    /// A type named `*Data`, `*Info` or `*State`.
    GenericSuffix,
    /// A function returning `Result<_, String>`, or an error variant holding
    /// only a message.
    StringlyError,
    /// A `*NotFound` or `MissingEntity` error built outside a `require_*`
    /// helper.
    InlineNotFound,
    /// A function returning a tuple, bare or inside `Result` or `Option`.
    TupleReturn,
    /// An `impl From`, `Default`, `Display`, `Index` or other infallible trait
    /// whose body can panic.
    PanickingConversion,
    /// A `#[napi]` function without `catch_unwind`: its panic aborts Node.
    NapiWithoutCatchUnwind,
    /// A parallel iterator collected into a `Result`, which reports whichever
    /// error a thread hits first.
    ParallelFirstError,
    /// `Box::leak`, `String::leak` or `.leak()`: memory never freed.
    LeakedStatic,
    /// A function calling itself with no depth, budget or visited set in sight.
    UnguardedRecursion,
    /// An id accessor that clones an owned id instead of lending it.
    OwnedIdAccessor,
    /// `find` or `position` comparing an id or name: a missing index.
    LinearLookup,
    /// An inline test module over 300 lines, which belongs in a sibling
    /// `tests.rs`.
    LargeInlineTests,
    /// A crate root with no `//!` header.
    CrateHeader,
    /// A unit test calling a non-`pub` function of its crate (`pub(crate)`
    /// included) that its own test module doesn't define.
    TestCallsPrivate,
    /// A public function only test code names.
    TestOnlyPub,
    /// A unit test whose body is over 40 lines.
    LongTest,
    /// A test with at least 85% of its tokens in common with another test
    /// in the same file.
    NearDuplicateTests,
    /// A test helper defined in two or more test files under one name, or
    /// with a body alike another's.
    RepeatedTestHelper,
    /// `assert!(r.is_err())`, or an error's `to_string().contains(..)`: an
    /// assert that passes for the wrong error.
    WeakErrorAssert,
    /// A test opening with the same two statements as four or more others
    /// in its crate.
    TestSetupCopy,
}

impl Kind {
    pub(crate) const ALL: [Self; 33] = [
        Self::MethodCandidate,
        Self::TraitCandidate,
        Self::LongChain,
        Self::RepeatedErrorMapping,
        Self::FieldCopyConversion,
        Self::DuplicateBody,
        Self::CollectTurbofish,
        Self::DuplicateType,
        Self::TypeNameCollision,
        Self::GetPrefix,
        Self::IterSuffix,
        Self::CtorWithPrefix,
        Self::IdParamName,
        Self::GenericSuffix,
        Self::StringlyError,
        Self::InlineNotFound,
        Self::TupleReturn,
        Self::PanickingConversion,
        Self::NapiWithoutCatchUnwind,
        Self::ParallelFirstError,
        Self::LeakedStatic,
        Self::UnguardedRecursion,
        Self::OwnedIdAccessor,
        Self::LinearLookup,
        Self::LargeInlineTests,
        Self::CrateHeader,
        Self::TestCallsPrivate,
        Self::TestOnlyPub,
        Self::LongTest,
        Self::NearDuplicateTests,
        Self::RepeatedTestHelper,
        Self::WeakErrorAssert,
        Self::TestSetupCopy,
    ];

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::MethodCandidate => "method-candidate",
            Self::TraitCandidate => "trait-candidate",
            Self::LongChain => "long-chain",
            Self::RepeatedErrorMapping => "repeated-error-mapping",
            Self::FieldCopyConversion => "field-copy-conversion",
            Self::DuplicateBody => "duplicate-body",
            Self::CollectTurbofish => "collect-turbofish",
            Self::DuplicateType => "duplicate-type",
            Self::TypeNameCollision => "type-name-collision",
            Self::GetPrefix => "get-prefix",
            Self::IterSuffix => "iter-suffix",
            Self::CtorWithPrefix => "ctor-with-prefix",
            Self::IdParamName => "id-param-name",
            Self::GenericSuffix => "generic-suffix",
            Self::StringlyError => "stringly-error",
            Self::InlineNotFound => "inline-not-found",
            Self::TupleReturn => "tuple-return",
            Self::PanickingConversion => "panicking-conversion",
            Self::NapiWithoutCatchUnwind => "napi-without-catch-unwind",
            Self::ParallelFirstError => "parallel-first-error",
            Self::LeakedStatic => "leaked-static",
            Self::UnguardedRecursion => "unguarded-recursion",
            Self::OwnedIdAccessor => "owned-id-accessor",
            Self::LinearLookup => "linear-lookup",
            Self::LargeInlineTests => "large-inline-tests",
            Self::CrateHeader => "crate-header",
            Self::TestCallsPrivate => "test-calls-private",
            Self::TestOnlyPub => "test-only-pub",
            Self::LongTest => "long-test",
            Self::NearDuplicateTests => "near-duplicate-tests",
            Self::RepeatedTestHelper => "repeated-test-helper",
            Self::WeakErrorAssert => "weak-error-assert",
            Self::TestSetupCopy => "test-setup-copy",
        }
    }
    /// Where this kind's hits are. Listed in full, so a new kind has to
    /// choose.
    pub(crate) fn scope(self) -> Scope {
        match self {
            Self::LargeInlineTests
            | Self::TestCallsPrivate
            | Self::LongTest
            | Self::NearDuplicateTests
            | Self::RepeatedTestHelper
            | Self::WeakErrorAssert
            | Self::TestSetupCopy => Scope::Tests,
            Self::MethodCandidate
            | Self::TraitCandidate
            | Self::LongChain
            | Self::RepeatedErrorMapping
            | Self::FieldCopyConversion
            | Self::DuplicateBody
            | Self::CollectTurbofish
            | Self::DuplicateType
            | Self::TypeNameCollision
            | Self::GetPrefix
            | Self::IterSuffix
            | Self::CtorWithPrefix
            | Self::IdParamName
            | Self::GenericSuffix
            | Self::StringlyError
            | Self::InlineNotFound
            | Self::TupleReturn
            | Self::PanickingConversion
            | Self::NapiWithoutCatchUnwind
            | Self::ParallelFirstError
            | Self::LeakedStatic
            | Self::UnguardedRecursion
            | Self::OwnedIdAccessor
            | Self::LinearLookup
            | Self::CrateHeader
            | Self::TestOnlyPub => Scope::Src,
        }
    }

    pub(crate) fn parse(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|kind| kind.as_str() == name)
    }
}

/// Where a kind's hits are: library and binary code, or test code.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) enum Scope {
    Src,
    Tests,
}

impl Scope {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Src => "src",
            Self::Tests => "tests",
        }
    }

    pub(crate) fn parse(name: &str) -> Option<Self> {
        [Self::Src, Self::Tests]
            .into_iter()
            .find(|scope| scope.as_str() == name)
    }
}

impl fmt::Display for Scope {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
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

impl Finding {
    /// The crate a finding is in: the directory after `crates/`, or the
    /// first path component outside the workspace layout.
    pub(crate) fn crate_name(&self) -> String {
        let parts: Vec<_> = self.path.components().map(Component::as_os_str).collect();
        let index = parts
            .iter()
            .position(|part| *part == "crates")
            .map_or(0, |crates| crates + 1);
        parts
            .get(index)
            .map(|part| part.to_string_lossy().into_owned())
            .unwrap_or_default()
    }
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

/// The findings of one file, as a visitor collects them.
pub(crate) struct Report<'a> {
    path: &'a Path,
    pub(crate) found: Vec<Finding>,
}

impl<'a> Report<'a> {
    pub(crate) fn new(path: &'a Path) -> Self {
        Self {
            path,
            found: Vec::new(),
        }
    }

    pub(crate) fn add(&mut self, kind: Kind, span: proc_macro2::Span, detail: String) {
        self.found.push(Finding {
            path: self.path.to_path_buf(),
            line: span.start().line,
            kind,
            detail,
        });
    }
}

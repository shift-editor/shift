/// Describes source concepts changed or omitted while importing into Shift.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ImportReport {
    pub losses: Vec<ImportLoss>,
}

/// One source concept that Shift cannot represent with identical semantics.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ImportLoss {
    pub kind: ImportLossKind,
    pub message: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ImportLossKind {
    Converted,
    Approximated,
    Omitted,
}

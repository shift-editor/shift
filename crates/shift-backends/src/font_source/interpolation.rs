use shift_font::AxisRange;

#[derive(Clone, Debug)]
pub(crate) struct InterpolationAxis {
    pub(crate) tag: String,
    /// The axis's bounds in design space.
    pub(crate) range: AxisRange,
}

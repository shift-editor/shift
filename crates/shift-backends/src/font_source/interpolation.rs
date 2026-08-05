#[derive(Clone, Debug)]
pub(crate) struct InterpolationAxis {
    pub(crate) tag: String,
    pub(crate) minimum: f64,
    pub(crate) default: f64,
    pub(crate) maximum: f64,
}

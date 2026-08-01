/// One drawing command consumed by Slug preprocessing.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum OutlineCommand<T> {
    Move {
        x: T,
        y: T,
    },
    Line {
        x: T,
        y: T,
    },
    Quad {
        cx: T,
        cy: T,
        x: T,
        y: T,
    },
    Cubic {
        c1x: T,
        c1y: T,
        c2x: T,
        c2y: T,
        x: T,
        y: T,
    },
    Close,
}

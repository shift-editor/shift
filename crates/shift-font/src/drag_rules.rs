//! Point-neighbourhood rules a drag applies, so handles follow the points
//! they belong to and smooth points stay smooth.
//!
//! A drag starts by matching each selected point's neighbourhood against a
//! table of patterns ([`PreparedDrag::new`]); every frame then turns the drag
//! delta into absolute positions for the selected points and the points the
//! matched rules move ([`PreparedDrag::moves`]). Positions are always computed
//! from the points as the drag found them, never from the previous frame.
//!
//! # Patterns
//!
//! A pattern reads the points around the matched one, which sits in the
//! middle: `N` no point (past the end of an open contour), `C` a corner
//! (on-curve, not smooth), `S` a smooth on-curve point, `H` a handle
//! (off-curve), and `@` another selected point. The matched point itself is
//! always written by its type. Templates add `X` (any of `N`, `C`, `S`, `H`)
//! and sets such as `[CS]`, and expand into concrete patterns when the table
//! is built. Windows of five and three points are tried; a pattern's
//! precedence is its length times 1000 plus its rule's priority, so a
//! five-point match always beats a three-point one.

use std::collections::{BTreeMap, HashSet};
use std::sync::OnceLock;

use indexmap::IndexMap;
use kurbo::{Point, Vec2};

use crate::PointType;

/// What a matched rule does to the points around the dragged one.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RuleId {
    /// An anchor drags its right handle along.
    MoveRightHandle,
    /// An anchor drags its left handle along.
    MoveLeftHandle,
    /// An anchor drags both its handles along.
    MoveBothHandles,
    /// Dragging a handle of a smooth point turns the handle before it.
    MaintainTangencyRight,
    /// Dragging a handle of a smooth point turns the handle after it.
    MaintainTangencyLeft,
    /// Dragging a point keeps the smooth points beside it smooth.
    MaintainTangencyBoth,
    /// A handle stays on the line through its smooth point and the point past it.
    MaintainCollinearity,
}

/// A point a rule reads or moves, named by what it is to the rule.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    LeftHandle,
    RightHandle,
    Smooth,
    OppositeHandle,
    Target,
    Reference,
    LeftSmooth,
    RightSmooth,
    OtherSmooth,
    OtherHandle,
    AssociatedHandle,
    End,
}

/// A role and its point's offset from the matched point.
type Affected = (Role, isize);

/// One rule's patterns: the rule, its priority, whether it may take over
/// patterns an earlier rule claimed, and its templates.
#[derive(Clone, Copy, Debug)]
pub struct RuleSpec {
    pub id: RuleId,
    pub priority: i32,
    pub allow_override: bool,
    pub entries: &'static [RuleEntry],
}

/// A pattern template and the points it names.
#[derive(Clone, Copy, Debug)]
pub struct RuleEntry {
    pub template: &'static str,
    pub affected: &'static [Affected],
}

use Role::{
    AssociatedHandle, End, LeftHandle, LeftSmooth, OppositeHandle, OtherHandle, OtherSmooth,
    Reference, RightHandle, RightSmooth, Smooth, Target,
};

/// Shift's drag rules.
pub const RULE_SPECS: &[RuleSpec] = &[
    RuleSpec {
        id: RuleId::MoveRightHandle,
        priority: 0,
        allow_override: false,
        entries: &[RuleEntry {
            template: "[X@][CS]H",
            affected: &[(RightHandle, 1)],
        }],
    },
    RuleSpec {
        id: RuleId::MoveLeftHandle,
        priority: 1,
        allow_override: true,
        entries: &[RuleEntry {
            template: "H[CS][X@]",
            affected: &[(LeftHandle, -1)],
        }],
    },
    RuleSpec {
        id: RuleId::MoveBothHandles,
        priority: 2,
        allow_override: true,
        entries: &[RuleEntry {
            template: "H[CS]H",
            affected: &[(LeftHandle, -1), (RightHandle, 1)],
        }],
    },
    RuleSpec {
        id: RuleId::MaintainTangencyRight,
        priority: 0,
        allow_override: false,
        entries: &[RuleEntry {
            template: "HS[HC][@X][@X]",
            affected: &[(Smooth, -1), (OppositeHandle, -2)],
        }],
    },
    RuleSpec {
        id: RuleId::MaintainTangencyLeft,
        priority: 2,
        allow_override: true,
        entries: &[RuleEntry {
            template: "[@X][CH]S",
            affected: &[(Smooth, 1), (OppositeHandle, 2)],
        }],
    },
    RuleSpec {
        id: RuleId::MaintainTangencyBoth,
        priority: 3,
        allow_override: true,
        entries: &[
            RuleEntry {
                template: "HSC",
                affected: &[(Target, -1), (Reference, 1)],
            },
            RuleEntry {
                template: "CSC",
                affected: &[(Target, -1), (Reference, 1)],
            },
            RuleEntry {
                template: "CSH",
                affected: &[(Target, -1), (Reference, 1)],
            },
            RuleEntry {
                template: "HSCSH",
                affected: &[
                    (LeftHandle, -2),
                    (LeftSmooth, -1),
                    (RightSmooth, 1),
                    (RightHandle, 2),
                ],
            },
            RuleEntry {
                template: "HHSSH",
                affected: &[(AssociatedHandle, -1), (OtherSmooth, 1), (OtherHandle, 2)],
            },
            RuleEntry {
                template: "HSSHH",
                affected: &[(OtherHandle, -2), (OtherSmooth, -1), (AssociatedHandle, 1)],
            },
        ],
    },
    RuleSpec {
        id: RuleId::MaintainCollinearity,
        priority: 0,
        allow_override: false,
        entries: &[
            RuleEntry {
                template: "[CS][HC@]HS[CS]",
                affected: &[(Smooth, 1), (End, 2)],
            },
            RuleEntry {
                template: "[CS]SH[H@][CS]",
                affected: &[(Smooth, -1), (End, -2)],
            },
        ],
    },
];

const WINDOW_SIZES: [usize; 2] = [5, 3];
const WINDOW_SIZE_WEIGHT: i32 = 1000;
const ALL_POINT_TOKENS: [u8; 4] = [b'N', b'C', b'S', b'H'];
const EPSILON: f64 = 1e-10;

/// Why a set of rule specs does not build a table: two rules claim one
/// pattern without one of them overriding the other by precedence.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum RuleTableError {
    #[error("duplicate concrete pattern {pattern:?} from {rule:?} collides with {existing:?}")]
    Duplicate {
        pattern: String,
        rule: RuleId,
        existing: RuleId,
    },
    #[error("override of pattern {pattern:?} by {rule:?} has lower precedence than {existing:?}")]
    LowerPrecedence {
        pattern: String,
        rule: RuleId,
        existing: RuleId,
    },
    #[error("ambiguous override of pattern {pattern:?} between {rule:?} and {existing:?}")]
    Ambiguous {
        pattern: String,
        rule: RuleId,
        existing: RuleId,
    },
}

/// A concrete pattern's rule.
#[derive(Clone, Copy, Debug)]
struct RuleMatch {
    rule: RuleId,
    affected: &'static [Affected],
    score: i32,
}

/// Concrete patterns and their rules.
#[derive(Debug, Default)]
pub struct RuleTable {
    patterns: BTreeMap<Vec<u8>, RuleMatch>,
}

impl RuleTable {
    /// Expands every spec's templates and files each concrete pattern under
    /// its rule.
    ///
    /// # Errors
    ///
    /// Returns [`RuleTableError`] when a pattern two rules claim is not
    /// resolved by an explicit override with higher precedence.
    pub fn from_specs(specs: &[RuleSpec]) -> Result<Self, RuleTableError> {
        let mut table = Self::default();
        for spec in specs {
            for entry in spec.entries {
                for pattern in expand_pattern(entry.template) {
                    table.insert(spec, entry, pattern)?;
                }
            }
        }
        Ok(table)
    }

    /// Shift's rules, built once.
    pub fn shift() -> &'static Self {
        static TABLE: OnceLock<RuleTable> = OnceLock::new();
        TABLE.get_or_init(|| {
            let table = Self::from_specs(RULE_SPECS);
            debug_assert!(table.is_ok(), "Shift's drag rules collide: {table:?}");
            table.unwrap_or_default()
        })
    }

    /// The rule a concrete pattern matches, if any.
    pub fn rule(&self, pattern: &str) -> Option<RuleId> {
        self.patterns
            .get(pattern.as_bytes())
            .map(|found| found.rule)
    }

    fn insert(
        &mut self,
        spec: &RuleSpec,
        entry: &RuleEntry,
        pattern: Vec<u8>,
    ) -> Result<(), RuleTableError> {
        let score = precedence(pattern.len(), spec.priority);
        if let Some(existing) = self.patterns.get(&pattern)
            && existing.rule != spec.id
        {
            let error = |make: fn(String, RuleId, RuleId) -> RuleTableError| {
                make(
                    String::from_utf8_lossy(&pattern).into_owned(),
                    spec.id,
                    existing.rule,
                )
            };
            if !spec.allow_override {
                return Err(error(|pattern, rule, existing| RuleTableError::Duplicate {
                    pattern,
                    rule,
                    existing,
                }));
            }
            if score < existing.score {
                return Err(error(|pattern, rule, existing| {
                    RuleTableError::LowerPrecedence {
                        pattern,
                        rule,
                        existing,
                    }
                }));
            }
            if score == existing.score {
                return Err(error(|pattern, rule, existing| RuleTableError::Ambiguous {
                    pattern,
                    rule,
                    existing,
                }));
            }
        }
        self.patterns.insert(
            pattern,
            RuleMatch {
                rule: spec.id,
                affected: entry.affected,
                score,
            },
        );
        Ok(())
    }
}

fn precedence(length: usize, priority: i32) -> i32 {
    i32::try_from(length)
        .unwrap_or(i32::MAX / WINDOW_SIZE_WEIGHT)
        .saturating_mul(WINDOW_SIZE_WEIGHT)
        .saturating_add(priority)
}

/// Every concrete pattern a template stands for.
///
/// `X` stands for any of `N`, `C`, `S` and `H`, also inside a set; a set such
/// as `[CS]` for each of its tokens. An empty set matches nothing.
pub fn expand_pattern(template: &str) -> Vec<Vec<u8>> {
    let bytes = template.as_bytes();
    let mut choices: Vec<Vec<u8>> = Vec::new();
    let mut index = 0;
    while let Some(&token) = bytes.get(index) {
        match token {
            b'[' => {
                let mut set = Vec::new();
                index += 1;
                while let Some(&member) = bytes.get(index) {
                    index += 1;
                    match member {
                        b']' => break,
                        b'X' => set.extend(ALL_POINT_TOKENS),
                        other => set.push(other),
                    }
                }
                if set.is_empty() {
                    return Vec::new();
                }
                choices.push(set);
            }
            b'X' => {
                choices.push(ALL_POINT_TOKENS.to_vec());
                index += 1;
            }
            other => {
                choices.push(vec![other]);
                index += 1;
            }
        }
    }

    let mut patterns = vec![Vec::new()];
    for choice in &choices {
        patterns = patterns
            .iter()
            .flat_map(|prefix| {
                choice.iter().map(move |&token| {
                    let mut pattern = prefix.clone();
                    pattern.push(token);
                    pattern
                })
            })
            .collect();
    }
    patterns.retain(|pattern| !pattern.is_empty());
    patterns
}

/// One contour point as the rules read it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DragPoint {
    pub position: Point,
    pub point_type: PointType,
    pub smooth: bool,
}

impl DragPoint {
    fn is_handle(&self) -> bool {
        self.point_type == PointType::OffCurve
    }
}

/// A contour as the rules read it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct DragContour {
    pub closed: bool,
    pub points: Vec<DragPoint>,
}

impl DragContour {
    /// The index `offset` points from `center`, wrapping around a closed
    /// contour; `None` past either end of an open one.
    fn index_at(&self, center: usize, offset: isize) -> Option<usize> {
        let count = isize::try_from(self.points.len()).ok()?;
        let index = isize::try_from(center).ok()?.checked_add(offset)?;
        if (0..count).contains(&index) {
            return usize::try_from(index).ok();
        }
        if !self.closed || count == 0 {
            return None;
        }
        usize::try_from(index.rem_euclid(count)).ok()
    }
}

/// A point by its contour's index and its index in the contour.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct PointRef {
    pub contour: usize,
    pub point: usize,
}

/// A rule matched around one selected point.
#[derive(Clone, Debug, PartialEq)]
pub struct MatchedRule {
    /// The selected point the pattern is centred on.
    pub point: PointRef,
    pub rule: RuleId,
    /// The concrete pattern that matched.
    pub pattern: String,
    /// The points the rule names, by role; a role whose point is past the
    /// end of an open contour is absent.
    pub affected: Vec<(Role, PointRef)>,
}

impl MatchedRule {
    fn role(&self, role: Role) -> Option<PointRef> {
        self.affected
            .iter()
            .find_map(|&(candidate, point)| (candidate == role).then_some(point))
    }
}

/// One point's position for a drag frame.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PointMove {
    pub point: PointRef,
    pub position: Point,
}

/// A drag's matched rules over the points as the drag found them.
#[derive(Clone, Debug)]
pub struct PreparedDrag {
    contours: Vec<DragContour>,
    selected: Vec<PointRef>,
    matched: Vec<MatchedRule>,
}

impl PreparedDrag {
    /// Matches the rules for dragging `selected` points of `contours`, each
    /// once, in the order given; points that are not in `contours` are
    /// ignored. A selection of corners with no handle or smooth point beside
    /// them matches nothing, and translates as it is.
    pub fn new(contours: Vec<DragContour>, selected: impl IntoIterator<Item = PointRef>) -> Self {
        let mut seen = HashSet::new();
        let selected: Vec<PointRef> = selected
            .into_iter()
            .filter(|point| point_in(&contours, *point).is_some() && seen.insert(*point))
            .collect();
        let mut drag = Self {
            contours,
            selected,
            matched: Vec::new(),
        };
        if drag.needs_rules() {
            let table = RuleTable::shift();
            drag.matched = drag
                .selected
                .iter()
                .filter_map(|&point| drag.match_rule(table, point, &seen))
                .collect();
        }
        drag
    }

    /// The rules matched, one per selected point that matched any.
    pub fn matched(&self) -> &[MatchedRule] {
        &self.matched
    }

    /// Whether every selected point just translates: no rule matched.
    pub fn is_uniform_translation(&self) -> bool {
        self.matched.is_empty()
    }

    /// Positions for a frame `delta` from where the drag started: each
    /// selected point moved by `delta`, in selection order, then the points
    /// rules move. A rule's position wins over a selected point's.
    pub fn moves(&self, delta: Vec2) -> Vec<PointMove> {
        let mut moves: IndexMap<PointRef, Point> = self
            .selected
            .iter()
            .filter_map(|&point| Some((point, self.position(point)? + delta)))
            .collect();
        for rule in &self.matched {
            for (point, position) in self.apply(rule, delta) {
                moves.insert(point, position);
            }
        }
        moves
            .into_iter()
            .map(|(point, position)| PointMove { point, position })
            .collect()
    }

    fn position(&self, point: PointRef) -> Option<Point> {
        point_in(&self.contours, point).map(|found| found.position)
    }

    /// Whether any selected point is a handle or smooth, or sits beside one.
    fn needs_rules(&self) -> bool {
        self.selected.iter().any(|&point| {
            let Some(contour) = self.contours.get(point.contour) else {
                return false;
            };
            [0, -1, 1].into_iter().any(|offset| {
                contour
                    .index_at(point.point, offset)
                    .and_then(|index| contour.points.get(index))
                    .is_some_and(|neighbour| neighbour.is_handle() || neighbour.smooth)
            })
        })
    }

    fn match_rule(
        &self,
        table: &RuleTable,
        point: PointRef,
        selected: &HashSet<PointRef>,
    ) -> Option<MatchedRule> {
        let contour = self.contours.get(point.contour)?;
        let (pattern, found) = WINDOW_SIZES
            .iter()
            .filter_map(|&window| {
                let pattern = pattern_at(contour, point, window, selected);
                let found = table.patterns.get(&pattern)?;
                Some((pattern, *found))
            })
            // Windows differ in length, so their scores never tie.
            .max_by_key(|(_, found)| found.score)?;
        let affected = found
            .affected
            .iter()
            .filter_map(|&(role, offset)| {
                let index = contour.index_at(point.point, offset)?;
                Some((
                    role,
                    PointRef {
                        contour: point.contour,
                        point: index,
                    },
                ))
            })
            .collect();
        Some(MatchedRule {
            point,
            rule: found.rule,
            pattern: String::from_utf8_lossy(&pattern).into_owned(),
            affected,
        })
    }

    /// The positions `rule` gives the points it moves for `delta`.
    fn apply(&self, rule: &MatchedRule, delta: Vec2) -> Vec<(PointRef, Point)> {
        let at = |role| {
            let point = rule.role(role)?;
            Some((point, self.position(point)?))
        };
        let Some(selected) = self.position(rule.point) else {
            return Vec::new();
        };
        let translated = |found: Option<(PointRef, Point)>| found.map(|(id, p)| (id, p + delta));
        match rule.rule {
            RuleId::MoveRightHandle => translated(at(RightHandle)).into_iter().collect(),
            RuleId::MoveLeftHandle => translated(at(LeftHandle)).into_iter().collect(),
            RuleId::MoveBothHandles => {
                let mut moves: Vec<_> = translated(at(LeftHandle)).into_iter().collect();
                if let Some(right) = translated(at(RightHandle))
                    && moves.first().is_none_or(|(left, _)| *left != right.0)
                {
                    moves.push(right);
                }
                moves
            }
            RuleId::MaintainTangencyRight | RuleId::MaintainTangencyLeft => {
                let (Some((_, smooth)), Some((opposite_id, opposite))) =
                    (at(Smooth), at(OppositeHandle))
                else {
                    return Vec::new();
                };
                vec![(
                    opposite_id,
                    maintain_tangency(selected, smooth, opposite, delta),
                )]
            }
            RuleId::MaintainTangencyBoth => tangency_both(selected, delta, at),
            RuleId::MaintainCollinearity => {
                let (Some((_, smooth)), Some((_, end))) = (at(Smooth), at(End)) else {
                    return Vec::new();
                };
                maintain_collinearity(smooth, end, selected, delta)
                    .map(|position| (rule.point, position))
                    .into_iter()
                    .collect()
            }
        }
    }
}

/// `MaintainTangencyBoth` for whichever of its three shapes matched.
fn tangency_both(
    selected: Point,
    delta: Vec2,
    at: impl Fn(Role) -> Option<(PointRef, Point)>,
) -> Vec<(PointRef, Point)> {
    // A smooth point between a handle and a point that stays: turn the handle
    // to keep the smooth point's tangent through the other point.
    if let (Some((target_id, target)), Some((_, reference))) = (at(Target), at(Reference)) {
        let moved = selected + delta;
        let direction = normalize(reference - moved);
        let length = length(target - selected);
        return vec![(target_id, moved + direction * -length)];
    }

    // A corner between two smooth points: each smooth point keeps its handle
    // in line with the corner.
    if let (
        Some((left_id, left)),
        Some((_, left_smooth)),
        Some((_, right_smooth)),
        Some((right_id, right)),
    ) = (
        at(LeftHandle),
        at(LeftSmooth),
        at(RightSmooth),
        at(RightHandle),
    ) {
        return vec![
            (
                left_id,
                maintain_tangency(selected, left_smooth, left, delta),
            ),
            (
                right_id,
                maintain_tangency(selected, right_smooth, right, delta),
            ),
        ];
    }

    // Two smooth points in a row: both handles turn to the line between them.
    if let (Some((_, other_smooth)), Some((other_id, other)), Some((associated_id, associated))) =
        (at(OtherSmooth), at(OtherHandle), at(AssociatedHandle))
    {
        let moved = selected + delta;
        let direction = normalize(other_smooth - moved);
        let associated_length = length(selected - associated);
        let other_length = length(other_smooth - other);
        return vec![
            (associated_id, moved + direction * -associated_length),
            (other_id, other_smooth + direction * other_length),
        ];
    }

    Vec::new()
}

/// The opposite handle of a smooth point, turned to stay in line with the
/// dragged handle and keeping its own length.
fn maintain_tangency(selected: Point, smooth: Point, opposite: Point, delta: Vec2) -> Point {
    let arm = (selected - smooth) + delta;
    let opposite_length = length(opposite - smooth);
    smooth + normalize(arm) * -opposite_length
}

/// The dragged handle projected onto the line from `end` through `smooth`,
/// on the far side of `smooth`; `None` when that line or the projection
/// collapses.
fn maintain_collinearity(smooth: Point, end: Point, handle: Point, delta: Vec2) -> Option<Point> {
    let axis = smooth - end;
    let axis_length_squared = axis.dot(axis);
    if axis_length_squared < EPSILON * EPSILON {
        return None;
    }
    let target = handle + delta;
    let t = (target - smooth).dot(axis) / axis_length_squared;
    if t.abs() < EPSILON {
        return None;
    }
    Some(smooth + axis * t.abs())
}

/// The pattern of `window` points centred on `point`.
fn pattern_at(
    contour: &DragContour,
    point: PointRef,
    window: usize,
    selected: &HashSet<PointRef>,
) -> Vec<u8> {
    let half = isize::try_from(window / 2).unwrap_or_default();
    (-half..=half)
        .map(|offset| {
            let Some(index) = contour.index_at(point.point, offset) else {
                return b'N';
            };
            let Some(found) = contour.points.get(index) else {
                return b'N';
            };
            let other = PointRef {
                contour: point.contour,
                point: index,
            };
            if offset != 0 && selected.contains(&other) {
                b'@'
            } else if found.is_handle() {
                b'H'
            } else if found.smooth {
                b'S'
            } else {
                b'C'
            }
        })
        .collect()
}

fn point_in(contours: &[DragContour], point: PointRef) -> Option<&DragPoint> {
    contours.get(point.contour)?.points.get(point.point)
}

/// A vector's length, with the same bits natively and in WebAssembly.
fn length(vector: Vec2) -> f64 {
    libm::hypot(vector.x, vector.y)
}

/// A unit vector along `vector`, or zero for a vector too short to point.
fn normalize(vector: Vec2) -> Vec2 {
    let length = length(vector);
    if length < EPSILON {
        return Vec2::ZERO;
    }
    vector / length
}

#[cfg(test)]
mod tests;

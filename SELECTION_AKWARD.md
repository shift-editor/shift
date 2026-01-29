Here’s a concise take based on how selection and the rest of the editor are used.
Current design
Selection: Set<PointId> / Set<SegmentId> everywhere — internal state and public API (getSelectedPoints(): ReadonlySet<PointId>, selectPoints(ids: Set<PointId>), etc.).
Editor / glyph: GlyphSnapshot with array-shaped data (contours, etc.).
Commands: All take pointIds: PointId[] (e.g. RotatePointsCommand, ScalePointsCommand, deleteSelectedPoints → removePoints([...selectedIds])).
So you have Sets at the selection boundary and arrays everywhere else (snapshots, commands). The boundary is where the mismatch shows up.
Where the friction is
In Editor.ts, selection is turned into an array at every call site that talks to commands or glyph APIs:
deleteSelectedPoints: [...selectedIds] → removePoints(...)
paste: new Set(cmd.createdPointIds) for input, and commands already work in arrays
rotateSelection, scaleSelection, reflectSelection, moveSelectionTo, alignSelection, distributeSelection: each does const pointIds = [...this.#selection.selectedPointIds.peek()] then passes pointIds to a command
getSelectionCenter path: Array.from(selectedPointIds) for the points array
So the “natural” type for the command layer is already array; the Set is converted at the boundary every time.
Consumers that truly benefit from a Set are:
getSegmentAwareBounds: uses .size and .has(id) in a loop → Set is a good fit internally.
ContentResolver: takes ReadonlySet, iterates and does set-like operations; could accept an array and build a Set internally if needed.
useSelectionBounds: uses selectedPointIds.size; would be .length with an array.
GlyphRenderer: uses .size and Array.from(...); with an array it would use .length and the array as-is.
isPointSelected(id): O(1) with a Set; you’d keep this on the selection API regardless.
So the only place that really needs set semantics for performance is code that does many .has(id) lookups (e.g. getSegmentAwareBounds). That can be satisfied by building a Set inside that function.
Opinion: arrays at the boundary, Sets inside
Using arrays at the boundary and Sets only inside the selection layer is consistent and would simplify the Editor:
Consistency with the rest of the stack
Snapshots and commands are array-based. Exposing selection as “list of IDs” at the boundary matches that. One collection shape at the API boundary (arrays) and one internal representation (Sets) is easier to reason about than Sets at the boundary and arrays everywhere else.
Less boilerplate in Editor
Instead of:
const pointIds = [...this.#selection.selectedPointIds.peek()];
you could do:
const pointIds = this.selection.getSelectedPoints();
and pass pointIds straight into commands. Same for deleteSelectedPoints and similar.
Internal representation stays correct
SelectionManager can still store a Set (deduping, O(1) add/remove/has). The boundary becomes:
In: selectPoints(ids: readonly PointId[]) → new Set(ids) inside.
Out: getSelectedPoints(): readonly PointId[] → Array.from(set) or [...set].
Cost of “array at boundary”
One allocation per “read” when something calls getSelectedPoints(). You already allocate when you spread in each command; with a single array at the boundary you might have fewer allocations (one array per consumer per update instead of one per command).
getSegmentAwareBounds(snapshot, selectedPointIds): if it takes readonly PointId[], it can do const set = new Set(selectedPointIds) at the top and keep its current .size/.has() logic. One small Set per bounds computation is negligible.
Membership checks
Keep isPointSelected(id) (and segment equivalent) on the selection API. Then UI and other code don’t need to do selectedPointIds.includes(id); they keep O(1) membership via the service.
So: yes, arrays at the boundary and Sets internally is a design I’d recommend. It aligns the selection API with snapshots and commands, removes repeated Set→array conversions in Editor, and keeps set semantics and performance where they matter (inside the selection layer and inside functions like getSegmentAwareBounds that want a Set for their own implementation).

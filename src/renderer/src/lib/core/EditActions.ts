import { Vector2D } from '@/lib/math/vector';
import { AppliedEdit, Edit } from '@/types/edit';

import { ContourPoint } from './Contour';
import { EditContext } from './EditEngine';

export const MaintainTangency = (
  ctx: EditContext,
  anchor: ContourPoint,
  selected: ContourPoint,
  opposite: ContourPoint,
  dx: number,
  dy: number
): AppliedEdit => {
  // Get the original magnitude of the opposite handle - this must be preserved
  const oppositeMagnitude = new Vector2D(opposite.x - anchor.x, opposite.y - anchor.y).length();
  const newSelectedVector = new Vector2D(selected.x - anchor.x, selected.y - anchor.y);

  // Create the opposite vector: opposite direction, preserving original magnitude
  const vectorLength = newSelectedVector.length();
  let newOppositeVector: Vector2D;

  if (vectorLength < 1e-10) {
    // Handle edge case: if the selected vector is essentially zero
    const originalOppositeVector = new Vector2D(opposite.x - anchor.x, opposite.y - anchor.y);
    newOppositeVector = originalOppositeVector; // Keep original direction
  } else {
    const normalizedDirection = newSelectedVector.normalize();
    newOppositeVector = normalizedDirection.multiply(-oppositeMagnitude);
  }

  // Calculate final position for opposite handle
  const newOppositePos = new Vector2D(
    anchor.x + newOppositeVector.x,
    anchor.y + newOppositeVector.y
  );

  // Create edits - selected point is already moved, so just record the edit
  const selectedEdit: Edit = {
    point: selected,
    from: { x: selected.x - dx, y: selected.y - dy }, // Original position before the first move
    to: { x: selected.x, y: selected.y }, // Current position (already moved)
  };

  const oppositeEdit: Edit = {
    point: opposite,
    from: { x: opposite.x, y: opposite.y },
    to: { x: newOppositePos.x, y: newOppositePos.y },
  };

  // Only move the opposite handle (selected is already moved)
  ctx.movePointTo(opposite, newOppositePos.x, newOppositePos.y);

  return {
    point: anchor,
    edits: [selectedEdit, oppositeEdit],
    affectedPoints: [selected, opposite],
  };
};

import type { SVG } from "@/types/common";
import { LOCK_PATH_DATA, LOCK_VIEW_BOX_SIZE } from "@/lib/editor/rendering/icons/lock";

export const LockIcon: SVG = (props) => (
  <svg
    viewBox={`0 0 ${LOCK_VIEW_BOX_SIZE} ${LOCK_VIEW_BOX_SIZE}`}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path d={LOCK_PATH_DATA} fill="currentColor" />
  </svg>
);

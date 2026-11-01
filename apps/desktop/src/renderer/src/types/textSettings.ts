import type { TextRunRecord } from "@shift/editor/text";
import type { TextRunNode } from "@shift/editor/types";

/** The proof text the sidebar's text settings apply to, and the node that places it. */
export interface TextSettingsTarget {
  readonly run: TextRunRecord;
  readonly node: TextRunNode;
}

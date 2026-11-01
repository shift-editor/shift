import { useSignalState } from "@shift/editor/signals";
import type { TextLayoutFailure } from "@shift/editor/text";
import { useEditor } from "@/workspace/WorkspaceContext";

/**
 * Says over the canvas why proof text is not shown, when a run's text could
 * not be laid out or its layout could not load what it shows.
 */
export function TextLayoutFailureNotice() {
  const editor = useEditor();
  const failure = useSignalState(editor.text.layoutFailureCell);
  if (!failure) return null;

  return (
    <p
      role="alert"
      className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-md bg-surface px-3 py-1.5 text-ui text-error card-shadow"
    >
      {failureMessage(failure)}
    </p>
  );
}

function failureMessage(failure: TextLayoutFailure): string {
  const reason = failure.error instanceof Error ? failure.error.message : String(failure.error);
  switch (failure.stage) {
    case "layout":
      return `Text could not be laid out: ${reason}`;
    case "preload":
      return `Glyphs the text shows could not be loaded: ${reason}`;
    case "module":
      return `The text layout module did not load: ${reason}`;
  }
}

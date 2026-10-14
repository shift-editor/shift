import type { FeatureDiagnostic } from "@shift/types";
import { cn } from "@shift/ui";
import ErrorIcon from "@/assets/general/error.svg";
import InfoIcon from "@/assets/general/info.svg";
import WarningIcon from "@/assets/general/warning.svg";
import { DockedPanel } from "./DockedPanel";

/** Rows mounted at most; a font importing someone else's code can report thousands. */
const MAX_ROWS = 500;

interface ProblemsPanelProps {
  readonly diagnostics: readonly FeatureDiagnostic[];
  /** The one-based line and column `offset` is at. */
  readonly positionOf: (offset: number) => { readonly line: number; readonly column: number };
  readonly onSelect: (diagnostic: FeatureDiagnostic) => void;
  readonly onClose: () => void;
}

/**
 * Every problem in the code, docked under it, laid out as IDE problem lists
 * are: severity icon, message, where it came from, then line and column.
 * Choosing one jumps to it.
 */
export const ProblemsPanel = ({
  diagnostics,
  positionOf,
  onSelect,
  onClose,
}: ProblemsPanelProps) => {
  const shown = diagnostics.slice(0, MAX_ROWS);
  const hidden = diagnostics.length - shown.length;
  return (
    <DockedPanel
      label="Problems"
      title={
        <span className="flex items-center gap-1.5">
          Problems
          <span className="rounded-full bg-input px-1.5 text-xs font-normal text-secondary tabular-nums">
            {diagnostics.length}
          </span>
        </span>
      }
      onClose={onClose}
    >
      <ul>
        {shown.length === 0 ? (
          <li className="px-4 py-1 text-ui text-secondary">No problems</li>
        ) : null}
        {shown.map((diagnostic, index) => {
          // A problem in generated code has no line of its own; it names its feature instead.
          const where = diagnostic.generatedTag
            ? `in ${diagnostic.generatedTag} (generated)`
            : linePosition(positionOf(diagnostic.from));
          return (
            <li key={`${diagnostic.from}-${index}`}>
              <button
                type="button"
                className="flex h-6 w-full items-center gap-2 px-4 text-left text-ui hover:bg-hover/50"
                onClick={() => onSelect(diagnostic)}
              >
                <SeverityIcon severity={diagnostic.severity} />
                <span className="min-w-0 truncate text-primary">{diagnostic.message}</span>
                <span className="shrink-0 text-secondary">
                  {diagnostic.rule ? `Feanor ${diagnostic.rule}` : "Compiler"}
                </span>
                <span className="ml-auto shrink-0 pl-3 text-secondary tabular-nums">{where}</span>
              </button>
            </li>
          );
        })}
        {hidden > 0 ? (
          <li className="px-4 py-1 text-ui text-secondary">
            {hidden} more; fix or ignore these to see the rest
          </li>
        ) : null}
      </ul>
    </DockedPanel>
  );
};

const SeverityIcon = ({ severity }: { readonly severity: FeatureDiagnostic["severity"] }) => {
  const className = "size-3.5 shrink-0";
  if (severity === "error") {
    return <ErrorIcon aria-label="Error" className={cn(className, "text-error")} />;
  }
  if (severity === "warning") {
    return <WarningIcon aria-label="Warning" className={cn(className, "text-canvas-orange")} />;
  }
  return <InfoIcon aria-label="Hint" className={cn(className, "text-icon-subtle")} />;
};

function linePosition(position: { readonly line: number; readonly column: number }): string {
  return `${position.line}:${position.column}`;
}

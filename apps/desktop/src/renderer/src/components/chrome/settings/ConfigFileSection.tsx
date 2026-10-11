import { Button } from "@shift/ui";
import type { ConfigProblem } from "@shared/config/config";
import { useTheme } from "@/context/ThemeContext";
import { getShiftHost } from "@/host/shiftHost";

/**
 * Where this build's `config.toml` lives, and what is wrong with it.
 *
 * @remarks
 * Settings edits the file; anything it reports here came from the file itself,
 * so the fix is usually in the file too.
 */
export const ConfigFileSection = () => {
  const { config, unknownTheme, saveError } = useTheme();
  if (!config) return null;

  const fileName = `${config.directory}/config.toml`;

  return (
    <section className="flex flex-col gap-2" aria-label="Config file">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="text-ui font-medium text-primary">Config file</h3>
          <p className="truncate font-mono text-ui text-secondary" title={fileName}>
            {fileName}
          </p>
        </div>
        <Button
          variant="muted"
          onClick={async () => {
            try {
              await getShiftHost().config.reveal();
            } catch (error) {
              console.error("Cannot open the config folder", error);
            }
          }}
        >
          Open folder
        </Button>
      </div>
      {saveError ? (
        <p role="alert" className="text-ui text-error">
          Not saved: {saveError}
        </p>
      ) : null}
      {unknownTheme ? (
        <p className="text-ui text-secondary">
          config.toml chooses theme “{unknownTheme}”, which Shift does not have; using the default.
        </p>
      ) : null}
      {config.problems.length > 0 ? (
        <ul className="flex flex-col gap-1" aria-label="Config problems">
          {config.problems.map((problem, index) => (
            <li key={index} className={problemClass(problem)}>
              {problemText(problem)}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
};

function problemClass({ severity }: ConfigProblem): string {
  return severity === "error" ? "text-ui text-error" : "text-ui text-secondary";
}

function problemText({ severity, message, line, column }: ConfigProblem): string {
  const location = line === null ? "config.toml" : `config.toml:${line}:${column ?? 1}`;
  const consequence = severity === "error" ? " Shift is using the last valid settings." : "";
  return `${location} ${message}${consequence}`;
}

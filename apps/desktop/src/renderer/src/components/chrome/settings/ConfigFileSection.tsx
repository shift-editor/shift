import {
  Button,
  Popover,
  PopoverPopup,
  PopoverPortal,
  PopoverPositioner,
  PopoverTrigger,
} from "@shift/ui";
import type { ConfigProblem } from "@shift/types";
import type { AppConfigState, ThemeFileState } from "@shared/config/config";
import type { UnknownThemeColors } from "@/lib/themes";
import { useTheme } from "@/context/ThemeContext";
import { getShiftHost } from "@/host/shiftHost";
import HelpIcon from "@/assets/general/help.svg";

/**
 * Where this build's `config.toml` lives, and what is wrong with it.
 *
 * @remarks
 * Settings edits the file; anything it reports here came from the file itself,
 * so the fix is usually in the file too.
 */
export const ConfigFileSection = () => {
  const { config, unknownThemes, saveError, shadowingThemeFiles, unknownThemeColors } = useTheme();
  if (!config) return null;

  const reports = fileReports(config, shadowingThemeFiles, unknownThemeColors);
  const fileName = `${config.directory}/config.toml`;
  const folderName = config.directory.split(/[\\/]/).filter(Boolean).at(-1) ?? config.directory;

  return (
    <section className="flex flex-col gap-2" aria-label="Config file">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-1">
            <h3 className="text-ui font-medium text-primary">Config file</h3>
            <ConfigFileHelp />
          </div>
          <p className="truncate font-mono text-ui text-secondary" title={fileName}>
            {folderName}/config.toml
          </p>
        </div>
        <div className="shrink-0 whitespace-nowrap">
          <Button
            variant="default"
            size="field"
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
      </div>
      {saveError ? (
        <p role="alert" className="text-ui text-error">
          Not saved: {saveError}
        </p>
      ) : null}
      {unknownThemes.map((name) => (
        <p key={name} className="text-ui text-secondary">
          config.toml chooses theme “{name}”, which Shift does not have; using the default.
        </p>
      ))}
      {reports.length > 0 ? (
        <ul className="flex flex-col gap-1" aria-label="Config problems">
          {reports.map((report, index) => (
            <li key={index} className={reportClass(report)}>
              {report.text}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
};

/** A "?" that explains the config file, on hover or click. */
const ConfigFileHelp = () => (
  <Popover>
    <PopoverTrigger openOnHover delay={200} aria-label="About the config file" variant="hint">
      <HelpIcon className="h-3.5 w-3.5" />
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverPositioner side="top" sideOffset={6}>
        <PopoverPopup className="max-w-64">
          <p className="px-2 py-1.5 text-ui leading-relaxed text-secondary">
            Settings saves your mode and themes in <Code>config.toml</Code>, and Shift applies any
            edit you make to it. Add your own themes as <Code>.toml</Code> files in the{" "}
            <Code>themes</Code> folder.
          </p>
        </PopoverPopup>
      </PopoverPositioner>
    </PopoverPortal>
  </Popover>
);

const Code = ({ children }: { children: string }) => (
  <code className="rounded-sm bg-hover px-1 py-px font-mono text-primary">{children}</code>
);

interface FileReport {
  severity: ConfigProblem["severity"];
  text: string;
}

/** Every problem in `config.toml` and `themes/`, labeled with its file and what Shift did. */
function fileReports(
  config: AppConfigState,
  shadowing: readonly ThemeFileState[],
  unknownColors: readonly UnknownThemeColors[],
): FileReport[] {
  const reports = config.problems.map((problem) =>
    report("config.toml", problem, "Shift is using the last valid settings."),
  );
  for (const file of config.themes) {
    const consequence = file.theme
      ? "Shift is using the theme's last valid colors."
      : "The theme is not listed until this is fixed.";
    for (const problem of file.problems) {
      reports.push(report(`themes/${file.id}.toml`, problem, consequence));
    }
  }
  for (const file of shadowing) {
    reports.push({
      severity: "warning",
      text: `themes/${file.id}.toml shares its name with a built-in theme and is ignored; rename the file.`,
    });
  }
  for (const { file, names } of unknownColors) {
    const quoted = names.map((name) => `"${name}"`).join(", ");
    reports.push({
      severity: "warning",
      text: `themes/${file.id}.toml sets ${quoted}, which Shift has no color for; ignored.`,
    });
  }
  return reports;
}

function report(fileName: string, problem: ConfigProblem, consequence: string): FileReport {
  const { severity, message, line, column } = problem;
  const location = line === undefined ? fileName : `${fileName}:${line}:${column ?? 1}`;
  const suffix = severity === "error" ? ` ${consequence}` : "";
  return { severity, text: `${location} ${message}${suffix}` };
}

function reportClass({ severity }: FileReport): string {
  return severity === "error" ? "text-ui text-error" : "text-ui text-secondary";
}

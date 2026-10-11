import overview from "../../../skills/shift/SKILL.md?raw";
import cli from "../../../skills/shift/references/cli.md?raw";
import fonts from "../../../skills/shift/references/fonts.md?raw";
import mcp from "../../../skills/shift/references/mcp.md?raw";
import variableFonts from "../../../skills/shift/references/variable-fonts.md?raw";

/** Sections of the bundled Shift skill that `shift.guide` serves. */
export const SHIFT_GUIDE_TOPICS = ["overview", "mcp", "cli", "fonts", "variable-fonts"] as const;

export type ShiftGuideTopic = (typeof SHIFT_GUIDE_TOPICS)[number];

const GUIDE: Record<ShiftGuideTopic, string> = {
  overview,
  mcp,
  cli,
  fonts,
  "variable-fonts": variableFonts,
};

/** The command the release build installs, which the skill text names. */
const RELEASE_COMMAND = "shift-cli";

/**
 * Returns one section of the Shift skill shipped with this build.
 *
 * @remarks
 * The skill's links point at `references/<topic>.md`; agents reading it over
 * MCP request those references by topic instead. Builds other than the release
 * install their CLI under their own name, so their guide opens by naming it.
 *
 * @param command - the command-line tool this build installs, such as `shift-cli-nightly`.
 */
export function shiftGuide(topic: ShiftGuideTopic, command: string = RELEASE_COMMAND): string {
  const preface =
    command === RELEASE_COMMAND
      ? ""
      : `This build installs its command-line tool as \`${command}\`. Run \`${command}\` wherever this guide says \`${RELEASE_COMMAND}\`.\n\n`;
  if (topic !== "overview") return preface + GUIDE[topic];

  const topics = SHIFT_GUIDE_TOPICS.filter((name) => name !== "overview").join(", ");
  return `${preface}${GUIDE.overview}\n---\n\nOver MCP, read a reference with \`shift.guide\` and \`topic\` set to one of: ${topics}.\n`;
}

/** Initialization instructions every MCP client receives on connect. */
export const SHIFT_MCP_INSTRUCTIONS = [
  "Shift is a desktop font editor; this server reads the fonts open in the running app.",
  "Call shift.guide first for how to work with Shift, then shift.describe for the exact typed API used inside shift.execute.",
  "This server is read-only: it inspects, renders, and captures, but cannot change a font.",
].join(" ");

import type { AgentCallMap, EditorControlOperation } from "@shared/agent/protocol";
import type { CommandId } from "@shared/commands";
import type { WindowRouter } from "@/lib/tabs/WindowNavigation";
import type { AgentRevisions } from "./AgentRevisions";
import type { ShiftEditorControl } from "./ShiftEditorControl";
import type { ShiftEditorReader } from "./ShiftEditorReader";

/** The agent-lane calls that control the window, by name. */
export type ControlOperation = EditorControlOperation | "commands.run";

/** One control call as the agent lane serves it. */
export type ControlCall<K extends ControlOperation> = (
  input: AgentCallMap[K]["request"],
) => Promise<AgentCallMap[K]["response"]>;

/** Every control call, by its agent-lane name. */
export type ControlCalls = { readonly [K in ControlOperation]: ControlCall<K> };

/**
 * The calls an agent makes to control one window (`shift.commands.run` and
 * `shift.editor.*`): the window's editor control and its command request,
 * behind its font-revision guard.
 *
 * @remarks
 * Each call checks `ifFontRevision` before it changes anything. None changes
 * font data, so each answers with the revision it was checked against.
 */
export class AgentControl {
  /** The handlers the agent lane serves, by call name. */
  readonly calls: ControlCalls;

  /**
   * @param router - The window's route, which the editor view reports.
   * @param runCommand - Runs an app command as the window's own menu and
   * shortcuts request it (`ShiftHost.commands.run`).
   */
  constructor(
    control: ShiftEditorControl,
    reader: ShiftEditorReader,
    revisions: AgentRevisions,
    router: WindowRouter,
    runCommand: (command: CommandId) => Promise<void>,
  ) {
    const view = () => reader.inspect(router.pathname());
    this.calls = {
      "commands.run": ({ command, ifFontRevision }) =>
        revisions.write(ifFontRevision, async () => {
          await runCommand(command);
          return null;
        }),
      "editor.setTool": ({ ifFontRevision, tool }) =>
        revisions.write(ifFontRevision, async () => {
          control.setTool(tool);
          return view();
        }),
      "editor.showPage": ({ ifFontRevision, pageId }) =>
        revisions.write(ifFontRevision, async () => {
          control.showPage(pageId);
          return view();
        }),
      "editor.openGlyph": ({ ifFontRevision, glyph }) =>
        revisions.write(ifFontRevision, async () => {
          await control.openGlyph(glyph);
          return view();
        }),
      "editor.setView": ({ ifFontRevision, ...input }) =>
        revisions.write(ifFontRevision, async () => {
          control.setView(input);
          return view();
        }),
      "editor.select": ({ ifFontRevision, ids }) =>
        revisions.write(ifFontRevision, async () => {
          control.select(ids);
          return view();
        }),
    };
  }
}

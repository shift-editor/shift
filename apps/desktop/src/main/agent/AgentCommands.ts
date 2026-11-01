import {
  CommandDisabledError,
  CommandNotFoundError,
  CommandNotRunnableError,
  type CommandRun,
  type CommandRunInput,
  type CommandSummary,
  type FontRevision,
  type ShiftObservation,
} from "@shift/runtime";
import { commandShortcut, toElectronAccelerator, type CommandId } from "../../shared/commands";
import type { Command, CommandContext, CommandRegistry } from "../commands/Command";

/** What {@link AgentCommands} needs of one window an agent names. */
export interface AgentCommandWindow {
  /** The context the window's own menu runs commands in, resolved now. */
  context(): CommandContext;
  /**
   * Runs `command` through the window's own command request once
   * `ifFontRevision`, when given, still matches.
   *
   * @throws {FontChangedError} when it no longer matches; nothing ran.
   */
  run(command: CommandId, ifFontRevision?: FontRevision): Promise<ShiftObservation<null>>;
}

/**
 * The app commands agents may list and run: the registry's `view` commands,
 * which change only what a window shows or its session state.
 *
 * @remarks
 * Which commands those are is each command's own `effect`, declared once in
 * the registry, so a new command chooses when it is added. A command runs the
 * way its menu item runs it, for the window the agent names.
 */
export class AgentCommands {
  readonly #registry: CommandRegistry;
  readonly #windowFor: (windowId: number) => AgentCommandWindow;

  /**
   * @param windowFor - Resolves a window an agent names; throws when it is not
   * open or has no font session.
   */
  constructor(registry: CommandRegistry, windowFor: (windowId: number) => AgentCommandWindow) {
    this.#registry = registry;
    this.#windowFor = windowFor;
  }

  /** Returns the commands an agent may run in window `windowId`, in menu order, with whether each can run now. */
  list(windowId: number): CommandSummary[] {
    const context = this.#windowFor(windowId).context();
    return this.#registry.withEffect("view").map((command) => ({
      id: command.id,
      title: command.label,
      shortcut: shortcutOf(command),
      enabled: this.#registry.isEnabled(command.id, context),
    }));
  }

  /**
   * Runs one view command for the window, as choosing its menu item there does.
   *
   * @throws {CommandNotFoundError} when no command has that id.
   * @throws {CommandNotRunnableError} when the command changes font data, files or anything outside the window.
   * @throws {CommandDisabledError} when it cannot run in the window now.
   * @throws {FontChangedError} when `ifFontRevision` no longer matches.
   */
  async run({ windowId, command: id, ifFontRevision }: CommandRunInput): Promise<CommandRun> {
    const window = this.#windowFor(windowId);
    const command = this.#registry.find(id);
    if (!command) throw new CommandNotFoundError(id);
    if (command.effect !== "view") throw new CommandNotRunnableError(id, command.effect);
    if (!this.#registry.isEnabled(command.id, window.context())) {
      throw new CommandDisabledError(id);
    }

    await window.run(command.id, ifFontRevision);
    return { ran: true };
  }
}

function shortcutOf(command: Command): string | null {
  const shortcut = commandShortcut(command.id);
  return shortcut ? toElectronAccelerator(shortcut) : null;
}

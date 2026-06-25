import type { CommandId } from "../../shared/commands";
import type { Window } from "../windows/Window";

/**
 * Stores app commands and runs them against the current main-process context.
 *
 * @remarks
 * The registry owns command lookup and enabled checks. It does not own app
 * state; callers provide a fresh {@link CommandContext} each time a command
 * runs so commands resolve the current window at execution time.
 */
export class CommandRegistry {
  #commands = new Map<CommandId, Command>();

  /**
   * Adds one command to the registry.
   *
   * @param command - Command definition whose ID must be unique within the registry.
   * @throws {Error} when another command already uses the same ID.
   */
  register(command: Command): void {
    if (this.#commands.has(command.id)) {
      throw new Error(`Command already registered: ${command.id}`);
    }

    this.#commands.set(command.id, command);
  }

  /**
   * Looks up a command by ID.
   *
   * @param id - Command identity to resolve.
   * @returns the registered command, or `null` when the ID is not registered.
   */
  get(id: CommandId): Command | null {
    return this.#commands.get(id) ?? null;
  }

  /**
   * Returns a snapshot of registered commands.
   *
   * @returns a fresh array; mutating it does not change the registry.
   */
  list(): Command[] {
    return [...this.#commands.values()];
  }

  /**
   * Checks whether a command can run in the supplied context.
   *
   * @param id - Command identity to check.
   * @param ctx - Current app state available to command implementations.
   * @returns `false` when the command is missing or its enabled predicate rejects the context.
   */
  isEnabled(id: CommandId, ctx: CommandContext): boolean {
    const command = this.get(id);
    if (!command) return false;
    return command.enabled?.(ctx) ?? true;
  }

  /**
   * Runs a command if it is registered and enabled.
   *
   * @param id - Command identity to run.
   * @param ctx - Current app state available to command implementations.
   * @throws {Error} when the command ID is not registered.
   */
  async run(id: CommandId, ctx: CommandContext): Promise<void> {
    const command = this.get(id);
    if (!command) {
      throw new Error(`Unknown command: ${id}`);
    }

    if (!this.isEnabled(id, ctx)) {
      return;
    }

    await command.run(ctx);
  }
}

/**
 * Main-process state exposed to command implementations.
 *
 * @remarks
 * Accessors should resolve live state at call time. Commands should not retain
 * objects from this context after they finish running.
 */
export type CommandContext = {
  document: {
    /** Creates a new untitled workspace through main's document workflow. */
    create: () => Promise<void>;
    open: () => Promise<void>;
    /** Returns whether the active window is attached to a workspace. */
    hasWorkspace: () => boolean;
    /** Saves through main's native document workflow. */
    save: () => Promise<void>;
    /** Runs main's native Save As workflow. */
    saveAs: () => Promise<void>;
  };
  windows: {
    /**
     * Returns the current working window.
     *
     * @returns `null` when the app has not created a window or the window is gone.
     */
    active: () => Window | null;
  };
};

/**
 * Declarative app command owned by the main process.
 *
 * @remarks
 * Command metadata can be reused by menus, command palettes, shortcuts, and
 * renderer chrome while the `run` callback remains the single behavior source.
 */
export type Command = {
  /** Stable command identity shared across process boundaries. */
  id: CommandId;
  /** Human-readable label suitable for menus or command palettes. */
  label: string;
  /** Optional longer explanation for command palettes or accessibility hints. */
  description?: string;
  /** Optional Electron accelerator string for native menu bindings. */
  accelerator?: string;
  /** Returns whether the command can run in the current app context. */
  enabled?: (ctx: CommandContext) => boolean;
  /** Performs the command's main-process side effects. */
  run: (ctx: CommandContext) => void | Promise<void>;
};

/**
 * Stateless command executor.
 *
 * Commands are verb scripts over the active glyph layer; they carry no
 * undo machinery. Undo authority lives in the workspace ledger — every
 * verb a command calls pushes intents that coalesce into one ledger entry
 * per tick, so a command IS one undo step without any history bookkeeping.
 */
import type { Signal } from "@/lib/signals/signal";
import type { GlyphLayer } from "@/lib/model/Glyph";
import type { Command, CommandContext } from "./Command";

export class CommandRunner {
  readonly #$layer: Signal<GlyphLayer | null>;

  constructor($layer: Signal<GlyphLayer | null>) {
    this.#$layer = $layer;
  }

  run<TResult>(command: Command<TResult>): TResult {
    return command.execute(this.#context());
  }

  #context(): CommandContext {
    const layer = this.#$layer.peek();
    if (!layer) {
      throw new Error("Cannot execute command without an active glyph layer");
    }

    return { layer };
  }
}

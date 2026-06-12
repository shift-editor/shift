/**
 * Stateless command executor.
 *
 * Commands are verb scripts over the active glyph source; they carry no
 * undo machinery. Undo authority lives in the workspace ledger — every
 * verb a command calls pushes intents that coalesce into one ledger entry
 * per tick, so a command IS one undo step without any history bookkeeping.
 */
import type { Signal } from "@/lib/signals/signal";
import type { GlyphSource } from "@/lib/model/Glyph";
import type { Command, CommandContext } from "./Command";

export class CommandRunner {
  readonly #$source: Signal<GlyphSource | null>;

  constructor($source: Signal<GlyphSource | null>) {
    this.#$source = $source;
  }

  run<TResult>(command: Command<TResult>): TResult {
    return command.execute(this.#context());
  }

  #context(): CommandContext {
    const source = this.#$source.peek();
    if (!source) {
      throw new Error("Cannot execute command without an active glyph source");
    }

    return { source };
  }
}

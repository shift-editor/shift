interface Command {
  undo(): void;
}

export class UndoManager {
  #undoStack: Command[] = [];

  push(command: Command) {
    this.#undoStack.push(command);
  }

  peek() {
    return this.#undoStack[this.#undoStack.length - 1];
  }

  undo() {
    const command = this.#undoStack.pop();
    if (command) {
      command.undo();
    }
  }

  clear() {
    this.#undoStack = [];
  }
}

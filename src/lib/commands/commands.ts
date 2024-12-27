export interface Command {
  execute(): void;
}

export class CommandManager {
  commands: Command[] = [];

  execute(cmd: Command): void {
    cmd.execute();
    this.commands.push(cmd);
  }
}

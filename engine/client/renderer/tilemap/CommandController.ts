export interface Command {
  func: () => void;
  undo: () => void;
  cache?: unknown;
}

const MAX_HISTORY = 500;

/**
 * Linear undo/redo stack. `addCommand` executes by default and pushes, trimming the redo tail.
 * `undo`/`redo` walk the pointer. Synchronous only — networking and rendering happen inside `func`.
 */
export class CommandController {
  readonly commands: Command[] = [];
  readonly defaultCommands: Record<string, () => void>;

  /** Index at which the next `addCommand` will be written. Also the redo pointer. */
  private _nowInsertIndex = 0;

  constructor(defaultCommands: Record<string, () => void> = {}) {
    this.defaultCommands = defaultCommands;
  }

  get nowInsertIndex(): number { return this._nowInsertIndex; }

  addCommand(cmd: Command, execute = true): void {
    this.commands.length = this._nowInsertIndex;
    this.commands.push(cmd);
    this._nowInsertIndex++;
    if (this.commands.length > MAX_HISTORY) {
      const drop = this.commands.length - MAX_HISTORY;
      this.commands.splice(0, drop);
      this._nowInsertIndex -= drop;
    }
    if (execute) cmd.func();
  }

  undo(): void {
    if (this._nowInsertIndex === 0) return;
    this._nowInsertIndex--;
    this.commands[this._nowInsertIndex].undo();
  }

  redo(): void {
    if (this._nowInsertIndex >= this.commands.length) return;
    this.commands[this._nowInsertIndex].func();
    this._nowInsertIndex++;
  }

  clear(): void {
    this.commands.length = 0;
    this._nowInsertIndex = 0;
  }
}

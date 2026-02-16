/**
 * A gap buffer for efficient text editing at the cursor position.
 *
 * Stores Unicode codepoints with a movable gap at the cursor. Insertions
 * and deletions at the cursor are O(1); moving the cursor shifts elements
 * across the gap boundary.
 */
export class GapBuffer<T> {
  #buf: Array<T | undefined>;
  #gapStart: number;
  #gapEnd: number;

  private constructor(capacity: number) {
    this.#buf = Array.from<T | undefined>({ length: capacity });
    this.#gapStart = 0;
    this.#gapEnd = capacity;
  }

  static create<T>(capacity = 64): GapBuffer<T> {
    return new GapBuffer<T>(capacity);
  }

  static from<T>(items: T[], cursor?: number): GapBuffer<T> {
    const gap = new GapBuffer<T>(items.length + 16);
    for (const item of items) {
      gap.insert(item);
    }
    if (cursor !== undefined) {
      gap.moveTo(cursor);
    }
    return gap;
  }

  get cursorPosition(): number {
    return this.#gapStart;
  }

  get length(): number {
    return this.#buf.length - (this.#gapEnd - this.#gapStart);
  }

  insert(item: T): void {
    if (this.#gapStart === this.#gapEnd) {
      this.#grow();
    }
    this.#buf[this.#gapStart] = item;
    this.#gapStart++;
  }

  /** Backspace: delete the character before the cursor. */
  delete(): boolean {
    if (this.#gapStart === 0) return false;
    this.#gapStart--;
    return true;
  }

  moveLeft(): boolean {
    if (this.#gapStart === 0) return false;
    this.#gapEnd--;
    this.#buf[this.#gapEnd] = this.#buf[this.#gapStart - 1] as T;
    this.#gapStart--;
    return true;
  }

  moveRight(): boolean {
    if (this.#gapEnd === this.#buf.length) return false;
    this.#buf[this.#gapStart] = this.#buf[this.#gapEnd] as T;
    this.#gapStart++;
    this.#gapEnd++;
    return true;
  }

  /**
   * Move cursor to an absolute index, clamped to [0, length].
   */
  moveTo(index: number): void {
    const clampedIndex = Math.max(0, Math.min(index, this.length));
    while (this.#gapStart > clampedIndex) {
      this.moveLeft();
    }
    while (this.#gapStart < clampedIndex) {
      this.moveRight();
    }
  }

  /** Return the compacted array of codepoints (no gap). */
  getText(): T[] {
    const result: T[] = [];
    for (let i = 0; i < this.#gapStart; i++) {
      result.push(this.#buf[i] as T);
    }
    for (let i = this.#gapEnd; i < this.#buf.length; i++) {
      result.push(this.#buf[i] as T);
    }
    return result;
  }

  clear(): void {
    this.#gapStart = 0;
    this.#gapEnd = this.#buf.length;
  }

  #grow(): void {
    const newCapacity = this.#buf.length * 2;
    const newBuf = Array.from<T | undefined>({ length: newCapacity });
    const tailLen = this.#buf.length - this.#gapEnd;

    // Copy before gap
    for (let i = 0; i < this.#gapStart; i++) {
      newBuf[i] = this.#buf[i];
    }
    // Copy after gap to end of new buffer
    const newGapEnd = newCapacity - tailLen;
    for (let i = 0; i < tailLen; i++) {
      newBuf[newGapEnd + i] = this.#buf[this.#gapEnd + i];
    }

    this.#buf = newBuf;
    this.#gapEnd = newGapEnd;
  }
}

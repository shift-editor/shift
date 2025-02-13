type FrameHandlerCallback = (...args: unknown[]) => void;

export class FrameHandler {
  #id: number | null = null;
  #callback: FrameHandlerCallback | null = null;

  public requestUpdate(callback: FrameHandlerCallback): void {
    if (this.#id) return;
    this.#callback = callback;

    this.#id = window.requestAnimationFrame(this.#update);
  }

  #update = () => {
    if (!this.#callback) return;
    this.#callback();
    this.#callback = null;
    this.#id = null;
  };

  cleanup(): void {
    if (!this.#id) return;
    window.cancelAnimationFrame(this.#id);
    this.#id = null;
    this.#callback = null;
  }

  public cancelUpdate(): void {
    this.cleanup();
  }
}

type FrameRequestCallback = (time: number) => void;

export class FrameHandler {
  #id: number;

  constructor() {
    this.#id = 0;
  }

  requestUpdate(callback: FrameRequestCallback): void {
    this.#id = window.requestAnimationFrame(callback);
  }

  cancelUpdate(): void {
    window.cancelAnimationFrame(this.#id);
  }
}

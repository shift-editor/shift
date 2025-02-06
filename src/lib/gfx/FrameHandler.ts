export class FrameHandler {
  #id: number;

  constructor() {
    this.#id = 0;
  }

  requestUpdate(): void {
    this.#id = window.requestAnimationFrame(() => {
      console.log("draw");
    });
  }

  cancelUpdate(): void {
    window.cancelAnimationFrame(this.#id);
  }
}

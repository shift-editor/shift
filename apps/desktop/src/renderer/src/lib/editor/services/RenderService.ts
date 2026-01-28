export interface RenderServiceDeps {
  requestRedraw: () => void;
  requestImmediateRedraw: () => void;
  cancelRedraw: () => void;
  setPreviewMode: (enabled: boolean) => void;
  setHandlesVisible: (visible: boolean) => void;
}

export class RenderService {
  #deps: RenderServiceDeps;

  constructor(deps: RenderServiceDeps) {
    this.#deps = deps;
  }

  requestRedraw(): void {
    this.#deps.requestRedraw();
  }

  requestImmediateRedraw(): void {
    this.#deps.requestImmediateRedraw();
  }

  cancelRedraw(): void {
    this.#deps.cancelRedraw();
  }

  setPreviewMode(enabled: boolean): void {
    this.#deps.setPreviewMode(enabled);
  }

  setHandlesVisible(visible: boolean): void {
    this.#deps.setHandlesVisible(visible);
  }
}

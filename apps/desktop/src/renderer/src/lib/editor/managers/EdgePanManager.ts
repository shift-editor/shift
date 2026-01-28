import type { Point2D, Rect2D } from "@shift/types";
import type { Editor } from "../Editor";

interface EdgePanConfig {
  marginSize: number;
  maxSpeed: number;
}

const DEFAULT_CONFIG: EdgePanConfig = {
  marginSize: 50,
  maxSpeed: 15,
};

export class EdgePanManager {
  private config: EdgePanConfig;
  private active = false;
  private ticking = false;
  private velocity: Point2D = { x: 0, y: 0 };
  private lastScreenPos: Point2D = { x: 0, y: 0 };

  constructor(
    private editor: Editor,
    config: Partial<EdgePanConfig> = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  update(screenPos: Point2D, canvasBounds: Rect2D): void {
    this.lastScreenPos = screenPos;
    const toolManager = this.editor.getToolManager();

    if (!toolManager.isDragging) {
      this.stop();
      return;
    }

    this.velocity = this.calculateVelocity(screenPos, canvasBounds);
    const shouldBeActive = this.velocity.x !== 0 || this.velocity.y !== 0;

    if (shouldBeActive && !this.ticking) {
      this.active = true;
      this.ticking = true;
      this.tick();
    } else if (!shouldBeActive) {
      this.active = false;
    }
  }

  private tick(): void {
    if (!this.active) {
      this.ticking = false;
      return;
    }

    const pan = this.editor.getPan();
    this.editor.pan(pan.x - this.velocity.x, pan.y - this.velocity.y);

    const screenPos = this.editor.getMousePosition(this.lastScreenPos.x, this.lastScreenPos.y);
    this.editor.getToolManager().handlePointerMove(screenPos, {
      shiftKey: false,
      altKey: false,
    });

    this.editor.requestRedraw();
    requestAnimationFrame(() => this.tick());
  }

  stop(): void {
    this.active = false;
    this.velocity = { x: 0, y: 0 };
  }

  private calculateVelocity(pos: Point2D, bounds: Rect2D): Point2D {
    const { marginSize, maxSpeed } = this.config;

    let vx = 0;
    let vy = 0;

    const leftDist = pos.x - bounds.left;
    const rightDist = bounds.right - pos.x;
    const topDist = pos.y - bounds.top;
    const bottomDist = bounds.bottom - pos.y;

    if (leftDist < marginSize && leftDist >= 0) {
      vx = -maxSpeed * (1 - leftDist / marginSize);
    } else if (rightDist < marginSize && rightDist >= 0) {
      vx = maxSpeed * (1 - rightDist / marginSize);
    }

    if (topDist < marginSize && topDist >= 0) {
      vy = -maxSpeed * (1 - topDist / marginSize);
    } else if (bottomDist < marginSize && bottomDist >= 0) {
      vy = maxSpeed * (1 - bottomDist / marginSize);
    }

    return { x: vx, y: vy };
  }
}

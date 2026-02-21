import type { Point2D, Rect2D } from "@shift/types";
import { Vec2 } from "@shift/geo";

interface EdgePanConfig {
  marginSize: number;
  maxSpeed: number;
}

const DEFAULT_CONFIG: EdgePanConfig = {
  marginSize: 50,
  maxSpeed: 15,
};

type EdgePanEditor = {
  toolManager: {
    isDragging: boolean;
    handlePointerMove(
      position: Point2D,
      modifiers: { shiftKey: boolean; altKey: boolean },
      options: { force: boolean },
    ): void;
  };
  pan: Point2D;
  setPan(x: number, y: number): void;
  requestRedraw(): void;
};

export class EdgePanManager {
  private config: EdgePanConfig;
  private active = false;
  private ticking = false;
  private velocity: Point2D = Vec2.zero();
  private lastScreenPos: Point2D = Vec2.zero();

  constructor(
    private editor: EdgePanEditor,
    config: Partial<EdgePanConfig> = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  update(screenPos: Point2D, canvasBounds: Rect2D): void {
    this.lastScreenPos = screenPos;
    const toolManager = this.editor.toolManager;

    if (!toolManager.isDragging) {
      this.stop();
      return;
    }

    this.velocity = this.calculateVelocity(screenPos, canvasBounds);
    const shouldBeActive = !Vec2.isZero(this.velocity);

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

    const newPan = Vec2.sub(this.editor.pan, this.velocity);
    this.editor.setPan(newPan.x, newPan.y);

    this.editor.toolManager.handlePointerMove(
      this.lastScreenPos,
      { shiftKey: false, altKey: false },
      { force: true },
    );

    this.editor.requestRedraw();
    requestAnimationFrame(() => this.tick());
  }

  stop(): void {
    this.active = false;
    this.velocity = Vec2.zero();
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

    return Vec2.create(vx, vy);
  }
}

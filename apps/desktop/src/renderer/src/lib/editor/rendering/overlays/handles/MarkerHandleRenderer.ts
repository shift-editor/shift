import type { Point2D } from "@shift/geo";
import { untracked } from "@/lib/signals/signal";
import type { SubmittedGeometry } from "@/types/rendering";
import type { CameraTransform } from "@/lib/editor/managers/Camera";
import type { MarkerLayer } from "@/lib/graphics/backends/MarkerLayer";
import { MARKER_INSTANCE_FLOATS } from "../../markers/types";
import { STYLES, type CachedInstanceStyle } from "../../markers/handleStyles";
import type { HandleDisplayList } from "./HandleItems";
import type { PointHandleItem } from "./PointHandleItem";

declare const __PLAYWRIGHT__: boolean;

const EMPTY_PACKED_INSTANCES = new Float32Array(0);

export class MarkerHandleRenderer {
  #packedInstances: Float32Array | null = null;
  #packedCapacity = 0;
  #uploadedLayer: MarkerLayer | null = null;
  #uploadedList: HandleDisplayList | null = null;
  #uploadedInstanceCount = 0;

  #resetUpload(): void {
    this.#uploadedList = null;
    this.#uploadedInstanceCount = 0;
  }

  draw(
    layer: MarkerLayer | null,
    list: HandleDisplayList,
    camera: CameraTransform,
    drawOffset: Point2D,
  ): boolean {
    if (!layer) return false;
    if (!layer.isAvailable()) return false;

    if (layer !== this.#uploadedLayer) {
      this.#uploadedLayer = layer;
      this.#resetUpload();
    }

    if (list !== this.#uploadedList) {
      this.#uploadedInstanceCount = this.#pack(list);
      if (
        !layer.uploadInstances(
          this.#packedInstances ?? EMPTY_PACKED_INSTANCES,
          this.#uploadedInstanceCount,
        )
      ) {
        return false;
      }
      this.#uploadedList = list;
    }

    const rendered = layer.drawUploaded(
      this.#uploadedInstanceCount,
      camera,
      drawOffset,
      camera.centre.x * 2,
      camera.logicalHeight,
    );
    if (!rendered) return false;

    if (typeof __PLAYWRIGHT__ !== "undefined" && __PLAYWRIGHT__) {
      const packed = this.#packedInstances;
      const items = this.#uploadedList?.items;
      const count = this.#uploadedInstanceCount;
      if (packed && items && count > 0) {
        const geometry: SubmittedGeometry = {
          point(pointId) {
            const index = items.findIndex((item) => item.point.id === pointId);
            if (index < 0 || index >= count) return null;

            const base = index * MARKER_INSTANCE_FLOATS;
            return { x: packed[base]!, y: packed[base + 1]! };
          },
        };
        untracked(() =>
          window.dispatchEvent(
            new CustomEvent<SubmittedGeometry>("shift:geometry-submitted", { detail: geometry }),
          ),
        );
      }
    }

    return true;
  }

  #pack(list: HandleDisplayList): number {
    const { items } = list;
    const requiredLength = items.length * MARKER_INSTANCE_FLOATS;
    if (requiredLength === 0) return 0;

    let packed = this.#packedInstances;
    if (!packed || requiredLength > this.#packedCapacity) {
      packed = new Float32Array(Math.max(requiredLength, this.#packedCapacity * 2));
      this.#packedInstances = packed;
      this.#packedCapacity = packed.length;
    }

    let index = 0;
    for (const item of items) {
      this.#writeInstance(packed, index, item, STYLES[item.shape][item.state]);
      index++;
    }

    return index;
  }

  #writeInstance(
    packed: Float32Array,
    index: number,
    item: PointHandleItem,
    style: CachedInstanceStyle,
  ): void {
    const base = index * MARKER_INSTANCE_FLOATS;
    packed[base] = item.point.x;

    packed[base + 1] = item.point.y;
    packed[base + 2] = style.extentX;
    packed[base + 3] = style.extentY;
    packed[base + 4] = item.rotation;
    packed[base + 5] = style.shapeId;
    packed[base + 6] = style.size;
    packed[base + 7] = style.lineWidth;

    packed.set(style.fillColor, base + 8);
    packed.set(style.strokeColor, base + 12);
    packed.set(style.overlayColor, base + 16);

    packed[base + 20] = style.barSize;

    packed.set(style.barStrokeColor, base + 21);
  }
}

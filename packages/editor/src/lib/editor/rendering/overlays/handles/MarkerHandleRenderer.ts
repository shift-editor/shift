import type { MatModel } from "@shift/geo";
import type { CameraTransform } from "../../../managers/Camera";
import type { MarkerLayer } from "../../../../graphics/backends/MarkerLayer";
import { MARKER_INSTANCE_FLOATS } from "../../markers/types";
import {
  buildMarkerStyles,
  METRIC_HALO_SHAPE_ID,
  type CachedInstanceStyle,
} from "../../markers/handleStyles";
import { parseCssColor, TRANSPARENT, type GpuColor } from "../../markers/color";
import type { EditorRenderTheme } from "../../Theme";
import type { HandleDisplayList } from "./HandleItems";
import type { PointHandleItem } from "./PointHandleItem";

const EMPTY_PACKED_INSTANCES = new Float32Array(0);

export class MarkerHandleRenderer {
  #packedInstances: Float32Array | null = null;
  #packedCapacity = 0;
  #uploadedLayer: MarkerLayer | null = null;
  #uploadedList: HandleDisplayList | null = null;
  #uploadedInstanceCount = 0;
  #theme: EditorRenderTheme | null = null;
  #styles: ReturnType<typeof buildMarkerStyles> | null = null;
  #metricHaloFill: GpuColor = TRANSPARENT;
  #metricHaloRadiusPx = 0;

  #resetUpload(): void {
    this.#uploadedList = null;
    this.#uploadedInstanceCount = 0;
  }

  draw(
    layer: MarkerLayer | null,
    list: HandleDisplayList,
    camera: CameraTransform,
    toScreen: MatModel,
    theme: EditorRenderTheme,
  ): boolean {
    if (!layer) return false;
    if (!layer.isAvailable()) return false;

    if (layer !== this.#uploadedLayer) {
      this.#uploadedLayer = layer;
      this.#resetUpload();
    }

    if (theme !== this.#theme) {
      this.#theme = theme;
      this.#styles = buildMarkerStyles(theme);
      this.#metricHaloFill = parseCssColor(theme.metricMarker.haloFill);
      this.#metricHaloRadiusPx = theme.metricMarker.haloRadiusPx;
      this.#resetUpload();
    }

    if (list !== this.#uploadedList) {
      this.#uploadedInstanceCount = this.#pack(list, this.#styles);
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

    return layer.drawUploaded(
      this.#uploadedInstanceCount,
      toScreen,
      camera.logicalWidth,
      camera.logicalHeight,
    );
  }

  #pack(list: HandleDisplayList, styles: ReturnType<typeof buildMarkerStyles> | null): number {
    const { items } = list;
    // Each on-metric handle packs a halo instance before itself.
    let instanceCount = items.length;
    for (const item of items) if (item.showsMetricMarker) instanceCount++;
    const requiredLength = instanceCount * MARKER_INSTANCE_FLOATS;
    if (requiredLength === 0 || !styles) return 0;

    let packed = this.#packedInstances;
    if (!packed || requiredLength > this.#packedCapacity) {
      packed = new Float32Array(Math.max(requiredLength, this.#packedCapacity * 2));
      this.#packedInstances = packed;
      this.#packedCapacity = packed.length;
    }

    let index = 0;
    for (const item of items) {
      const style = styles[item.shape][item.state];
      if (item.showsMetricMarker) {
        this.#writeInstance(packed, index, item, this.#metricHalo());
        index++;
      }
      this.#writeInstance(packed, index, item, style);
      index++;
    }

    return index;
  }

  /** A filled, strokeless circle around the handle, drawn beneath it. */
  #metricHalo(): CachedInstanceStyle {
    const radius = this.#metricHaloRadiusPx;
    return {
      shapeId: METRIC_HALO_SHAPE_ID,
      size: radius,
      lineWidth: 0,
      fillColor: this.#metricHaloFill,
      strokeColor: TRANSPARENT,
      overlayColor: TRANSPARENT,
      barSize: 0,
      barStrokeColor: TRANSPARENT,
      extentX: radius + 2,
      extentY: radius + 2,
    };
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

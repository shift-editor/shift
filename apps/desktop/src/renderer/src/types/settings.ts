import type { AxisId, SourceId } from "@shift/types";

export type SettingsCategory = "font" | "sources" | "axes" | "features";

export type AxisSettingsSection = "definition" | "mapping" | "styles";

export type SettingsTarget =
  | { category: "font" }
  | { category: "sources"; sourceId?: SourceId }
  | { category: "axes"; axisId?: AxisId }
  | { category: "features" };

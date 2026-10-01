import type { AxisId, NamedInstanceId, SourceId } from "@shift/types";

export type SettingsCategory = "appearance" | "font" | "sources" | "instances" | "axes";

export type AxisSettingsSection = "definition" | "mapping" | "styles";

export type SettingsTarget =
  | { category: "appearance" }
  | { category: "font" }
  | { category: "sources"; sourceId?: SourceId }
  | { category: "instances"; instanceId?: NamedInstanceId }
  | { category: "axes"; axisId?: AxisId };

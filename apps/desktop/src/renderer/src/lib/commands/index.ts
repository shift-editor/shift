// Core command infrastructure
export {
  type Command,
  type CommandContext,
  BaseCommand,
  CompositeCommand,
  CommandHistory,
  type CommandHistoryOptions,
} from "./core";

// Primitive commands (point, bezier operations)
export {
  AddPointCommand,
  MovePointsCommand,
  MovePointToCommand,
  RemovePointsCommand,
  InsertPointCommand,
  AddBezierAnchorCommand,
  TogglePointSmoothCommand,
  CloseContourCommand,
  AddContourCommand,
  SetActiveContourCommand,
  ReverseContourCommand,
  NudgePointsCommand,
} from "./primitives";

// Clipboard commands
export { PasteCommand } from "./clipboard";

// Transform commands
export {
  RotatePointsCommand,
  ScalePointsCommand,
  ReflectPointsCommand,
  TransformMatrixCommand,
} from "./transform";

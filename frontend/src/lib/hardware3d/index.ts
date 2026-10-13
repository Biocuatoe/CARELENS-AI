export { buildHardwareAssembly, rigidBox, type HardwareAssembly, type PartHandle, type PartStatus, type SectionMode } from "./assembly";
export {
  ACTIVE_BATTERY_PROFILE,
  BATTERY_PROFILES,
  COMPONENTS,
  COMPONENT_BY_ID,
  PART_IDS,
  center,
  extent,
  type BatteryProfile,
  type ComponentConfig,
  type DimensionStatus,
  type PartId,
  type PartSource,
  type PlacementStatus,
} from "./assemblyConfig";
export { checkFit, findOverlaps, sizeOf, type FitEntry, type OverlapEntry, type PartBox } from "./fit";
export { type SwitchPosition } from "./procedural";
export { INTERIOR_MM, LIP_CLEARANCE_MM, CAMERA_WINDOW_MM, ENCLOSURE_BOUNDS_MM } from "./units";
export { validateAssembly, type Collision, type FeatureCheck, type ShellIssue, type ValidationReport } from "./validate";
export { HardwareViewer, isWebGLAvailable, type ViewPreset, type ViewerSample } from "./viewer";
export { BEATS, STAGES, type BeatConfig, type Layout, type StageConfig, type StageId } from "./animationConfig";
export { createTimeline, snapProgress, type FrameState, type Timeline } from "./timeline";
export { HardwareScrollStory, type HeroInset, type StoryAnchor, type StoryFrameInfo, type StoryMode, type StoryOptions } from "./scrollStory";
export { validateTimeline, type TimelineValidation } from "./animationValidation";

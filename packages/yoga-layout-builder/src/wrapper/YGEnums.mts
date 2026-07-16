/**
 * Yoga Layout Enums.
 *
 * GENERATED from upstream yoga/YGEnums.h @ yoga v3.2.1 by
 * scripts/source-cloned/shared/generate-enums.mts — do not edit by hand.
 * Copyright (c) Meta Platforms, Inc. and affiliates. MIT License.
 */

export const Align = {
  Auto: 0,
  Baseline: 5,
  Center: 2,
  FlexEnd: 3,
  FlexStart: 1,
  SpaceAround: 7,
  SpaceBetween: 6,
  SpaceEvenly: 8,
  Stretch: 4,
}

export const BoxSizing = {
  BorderBox: 0,
  ContentBox: 1,
}

export const Dimension = {
  Height: 1,
  Width: 0,
}

export const Direction = {
  Inherit: 0,
  LTR: 1,
  RTL: 2,
}

export const Display = {
  Contents: 2,
  Flex: 0,
  None: 1,
}

export const Edge = {
  All: 8,
  Bottom: 3,
  End: 5,
  Horizontal: 6,
  Left: 0,
  Right: 2,
  Start: 4,
  Top: 1,
  Vertical: 7,
}

export const Errata = {
  AbsolutePercentAgainstInnerSize: 4,
  AbsolutePositionWithoutInsetsExcludesPadding: 2,
  All: 2_147_483_647,
  Classic: 2_147_483_646,
  None: 0,
  StretchFlexBasis: 1,
}

export const ExperimentalFeature = {
  WebFlexBasis: 0,
}

export const FlexDirection = {
  Column: 0,
  ColumnReverse: 1,
  Row: 2,
  RowReverse: 3,
}

export const Gutter = {
  All: 2,
  Column: 0,
  Row: 1,
}

export const Justify = {
  Center: 1,
  FlexEnd: 2,
  FlexStart: 0,
  SpaceAround: 4,
  SpaceBetween: 3,
  SpaceEvenly: 5,
}

export const LogLevel = {
  Debug: 3,
  Error: 0,
  Fatal: 5,
  Info: 2,
  Verbose: 4,
  Warn: 1,
}

export const MeasureMode = {
  AtMost: 2,
  Exactly: 1,
  Undefined: 0,
}

export const NodeType = {
  Default: 0,
  Text: 1,
}

export const Overflow = {
  Hidden: 1,
  Scroll: 2,
  Visible: 0,
}

export const PositionType = {
  Absolute: 2,
  Relative: 1,
  Static: 0,
}

export const Unit = {
  Auto: 3,
  Percent: 2,
  Point: 1,
  Undefined: 0,
}

export const Wrap = {
  NoWrap: 0,
  Wrap: 1,
  WrapReverse: 2,
}

// Flat constant exports for compatibility with yoga-layout npm package API.
const constants = {
  ALIGN_AUTO: Align.Auto,
  ALIGN_BASELINE: Align.Baseline,
  ALIGN_CENTER: Align.Center,
  ALIGN_FLEX_END: Align.FlexEnd,
  ALIGN_FLEX_START: Align.FlexStart,
  ALIGN_SPACE_AROUND: Align.SpaceAround,
  ALIGN_SPACE_BETWEEN: Align.SpaceBetween,
  ALIGN_SPACE_EVENLY: Align.SpaceEvenly,
  ALIGN_STRETCH: Align.Stretch,
  BOX_SIZING_BORDER_BOX: BoxSizing.BorderBox,
  BOX_SIZING_CONTENT_BOX: BoxSizing.ContentBox,
  DIMENSION_HEIGHT: Dimension.Height,
  DIMENSION_WIDTH: Dimension.Width,
  DIRECTION_INHERIT: Direction.Inherit,
  DIRECTION_LTR: Direction.LTR,
  DIRECTION_RTL: Direction.RTL,
  DISPLAY_CONTENTS: Display.Contents,
  DISPLAY_FLEX: Display.Flex,
  DISPLAY_NONE: Display.None,
  EDGE_ALL: Edge.All,
  EDGE_BOTTOM: Edge.Bottom,
  EDGE_END: Edge.End,
  EDGE_HORIZONTAL: Edge.Horizontal,
  EDGE_LEFT: Edge.Left,
  EDGE_RIGHT: Edge.Right,
  EDGE_START: Edge.Start,
  EDGE_TOP: Edge.Top,
  EDGE_VERTICAL: Edge.Vertical,
  ERRATA_ABSOLUTE_PERCENT_AGAINST_INNER_SIZE:
    Errata.AbsolutePercentAgainstInnerSize,
  ERRATA_ABSOLUTE_POSITION_WITHOUT_INSETS_EXCLUDES_PADDING:
    Errata.AbsolutePositionWithoutInsetsExcludesPadding,
  ERRATA_ALL: Errata.All,
  ERRATA_CLASSIC: Errata.Classic,
  ERRATA_NONE: Errata.None,
  ERRATA_STRETCH_FLEX_BASIS: Errata.StretchFlexBasis,
  EXPERIMENTAL_FEATURE_WEB_FLEX_BASIS: ExperimentalFeature.WebFlexBasis,
  FLEX_DIRECTION_COLUMN: FlexDirection.Column,
  FLEX_DIRECTION_COLUMN_REVERSE: FlexDirection.ColumnReverse,
  FLEX_DIRECTION_ROW: FlexDirection.Row,
  FLEX_DIRECTION_ROW_REVERSE: FlexDirection.RowReverse,
  GUTTER_ALL: Gutter.All,
  GUTTER_COLUMN: Gutter.Column,
  GUTTER_ROW: Gutter.Row,
  JUSTIFY_CENTER: Justify.Center,
  JUSTIFY_FLEX_END: Justify.FlexEnd,
  JUSTIFY_FLEX_START: Justify.FlexStart,
  JUSTIFY_SPACE_AROUND: Justify.SpaceAround,
  JUSTIFY_SPACE_BETWEEN: Justify.SpaceBetween,
  JUSTIFY_SPACE_EVENLY: Justify.SpaceEvenly,
  LOG_LEVEL_DEBUG: LogLevel.Debug,
  LOG_LEVEL_ERROR: LogLevel.Error,
  LOG_LEVEL_FATAL: LogLevel.Fatal,
  LOG_LEVEL_INFO: LogLevel.Info,
  LOG_LEVEL_VERBOSE: LogLevel.Verbose,
  LOG_LEVEL_WARN: LogLevel.Warn,
  MEASURE_MODE_AT_MOST: MeasureMode.AtMost,
  MEASURE_MODE_EXACTLY: MeasureMode.Exactly,
  MEASURE_MODE_UNDEFINED: MeasureMode.Undefined,
  NODE_TYPE_DEFAULT: NodeType.Default,
  NODE_TYPE_TEXT: NodeType.Text,
  OVERFLOW_HIDDEN: Overflow.Hidden,
  OVERFLOW_SCROLL: Overflow.Scroll,
  OVERFLOW_VISIBLE: Overflow.Visible,
  POSITION_TYPE_ABSOLUTE: PositionType.Absolute,
  POSITION_TYPE_RELATIVE: PositionType.Relative,
  POSITION_TYPE_STATIC: PositionType.Static,
  UNIT_AUTO: Unit.Auto,
  UNIT_PERCENT: Unit.Percent,
  UNIT_POINT: Unit.Point,
  UNIT_UNDEFINED: Unit.Undefined,
  WRAP_NO_WRAP: Wrap.NoWrap,
  WRAP_WRAP: Wrap.Wrap,
  WRAP_WRAP_REVERSE: Wrap.WrapReverse,
}

export { constants }
// oxlint-disable-next-line socket/no-default-export -- wrapAssembly.mts + the wasm-sync inliner consume the default export as `YGEnums`.
export default constants

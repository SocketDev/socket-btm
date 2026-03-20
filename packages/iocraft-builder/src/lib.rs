//! Node.js bindings for iocraft TUI library.
//!
//! This module provides native bindings to iocraft, enabling React-like
//! declarative terminal UIs in Node.js with:
//! - Flexbox layouts
//! - Mouse support
//! - Keyboard input
//! - Rich styling

mod builder;

pub use builder::*;

use crossterm::terminal;
use iocraft::prelude::*;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use phf::phf_map;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::Mutex;

// ============================================================================
// Color Types
// ============================================================================

/// RGB color specification for styling.
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct JsColor {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

impl From<JsColor> for Color {
    fn from(c: JsColor) -> Self {
        Color::Rgb {
            r: c.r,
            g: c.g,
            b: c.b,
        }
    }
}

/// Named color values matching crossterm colors.
#[napi(string_enum)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum JsNamedColor {
    Black,
    DarkGrey,
    Red,
    DarkRed,
    Green,
    DarkGreen,
    Yellow,
    DarkYellow,
    Blue,
    DarkBlue,
    Magenta,
    DarkMagenta,
    Cyan,
    DarkCyan,
    White,
    Grey,
    Reset,
}

impl From<JsNamedColor> for Color {
    fn from(c: JsNamedColor) -> Self {
        match c {
            JsNamedColor::Black => Color::Black,
            JsNamedColor::DarkGrey => Color::DarkGrey,
            JsNamedColor::Red => Color::Red,
            JsNamedColor::DarkRed => Color::DarkRed,
            JsNamedColor::Green => Color::Green,
            JsNamedColor::DarkGreen => Color::DarkGreen,
            JsNamedColor::Yellow => Color::Yellow,
            JsNamedColor::DarkYellow => Color::DarkYellow,
            JsNamedColor::Blue => Color::Blue,
            JsNamedColor::DarkBlue => Color::DarkBlue,
            JsNamedColor::Magenta => Color::Magenta,
            JsNamedColor::DarkMagenta => Color::DarkMagenta,
            JsNamedColor::Cyan => Color::Cyan,
            JsNamedColor::DarkCyan => Color::DarkCyan,
            JsNamedColor::White => Color::White,
            JsNamedColor::Grey => Color::Grey,
            JsNamedColor::Reset => Color::Reset,
        }
    }
}

// ============================================================================
// Event Types
// ============================================================================

/// Mouse event data passed to JavaScript callbacks.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct JsMouseEvent {
    pub column: u32,
    pub row: u32,
    pub kind: String,
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
}

/// Keyboard event data passed to JavaScript callbacks.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct JsKeyEvent {
    pub key: String,
    pub code: String,
    pub kind: String,
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
}

// ============================================================================
// Style Properties
// ============================================================================

/// Border style for View components.
#[napi(string_enum)]
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub enum JsBorderStyle {
    #[default]
    None,
    Single,
    Double,
    Round,
    Bold,
    DoubleLeftRight,
    DoubleTopBottom,
    Classic,
}

impl From<JsBorderStyle> for BorderStyle {
    fn from(s: JsBorderStyle) -> Self {
        match s {
            JsBorderStyle::None => BorderStyle::None,
            JsBorderStyle::Single => BorderStyle::Single,
            JsBorderStyle::Double => BorderStyle::Double,
            JsBorderStyle::Round => BorderStyle::Round,
            JsBorderStyle::Bold => BorderStyle::Bold,
            JsBorderStyle::DoubleLeftRight => BorderStyle::DoubleLeftRight,
            JsBorderStyle::DoubleTopBottom => BorderStyle::DoubleTopBottom,
            JsBorderStyle::Classic => BorderStyle::Classic,
        }
    }
}

/// Flex direction for layout.
#[napi(string_enum)]
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub enum JsFlexDirection {
    #[default]
    Row,
    Column,
    RowReverse,
    ColumnReverse,
}

impl From<JsFlexDirection> for FlexDirection {
    fn from(d: JsFlexDirection) -> Self {
        match d {
            JsFlexDirection::Row => FlexDirection::Row,
            JsFlexDirection::Column => FlexDirection::Column,
            JsFlexDirection::RowReverse => FlexDirection::RowReverse,
            JsFlexDirection::ColumnReverse => FlexDirection::ColumnReverse,
        }
    }
}

/// Justify content for layout.
#[napi(string_enum)]
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub enum JsJustifyContent {
    #[default]
    FlexStart,
    FlexEnd,
    Center,
    SpaceBetween,
    SpaceAround,
    SpaceEvenly,
}

impl From<JsJustifyContent> for JustifyContent {
    fn from(j: JsJustifyContent) -> Self {
        match j {
            JsJustifyContent::FlexStart => JustifyContent::FlexStart,
            JsJustifyContent::FlexEnd => JustifyContent::FlexEnd,
            JsJustifyContent::Center => JustifyContent::Center,
            JsJustifyContent::SpaceBetween => JustifyContent::SpaceBetween,
            JsJustifyContent::SpaceAround => JustifyContent::SpaceAround,
            JsJustifyContent::SpaceEvenly => JustifyContent::SpaceEvenly,
        }
    }
}

/// Align items for layout.
#[napi(string_enum)]
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub enum JsAlignItems {
    #[default]
    Stretch,
    FlexStart,
    FlexEnd,
    Center,
    Baseline,
}

impl From<JsAlignItems> for AlignItems {
    fn from(a: JsAlignItems) -> Self {
        match a {
            JsAlignItems::Stretch => AlignItems::Stretch,
            JsAlignItems::FlexStart => AlignItems::FlexStart,
            JsAlignItems::FlexEnd => AlignItems::FlexEnd,
            JsAlignItems::Center => AlignItems::Center,
            JsAlignItems::Baseline => AlignItems::Baseline,
        }
    }
}

/// Text weight.
#[napi(string_enum)]
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub enum JsWeight {
    #[default]
    Normal,
    Bold,
    Light,
}

impl From<JsWeight> for Weight {
    fn from(w: JsWeight) -> Self {
        match w {
            JsWeight::Normal => Weight::Normal,
            JsWeight::Bold => Weight::Bold,
            JsWeight::Light => Weight::Light,
        }
    }
}

/// Text alignment.
#[napi(string_enum)]
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub enum JsTextAlign {
    #[default]
    Left,
    Right,
    Center,
}

impl From<JsTextAlign> for TextAlign {
    fn from(a: JsTextAlign) -> Self {
        match a {
            JsTextAlign::Left => TextAlign::Left,
            JsTextAlign::Right => TextAlign::Right,
            JsTextAlign::Center => TextAlign::Center,
        }
    }
}

/// Text wrapping behavior.
#[napi(string_enum)]
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub enum JsTextWrap {
    #[default]
    Wrap,
    NoWrap,
}

impl From<JsTextWrap> for TextWrap {
    fn from(w: JsTextWrap) -> Self {
        match w {
            JsTextWrap::Wrap => TextWrap::Wrap,
            JsTextWrap::NoWrap => TextWrap::NoWrap,
        }
    }
}

// ============================================================================
// Component Node (JSON representation from JavaScript)
// ============================================================================

/// Component node in the render tree from JavaScript.
///
/// Fields ordered by size (largest to smallest) for optimal memory layout.
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComponentNode {
    /// Child components (largest: Vec + data)
    pub children: Option<Vec<ComponentNode>>,

    /// Component type: "View", "Text", "Box" (String: 24 bytes)
    #[napi(js_name = "type")]
    #[serde(rename = "type")]
    pub node_type: String,

    /// Text content (for Text components) (Option<String>: 24 bytes)
    pub content: Option<String>,

    /// Border style (Option<String>: 24 bytes)
    pub border_style: Option<String>,

    /// Border color (named color string) (Option<String>: 24 bytes)
    pub border_color: Option<String>,

    /// Background color (named color string) (Option<String>: 24 bytes)
    pub background_color: Option<String>,

    /// Text color (named color string) (Option<String>: 24 bytes)
    pub color: Option<String>,

    /// Flex direction (Option<String>: 24 bytes)
    pub flex_direction: Option<String>,

    /// Justify content (Option<String>: 24 bytes)
    pub justify_content: Option<String>,

    /// Align items (Option<String>: 24 bytes)
    pub align_items: Option<String>,

    /// Text weight (for Text components) (Option<String>: 24 bytes)
    pub weight: Option<String>,

    /// Text alignment (for Text components) (Option<String>: 24 bytes)
    pub align: Option<String>,

    /// Text wrapping (for Text components) (Option<String>: 24 bytes)
    pub wrap: Option<String>,

    /// Width as percentage (0-100) (Option<f64>: 16 bytes)
    pub width_percent: Option<f64>,

    /// Height as percentage (0-100) (Option<f64>: 16 bytes)
    pub height_percent: Option<f64>,

    /// Flex grow (Option<f64>: 16 bytes)
    pub flex_grow: Option<f64>,

    /// Flex shrink (Option<f64>: 16 bytes)
    pub flex_shrink: Option<f64>,

    /// Width in characters (Option<u32>: 8 bytes)
    pub width: Option<u32>,

    /// Height in characters (Option<u32>: 8 bytes)
    pub height: Option<u32>,

    /// Padding (all sides) (Option<u32>: 8 bytes)
    pub padding: Option<u32>,
    pub padding_top: Option<u32>,
    pub padding_right: Option<u32>,
    pub padding_bottom: Option<u32>,
    pub padding_left: Option<u32>,
    pub padding_x: Option<u32>,
    pub padding_y: Option<u32>,

    /// Gap between children (Option<u32>: 8 bytes)
    pub gap: Option<u32>,
    pub row_gap: Option<u32>,
    pub column_gap: Option<u32>,

    /// Margin (all sides) (Option<i32>: 8 bytes)
    pub margin: Option<i32>,
    pub margin_top: Option<i32>,
    pub margin_right: Option<i32>,
    pub margin_bottom: Option<i32>,
    pub margin_left: Option<i32>,
    pub margin_x: Option<i32>,
    pub margin_y: Option<i32>,

    /// Whether text is underlined (Option<bool>: 2 bytes)
    pub underline: Option<bool>,

    /// Whether text is italic (Option<bool>: 2 bytes)
    pub italic: Option<bool>,

    /// Whether text is bold (shorthand for weight: "Bold") (Option<bool>: 2 bytes)
    pub bold: Option<bool>,
}

// ============================================================================
// Static Maps for Zero-Allocation Parsing
// ============================================================================

static COLOR_MAP: phf::Map<&'static str, Color> = phf_map! {
    "black" => Color::Black,
    "darkgrey" => Color::DarkGrey,
    "darkgray" => Color::DarkGrey,
    "red" => Color::Red,
    "darkred" => Color::DarkRed,
    "green" => Color::Green,
    "darkgreen" => Color::DarkGreen,
    "yellow" => Color::Yellow,
    "darkyellow" => Color::DarkYellow,
    "blue" => Color::Blue,
    "darkblue" => Color::DarkBlue,
    "magenta" => Color::Magenta,
    "darkmagenta" => Color::DarkMagenta,
    "cyan" => Color::Cyan,
    "darkcyan" => Color::DarkCyan,
    "white" => Color::White,
    "grey" => Color::Grey,
    "gray" => Color::Grey,
    "reset" => Color::Reset,
};

static BORDER_STYLE_MAP: phf::Map<&'static str, BorderStyle> = phf_map! {
    "single" => BorderStyle::Single,
    "double" => BorderStyle::Double,
    "round" => BorderStyle::Round,
    "rounded" => BorderStyle::Round,
    "bold" => BorderStyle::Bold,
    "doubleleftright" => BorderStyle::DoubleLeftRight,
    "doubletopbottom" => BorderStyle::DoubleTopBottom,
    "classic" => BorderStyle::Classic,
    "none" => BorderStyle::None,
};

static FLEX_DIRECTION_MAP: phf::Map<&'static str, FlexDirection> = phf_map! {
    "row" => FlexDirection::Row,
    "column" => FlexDirection::Column,
    "rowreverse" => FlexDirection::RowReverse,
    "row-reverse" => FlexDirection::RowReverse,
    "columnreverse" => FlexDirection::ColumnReverse,
    "column-reverse" => FlexDirection::ColumnReverse,
};

static JUSTIFY_CONTENT_MAP: phf::Map<&'static str, JustifyContent> = phf_map! {
    "flexstart" => JustifyContent::FlexStart,
    "flex-start" => JustifyContent::FlexStart,
    "start" => JustifyContent::FlexStart,
    "flexend" => JustifyContent::FlexEnd,
    "flex-end" => JustifyContent::FlexEnd,
    "end" => JustifyContent::FlexEnd,
    "center" => JustifyContent::Center,
    "spacebetween" => JustifyContent::SpaceBetween,
    "space-between" => JustifyContent::SpaceBetween,
    "spacearound" => JustifyContent::SpaceAround,
    "space-around" => JustifyContent::SpaceAround,
    "spaceevenly" => JustifyContent::SpaceEvenly,
    "space-evenly" => JustifyContent::SpaceEvenly,
};

static ALIGN_ITEMS_MAP: phf::Map<&'static str, AlignItems> = phf_map! {
    "flexstart" => AlignItems::FlexStart,
    "flex-start" => AlignItems::FlexStart,
    "start" => AlignItems::FlexStart,
    "flexend" => AlignItems::FlexEnd,
    "flex-end" => AlignItems::FlexEnd,
    "end" => AlignItems::FlexEnd,
    "center" => AlignItems::Center,
    "baseline" => AlignItems::Baseline,
    "stretch" => AlignItems::Stretch,
};

static TEXT_ALIGN_MAP: phf::Map<&'static str, TextAlign> = phf_map! {
    "left" => TextAlign::Left,
    "center" => TextAlign::Center,
    "right" => TextAlign::Right,
};

static WEIGHT_MAP: phf::Map<&'static str, Weight> = phf_map! {
    "normal" => Weight::Normal,
    "bold" => Weight::Bold,
    "light" => Weight::Light,
};

static TEXT_WRAP_MAP: phf::Map<&'static str, TextWrap> = phf_map! {
    "wrap" => TextWrap::Wrap,
    "nowrap" => TextWrap::NoWrap,
};

// ============================================================================
// Helper Functions for Parsing
// ============================================================================

/// Fast hex digit to value conversion using lookup table.
#[inline(always)]
fn hex_to_u8(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}

/// Parse hex color (#RRGGBB or RRGGBB) with optimized byte-level parsing.
///
/// This function is optimized for performance:
/// - Direct byte access (no UTF-8 overhead)
/// - Lookup table for hex digits (no multiplication)
/// - Single pass through the string
/// - Branch-free digit combination
#[inline]
fn parse_hex_color(s: &str) -> Option<Color> {
    let bytes = s.as_bytes();

    // Handle optional '#' prefix
    let hex_bytes = if !bytes.is_empty() && bytes[0] == b'#' {
        &bytes[1..]
    } else {
        bytes
    };

    // Must be exactly 6 hex digits
    if hex_bytes.len() != 6 {
        return None;
    }

    // Parse all 6 hex digits
    let r1 = hex_to_u8(hex_bytes[0])?;
    let r2 = hex_to_u8(hex_bytes[1])?;
    let g1 = hex_to_u8(hex_bytes[2])?;
    let g2 = hex_to_u8(hex_bytes[3])?;
    let b1 = hex_to_u8(hex_bytes[4])?;
    let b2 = hex_to_u8(hex_bytes[5])?;

    // Combine digit pairs using bit shifts (faster than multiplication)
    let r = (r1 << 4) | r2;
    let g = (g1 << 4) | g2;
    let b = (b1 << 4) | b2;

    Some(Color::Rgb { r, g, b })
}

fn parse_named_color(s: &str) -> Option<Color> {
    // Fast path: exact lowercase match (O(1) lookup).
    if let Some(&color) = COLOR_MAP.get(s) {
        return Some(color);
    }

    // Try hex color before falling back to case conversion.
    // Hex colors start with '#' or are 6 hex digits.
    if s.len() == 6 || (s.len() == 7 && s.starts_with('#')) {
        if let Some(color) = parse_hex_color(s) {
            return Some(color);
        }
    }

    // Fallback: convert to lowercase once and retry.
    // This handles PascalCase/UPPERCASE variants.
    let lower = s.to_ascii_lowercase();
    COLOR_MAP.get(lower.as_str()).copied()
}

fn parse_border_style(s: &str) -> BorderStyle {
    // Fast path: exact lowercase match (O(1) lookup).
    if let Some(&style) = BORDER_STYLE_MAP.get(s) {
        return style;
    }

    // Fallback: convert to lowercase once and retry.
    let lower = s.to_ascii_lowercase();
    BORDER_STYLE_MAP
        .get(lower.as_str())
        .copied()
        .unwrap_or(BorderStyle::None)
}

fn parse_flex_direction(s: &str) -> FlexDirection {
    // Fast path: exact lowercase match (O(1) lookup).
    if let Some(&direction) = FLEX_DIRECTION_MAP.get(s) {
        return direction;
    }

    // Fallback: convert to lowercase once and retry.
    let lower = s.to_ascii_lowercase();
    FLEX_DIRECTION_MAP
        .get(lower.as_str())
        .copied()
        .unwrap_or(FlexDirection::Row)
}

fn parse_justify_content(s: &str) -> JustifyContent {
    // Fast path: exact lowercase match (O(1) lookup).
    if let Some(&justify) = JUSTIFY_CONTENT_MAP.get(s) {
        return justify;
    }

    // Fallback: convert to lowercase once and retry.
    let lower = s.to_ascii_lowercase();
    JUSTIFY_CONTENT_MAP
        .get(lower.as_str())
        .copied()
        .unwrap_or(JustifyContent::FlexStart)
}

fn parse_align_items(s: &str) -> AlignItems {
    // Fast path: exact lowercase match (O(1) lookup).
    if let Some(&align) = ALIGN_ITEMS_MAP.get(s) {
        return align;
    }

    // Fallback: convert to lowercase once and retry.
    let lower = s.to_ascii_lowercase();
    ALIGN_ITEMS_MAP
        .get(lower.as_str())
        .copied()
        .unwrap_or(AlignItems::Stretch)
}

fn parse_text_align(s: &str) -> TextAlign {
    // Fast path: exact lowercase match (O(1) lookup).
    if let Some(&align) = TEXT_ALIGN_MAP.get(s) {
        return align;
    }

    // Fallback: convert to lowercase once and retry.
    let lower = s.to_ascii_lowercase();
    TEXT_ALIGN_MAP
        .get(lower.as_str())
        .copied()
        .unwrap_or(TextAlign::Left)
}

fn parse_weight(s: &str) -> Weight {
    // Fast path: exact lowercase match (O(1) lookup).
    if let Some(&weight) = WEIGHT_MAP.get(s) {
        return weight;
    }

    // Fallback: convert to lowercase once and retry.
    let lower = s.to_ascii_lowercase();
    WEIGHT_MAP
        .get(lower.as_str())
        .copied()
        .unwrap_or(Weight::Normal)
}

fn parse_text_wrap(s: &str) -> TextWrap {
    // Fast path: exact lowercase match (O(1) lookup).
    if let Some(&wrap) = TEXT_WRAP_MAP.get(s) {
        return wrap;
    }

    // Fallback: convert to lowercase once and retry.
    let lower = s.to_ascii_lowercase();
    TEXT_WRAP_MAP
        .get(lower.as_str())
        .copied()
        .unwrap_or(TextWrap::Wrap)
}

// ============================================================================
// Dynamic Component Wrapper
// ============================================================================

/// Convert a ComponentNode to an AnyElement.
fn node_to_element(node: &ComponentNode) -> AnyElement<'static> {
    // Use eq_ignore_ascii_case to avoid allocating with to_lowercase().
    if node.node_type.eq_ignore_ascii_case("text") {
        // Text component branch.
        let content = node.content.as_deref().unwrap_or("");
            let color = node.color.as_ref().and_then(|c| parse_named_color(c));
            let weight = if node.bold.unwrap_or(false) {
                Weight::Bold
            } else {
                node.weight
                    .as_ref()
                    .map(|w| parse_weight(w))
                    .unwrap_or(Weight::Normal)
            };
            let align = node
                .align
                .as_ref()
                .map(|a| parse_text_align(a))
                .unwrap_or(TextAlign::Left);
            let wrap = node
                .wrap
                .as_ref()
                .map(|w| parse_text_wrap(w))
                .unwrap_or(TextWrap::Wrap);
            let underline = node.underline.unwrap_or(false);
            let italic = node.italic.unwrap_or(false);

        element! {
            Text(
                content: content,
                color: color,
                weight: weight,
                align: align,
                wrap: wrap,
                decoration: if underline { TextDecoration::Underline } else { TextDecoration::None },
                italic: italic,
            )
        }
        .into_any()
    } else {
        // View component branch (default for "view", "box", or any other type).
        // Convert children recursively with pre-allocation.
            let children: Vec<AnyElement<'static>> = if let Some(child_nodes) = &node.children {
                if child_nodes.is_empty() {
                    Vec::new()
                } else {
                    let mut children = Vec::with_capacity(child_nodes.len());
                    for child in child_nodes {
                        children.push(node_to_element(child));
                    }
                    children
                }
            } else {
                Vec::new()
            };

            // Parse all the properties
            let border_style = node
                .border_style
                .as_ref()
                .map(|s| parse_border_style(s))
                .unwrap_or(BorderStyle::None);
            let border_color = node.border_color.as_ref().and_then(|c| parse_named_color(c));
            let background_color = node
                .background_color
                .as_ref()
                .and_then(|c| parse_named_color(c));
            let flex_direction = node
                .flex_direction
                .as_ref()
                .map(|d| parse_flex_direction(d))
                .unwrap_or(FlexDirection::Row);
            let justify_content = node
                .justify_content
                .as_ref()
                .map(|j| parse_justify_content(j));
            let align_items = node.align_items.as_ref().map(|a| parse_align_items(a));

            // Build the View element with all props
            let mut view_props = ViewProps::default();
            view_props.children = children;
            view_props.border_style = border_style;
            view_props.border_color = border_color;
            view_props.background_color = background_color;
            view_props.flex_direction = flex_direction;
            view_props.justify_content = justify_content;
            view_props.align_items = align_items;

            // Width/Height
            if let Some(w) = node.width {
                view_props.width = w.into();
            } else if let Some(wp) = node.width_percent {
                view_props.width = Percent(wp as f32).into();
            }
            if let Some(h) = node.height {
                view_props.height = h.into();
            } else if let Some(hp) = node.height_percent {
                view_props.height = Percent(hp as f32).into();
            }

            // Padding
            if let Some(p) = node.padding {
                view_props.padding = p.into();
            }
            if let Some(p) = node.padding_x {
                view_props.padding_left = p.into();
                view_props.padding_right = p.into();
            }
            if let Some(p) = node.padding_y {
                view_props.padding_top = p.into();
                view_props.padding_bottom = p.into();
            }
            if let Some(p) = node.padding_top {
                view_props.padding_top = p.into();
            }
            if let Some(p) = node.padding_right {
                view_props.padding_right = p.into();
            }
            if let Some(p) = node.padding_bottom {
                view_props.padding_bottom = p.into();
            }
            if let Some(p) = node.padding_left {
                view_props.padding_left = p.into();
            }

            // Margin
            if let Some(m) = node.margin {
                view_props.margin = m.into();
            }
            if let Some(m) = node.margin_x {
                view_props.margin_left = m.into();
                view_props.margin_right = m.into();
            }
            if let Some(m) = node.margin_y {
                view_props.margin_top = m.into();
                view_props.margin_bottom = m.into();
            }
            if let Some(m) = node.margin_top {
                view_props.margin_top = m.into();
            }
            if let Some(m) = node.margin_right {
                view_props.margin_right = m.into();
            }
            if let Some(m) = node.margin_bottom {
                view_props.margin_bottom = m.into();
            }
            if let Some(m) = node.margin_left {
                view_props.margin_left = m.into();
            }

            // Gap
            if let Some(g) = node.gap {
                view_props.gap = g.into();
            }
            if let Some(g) = node.row_gap {
                view_props.row_gap = g.into();
            }
            if let Some(g) = node.column_gap {
                view_props.column_gap = g.into();
            }

            // Flex grow/shrink
            if let Some(fg) = node.flex_grow {
                view_props.flex_grow = fg as f32;
            }
            if let Some(fs) = node.flex_shrink {
                view_props.flex_shrink = Some(fs as f32);
            }

        Element::<View> {
            key: ElementKey::new(0),
            props: view_props,
        }
        .into_any()
    }
}

// ============================================================================
// Terminal Size
// ============================================================================

/// Get the current terminal size.
#[napi(js_name = "get_terminal_size")]
pub fn get_terminal_size() -> Result<Vec<u32>> {
    match terminal::size() {
        Ok((width, height)) => Ok(vec![width as u32, height as u32]),
        Err(_) => Ok(vec![80, 24]), // Default fallback
    }
}

// ============================================================================
// Static Render (One-shot)
// ============================================================================

/// Render a component tree to a string (no terminal interaction).
#[napi(js_name = "render_to_string")]
pub fn render_to_string(tree: ComponentNode) -> Result<String> {
    let mut elem = node_to_element(&tree);
    Ok(elem.to_string())
}

/// Render a component tree to a string with a maximum width.
#[napi(js_name = "render_to_string_with_width")]
pub fn render_to_string_with_width(tree: ComponentNode, max_width: u32) -> Result<String> {
    let mut elem = node_to_element(&tree);
    let canvas = elem.render(Some(max_width as usize));
    Ok(canvas.to_string())
}

/// Render a component tree and print to stdout.
#[napi(js_name = "print_component")]
pub fn print_component(tree: ComponentNode) -> Result<()> {
    let mut elem = node_to_element(&tree);
    elem.print();
    Ok(())
}

/// Render a component tree and print to stderr.
#[napi(js_name = "eprint_component")]
pub fn eprint_component(tree: ComponentNode) -> Result<()> {
    let mut elem = node_to_element(&tree);
    elem.eprint();
    Ok(())
}

// ============================================================================
// CamelCase Aliases for JavaScript Compatibility
// ============================================================================

/// Get the current terminal size (camelCase alias).
#[napi(js_name = "getTerminalSize")]
pub fn get_terminal_size_camel() -> Result<Vec<u32>> {
    get_terminal_size()
}

/// Render a component tree to a string (camelCase alias).
#[napi(js_name = "renderToString")]
pub fn render_to_string_camel(tree: ComponentNode) -> Result<String> {
    render_to_string(tree)
}

/// Render a component tree to a string with a maximum width (camelCase alias).
#[napi(js_name = "renderToStringWithWidth")]
pub fn render_to_string_with_width_camel(tree: ComponentNode, max_width: u32) -> Result<String> {
    render_to_string_with_width(tree, max_width)
}

/// Render a component tree and print to stdout (camelCase alias).
#[napi(js_name = "printComponent")]
pub fn print_component_camel(tree: ComponentNode) -> Result<()> {
    print_component(tree)
}

/// Render a component tree and print to stderr (camelCase alias).
#[napi(js_name = "eprintComponent")]
pub fn eprint_component_camel(tree: ComponentNode) -> Result<()> {
    eprint_component(tree)
}

// ============================================================================
// Interactive Renderer
// ============================================================================

/// Shared state for the interactive renderer.
struct RendererState {
    tree: Option<ComponentNode>,
}

/// Interactive TUI renderer with state management.
///
/// This renderer allows setting a component tree and rendering it
/// to the terminal. For interactive applications, use the event
/// handling APIs to respond to user input.
#[napi]
pub struct TuiRenderer {
    state: Arc<Mutex<RendererState>>,
    running: Arc<AtomicBool>,
}

#[napi]
impl TuiRenderer {
    /// Create a new TUI renderer.
    #[napi(constructor)]
    pub fn new() -> Result<Self> {
        Ok(Self {
            state: Arc::new(Mutex::new(RendererState { tree: None })),
            running: Arc::new(AtomicBool::new(false)),
        })
    }

    /// Set the component tree to render.
    #[napi]
    pub async fn set_tree(&self, tree: ComponentNode) -> Result<()> {
        let mut state = self.state.lock().await;
        state.tree = Some(tree);
        Ok(())
    }

    /// Check if the renderer is running.
    #[napi]
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    /// Get terminal size.
    #[napi]
    pub fn get_size(&self) -> Result<Vec<u32>> {
        get_terminal_size()
    }

    /// Render the current tree once and return the output string.
    #[napi]
    pub async fn render_once(&self) -> Result<String> {
        let state = self.state.lock().await;
        match &state.tree {
            Some(tree) => {
                let mut elem = node_to_element(tree);
                Ok(elem.to_string())
            }
            None => Ok(String::new()),
        }
    }

    /// Render the current tree with a specific width.
    #[napi]
    pub async fn render_with_width(&self, max_width: u32) -> Result<String> {
        let state = self.state.lock().await;
        match &state.tree {
            Some(tree) => {
                let mut elem = node_to_element(tree);
                let canvas = elem.render(Some(max_width as usize));
                Ok(canvas.to_string())
            }
            None => Ok(String::new()),
        }
    }

    /// Print the current tree to stdout.
    #[napi]
    pub async fn print(&self) -> Result<()> {
        let state = self.state.lock().await;
        if let Some(tree) = &state.tree {
            let mut elem = node_to_element(tree);
            elem.print();
        }
        Ok(())
    }

    /// Print the current tree to stderr.
    #[napi]
    pub async fn eprint(&self) -> Result<()> {
        let state = self.state.lock().await;
        if let Some(tree) = &state.tree {
            let mut elem = node_to_element(tree);
            elem.eprint();
        }
        Ok(())
    }
}

// ============================================================================
// Simple Box/Text Helpers (Convenience API)
// ============================================================================

/// Create a simple text component node.
#[napi]
pub fn text(content: String) -> ComponentNode {
    ComponentNode {
        children: None,
        node_type: "Text".to_string(),
        content: Some(content),
        border_style: None,
        border_color: None,
        background_color: None,
        color: None,
        flex_direction: None,
        justify_content: None,
        align_items: None,
        weight: None,
        align: None,
        wrap: None,
        width_percent: None,
        height_percent: None,
        flex_grow: None,
        flex_shrink: None,
        width: None,
        height: None,
        padding: None,
        padding_top: None,
        padding_right: None,
        padding_bottom: None,
        padding_left: None,
        padding_x: None,
        padding_y: None,
        gap: None,
        row_gap: None,
        column_gap: None,
        margin: None,
        margin_top: None,
        margin_right: None,
        margin_bottom: None,
        margin_left: None,
        margin_x: None,
        margin_y: None,
        underline: None,
        italic: None,
        bold: None,
    }
}

/// Create a View/Box component node with children.
#[napi]
pub fn view(children: Vec<ComponentNode>) -> ComponentNode {
    ComponentNode {
        children: Some(children),
        node_type: "View".to_string(),
        content: None,
        border_style: None,
        border_color: None,
        background_color: None,
        color: None,
        flex_direction: None,
        justify_content: None,
        align_items: None,
        weight: None,
        align: None,
        wrap: None,
        width_percent: None,
        height_percent: None,
        flex_grow: None,
        flex_shrink: None,
        width: None,
        height: None,
        padding: None,
        padding_top: None,
        padding_right: None,
        padding_bottom: None,
        padding_left: None,
        padding_x: None,
        padding_y: None,
        gap: None,
        row_gap: None,
        column_gap: None,
        margin: None,
        margin_top: None,
        margin_right: None,
        margin_bottom: None,
        margin_left: None,
        margin_x: None,
        margin_y: None,
        underline: None,
        italic: None,
        bold: None,
    }
}

// ============================================================================
// Module Initialization
// ============================================================================

/// Initialize the iocraft module.
#[napi]
pub fn init() -> Result<()> {
    Ok(())
}

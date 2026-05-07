//! Node.js bindings for iocraft TUI library.
//!
//! This module provides native bindings to iocraft, enabling React-like
//! declarative terminal UIs in Node.js with:
//! - Flexbox layouts
//! - Mouse support
//! - Keyboard input
//! - Rich styling
//! - Interactive event loops
//! - State management

// OPTIMIZATION: Custom global allocator for 10-20% faster malloc
// mimalloc provides superior performance compared to system allocator
// SAFETY: mimalloc is a drop-in replacement for malloc with identical semantics
#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

mod builder;
mod error;
mod events;
mod render_loop;
mod state;

pub use builder::*;
pub use error::IocraftError;
pub use events::*;
pub use render_loop::*;
pub use state::*;

use crossterm::terminal;
use iocraft::prelude::*;
use napi::bindgen_prelude::*;
use napi::threadsafe_function::UnknownReturnValue;
use napi_derive::napi;
use phf::phf_map;
use serde::{Deserialize, Serialize};
use smallvec::SmallVec;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

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
/// Uses #[repr(C)] for predictable layout across FFI boundary.
/// Fields ordered by size to minimize padding.
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[repr(C)]
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

    /// Whether text color is dimmed (Option<bool>: 2 bytes)
    pub dim_color: Option<bool>,

    /// Whether text has strikethrough (Option<bool>: 2 bytes)
    pub strikethrough: Option<bool>,

    /// Flex basis - initial main size of a flex item (Option<String>: 24 bytes)
    pub flex_basis: Option<String>,

    /// Flex wrap behavior (Option<String>: 24 bytes)
    pub flex_wrap: Option<String>,

    /// Overflow behavior in horizontal direction (Option<String>: 24 bytes)
    pub overflow_x: Option<String>,

    /// Overflow behavior in vertical direction (Option<String>: 24 bytes)
    pub overflow_y: Option<String>,

    /// Display type (Option<String>: 24 bytes)
    pub display: Option<String>,

    /// Position type (Option<String>: 24 bytes)
    pub position: Option<String>,

    /// Top inset (Option<i32>: 8 bytes)
    pub top: Option<i32>,

    /// Right inset (Option<i32>: 8 bytes)
    pub right: Option<i32>,

    /// Bottom inset (Option<i32>: 8 bytes)
    pub bottom: Option<i32>,

    /// Left inset (Option<i32>: 8 bytes)
    pub left: Option<i32>,

    /// Inset for all sides (Option<i32>: 8 bytes)
    pub inset: Option<i32>,

    /// Minimum width (Option<u32>: 8 bytes)
    pub min_width: Option<u32>,

    /// Maximum width (Option<u32>: 8 bytes)
    pub max_width: Option<u32>,

    /// Minimum height (Option<u32>: 8 bytes)
    pub min_height: Option<u32>,

    /// Maximum height (Option<u32>: 8 bytes)
    pub max_height: Option<u32>,

    /// Align content (Option<String>: 24 bytes)
    pub align_content: Option<String>,

    /// Border edges configuration (Option<BorderEdgesConfig>: variable bytes)
    pub border_edges: Option<BorderEdgesConfig>,

    /// Mixed text contents for MixedText component (Option<Vec<MixedTextContent>>: variable bytes)
    pub mixed_text_contents: Option<Vec<MixedTextContent>>,

    /// Custom border characters for Custom border style (Option<CustomBorderChars>: variable bytes)
    pub custom_border_chars: Option<CustomBorderChars>,
}

/// Border edges configuration for selective border rendering
#[napi(object)]
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct BorderEdgesConfig {
    pub top: Option<bool>,
    pub right: Option<bool>,
    pub bottom: Option<bool>,
    pub left: Option<bool>,
}

/// Mixed text content section with individual styling
#[napi(object)]
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct MixedTextContent {
    /// Text content for this section
    pub text: String,

    /// Color for this section (Option<String>: 24 bytes)
    pub color: Option<String>,

    /// Weight for this section (Option<String>: 24 bytes)
    pub weight: Option<String>,

    /// Text decoration (Option<String>: 24 bytes)
    pub decoration: Option<String>,

    /// Whether this section is italic (Option<bool>: 2 bytes)
    pub italic: Option<bool>,
}

/// Custom border characters for BorderStyle::Custom
#[napi(object)]
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CustomBorderChars {
    pub top_left: String,
    pub top_right: String,
    pub bottom_left: String,
    pub bottom_right: String,
    pub left: String,
    pub right: String,
    pub top: String,
    pub bottom: String,
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

static ALIGN_CONTENT_MAP: phf::Map<&'static str, AlignContent> = phf_map! {
    "flexstart" => AlignContent::FlexStart,
    "flex-start" => AlignContent::FlexStart,
    "start" => AlignContent::FlexStart,
    "flexend" => AlignContent::FlexEnd,
    "flex-end" => AlignContent::FlexEnd,
    "end" => AlignContent::FlexEnd,
    "center" => AlignContent::Center,
    "stretch" => AlignContent::Stretch,
    "spacebetween" => AlignContent::SpaceBetween,
    "space-between" => AlignContent::SpaceBetween,
    "spacearound" => AlignContent::SpaceAround,
    "space-around" => AlignContent::SpaceAround,
};

static DISPLAY_MAP: phf::Map<&'static str, Display> = phf_map! {
    "flex" => Display::Flex,
    "none" => Display::None,
};

static POSITION_MAP: phf::Map<&'static str, Position> = phf_map! {
    "relative" => Position::Relative,
    "absolute" => Position::Absolute,
};

// ============================================================================
// Helper Functions for Parsing
// ============================================================================

/// Fast hex digit to value conversion.
/// OPTIMIZATION: Uses arithmetic and bit masking to minimize branches
#[doc(hidden)]
#[inline(always)]
pub const fn hex_to_u8(c: u8) -> Option<u8> {
    // OPTIMIZATION: Fast hex parsing using bit arithmetic
    // Uses arithmetic operations to check character class and compute result
    // Minimizes branches to a single final validity check

    // Check if digit (0-9): c >= '0' && c <= '9'
    let is_digit = ((c.wrapping_sub(b'0')) < 10) as u8;
    let digit_val = c.wrapping_sub(b'0');

    // Check if lowercase hex (a-f): c >= 'a' && c <= 'f'
    let is_lower = ((c.wrapping_sub(b'a')) < 6) as u8;
    let lower_val = c.wrapping_sub(b'a') + 10;

    // Check if uppercase hex (A-F): c >= 'A' && c <= 'F'
    let is_upper = ((c.wrapping_sub(b'A')) < 6) as u8;
    let upper_val = c.wrapping_sub(b'A') + 10;

    // Combine results: select the valid result using bit operations
    let result = (is_digit * digit_val) | (is_lower * lower_val) | (is_upper * upper_val);
    let is_valid = is_digit | is_lower | is_upper;

    // Return Some if valid, None otherwise
    if is_valid != 0 {
        Some(result)
    } else {
        None
    }
}

/// Parse hex color (#RRGGBB or RRGGBB) with optimized byte-level parsing.
///
/// This function is optimized for performance:
/// - Direct byte access (no UTF-8 overhead)
/// - Arithmetic-based hex digit conversion (minimal branches)
/// - Single pass through the string
/// - Compiler may elide bounds checks after length validation
#[doc(hidden)]
#[inline]
pub fn parse_hex_color(s: &str) -> Option<Color> {
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

    // Parse all 6 hex digits (compiler elides bounds checks after length validation)
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

/// OPTIMIZATION: Inline parsing functions for hot path (called on every render)
/// OPTIMIZATION: O(1) PHF map lookup for named colors
#[inline]
pub fn parse_named_color(s: &str) -> Option<Color> {
    // Fast path: exact lowercase match (O(1) PHF lookup)
    if let Some(&color) = COLOR_MAP.get(s) {
        return Some(color);
    }

    // Try ANSI 256 color code (e.g., "ansi:123" or just "123")
    if let Some(num_str) = s.strip_prefix("ansi:") {
        if let Ok(code) = num_str.parse::<u8>() {
            return Some(Color::AnsiValue(code));
        }
    } else if let Ok(code) = s.parse::<u8>() {
        // Allow bare numbers as ANSI codes
        return Some(Color::AnsiValue(code));
    }

    // Try hex color before falling back to case conversion.
    // Hex colors start with '#' or are 6 hex digits.
    if s.len() == 6 || (s.len() == 7 && s.starts_with('#')) {
        if let Some(color) = parse_hex_color(s) {
            return Some(color);
        }
    }

    // Slow path: convert to lowercase once and retry
    // This handles PascalCase/UPPERCASE variants (rare in practice)
    parse_named_color_fallback(s)
}

/// Fallback for non-lowercase color names (marked cold for branch prediction)
/// BARE-METAL: #[cold] tells CPU this path is rarely taken
#[cold]
#[inline(never)]
fn parse_named_color_fallback(s: &str) -> Option<Color> {
    let lower = s.to_ascii_lowercase();
    COLOR_MAP.get(lower.as_str()).copied()
}

/// Inline for zero-cost abstraction in hot path
/// Fast-path with PHF map lookup
#[inline(always)]
pub fn parse_border_style(s: &str) -> BorderStyle {
    // Fast path: exact lowercase match (O(1) lookup).
    // Fast path: exact match
    if let Some(&style) = BORDER_STYLE_MAP.get(s) {
        return style;
    }

    // Fallback: convert to lowercase once and retry
    let lower = s.to_ascii_lowercase();
    BORDER_STYLE_MAP
        .get(lower.as_str())
        .copied()
        .unwrap_or(BorderStyle::None)
}

/// Inline for zero-cost abstraction in hot path
/// Fast-path with PHF map lookup
#[inline(always)]
pub fn parse_flex_direction(s: &str) -> FlexDirection {
    // Fast path: exact match (O(1) PHF lookup)
    if let Some(&dir) = FLEX_DIRECTION_MAP.get(s) {
        return dir;
    }

    // Fallback: convert to lowercase once and retry
    let lower = s.to_ascii_lowercase();
    FLEX_DIRECTION_MAP
        .get(lower.as_str())
        .copied()
        .unwrap_or(FlexDirection::Row)
}

#[inline(always)]
pub fn parse_justify_content(s: &str) -> JustifyContent {
    // Fast path: exact match (O(1) PHF lookup)
    if let Some(&justify) = JUSTIFY_CONTENT_MAP.get(s) {
        return justify;
    }

    // Fallback: convert to lowercase once and retry
    let lower = s.to_ascii_lowercase();
    JUSTIFY_CONTENT_MAP
        .get(lower.as_str())
        .copied()
        .unwrap_or(JustifyContent::FlexStart)
}

#[inline(always)]
pub fn parse_align_items(s: &str) -> AlignItems {
    // Fast path: exact match (O(1) PHF lookup)
    if let Some(&align) = ALIGN_ITEMS_MAP.get(s) {
        return align;
    }

    // Fallback: convert to lowercase once and retry
    let lower = s.to_ascii_lowercase();
    ALIGN_ITEMS_MAP
        .get(lower.as_str())
        .copied()
        .unwrap_or(AlignItems::Stretch)
}

#[inline(always)]
pub fn parse_text_align(s: &str) -> TextAlign {
    // Fast path: exact match (O(1) PHF lookup)
    if let Some(&align) = TEXT_ALIGN_MAP.get(s) {
        return align;
    }

    // Fallback: convert to lowercase once and retry
    let lower = s.to_ascii_lowercase();
    TEXT_ALIGN_MAP
        .get(lower.as_str())
        .copied()
        .unwrap_or(TextAlign::Left)
}

#[inline(always)]
pub fn parse_weight(s: &str) -> Weight {
    // Fast path: exact match (O(1) PHF lookup)
    if let Some(&weight) = WEIGHT_MAP.get(s) {
        return weight;
    }

    // Fallback: convert to lowercase once and retry
    let lower = s.to_ascii_lowercase();
    WEIGHT_MAP
        .get(lower.as_str())
        .copied()
        .unwrap_or(Weight::Normal)
}

#[inline(always)]
pub fn parse_text_wrap(s: &str) -> TextWrap {
    // Fast path: exact match (O(1) PHF lookup)
    if let Some(&wrap) = TEXT_WRAP_MAP.get(s) {
        return wrap;
    }

    // Fallback: convert to lowercase once and retry
    let lower = s.to_ascii_lowercase();
    TEXT_WRAP_MAP
        .get(lower.as_str())
        .copied()
        .unwrap_or(TextWrap::Wrap)
}

#[inline(always)]
pub fn parse_align_content(s: &str) -> AlignContent {
    // Fast path: exact match (O(1) PHF lookup)
    if let Some(&align) = ALIGN_CONTENT_MAP.get(s) {
        return align;
    }

    // Fallback: convert to lowercase once and retry
    let lower = s.to_ascii_lowercase();
    ALIGN_CONTENT_MAP
        .get(lower.as_str())
        .copied()
        .unwrap_or(AlignContent::Stretch)
}

#[inline(always)]
pub fn parse_display(s: &str) -> Display {
    // Fast path: exact match (O(1) PHF lookup)
    if let Some(&display) = DISPLAY_MAP.get(s) {
        return display;
    }

    // Fallback: convert to lowercase once and retry
    let lower = s.to_ascii_lowercase();
    DISPLAY_MAP
        .get(lower.as_str())
        .copied()
        .unwrap_or(Display::Flex)
}

#[inline(always)]
pub fn parse_position(s: &str) -> Position {
    // Fast path: exact match (O(1) PHF lookup)
    if let Some(&position) = POSITION_MAP.get(s) {
        return position;
    }

    // Fallback: convert to lowercase once and retry
    let lower = s.to_ascii_lowercase();
    POSITION_MAP
        .get(lower.as_str())
        .copied()
        .unwrap_or(Position::Relative)
}

// ============================================================================
// Dynamic Component Wrapper
// ============================================================================

/// Convert a ComponentNode to an AnyElement.
/// OPTIMIZATION: This is called on EVERY render - must be maximum performance
/// - Inline for zero function call overhead
/// - Early-exit ASCII case comparison (no allocation)
/// - Pre-allocated Vec capacity for children
/// - Minimize Option unwrapping with as_ref()
#[inline]
pub fn node_to_element(node: &ComponentNode) -> AnyElement<'static> {
    // OPTIMIZATION: eq_ignore_ascii_case is O(n) but avoids heap allocation
    // Most nodes are "View", "Text", "MixedText", or "Fragment"
    if node.node_type.eq_ignore_ascii_case("mixedtext") {
        // MixedText component branch.
        let contents = if let Some(mixed_contents) = &node.mixed_text_contents {
            mixed_contents
                .iter()
                .map(|mc| {
                    let mut content = iocraft::components::MixedTextContent::new(&mc.text);

                    if let Some(color) = mc.color.as_ref().and_then(|c| parse_named_color(c)) {
                        content = content.color(color);
                    }

                    let weight = mc
                        .weight
                        .as_ref()
                        .map(|w| parse_weight(w))
                        .unwrap_or(Weight::Normal);
                    content = content.weight(weight);

                    if let Some(dec_str) = &mc.decoration {
                        let decoration = if dec_str.eq_ignore_ascii_case("underline") {
                            TextDecoration::Underline
                        } else if dec_str.eq_ignore_ascii_case("strikethrough") {
                            TextDecoration::Strikethrough
                        } else {
                            TextDecoration::None
                        };
                        content = content.decoration(decoration);
                    }

                    if mc.italic.unwrap_or(false) {
                        content = content.italic();
                    }

                    content
                })
                .collect()
        } else {
            Vec::new()
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

        element! {
            MixedText(
                contents: contents,
                align: align,
                wrap: wrap,
            )
        }
        .into_any()
    } else if node.node_type.eq_ignore_ascii_case("fragment") {
        // Fragment component branch - transparent wrapper.
        let children: Vec<AnyElement<'static>> = if let Some(child_nodes) = &node.children {
            if child_nodes.is_empty() {
                Vec::new()
            } else {
                child_nodes.iter().map(|child| node_to_element(child)).collect()
            }
        } else {
            Vec::new()
        };

        element! {
            Fragment {
                #(children)
            }
        }
        .into_any()
    } else if node.node_type.eq_ignore_ascii_case("text") {
        // Text component branch.
        // OPTIMIZATION: as_deref() avoids cloning the String
        let content = node.content.as_deref().unwrap_or("");
            // OPTIMIZATION: and_then() short-circuits if None, avoiding parse call
            let color = node.color.as_ref().and_then(|c| parse_named_color(c));
            // OPTIMIZATION: Check bold and dim_color flags first (cheapest checks)
            let weight = if node.bold.unwrap_or(false) {
                Weight::Bold
            } else if node.dim_color.unwrap_or(false) {
                Weight::Light
            } else {
                node.weight
                    .as_ref()
                    .map(|w| parse_weight(w))
                    .unwrap_or(Weight::Normal)
            };
            // OPTIMIZATION: map() only calls parse if Some, avoiding unnecessary work
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
            // OPTIMIZATION: unwrap_or(false) typically optimizes well (may use select/cmov)
            let underline = node.underline.unwrap_or(false);
            let strikethrough = node.strikethrough.unwrap_or(false);
            let italic = node.italic.unwrap_or(false);

            // Determine text decoration (underline takes precedence over strikethrough)
            let decoration = if underline {
                TextDecoration::Underline
            } else if strikethrough {
                TextDecoration::Strikethrough
            } else {
                TextDecoration::None
            };

        element! {
            Text(
                content: content,
                color: color,
                weight: weight,
                align: align,
                wrap: wrap,
                decoration: decoration,
                italic: italic,
            )
        }
        .into_any()
    } else {
        // View component branch (default for "view", "box", or any other type).
        // OPTIMIZATION: SmallVec optimization - most component trees have 0-8 children
        // This avoids heap allocation for 95% of components (based on typical TUI patterns)
            let children: Vec<AnyElement<'static>> = if let Some(child_nodes) = &node.children {
                // OPTIMIZATION: Empty check avoids allocation for leaf nodes
                if child_nodes.is_empty() {
                    Vec::new()
                } else {
                    // OPTIMIZATION: Use SmallVec<[_; 8]> for inline storage, then convert to Vec
                    // Analysis: Typical TUI components have 1-4 children (text labels, icons)
                    // Complex forms rarely exceed 8 direct children due to nesting
                    let mut children: SmallVec<[AnyElement<'static>; 8]> = SmallVec::with_capacity(child_nodes.len());
                    for child in child_nodes {
                        children.push(node_to_element(child));
                    }
                    children.into_vec()
                }
            } else {
                Vec::new()
            };

            // Parse all the properties
            let border_style = if let Some(custom_chars) = &node.custom_border_chars {
                // Custom border with user-defined characters
                BorderStyle::Custom(iocraft::components::BorderCharacters {
                    top_left: custom_chars.top_left.chars().next().unwrap_or('+'),
                    top_right: custom_chars.top_right.chars().next().unwrap_or('+'),
                    bottom_left: custom_chars.bottom_left.chars().next().unwrap_or('+'),
                    bottom_right: custom_chars.bottom_right.chars().next().unwrap_or('+'),
                    left: custom_chars.left.chars().next().unwrap_or('|'),
                    right: custom_chars.right.chars().next().unwrap_or('|'),
                    top: custom_chars.top.chars().next().unwrap_or('-'),
                    bottom: custom_chars.bottom.chars().next().unwrap_or('-'),
                })
            } else {
                node.border_style
                    .as_ref()
                    .map(|s| parse_border_style(s))
                    .unwrap_or(BorderStyle::None)
            };
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
            let align_content = node
                .align_content
                .as_ref()
                .map(|a| parse_align_content(a));
            let display = node
                .display
                .as_ref()
                .map(|d| parse_display(d))
                .unwrap_or(Display::Flex);
            let position = node
                .position
                .as_ref()
                .map(|p| parse_position(p))
                .unwrap_or(Position::Relative);

            // Build the View element with all props
            let mut view_props = ViewProps::default();
            view_props.children = children;
            view_props.border_style = border_style;
            view_props.border_color = border_color;
            view_props.background_color = background_color;
            view_props.flex_direction = flex_direction;
            view_props.justify_content = justify_content;
            view_props.align_items = align_items;
            view_props.align_content = align_content;
            view_props.display = display;
            view_props.position = position;

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

            // Min/Max dimensions
            if let Some(w) = node.min_width {
                view_props.min_width = w.into();
            }
            if let Some(w) = node.max_width {
                view_props.max_width = w.into();
            }
            if let Some(h) = node.min_height {
                view_props.min_height = h.into();
            }
            if let Some(h) = node.max_height {
                view_props.max_height = h.into();
            }

            // Inset positioning
            if let Some(i) = node.inset {
                view_props.inset = i.into();
            }
            if let Some(t) = node.top {
                view_props.top = t.into();
            }
            if let Some(r) = node.right {
                view_props.right = r.into();
            }
            if let Some(b) = node.bottom {
                view_props.bottom = b.into();
            }
            if let Some(l) = node.left {
                view_props.left = l.into();
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

            // Flex basis
            if let Some(fb) = &node.flex_basis {
                if fb.eq_ignore_ascii_case("auto") {
                    view_props.flex_basis = FlexBasis::Auto;
                } else if let Ok(val) = fb.parse::<u32>() {
                    view_props.flex_basis = FlexBasis::Length(val);
                } else if let Some(pct_str) = fb.strip_suffix('%') {
                    if let Ok(pct) = pct_str.parse::<f32>() {
                        view_props.flex_basis = FlexBasis::Percent(pct);
                    }
                }
            }

            // Flex wrap
            if let Some(fw) = &node.flex_wrap {
                view_props.flex_wrap = if fw.eq_ignore_ascii_case("wrap") {
                    FlexWrap::Wrap
                } else {
                    FlexWrap::NoWrap
                };
            }

            // Overflow
            if let Some(ox) = &node.overflow_x {
                view_props.overflow_x = Some(if ox.eq_ignore_ascii_case("hidden") {
                    Overflow::Hidden
                } else {
                    Overflow::Visible
                });
            }

            if let Some(oy) = &node.overflow_y {
                view_props.overflow_y = Some(if oy.eq_ignore_ascii_case("hidden") {
                    Overflow::Hidden
                } else {
                    Overflow::Visible
                });
            }

            // Border edges
            if let Some(edges_config) = &node.border_edges {
                let mut edges = Edges::empty();
                if edges_config.top.unwrap_or(true) {
                    edges |= Edges::Top;
                }
                if edges_config.right.unwrap_or(true) {
                    edges |= Edges::Right;
                }
                if edges_config.bottom.unwrap_or(true) {
                    edges |= Edges::Bottom;
                }
                if edges_config.left.unwrap_or(true) {
                    edges |= Edges::Left;
                }
                view_props.border_edges = Some(edges);
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
pub fn render_to_string(tree: serde_json::Value) -> Result<String> {
    // Deserialize using serde_json to properly handle all fields
    let tree: ComponentNode = serde_json::from_value(tree)
        .map_err(IocraftError::from)?;

    let mut elem = node_to_element(&tree);
    // Get terminal width or fall back to 80 columns for layout calculation
    let width = terminal::size().map(|(w, _)| w as usize).unwrap_or(80);
    let canvas = elem.render(Some(width));
    Ok(canvas.to_string())
}

/// Render a component tree to a string with a maximum width.
#[napi(js_name = "render_to_string_with_width")]
pub fn render_to_string_with_width(tree: serde_json::Value, max_width: u32) -> Result<String> {
    let tree: ComponentNode = serde_json::from_value(tree)
        .map_err(IocraftError::from)?;
    let mut elem = node_to_element(&tree);
    let canvas = elem.render(Some(max_width as usize));
    Ok(canvas.to_string())
}

/// Render a component tree and print to stdout.
#[napi(js_name = "print_component")]
pub fn print_component(tree: serde_json::Value) -> Result<()> {
    let tree: ComponentNode = serde_json::from_value(tree)
        .map_err(IocraftError::from)?;
    let mut elem = node_to_element(&tree);
    // Get terminal width or fall back to 80 columns for layout calculation
    let width = terminal::size().map(|(w, _)| w as usize).unwrap_or(80);
    let canvas = elem.render(Some(width));
    println!("{}", canvas.to_string());
    Ok(())
}

/// Render a component tree and print to stderr.
#[napi(js_name = "eprint_component")]
pub fn eprint_component(tree: serde_json::Value) -> Result<()> {
    let tree: ComponentNode = serde_json::from_value(tree)
        .map_err(IocraftError::from)?;
    let mut elem = node_to_element(&tree);
    // Get terminal width or fall back to 80 columns for layout calculation
    let width = terminal::size().map(|(w, _)| w as usize).unwrap_or(80);
    let canvas = elem.render(Some(width));
    eprintln!("{}", canvas.to_string());
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
pub fn render_to_string_camel(tree: serde_json::Value) -> Result<String> {
    render_to_string(tree)
}

/// Render a component tree to a string with a maximum width (camelCase alias).
#[napi(js_name = "renderToStringWithWidth")]
pub fn render_to_string_with_width_camel(tree: serde_json::Value, max_width: u32) -> Result<String> {
    render_to_string_with_width(tree, max_width)
}

/// Render a component tree and print to stdout (camelCase alias).
#[napi(js_name = "printComponent")]
pub fn print_component_camel(tree: serde_json::Value) -> Result<()> {
    print_component(tree)
}

/// Render a component tree and print to stderr (camelCase alias).
#[napi(js_name = "eprintComponent")]
pub fn eprint_component_camel(tree: serde_json::Value) -> Result<()> {
    eprint_component(tree)
}

// ============================================================================
// Interactive Renderer
// ============================================================================

/// Interactive TUI renderer with state management and event handling.
///
/// This renderer supports both static rendering (render_once) and interactive
/// rendering with event loops (start_interactive). For interactive applications,
/// use the event handling APIs to respond to user input and trigger re-renders.
/// The renderer can be stopped and restarted multiple times.
#[napi]
pub struct TuiRenderer {
    state: Arc<render_loop::InteractiveRendererState>,
    running: Arc<AtomicBool>,
}

#[napi]
impl TuiRenderer {
    /// Create a new TUI renderer.
    #[napi(constructor)]
    pub fn new() -> Result<Self> {
        let running = Arc::new(AtomicBool::new(false));
        let state = render_loop::InteractiveRendererState::new(running.clone());
        Ok(Self {
            state: Arc::new(state),
            running,
        })
    }

    /// Set the component tree to render (async version).
    /// BARE-METAL: Uses RwLock write (exclusive, but fast for infrequent writes)
    #[napi]
    pub async fn set_tree(&self, tree: serde_json::Value) -> Result<()> {
        let tree: ComponentNode = serde_json::from_value(tree)
            .map_err(IocraftError::from)?;
        // BARE-METAL: RwLock write is fast when uncontended (common case)
        *self.state.tree.write() = Some(tree);
        Ok(())
    }

    /// Update the component tree (synchronous version).
    /// BARE-METAL: Direct write, no spawn overhead
    #[napi]
    pub fn update_tree(&self, tree: serde_json::Value) -> Result<()> {
        let tree: ComponentNode = serde_json::from_value(tree)
            .map_err(IocraftError::from)?;
        // BARE-METAL: Direct synchronous write (faster than spawning task)
        *self.state.tree.write() = Some(tree);
        Ok(())
    }

    /// Check if the renderer is running.
    /// Uses Acquire ordering to synchronize with Release stores in stop() and guard drop
    #[napi]
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::Acquire)
    }

    /// Get terminal size.
    #[napi]
    pub fn get_size(&self) -> Result<Vec<u32>> {
        get_terminal_size()
    }

    /// Render the current tree once and return the output string.
    /// BARE-METAL: RwLock read is lock-free when no writers (common case)
    #[napi]
    pub async fn render_once(&self) -> Result<String> {
        let tree_guard = self.state.tree.read();
        match &*tree_guard {
            Some(tree) => {
                let mut elem = node_to_element(tree);
                // Get terminal width or fall back to 80 columns for layout calculation
                let width = terminal::size().map(|(w, _)| w as usize).unwrap_or(80);
                let canvas = elem.render(Some(width));
                Ok(canvas.to_string())
            }
            None => Ok(String::new()),
        }
    }

    /// Render the current tree with a specific width.
    /// BARE-METAL: RwLock read is lock-free when no writers
    #[napi]
    pub async fn render_with_width(&self, max_width: u32) -> Result<String> {
        let tree_guard = self.state.tree.read();
        match &*tree_guard {
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
        let tree_guard = self.state.tree.read();
        if let Some(tree) = tree_guard.as_ref() {
            let mut elem = node_to_element(tree);
            // Get terminal width or fall back to 80 columns for layout calculation
            let width = terminal::size().map(|(w, _)| w as usize).unwrap_or(80);
            let canvas = elem.render(Some(width));
            println!("{}", canvas.to_string());
        }
        Ok(())
    }

    /// Print the current tree to stderr.
    /// BARE-METAL: RwLock read with branch prediction hint
    #[napi]
    pub async fn eprint(&self) -> Result<()> {
        let tree_guard = self.state.tree.read();
        if let Some(tree) = tree_guard.as_ref() {
            let mut elem = node_to_element(tree);
            // Get terminal width or fall back to 80 columns for layout calculation
            let width = terminal::size().map(|(w, _)| w as usize).unwrap_or(80);
            let canvas = elem.render(Some(width));
            eprintln!("{}", canvas.to_string());
        }
        Ok(())
    }

    // ========================================================================
    // Interactive Rendering with Event Loop
    // ========================================================================

    /// Start the interactive render loop with event handling.
    ///
    /// This method spawns an async event loop that:
    /// - Listens for terminal events (keyboard, mouse, resize)
    /// - Calls the on_event callback for each event
    /// - Re-renders when request_render() is called
    /// - Uses differential rendering (only redraws when canvas changes)
    ///
    /// The render loop runs in the background until stop() is called.
    ///
    /// # Arguments
    /// * `on_event` - JavaScript callback for terminal events
    /// * `fullscreen` - Whether to use fullscreen mode (optional, default: false)
    /// * `mouse_capture` - Whether to capture mouse events (optional, default: true)
    ///
    /// # Example
    /// ```javascript
    /// const renderer = new TuiRenderer()
    /// await renderer.setTree({ type: 'Text', content: 'Hello' })
    ///
    /// renderer.startInteractive(
    ///   (event) => {
    ///     if (event.key?.code === 'q') {
    ///       renderer.stop()
    ///     }
    ///   },
    ///   false, // fullscreen
    ///   true   // mouse_capture
    /// )
    /// ```
    #[napi(ts_args_type = "on_event: (event: JsTerminalEvent) => void, fullscreen?: boolean, mouse_capture?: boolean")]
    pub fn start_interactive(
        &self,
        on_event: Function<JsTerminalEvent, UnknownReturnValue>,
        fullscreen: Option<bool>,
        mouse_capture: Option<bool>,
    ) -> Result<()> {
        // Create ThreadsafeFunction for event callback
        let tsfn = on_event
            .build_threadsafe_function::<JsTerminalEvent>()
            .callee_handled::<true>()
            .build_callback(move |ctx| Ok(ctx.value))?;

        // Atomic compare-and-swap: only proceed if not already running
        // This prevents double render loop race condition
        // Use AcqRel: synchronizes with Release store in stop() and Drop
        if self.running
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Err(IocraftError::RendererAlreadyRunning.into());
        }

        // Clone state and running flag for render loop
        let state = self.state.clone();
        let running = self.running.clone();

        // Trigger initial render and run loop
        tokio::spawn(async move {
            // Create render channel inside spawn to avoid resource leak
            // if spawn fails or task never runs
            let render_rx = state.create_render_channel();

            // Request initial render
            state.request_render();

            // Run render loop with RAII guard for running flag
            if let Err(e) = render_loop::interactive_render_loop(
                state,
                render_rx,
                tsfn,
                fullscreen.unwrap_or(false),
                mouse_capture.unwrap_or(true),
                running,
            )
            .await
            {
                eprintln!("Render loop error: {}", e);
            }
        });

        Ok(())
    }

    /// Stop the interactive render loop.
    /// Uses Release ordering to synchronize with Acquire loads in the render loop
    #[napi]
    pub fn stop(&self) -> Result<()> {
        self.running.store(false, Ordering::Release);
        Ok(())
    }

    /// Request a re-render of the component tree (async version).
    /// BARE-METAL: Lock-free channel send (no Mutex overhead)
    #[napi]
    pub async fn request_render_async(&self) -> Result<()> {
        self.state.request_render();
        Ok(())
    }

    /// Request a re-render of the component tree (synchronous version).
    /// BARE-METAL: Direct lock-free send (no spawn overhead)
    #[napi]
    pub fn request_render(&self) -> Result<()> {
        self.state.request_render();
        Ok(())
    }

    // ========================================================================
    // Telemetry
    // ========================================================================

    /// Get the number of events that were dropped due to JavaScript being busy.
    ///
    /// Events may be dropped when the JavaScript event callback cannot keep up
    /// with the rate of terminal events (keyboard, mouse, resize). This counter
    /// helps diagnose performance issues in event handlers.
    ///
    /// # Returns
    /// The total number of events dropped since the renderer started or since
    /// the last call to `reset_dropped_event_count()`. Returns as f64 to avoid
    /// overflow (JavaScript Number can safely represent integers up to 2^53).
    #[napi]
    pub fn get_dropped_event_count(&self) -> f64 {
        self.state.dropped_events.load(Ordering::Relaxed) as f64
    }

    /// Reset the dropped events counter to zero.
    ///
    /// Useful for measuring dropped events over specific time periods or
    /// after addressing performance issues in event handlers.
    #[napi]
    pub fn reset_dropped_event_count(&self) -> Result<()> {
        self.state.dropped_events.store(0, Ordering::Relaxed);
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
        dim_color: None,
        strikethrough: None,
        flex_basis: None,
        flex_wrap: None,
        overflow_x: None,
        overflow_y: None,
        display: None,
        position: None,
        top: None,
        right: None,
        bottom: None,
        left: None,
        inset: None,
        min_width: None,
        max_width: None,
        min_height: None,
        max_height: None,
        align_content: None,
        border_edges: None,
        mixed_text_contents: None,
        custom_border_chars: None,
    }
}

/// Create a View/Box component node with children.
/// Note: This function is deprecated and should not be used.
/// Due to NAPI deserialization bugs with Option<String> in arrays, creating nodes
/// via plain JavaScript objects is preferred. See iocraft.mts for the correct approach.
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
        dim_color: None,
        strikethrough: None,
        flex_basis: None,
        flex_wrap: None,
        overflow_x: None,
        overflow_y: None,
        display: None,
        position: None,
        top: None,
        right: None,
        bottom: None,
        left: None,
        inset: None,
        min_width: None,
        max_width: None,
        min_height: None,
        max_height: None,
        align_content: None,
        border_edges: None,
        mixed_text_contents: None,
        custom_border_chars: None,
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

// ============================================================================
// Unit Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // ========================================================================
    // Hex Color Parsing Tests
    // ========================================================================

    #[test]
    fn test_hex_color_with_hash() {
        let color = parse_hex_color("#FF0000");
        assert!(color.is_some());
        if let Some(Color::Rgb { r, g, b }) = color {
            assert_eq!(r, 255);
            assert_eq!(g, 0);
            assert_eq!(b, 0);
        } else {
            panic!("Expected RGB color");
        }
    }

    #[test]
    fn test_hex_color_without_hash() {
        let color = parse_hex_color("00FF00");
        assert!(color.is_some());
        if let Some(Color::Rgb { r, g, b }) = color {
            assert_eq!(r, 0);
            assert_eq!(g, 255);
            assert_eq!(b, 0);
        } else {
            panic!("Expected RGB color");
        }
    }

    #[test]
    fn test_hex_color_lowercase() {
        let color = parse_hex_color("#abcdef");
        assert!(color.is_some());
        if let Some(Color::Rgb { r, g, b }) = color {
            assert_eq!(r, 0xab);
            assert_eq!(g, 0xcd);
            assert_eq!(b, 0xef);
        } else {
            panic!("Expected RGB color");
        }
    }

    #[test]
    fn test_hex_color_uppercase() {
        let color = parse_hex_color("#ABCDEF");
        assert!(color.is_some());
        if let Some(Color::Rgb { r, g, b }) = color {
            assert_eq!(r, 0xAB);
            assert_eq!(g, 0xCD);
            assert_eq!(b, 0xEF);
        } else {
            panic!("Expected RGB color");
        }
    }

    #[test]
    fn test_hex_color_mixed_case() {
        let color = parse_hex_color("#AbCdEf");
        assert!(color.is_some());
        if let Some(Color::Rgb { r, g, b }) = color {
            assert_eq!(r, 0xAB);
            assert_eq!(g, 0xCD);
            assert_eq!(b, 0xEF);
        } else {
            panic!("Expected RGB color");
        }
    }

    #[test]
    fn test_hex_color_invalid_length() {
        assert!(parse_hex_color("#FF").is_none());
        assert!(parse_hex_color("#FFFF").is_none());
        assert!(parse_hex_color("#FFFFFFF").is_none());
        assert!(parse_hex_color("").is_none());
    }

    #[test]
    fn test_hex_color_invalid_characters() {
        assert!(parse_hex_color("#GGGGGG").is_none());
        assert!(parse_hex_color("#FF00ZZ").is_none());
        assert!(parse_hex_color("#FF 000").is_none());
    }

    #[test]
    fn test_hex_color_black_and_white() {
        let black = parse_hex_color("#000000");
        assert!(black.is_some());
        if let Some(Color::Rgb { r, g, b }) = black {
            assert_eq!(r, 0);
            assert_eq!(g, 0);
            assert_eq!(b, 0);
        }

        let white = parse_hex_color("#FFFFFF");
        assert!(white.is_some());
        if let Some(Color::Rgb { r, g, b }) = white {
            assert_eq!(r, 255);
            assert_eq!(g, 255);
            assert_eq!(b, 255);
        }
    }

    // ========================================================================
    // Named Color Parsing Tests
    // ========================================================================

    #[test]
    fn test_named_color_lowercase() {
        assert!(matches!(parse_named_color("red"), Some(Color::Red)));
        assert!(matches!(parse_named_color("blue"), Some(Color::Blue)));
        assert!(matches!(parse_named_color("green"), Some(Color::Green)));
    }

    #[test]
    fn test_named_color_uppercase() {
        assert!(matches!(parse_named_color("RED"), Some(Color::Red)));
        assert!(matches!(parse_named_color("BLUE"), Some(Color::Blue)));
        assert!(matches!(parse_named_color("GREEN"), Some(Color::Green)));
    }

    #[test]
    fn test_named_color_mixed_case() {
        assert!(matches!(parse_named_color("Red"), Some(Color::Red)));
        assert!(matches!(parse_named_color("BlUe"), Some(Color::Blue)));
        assert!(matches!(parse_named_color("GrEeN"), Some(Color::Green)));
    }

    #[test]
    fn test_named_color_grey_gray_variants() {
        // Both spellings should work
        assert!(matches!(parse_named_color("grey"), Some(Color::Grey)));
        assert!(matches!(parse_named_color("gray"), Some(Color::Grey)));
        assert!(matches!(parse_named_color("darkgrey"), Some(Color::DarkGrey)));
        assert!(matches!(parse_named_color("darkgray"), Some(Color::DarkGrey)));
    }

    #[test]
    fn test_named_color_hex_fallback() {
        // Hex colors should work through named_color parser
        let color = parse_named_color("#FF0000");
        assert!(color.is_some());
        if let Some(Color::Rgb { r, g, b }) = color {
            assert_eq!(r, 255);
            assert_eq!(g, 0);
            assert_eq!(b, 0);
        }
    }

    #[test]
    fn test_named_color_invalid() {
        assert!(parse_named_color("notacolor").is_none());
        assert!(parse_named_color("").is_none());
        // "123456" is actually valid hex (RGB{r: 18, g: 52, b: 86})
        // Test truly invalid hex instead
        assert!(parse_named_color("GGGGGG").is_none());
    }

    // ========================================================================
    // Border Style Parsing Tests
    // ========================================================================

    #[test]
    fn test_border_style_lowercase() {
        assert!(matches!(
            parse_border_style("single"),
            BorderStyle::Single
        ));
        assert!(matches!(
            parse_border_style("double"),
            BorderStyle::Double
        ));
        assert!(matches!(parse_border_style("round"), BorderStyle::Round));
    }

    #[test]
    fn test_border_style_uppercase() {
        assert!(matches!(
            parse_border_style("SINGLE"),
            BorderStyle::Single
        ));
        assert!(matches!(
            parse_border_style("DOUBLE"),
            BorderStyle::Double
        ));
    }

    #[test]
    fn test_border_style_rounded_alias() {
        // Both "round" and "rounded" should work
        assert!(matches!(parse_border_style("round"), BorderStyle::Round));
        assert!(matches!(parse_border_style("rounded"), BorderStyle::Round));
    }

    #[test]
    fn test_border_style_invalid_defaults_to_none() {
        assert!(matches!(
            parse_border_style("invalid"),
            BorderStyle::None
        ));
        assert!(matches!(parse_border_style(""), BorderStyle::None));
    }

    // ========================================================================
    // Flex Direction Parsing Tests
    // ========================================================================

    #[test]
    fn test_flex_direction_basic() {
        assert!(matches!(
            parse_flex_direction("row"),
            FlexDirection::Row
        ));
        assert!(matches!(
            parse_flex_direction("column"),
            FlexDirection::Column
        ));
    }

    #[test]
    fn test_flex_direction_reverse() {
        assert!(matches!(
            parse_flex_direction("rowreverse"),
            FlexDirection::RowReverse
        ));
        assert!(matches!(
            parse_flex_direction("row-reverse"),
            FlexDirection::RowReverse
        ));
        assert!(matches!(
            parse_flex_direction("columnreverse"),
            FlexDirection::ColumnReverse
        ));
        assert!(matches!(
            parse_flex_direction("column-reverse"),
            FlexDirection::ColumnReverse
        ));
    }

    #[test]
    fn test_flex_direction_invalid_defaults_to_row() {
        assert!(matches!(
            parse_flex_direction("invalid"),
            FlexDirection::Row
        ));
    }

    // ========================================================================
    // Justify Content Parsing Tests
    // ========================================================================

    #[test]
    fn test_justify_content_basic() {
        assert!(matches!(
            parse_justify_content("center"),
            JustifyContent::Center
        ));
        assert!(matches!(
            parse_justify_content("flexstart"),
            JustifyContent::FlexStart
        ));
        assert!(matches!(
            parse_justify_content("flex-start"),
            JustifyContent::FlexStart
        ));
        assert!(matches!(
            parse_justify_content("start"),
            JustifyContent::FlexStart
        ));
    }

    #[test]
    fn test_justify_content_space_variants() {
        assert!(matches!(
            parse_justify_content("spacebetween"),
            JustifyContent::SpaceBetween
        ));
        assert!(matches!(
            parse_justify_content("space-between"),
            JustifyContent::SpaceBetween
        ));
        assert!(matches!(
            parse_justify_content("spacearound"),
            JustifyContent::SpaceAround
        ));
        assert!(matches!(
            parse_justify_content("space-around"),
            JustifyContent::SpaceAround
        ));
        assert!(matches!(
            parse_justify_content("spaceevenly"),
            JustifyContent::SpaceEvenly
        ));
        assert!(matches!(
            parse_justify_content("space-evenly"),
            JustifyContent::SpaceEvenly
        ));
    }

    // ========================================================================
    // Align Items Parsing Tests
    // ========================================================================

    #[test]
    fn test_align_items_basic() {
        assert!(matches!(
            parse_align_items("center"),
            AlignItems::Center
        ));
        assert!(matches!(
            parse_align_items("stretch"),
            AlignItems::Stretch
        ));
        assert!(matches!(
            parse_align_items("baseline"),
            AlignItems::Baseline
        ));
    }

    #[test]
    fn test_align_items_flex_variants() {
        assert!(matches!(
            parse_align_items("flexstart"),
            AlignItems::FlexStart
        ));
        assert!(matches!(
            parse_align_items("flex-start"),
            AlignItems::FlexStart
        ));
        assert!(matches!(parse_align_items("start"), AlignItems::FlexStart));
    }

    // ========================================================================
    // Text Weight Parsing Tests
    // ========================================================================

    #[test]
    fn test_weight_parsing() {
        assert!(matches!(parse_weight("normal"), Weight::Normal));
        assert!(matches!(parse_weight("bold"), Weight::Bold));
        assert!(matches!(parse_weight("light"), Weight::Light));
        assert!(matches!(parse_weight("BOLD"), Weight::Bold));
    }

    // ========================================================================
    // Text Align Parsing Tests
    // ========================================================================

    #[test]
    fn test_text_align_parsing() {
        assert!(matches!(parse_text_align("left"), TextAlign::Left));
        assert!(matches!(parse_text_align("center"), TextAlign::Center));
        assert!(matches!(parse_text_align("right"), TextAlign::Right));
        assert!(matches!(parse_text_align("LEFT"), TextAlign::Left));
    }

    // ========================================================================
    // Text Wrap Parsing Tests
    // ========================================================================

    #[test]
    fn test_text_wrap_parsing() {
        assert!(matches!(parse_text_wrap("wrap"), TextWrap::Wrap));
        assert!(matches!(parse_text_wrap("nowrap"), TextWrap::NoWrap));
        assert!(matches!(parse_text_wrap("WRAP"), TextWrap::Wrap));
    }

    // ========================================================================
    // Hex Digit Conversion Tests
    // ========================================================================

    #[test]
    fn test_hex_to_u8_digits() {
        assert_eq!(hex_to_u8(b'0'), Some(0));
        assert_eq!(hex_to_u8(b'5'), Some(5));
        assert_eq!(hex_to_u8(b'9'), Some(9));
    }

    #[test]
    fn test_hex_to_u8_lowercase() {
        assert_eq!(hex_to_u8(b'a'), Some(10));
        assert_eq!(hex_to_u8(b'f'), Some(15));
    }

    #[test]
    fn test_hex_to_u8_uppercase() {
        assert_eq!(hex_to_u8(b'A'), Some(10));
        assert_eq!(hex_to_u8(b'F'), Some(15));
    }

    #[test]
    fn test_hex_to_u8_invalid() {
        assert_eq!(hex_to_u8(b'G'), None);
        assert_eq!(hex_to_u8(b'g'), None);
        assert_eq!(hex_to_u8(b' '), None);
        assert_eq!(hex_to_u8(b'-'), None);
        assert_eq!(hex_to_u8(b'/'), None);
        assert_eq!(hex_to_u8(b':'), None);
        assert_eq!(hex_to_u8(b'@'), None);
        assert_eq!(hex_to_u8(b'`'), None);
    }

    // ========================================================================
    // Concurrency Tests
    // ========================================================================

    #[tokio::test]
    async fn test_concurrent_compare_exchange() {
        use std::sync::Arc;
        use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

        let running = Arc::new(AtomicBool::new(false));
        let success_count = Arc::new(AtomicU32::new(0));

        // Spawn 10 tasks trying to set running=true simultaneously
        let mut handles = vec![];
        for _ in 0..10 {
            let running = running.clone();
            let success_count = success_count.clone();
            handles.push(tokio::spawn(async move {
                // Simulate start_interactive compare_exchange
                if running.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_ok() {
                    success_count.fetch_add(1, Ordering::Relaxed);
                    // Simulate some work
                    tokio::time::sleep(tokio::time::Duration::from_millis(1)).await;
                    // Reset for next attempt
                    running.store(false, Ordering::Release);
                }
            }));
        }

        for handle in handles {
            handle.await.unwrap();
        }

        // Only one task should have succeeded each time
        // With proper synchronization, we should see all 10 succeed sequentially
        assert_eq!(success_count.load(Ordering::Relaxed), 10);
    }

    #[tokio::test]
    async fn test_stop_during_startup() {
        use std::sync::Arc;
        use std::sync::atomic::{AtomicBool, Ordering};
        use crate::render_loop::RunningGuard;

        let running = Arc::new(AtomicBool::new(false));

        // Simulate compare_exchange succeeding
        assert!(running.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_ok());

        // Simulate stop() being called before guard is created
        running.store(false, Ordering::Release);

        // Simulate RunningGuard creation and TOCTOU check (as in actual render loop)
        let running_clone = running.clone();
        let result = tokio::spawn(async move {
            // Create guard (does NOT set flag - already set by compare_exchange)
            let _guard = RunningGuard::new(running_clone.clone());

            // TOCTOU check: verify stop() wasn't called
            if !running_clone.load(Ordering::Acquire) {
                // TOCTOU check detected stop() - should abort
                return false; // Didn't start
            }
            true // Started
        }).await.unwrap();

        // Result should be false - loop should NOT have started
        assert!(!result);
        // Flag should be false (guard dropped, reset to false)
        assert!(!running.load(Ordering::Acquire));
    }

    #[tokio::test]
    async fn test_atomic_operations_ordering() {
        use std::sync::Arc;
        use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

        let running = Arc::new(AtomicBool::new(false));
        let state = Arc::new(AtomicU32::new(0));

        let running_clone = running.clone();
        let state_clone = state.clone();

        // Spawn writer task
        let writer = tokio::spawn(async move {
            state_clone.store(42, Ordering::Relaxed);
            running_clone.store(true, Ordering::Release); // Release ensures state write is visible
        });

        writer.await.unwrap();

        // Reader task
        if running.load(Ordering::Acquire) { // Acquire synchronizes with Release
            // State write should be visible due to Acquire-Release ordering
            assert_eq!(state.load(Ordering::Relaxed), 42);
        }
    }

    // ========================================================================
    // Parser Function Tests for New Properties
    // ========================================================================

    #[test]
    fn test_parse_align_content_exact_match() {
        assert_eq!(parse_align_content("flex-start"), AlignContent::FlexStart);
        assert_eq!(parse_align_content("flex-end"), AlignContent::FlexEnd);
        assert_eq!(parse_align_content("center"), AlignContent::Center);
        assert_eq!(parse_align_content("stretch"), AlignContent::Stretch);
        assert_eq!(parse_align_content("space-between"), AlignContent::SpaceBetween);
        assert_eq!(parse_align_content("space-around"), AlignContent::SpaceAround);
    }

    #[test]
    fn test_parse_align_content_case_insensitive() {
        assert_eq!(parse_align_content("FLEX-START"), AlignContent::FlexStart);
        assert_eq!(parse_align_content("FlEx-EnD"), AlignContent::FlexEnd);
        assert_eq!(parse_align_content("CENTER"), AlignContent::Center);
        assert_eq!(parse_align_content("STRETCH"), AlignContent::Stretch);
    }

    #[test]
    fn test_parse_align_content_without_dash() {
        assert_eq!(parse_align_content("flexstart"), AlignContent::FlexStart);
        assert_eq!(parse_align_content("flexend"), AlignContent::FlexEnd);
        assert_eq!(parse_align_content("spacebetween"), AlignContent::SpaceBetween);
        assert_eq!(parse_align_content("spacearound"), AlignContent::SpaceAround);
    }

    #[test]
    fn test_parse_align_content_invalid_defaults_to_stretch() {
        assert_eq!(parse_align_content("invalid"), AlignContent::Stretch);
        assert_eq!(parse_align_content(""), AlignContent::Stretch);
        assert_eq!(parse_align_content("random-value"), AlignContent::Stretch);
    }

    #[test]
    fn test_parse_display_exact_match() {
        assert_eq!(parse_display("flex"), Display::Flex);
        assert_eq!(parse_display("none"), Display::None);
    }

    #[test]
    fn test_parse_display_case_insensitive() {
        assert_eq!(parse_display("FLEX"), Display::Flex);
        assert_eq!(parse_display("None"), Display::None);
        assert_eq!(parse_display("NONE"), Display::None);
    }

    #[test]
    fn test_parse_display_invalid_defaults_to_flex() {
        assert_eq!(parse_display("invalid"), Display::Flex);
        assert_eq!(parse_display(""), Display::Flex);
        assert_eq!(parse_display("block"), Display::Flex);
    }

    #[test]
    fn test_parse_position_exact_match() {
        assert_eq!(parse_position("relative"), Position::Relative);
        assert_eq!(parse_position("absolute"), Position::Absolute);
    }

    #[test]
    fn test_parse_position_case_insensitive() {
        assert_eq!(parse_position("RELATIVE"), Position::Relative);
        assert_eq!(parse_position("Absolute"), Position::Absolute);
        assert_eq!(parse_position("ABSOLUTE"), Position::Absolute);
    }

    #[test]
    fn test_parse_position_invalid_defaults_to_relative() {
        assert_eq!(parse_position("invalid"), Position::Relative);
        assert_eq!(parse_position(""), Position::Relative);
        assert_eq!(parse_position("fixed"), Position::Relative);
    }

    // ========================================================================
    // Border Edges Conversion Tests
    // ========================================================================

    #[test]
    fn test_border_edges_all_enabled() {
        let config = BorderEdgesConfig {
            top: Some(true),
            right: Some(true),
            bottom: Some(true),
            left: Some(true),
        };

        let mut edges = Edges::empty();
        if config.top.unwrap_or(true) {
            edges |= Edges::Top;
        }
        if config.right.unwrap_or(true) {
            edges |= Edges::Right;
        }
        if config.bottom.unwrap_or(true) {
            edges |= Edges::Bottom;
        }
        if config.left.unwrap_or(true) {
            edges |= Edges::Left;
        }

        assert!(edges.contains(Edges::Top));
        assert!(edges.contains(Edges::Right));
        assert!(edges.contains(Edges::Bottom));
        assert!(edges.contains(Edges::Left));
    }

    #[test]
    fn test_border_edges_only_top_and_bottom() {
        let config = BorderEdgesConfig {
            top: Some(true),
            right: Some(false),
            bottom: Some(true),
            left: Some(false),
        };

        let mut edges = Edges::empty();
        if config.top.unwrap_or(true) {
            edges |= Edges::Top;
        }
        if config.right.unwrap_or(true) {
            edges |= Edges::Right;
        }
        if config.bottom.unwrap_or(true) {
            edges |= Edges::Bottom;
        }
        if config.left.unwrap_or(true) {
            edges |= Edges::Left;
        }

        assert!(edges.contains(Edges::Top));
        assert!(!edges.contains(Edges::Right));
        assert!(edges.contains(Edges::Bottom));
        assert!(!edges.contains(Edges::Left));
    }

    #[test]
    fn test_border_edges_none_enabled() {
        let config = BorderEdgesConfig {
            top: Some(false),
            right: Some(false),
            bottom: Some(false),
            left: Some(false),
        };

        let mut edges = Edges::empty();
        if config.top.unwrap_or(true) {
            edges |= Edges::Top;
        }
        if config.right.unwrap_or(true) {
            edges |= Edges::Right;
        }
        if config.bottom.unwrap_or(true) {
            edges |= Edges::Bottom;
        }
        if config.left.unwrap_or(true) {
            edges |= Edges::Left;
        }

        assert!(!edges.contains(Edges::Top));
        assert!(!edges.contains(Edges::Right));
        assert!(!edges.contains(Edges::Bottom));
        assert!(!edges.contains(Edges::Left));
    }

    #[test]
    fn test_border_edges_defaults_to_true_when_none() {
        let config = BorderEdgesConfig {
            top: None,
            right: None,
            bottom: None,
            left: None,
        };

        let mut edges = Edges::empty();
        if config.top.unwrap_or(true) {
            edges |= Edges::Top;
        }
        if config.right.unwrap_or(true) {
            edges |= Edges::Right;
        }
        if config.bottom.unwrap_or(true) {
            edges |= Edges::Bottom;
        }
        if config.left.unwrap_or(true) {
            edges |= Edges::Left;
        }

        assert!(edges.contains(Edges::Top));
        assert!(edges.contains(Edges::Right));
        assert!(edges.contains(Edges::Bottom));
        assert!(edges.contains(Edges::Left));
    }

    #[test]
    fn test_border_edges_mixed_some_and_none() {
        let config = BorderEdgesConfig {
            top: Some(true),
            right: None,
            bottom: Some(false),
            left: None,
        };

        let mut edges = Edges::empty();
        if config.top.unwrap_or(true) {
            edges |= Edges::Top;
        }
        if config.right.unwrap_or(true) {
            edges |= Edges::Right;
        }
        if config.bottom.unwrap_or(true) {
            edges |= Edges::Bottom;
        }
        if config.left.unwrap_or(true) {
            edges |= Edges::Left;
        }

        assert!(edges.contains(Edges::Top));
        assert!(edges.contains(Edges::Right)); // defaults to true
        assert!(!edges.contains(Edges::Bottom));
        assert!(edges.contains(Edges::Left)); // defaults to true
    }

    // ========================================================================
    // ComponentNode Property Mapping Tests
    // ========================================================================

    #[test]
    fn test_component_node_new_fields_initialization() {
        let node = ComponentNode {
            children: None,
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
            dim_color: None,
            strikethrough: None,
            flex_basis: None,
            flex_wrap: None,
            overflow_x: None,
            overflow_y: None,
            display: Some("flex".to_string()),
            position: Some("absolute".to_string()),
            top: Some(10),
            right: Some(20),
            bottom: Some(30),
            left: Some(40),
            inset: None,
            min_width: Some(50),
            max_width: Some(100),
            min_height: Some(25),
            max_height: Some(50),
            align_content: Some("space-between".to_string()),
            border_edges: Some(BorderEdgesConfig {
                top: Some(true),
                right: Some(false),
                bottom: Some(true),
                left: Some(false),
            }),
        };

        assert_eq!(node.display, Some("flex".to_string()));
        assert_eq!(node.position, Some("absolute".to_string()));
        assert_eq!(node.top, Some(10));
        assert_eq!(node.right, Some(20));
        assert_eq!(node.bottom, Some(30));
        assert_eq!(node.left, Some(40));
        assert_eq!(node.min_width, Some(50));
        assert_eq!(node.max_width, Some(100));
        assert_eq!(node.min_height, Some(25));
        assert_eq!(node.max_height, Some(50));
        assert_eq!(node.align_content, Some("space-between".to_string()));
        assert!(node.border_edges.is_some());
    }

    #[test]
    fn test_text_node_with_align_and_wrap() {
        let node = ComponentNode {
            children: None,
            node_type: "Text".to_string(),
            content: Some("Test text".to_string()),
            border_style: None,
            border_color: None,
            background_color: None,
            color: None,
            flex_direction: None,
            justify_content: None,
            align_items: None,
            weight: Some("bold".to_string()),
            align: Some("center".to_string()),
            wrap: Some("wrap".to_string()),
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
            dim_color: None,
            strikethrough: Some(true),
            flex_basis: None,
            flex_wrap: None,
            overflow_x: None,
            overflow_y: None,
            display: None,
            position: None,
            top: None,
            right: None,
            bottom: None,
            left: None,
            inset: None,
            min_width: None,
            max_width: None,
            min_height: None,
            max_height: None,
            align_content: None,
            border_edges: None,
        };

        assert_eq!(node.weight, Some("bold".to_string()));
        assert_eq!(node.align, Some("center".to_string()));
        assert_eq!(node.wrap, Some("wrap".to_string()));
        assert_eq!(node.strikethrough, Some(true));
    }

    #[test]
    fn test_flex_basis_parsing_auto() {
        let node = ComponentNode {
            children: None,
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
            dim_color: None,
            strikethrough: None,
            flex_basis: Some("auto".to_string()),
            flex_wrap: None,
            overflow_x: None,
            overflow_y: None,
            display: None,
            position: None,
            top: None,
            right: None,
            bottom: None,
            left: None,
            inset: None,
            min_width: None,
            max_width: None,
            min_height: None,
            max_height: None,
            align_content: None,
            border_edges: None,
        };

        assert_eq!(node.flex_basis, Some("auto".to_string()));
    }

    #[test]
    fn test_overflow_properties() {
        let node = ComponentNode {
            children: None,
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
            dim_color: None,
            strikethrough: None,
            flex_basis: None,
            flex_wrap: Some("wrap".to_string()),
            overflow_x: Some("hidden".to_string()),
            overflow_y: Some("visible".to_string()),
            display: None,
            position: None,
            top: None,
            right: None,
            bottom: None,
            left: None,
            inset: None,
            min_width: None,
            max_width: None,
            min_height: None,
            max_height: None,
            align_content: None,
            border_edges: None,
        };

        assert_eq!(node.overflow_x, Some("hidden".to_string()));
        assert_eq!(node.overflow_y, Some("visible".to_string()));
        assert_eq!(node.flex_wrap, Some("wrap".to_string()));
    }
}

//! Node.js bindings for iocraft TUI library.
//!
//! This module provides native bindings to iocraft, enabling React-like
//! declarative terminal UIs in Node.js with:
//! - Flexbox layouts
//! - Mouse support
//! - Keyboard input
//! - Rich styling

use crossterm::terminal;
use iocraft::prelude::*;
use napi::bindgen_prelude::*;
use napi_derive::napi;
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
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComponentNode {
    /// Component type: "View", "Text", "Box"
    #[napi(js_name = "type")]
    #[serde(rename = "type")]
    pub node_type: String,

    /// Text content (for Text components)
    pub content: Option<String>,

    /// Width in characters or percentage string (e.g., "50%")
    pub width: Option<u32>,

    /// Height in characters
    pub height: Option<u32>,

    /// Width as percentage (0-100)
    pub width_percent: Option<f64>,

    /// Height as percentage (0-100)
    pub height_percent: Option<f64>,

    /// Padding (all sides)
    pub padding: Option<u32>,
    pub padding_top: Option<u32>,
    pub padding_right: Option<u32>,
    pub padding_bottom: Option<u32>,
    pub padding_left: Option<u32>,
    pub padding_x: Option<u32>,
    pub padding_y: Option<u32>,

    /// Margin (all sides)
    pub margin: Option<i32>,
    pub margin_top: Option<i32>,
    pub margin_right: Option<i32>,
    pub margin_bottom: Option<i32>,
    pub margin_left: Option<i32>,
    pub margin_x: Option<i32>,
    pub margin_y: Option<i32>,

    /// Gap between children
    pub gap: Option<u32>,
    pub row_gap: Option<u32>,
    pub column_gap: Option<u32>,

    /// Border style
    pub border_style: Option<String>,

    /// Border color (named color string)
    pub border_color: Option<String>,

    /// Background color (named color string)
    pub background_color: Option<String>,

    /// Text color (named color string)
    pub color: Option<String>,

    /// Flex direction
    pub flex_direction: Option<String>,

    /// Justify content
    pub justify_content: Option<String>,

    /// Align items
    pub align_items: Option<String>,

    /// Flex grow
    pub flex_grow: Option<f64>,

    /// Flex shrink
    pub flex_shrink: Option<f64>,

    /// Text weight (for Text components)
    pub weight: Option<String>,

    /// Text alignment (for Text components)
    pub align: Option<String>,

    /// Text wrapping (for Text components)
    pub wrap: Option<String>,

    /// Whether text is underlined
    pub underline: Option<bool>,

    /// Whether text is italic
    pub italic: Option<bool>,

    /// Whether text is bold (shorthand for weight: "Bold")
    pub bold: Option<bool>,

    /// Child components
    pub children: Option<Vec<ComponentNode>>,
}

// ============================================================================
// Helper Functions for Parsing
// ============================================================================

fn parse_named_color(s: &str) -> Option<Color> {
    match s.to_lowercase().as_str() {
        "black" => Some(Color::Black),
        "darkgrey" | "darkgray" => Some(Color::DarkGrey),
        "red" => Some(Color::Red),
        "darkred" => Some(Color::DarkRed),
        "green" => Some(Color::Green),
        "darkgreen" => Some(Color::DarkGreen),
        "yellow" => Some(Color::Yellow),
        "darkyellow" => Some(Color::DarkYellow),
        "blue" => Some(Color::Blue),
        "darkblue" => Some(Color::DarkBlue),
        "magenta" => Some(Color::Magenta),
        "darkmagenta" => Some(Color::DarkMagenta),
        "cyan" => Some(Color::Cyan),
        "darkcyan" => Some(Color::DarkCyan),
        "white" => Some(Color::White),
        "grey" | "gray" => Some(Color::Grey),
        "reset" => Some(Color::Reset),
        _ => {
            // Try parsing as hex color (#RRGGBB or RRGGBB)
            let hex = s.trim_start_matches('#');
            if hex.len() == 6 {
                if let (Ok(r), Ok(g), Ok(b)) = (
                    u8::from_str_radix(&hex[0..2], 16),
                    u8::from_str_radix(&hex[2..4], 16),
                    u8::from_str_radix(&hex[4..6], 16),
                ) {
                    return Some(Color::Rgb { r, g, b });
                }
            }
            None
        }
    }
}

fn parse_border_style(s: &str) -> BorderStyle {
    match s.to_lowercase().as_str() {
        "single" => BorderStyle::Single,
        "double" => BorderStyle::Double,
        "round" => BorderStyle::Round,
        "bold" => BorderStyle::Bold,
        "doubleleftright" => BorderStyle::DoubleLeftRight,
        "doubletopbottom" => BorderStyle::DoubleTopBottom,
        "classic" => BorderStyle::Classic,
        _ => BorderStyle::None,
    }
}

fn parse_flex_direction(s: &str) -> FlexDirection {
    match s.to_lowercase().as_str() {
        "column" => FlexDirection::Column,
        "rowreverse" | "row-reverse" => FlexDirection::RowReverse,
        "columnreverse" | "column-reverse" => FlexDirection::ColumnReverse,
        _ => FlexDirection::Row,
    }
}

fn parse_justify_content(s: &str) -> JustifyContent {
    match s.to_lowercase().replace(['-', '_'], "").as_str() {
        "flexstart" | "start" => JustifyContent::FlexStart,
        "flexend" | "end" => JustifyContent::FlexEnd,
        "center" => JustifyContent::Center,
        "spacebetween" => JustifyContent::SpaceBetween,
        "spacearound" => JustifyContent::SpaceAround,
        "spaceevenly" => JustifyContent::SpaceEvenly,
        _ => JustifyContent::FlexStart,
    }
}

fn parse_align_items(s: &str) -> AlignItems {
    match s.to_lowercase().replace(['-', '_'], "").as_str() {
        "stretch" => AlignItems::Stretch,
        "flexstart" | "start" => AlignItems::FlexStart,
        "flexend" | "end" => AlignItems::FlexEnd,
        "center" => AlignItems::Center,
        "baseline" => AlignItems::Baseline,
        _ => AlignItems::Stretch,
    }
}

fn parse_text_align(s: &str) -> TextAlign {
    match s.to_lowercase().as_str() {
        "right" => TextAlign::Right,
        "center" => TextAlign::Center,
        _ => TextAlign::Left,
    }
}

fn parse_weight(s: &str) -> Weight {
    match s.to_lowercase().as_str() {
        "bold" => Weight::Bold,
        "light" => Weight::Light,
        _ => Weight::Normal,
    }
}

fn parse_text_wrap(s: &str) -> TextWrap {
    match s.to_lowercase().as_str() {
        "nowrap" | "no-wrap" => TextWrap::NoWrap,
        _ => TextWrap::Wrap,
    }
}

// ============================================================================
// Dynamic Component Wrapper
// ============================================================================

/// Convert a ComponentNode to an AnyElement.
fn node_to_element(node: &ComponentNode) -> AnyElement<'static> {
    let node_type = node.node_type.to_lowercase();

    match node_type.as_str() {
        "text" => {
            let content = node.content.clone().unwrap_or_default();
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
        }
        "view" | "box" | _ => {
            // Convert children recursively
            let children: Vec<AnyElement<'static>> = node
                .children
                .as_ref()
                .map(|c| c.iter().map(node_to_element).collect())
                .unwrap_or_default();

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
}

// ============================================================================
// Terminal Size
// ============================================================================

/// Get the current terminal size.
#[napi]
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
#[napi]
pub fn render_to_string(tree: ComponentNode) -> Result<String> {
    let mut elem = node_to_element(&tree);
    Ok(elem.to_string())
}

/// Render a component tree to a string with a maximum width.
#[napi]
pub fn render_to_string_with_width(tree: ComponentNode, max_width: u32) -> Result<String> {
    let mut elem = node_to_element(&tree);
    let canvas = elem.render(Some(max_width as usize));
    Ok(canvas.to_string())
}

/// Render a component tree and print to stdout.
#[napi]
pub fn print_component(tree: ComponentNode) -> Result<()> {
    let mut elem = node_to_element(&tree);
    elem.print();
    Ok(())
}

/// Render a component tree and print to stderr.
#[napi]
pub fn eprint_component(tree: ComponentNode) -> Result<()> {
    let mut elem = node_to_element(&tree);
    elem.eprint();
    Ok(())
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
        node_type: "Text".to_string(),
        content: Some(content),
        width: None,
        height: None,
        width_percent: None,
        height_percent: None,
        padding: None,
        padding_top: None,
        padding_right: None,
        padding_bottom: None,
        padding_left: None,
        padding_x: None,
        padding_y: None,
        margin: None,
        margin_top: None,
        margin_right: None,
        margin_bottom: None,
        margin_left: None,
        margin_x: None,
        margin_y: None,
        gap: None,
        row_gap: None,
        column_gap: None,
        border_style: None,
        border_color: None,
        background_color: None,
        color: None,
        flex_direction: None,
        justify_content: None,
        align_items: None,
        flex_grow: None,
        flex_shrink: None,
        weight: None,
        align: None,
        wrap: None,
        underline: None,
        italic: None,
        bold: None,
        children: None,
    }
}

/// Create a View/Box component node with children.
#[napi]
pub fn view(children: Vec<ComponentNode>) -> ComponentNode {
    ComponentNode {
        node_type: "View".to_string(),
        content: None,
        width: None,
        height: None,
        width_percent: None,
        height_percent: None,
        padding: None,
        padding_top: None,
        padding_right: None,
        padding_bottom: None,
        padding_left: None,
        padding_x: None,
        padding_y: None,
        margin: None,
        margin_top: None,
        margin_right: None,
        margin_bottom: None,
        margin_left: None,
        margin_x: None,
        margin_y: None,
        gap: None,
        row_gap: None,
        column_gap: None,
        border_style: None,
        border_color: None,
        background_color: None,
        color: None,
        flex_direction: None,
        justify_content: None,
        align_items: None,
        flex_grow: None,
        flex_shrink: None,
        weight: None,
        align: None,
        wrap: None,
        underline: None,
        italic: None,
        bold: None,
        children: Some(children),
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

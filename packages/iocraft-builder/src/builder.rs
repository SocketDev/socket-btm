//! Builder API for creating iocraft components with fluent interface.
//!
//! This module provides ViewBuilder and TextBuilder for ergonomic component
//! construction with zero-clone rendering via std::mem::replace.

use crate::ComponentNode;

/// Create an empty ComponentNode for use with std::mem::replace.
fn empty_component_node() -> ComponentNode {
    ComponentNode {
        children: None,
        node_type: String::new(),
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

/// Builder for View components with fluent API.
pub struct ViewBuilder {
    config: ComponentNode,
}

impl ViewBuilder {
    /// Create a new ViewBuilder.
    pub fn new() -> Self {
        Self {
            config: ComponentNode {
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
            },
        }
    }

    /// Set width in characters.
    pub fn width(mut self, width: u32) -> Self {
        self.config.width = Some(width);
        self
    }

    /// Set height in characters.
    pub fn height(mut self, height: u32) -> Self {
        self.config.height = Some(height);
        self
    }

    /// Set width as percentage (0-100).
    pub fn width_percent(mut self, width_percent: f64) -> Self {
        self.config.width_percent = Some(width_percent);
        self
    }

    /// Set height as percentage (0-100).
    pub fn height_percent(mut self, height_percent: f64) -> Self {
        self.config.height_percent = Some(height_percent);
        self
    }

    /// Set padding (all sides).
    pub fn padding(mut self, padding: u32) -> Self {
        self.config.padding = Some(padding);
        self
    }

    /// Set padding for left and right sides.
    pub fn padding_x(mut self, padding: u32) -> Self {
        self.config.padding_x = Some(padding);
        self
    }

    /// Set padding for top and bottom sides.
    pub fn padding_y(mut self, padding: u32) -> Self {
        self.config.padding_y = Some(padding);
        self
    }

    /// Set top padding.
    pub fn padding_top(mut self, padding: u32) -> Self {
        self.config.padding_top = Some(padding);
        self
    }

    /// Set right padding.
    pub fn padding_right(mut self, padding: u32) -> Self {
        self.config.padding_right = Some(padding);
        self
    }

    /// Set bottom padding.
    pub fn padding_bottom(mut self, padding: u32) -> Self {
        self.config.padding_bottom = Some(padding);
        self
    }

    /// Set left padding.
    pub fn padding_left(mut self, padding: u32) -> Self {
        self.config.padding_left = Some(padding);
        self
    }

    /// Set margin (all sides).
    pub fn margin(mut self, margin: i32) -> Self {
        self.config.margin = Some(margin);
        self
    }

    /// Set margin for left and right sides.
    pub fn margin_x(mut self, margin: i32) -> Self {
        self.config.margin_x = Some(margin);
        self
    }

    /// Set margin for top and bottom sides.
    pub fn margin_y(mut self, margin: i32) -> Self {
        self.config.margin_y = Some(margin);
        self
    }

    /// Set top margin.
    pub fn margin_top(mut self, margin: i32) -> Self {
        self.config.margin_top = Some(margin);
        self
    }

    /// Set right margin.
    pub fn margin_right(mut self, margin: i32) -> Self {
        self.config.margin_right = Some(margin);
        self
    }

    /// Set bottom margin.
    pub fn margin_bottom(mut self, margin: i32) -> Self {
        self.config.margin_bottom = Some(margin);
        self
    }

    /// Set left margin.
    pub fn margin_left(mut self, margin: i32) -> Self {
        self.config.margin_left = Some(margin);
        self
    }

    /// Set gap between children.
    pub fn gap(mut self, gap: u32) -> Self {
        self.config.gap = Some(gap);
        self
    }

    /// Set row gap.
    pub fn row_gap(mut self, gap: u32) -> Self {
        self.config.row_gap = Some(gap);
        self
    }

    /// Set column gap.
    pub fn column_gap(mut self, gap: u32) -> Self {
        self.config.column_gap = Some(gap);
        self
    }

    /// Set border style.
    pub fn border_style(mut self, style: impl Into<String>) -> Self {
        self.config.border_style = Some(style.into());
        self
    }

    /// Set border color.
    pub fn border_color(mut self, color: impl Into<String>) -> Self {
        self.config.border_color = Some(color.into());
        self
    }

    /// Set background color.
    pub fn background_color(mut self, color: impl Into<String>) -> Self {
        self.config.background_color = Some(color.into());
        self
    }

    /// Set flex direction.
    pub fn flex_direction(mut self, direction: impl Into<String>) -> Self {
        self.config.flex_direction = Some(direction.into());
        self
    }

    /// Set justify content.
    pub fn justify_content(mut self, justify: impl Into<String>) -> Self {
        self.config.justify_content = Some(justify.into());
        self
    }

    /// Set align items.
    pub fn align_items(mut self, align: impl Into<String>) -> Self {
        self.config.align_items = Some(align.into());
        self
    }

    /// Set flex grow.
    pub fn flex_grow(mut self, grow: f64) -> Self {
        self.config.flex_grow = Some(grow);
        self
    }

    /// Set flex shrink.
    pub fn flex_shrink(mut self, shrink: f64) -> Self {
        self.config.flex_shrink = Some(shrink);
        self
    }

    /// Set children.
    pub fn children(mut self, children: Vec<ComponentNode>) -> Self {
        self.config.children = Some(children);
        self
    }

    /// Add a single child.
    pub fn child(mut self, child: ComponentNode) -> Self {
        if let Some(ref mut children) = self.config.children {
            children.push(child);
        } else {
            self.config.children = Some(vec![child]);
        }
        self
    }

    /// Build the ComponentNode with zero-clone using std::mem::replace.
    pub fn build(mut self) -> ComponentNode {
        std::mem::replace(&mut self.config, empty_component_node())
    }
}

impl Default for ViewBuilder {
    fn default() -> Self {
        Self::new()
    }
}

/// Builder for Text components with fluent API.
pub struct TextBuilder {
    config: ComponentNode,
}

impl TextBuilder {
    /// Create a new TextBuilder with content.
    pub fn new(content: impl Into<String>) -> Self {
        Self {
            config: ComponentNode {
                children: None,
                node_type: "Text".to_string(),
                content: Some(content.into()),
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
            },
        }
    }

    /// Set text color.
    pub fn color(mut self, color: impl Into<String>) -> Self {
        self.config.color = Some(color.into());
        self
    }

    /// Set text weight.
    pub fn weight(mut self, weight: impl Into<String>) -> Self {
        self.config.weight = Some(weight.into());
        self
    }

    /// Set bold text (shorthand for weight: "Bold").
    pub fn bold(mut self) -> Self {
        self.config.bold = Some(true);
        self
    }

    /// Set text alignment.
    pub fn align(mut self, align: impl Into<String>) -> Self {
        self.config.align = Some(align.into());
        self
    }

    /// Set text wrapping.
    pub fn wrap(mut self, wrap: impl Into<String>) -> Self {
        self.config.wrap = Some(wrap.into());
        self
    }

    /// Set text underline.
    pub fn underline(mut self) -> Self {
        self.config.underline = Some(true);
        self
    }

    /// Set text italic.
    pub fn italic(mut self) -> Self {
        self.config.italic = Some(true);
        self
    }

    /// Build the ComponentNode with zero-clone using std::mem::replace.
    pub fn build(mut self) -> ComponentNode {
        std::mem::replace(&mut self.config, empty_component_node())
    }
}

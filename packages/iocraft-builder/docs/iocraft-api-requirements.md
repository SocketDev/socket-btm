# iocraft Node.js Bindings API Requirements

This document specifies the API requirements for the iocraft Node.js native bindings built in socket-btm.

## Dual Naming Convention Support

The Node.js bindings **MUST** support both camelCase and snake_case for maximum flexibility:

### Functions

Both naming conventions should work as aliases:

| camelCase (JavaScript convention)         | snake_case (Rust convention)                  |
| ----------------------------------------- | --------------------------------------------- |
| `eprintComponent(element)`                | `eprint_component(element)`                   |
| `getTerminalSize()`                       | `get_terminal_size()`                         |
| `printComponent(element)`                 | `print_component(element)`                    |
| `renderToString(element)`                 | `render_to_string(element)`                   |
| `renderToStringWithWidth(element, width)` | `render_to_string_with_width(element, width)` |

### Properties

Both naming conventions should work as aliases on node objects:

| camelCase         | snake_case         |
| ----------------- | ------------------ |
| `alignItems`      | `align_items`      |
| `backgroundColor` | `background_color` |
| `borderColor`     | `border_color`     |
| `borderStyle`     | `border_style`     |
| `columnGap`       | `column_gap`       |
| `flexBasis`       | `flex_basis`       |
| `flexDirection`   | `flex_direction`   |
| `flexGrow`        | `flex_grow`        |
| `flexShrink`      | `flex_shrink`      |
| `flexWrap`        | `flex_wrap`        |
| `heightPercent`   | `height_percent`   |
| `justifyContent`  | `justify_content`  |
| `marginBottom`    | `margin_bottom`    |
| `marginLeft`      | `margin_left`      |
| `marginRight`     | `margin_right`     |
| `marginTop`       | `margin_top`       |
| `marginX`         | `margin_x`         |
| `marginY`         | `margin_y`         |
| `overflowX`       | `overflow_x`       |
| `overflowY`       | `overflow_y`       |
| `paddingBottom`   | `padding_bottom`   |
| `paddingLeft`     | `padding_left`     |
| `paddingRight`    | `padding_right`    |
| `paddingTop`      | `padding_top`      |
| `paddingX`        | `padding_x`        |
| `paddingY`        | `padding_y`        |
| `rowGap`          | `row_gap`          |
| `widthPercent`    | `width_percent`    |

## Implementation Approach

In the Rust NAPI bindings, create property getters/setters and function exports that support both naming conventions:

```rust
// Example for functions (snake_case method with camelCase alias):
#[napi]
impl Iocraft {
  #[napi(js_name = "printComponent")]
  pub fn print_component(&self, element: Element) {
    // Implementation.
  }

  #[napi(js_name = "eprintComponent")]
  pub fn eprint_component(&self, element: Element) {
    // Implementation.
  }

  #[napi(js_name = "renderToString")]
  pub fn render_to_string(&self, element: Element) -> String {
    // Implementation.
  }

  #[napi(js_name = "renderToStringWithWidth")]
  pub fn render_to_string_with_width(&self, element: Element, width: u32) -> String {
    // Implementation.
  }

  #[napi(js_name = "getTerminalSize")]
  pub fn get_terminal_size(&self) -> (u32, u32) {
    // Implementation.
  }
}

// Example for properties (both getters/setters point to same underlying value):
#[napi]
impl ComponentNode {
  // flexDirection / flex_direction
  #[napi(getter, js_name = "flexDirection")]
  pub fn get_flex_direction_camel(&self) -> Option<String> {
    self.flex_direction.clone()
  }

  #[napi(setter, js_name = "flexDirection")]
  pub fn set_flex_direction_camel(&mut self, value: Option<String>) {
    self.flex_direction = value;
  }

  #[napi(getter, js_name = "flex_direction")]
  pub fn get_flex_direction_snake(&self) -> Option<String> {
    self.flex_direction.clone()
  }

  #[napi(setter, js_name = "flex_direction")]
  pub fn set_flex_direction_snake(&mut self, value: Option<String>) {
    self.flex_direction = value;
  }

  // paddingLeft / padding_left
  #[napi(getter, js_name = "paddingLeft")]
  pub fn get_padding_left_camel(&self) -> Option<f64> {
    self.padding_left
  }

  #[napi(setter, js_name = "paddingLeft")]
  pub fn set_padding_left_camel(&mut self, value: Option<f64>) {
    self.padding_left = value;
  }

  #[napi(getter, js_name = "padding_left")]
  pub fn get_padding_left_snake(&self) -> Option<f64> {
    self.padding_left
  }

  #[napi(setter, js_name = "padding_left")]
  pub fn set_padding_left_snake(&mut self, value: Option<f64>) {
    self.padding_left = value;
  }

  // Repeat for all other properties...
}
```

**Key points:**

- Keep Rust method names in snake_case (Rust convention)
- Use `#[napi(js_name = "camelCase")]` to create camelCase JavaScript aliases
- Both naming conventions access the same underlying Rust fields
- Apply to ALL properties listed in the Properties table above

## Testing

Both naming conventions MUST be tested to ensure they work correctly:

```javascript
import iocraft from '@socketaddon/iocraft'

// Test functions work with both conventions.
const element = iocraft.view([iocraft.text('test')])

// Both should work:
iocraft.printComponent(element) // camelCase
iocraft.print_component(element) // snake_case

// Both should work:
const output1 = iocraft.renderToString(element) // camelCase
const output2 = iocraft.render_to_string(element) // snake_case

// Both should work:
const output3 = iocraft.renderToStringWithWidth(element, 80) // camelCase
const output4 = iocraft.render_to_string_with_width(element, 80) // snake_case

// Test terminal size getter.
const [width1, height1] = iocraft.getTerminalSize() // camelCase
const [width2, height2] = iocraft.get_terminal_size() // snake_case

// Test properties work with both conventions.
const node = iocraft.view([])

// Layout properties:
node.flexDirection = 'row'
node.flex_direction = 'column'
console.assert(node.flexDirection === 'column')
console.assert(node.flex_direction === 'column')

// Spacing properties:
node.paddingLeft = 10
node.padding_top = 5
console.assert(node.paddingLeft === 10)
console.assert(node.padding_left === 10)
console.assert(node.paddingTop === 5)
console.assert(node.padding_top === 5)

// Size properties:
node.widthPercent = 50
console.assert(node.widthPercent === 50)
console.assert(node.width_percent === 50)

// Color properties:
node.backgroundColor = 'blue'
console.assert(node.backgroundColor === 'blue')
console.assert(node.background_color === 'blue')
```

## Benefits

1. **JavaScript developers** can use familiar camelCase conventions
2. **Rust developers** or those referencing Rust docs can use snake_case
3. **Migration friendly** - code using either convention will continue to work
4. **No breaking changes** - adding camelCase aliases is backward compatible

## Package Publishing

The @socketaddon/iocraft packages will be published from socket-cli repository after binaries are built in socket-btm.

Binary naming convention: `iocraft-{release-tag}-{platform}-{arch}[-musl].node`

Example: `iocraft-20260316-d449dc0-darwin-arm64.node`

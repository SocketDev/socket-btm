#!/usr/bin/env node
/**
 * Comprehensive showcase of iocraft-builder Builder API.
 *
 * This example demonstrates all builder features and best practices.
 */

import { ViewBuilder, TextBuilder, render_to_string } from '../index.mts'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

logger.info('🎨 iocraft-builder Builder API Showcase\n')

// ============================================================================
// Example 1: Simple Text with Styling
// ============================================================================

logger.info('📝 Example 1: Styled Text')
const styledText = TextBuilder.new('Hello, World!')
  .color('Blue')
  .bold()
  .underline()
  .build()

logger.info(render_to_string(styledText))
logger.log()

// ============================================================================
// Example 2: View with Border and Padding
// ============================================================================

logger.info('📦 Example 2: Bordered View')
const borderedView = ViewBuilder.new()
  .border_style('single')
  .border_color('Cyan')
  .padding(2)
  .child(TextBuilder.new('Bordered Content').color('Green').build())
  .build()

logger.info(render_to_string(borderedView))
logger.log()

// ============================================================================
// Example 3: Flexbox Layout
// ============================================================================

logger.info('📐 Example 3: Flexbox Row Layout')
const flexRow = ViewBuilder.new()
  .flex_direction('row')
  .justify_content('space-between')
  .gap(2)
  .padding(1)
  .border_style('double')
  .child(TextBuilder.new('Left').color('Red').build())
  .child(TextBuilder.new('Center').color('Yellow').build())
  .child(TextBuilder.new('Right').color('Green').build())
  .build()

logger.info(render_to_string(flexRow))
logger.log()

// ============================================================================
// Example 4: Nested Components (Dashboard)
// ============================================================================

logger.info('📊 Example 4: Dashboard Layout')
const dashboard = ViewBuilder.new()
  .flex_direction('column')
  .gap(1)
  .padding(1)
  .border_style('double')
  .border_color('Magenta')
  // Title
  .child(
    ViewBuilder.new()
      .padding(1)
      .background_color('Blue')
      .child(TextBuilder.new('Dashboard').color('White').bold().build())
      .build(),
  )
  // Stats Row
  .child(
    ViewBuilder.new()
      .flex_direction('row')
      .gap(2)
      .child(
        ViewBuilder.new()
          .border_style('single')
          .padding(1)
          .child(TextBuilder.new('Users: 1,234').color('Cyan').build())
          .build(),
      )
      .child(
        ViewBuilder.new()
          .border_style('single')
          .padding(1)
          .child(TextBuilder.new('Revenue: $5,678').color('Green').build())
          .build(),
      )
      .child(
        ViewBuilder.new()
          .border_style('single')
          .padding(1)
          .child(TextBuilder.new('Errors: 0').color('Red').build())
          .build(),
      )
      .build(),
  )
  // Logs Section
  .child(
    ViewBuilder.new()
      .border_style('single')
      .padding(1)
      .flex_direction('column')
      .child(TextBuilder.new('[INFO] System started').color('Green').build())
      .child(
        TextBuilder.new('[INFO] Database connected').color('Green').build(),
      )
      .child(TextBuilder.new('[WARN] Cache miss').color('Yellow').build())
      .build(),
  )
  .build()

logger.info(render_to_string(dashboard))
logger.log()

// ============================================================================
// Example 5: Complex Grid Layout
// ============================================================================

logger.info('🎯 Example 5: Complex Grid')
const grid = ViewBuilder.new()
  .flex_direction('column')
  .gap(1)
  .padding(2)
  .border_style('rounded')
  .child(
    ViewBuilder.new()
      .flex_direction('row')
      .gap(1)
      .child(
        ViewBuilder.new()
          .width(20)
          .height(3)
          .border_style('single')
          .padding(1)
          .child(TextBuilder.new('Cell 1').align('Center').build())
          .build(),
      )
      .child(
        ViewBuilder.new()
          .width(20)
          .height(3)
          .border_style('single')
          .padding(1)
          .child(TextBuilder.new('Cell 2').align('Center').build())
          .build(),
      )
      .child(
        ViewBuilder.new()
          .width(20)
          .height(3)
          .border_style('single')
          .padding(1)
          .child(TextBuilder.new('Cell 3').align('Center').build())
          .build(),
      )
      .build(),
  )
  .child(
    ViewBuilder.new()
      .flex_direction('row')
      .gap(1)
      .child(
        ViewBuilder.new()
          .width(20)
          .height(3)
          .border_style('single')
          .padding(1)
          .child(TextBuilder.new('Cell 4').align('Center').build())
          .build(),
      )
      .child(
        ViewBuilder.new()
          .width(20)
          .height(3)
          .border_style('single')
          .padding(1)
          .child(TextBuilder.new('Cell 5').align('Center').build())
          .build(),
      )
      .child(
        ViewBuilder.new()
          .width(20)
          .height(3)
          .border_style('single')
          .padding(1)
          .child(TextBuilder.new('Cell 6').align('Center').build())
          .build(),
      )
      .build(),
  )
  .build()

logger.info(render_to_string(grid))
logger.log()

// ============================================================================
// Example 6: All Text Styles
// ============================================================================

logger.info('✨ Example 6: All Text Styles')
const textStyles = ViewBuilder.new()
  .flex_direction('column')
  .gap(1)
  .padding(1)
  .border_style('double')
  .child(TextBuilder.new('Normal Text').build())
  .child(TextBuilder.new('Bold Text').bold().build())
  .child(TextBuilder.new('Italic Text').italic().build())
  .child(TextBuilder.new('Underline Text').underline().build())
  .child(TextBuilder.new('Red Text').color('Red').build())
  .child(TextBuilder.new('Bold + Underline').bold().underline().build())
  .child(
    TextBuilder.new('All Styles')
      .bold()
      .italic()
      .underline()
      .color('Magenta')
      .build(),
  )
  .build()

logger.info(render_to_string(textStyles))
logger.log()

// ============================================================================
// Example 7: All Border Styles
// ============================================================================

logger.info('🎨 Example 7: All Border Styles')
const borderStyles = ViewBuilder.new()
  .flex_direction('row')
  .gap(2)
  .padding(1)
  .child(
    ViewBuilder.new()
      .border_style('single')
      .padding(1)
      .child(TextBuilder.new('Single').build())
      .build(),
  )
  .child(
    ViewBuilder.new()
      .border_style('double')
      .padding(1)
      .child(TextBuilder.new('Double').build())
      .build(),
  )
  .child(
    ViewBuilder.new()
      .border_style('rounded')
      .padding(1)
      .child(TextBuilder.new('Rounded').build())
      .build(),
  )
  .child(
    ViewBuilder.new()
      .border_style('bold')
      .padding(1)
      .child(TextBuilder.new('Bold').build())
      .build(),
  )
  .build()

logger.info(render_to_string(borderStyles))
logger.log()

// ============================================================================
// Example 8: Spacing Showcase
// ============================================================================

logger.info('📏 Example 8: Padding & Margin')
const spacing = ViewBuilder.new()
  .flex_direction('column')
  .gap(1)
  .border_style('double')
  .padding(2)
  .child(
    ViewBuilder.new()
      .border_style('single')
      .padding_top(1)
      .padding_bottom(1)
      .padding_left(3)
      .padding_right(3)
      .child(TextBuilder.new('Custom Padding').build())
      .build(),
  )
  .child(
    ViewBuilder.new()
      .border_style('single')
      .padding_x(5)
      .padding_y(0)
      .child(TextBuilder.new('Horizontal Padding Only').build())
      .build(),
  )
  .build()

logger.info(render_to_string(spacing))
logger.log()

logger.success('All examples rendered successfully!')
logger.log()
logger.info('💡 Key Takeaways:')
logger.info('   • Builder API provides fluent, chainable methods')
logger.info('   • Zero-clone performance via std::mem::replace')
logger.info('   • Supports all iocraft features (flex, borders, colors, etc.)')
logger.info('   • Clean, readable code with method chaining')
logger.log()

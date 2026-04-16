#!/usr/bin/env node
/**
 * Interactive Counter Example
 *
 * Demonstrates all interactive TUI features:
 * - Event handling (keyboard, mouse, resize)
 * - State management with automatic re-renders
 * - Differential rendering
 * - Flexbox layouts
 *
 * Controls:
 * - Arrow Up: Increment counter
 * - Arrow Down: Decrement counter
 * - Space: Reset to zero
 * - q/Esc: Quit
 */
import process from 'node:process'

import {
  TuiRenderer,
  JsStateHandle,
} from '../build/dev/out/darwin-arm64/iocraft.node'

// ============================================================================
// State Management
// ============================================================================

const state = {
  counter: new JsStateHandle(0),
  lastEvent: new JsStateHandle('None'),
  renderCount: new JsStateHandle(0),
}

// ============================================================================
// UI Component Tree Builder
// ============================================================================

function buildUI() {
  const counter = state.counter.get()
  const lastEvent = state.lastEvent.get()
  const renderCount = state.renderCount.get()

  return {
    __proto__: null,
    type: 'Box',
    props: {
      __proto__: null,
      flex_direction: 'column',
      gap: 1,
      border_style: 'rounded',
      border_color: 'cyan',
      padding: 2,
    },
    children: [
      // Title
      {
        __proto__: null,
        type: 'Box',
        props: {
          __proto__: null,
          justify_content: 'center',
        },
        children: [
          {
            __proto__: null,
            type: 'Text',
            props: {
              __proto__: null,
              color: 'magenta',
              weight: 'bold',
            },
            children: ['🚀 Interactive Counter Demo'],
          },
        ],
      },

      // Counter display
      {
        __proto__: null,
        type: 'Box',
        props: {
          __proto__: null,
          justify_content: 'center',
          padding: 1,
        },
        children: [
          {
            __proto__: null,
            type: 'Text',
            props: {
              __proto__: null,
              color: counter >= 0 ? 'green' : 'red',
              weight: 'bold',
            },
            children: [`Count: ${counter}`],
          },
        ],
      },

      // Instructions
      {
        __proto__: null,
        type: 'Box',
        props: {
          __proto__: null,
          flex_direction: 'column',
          gap: 0,
        },
        children: [
          {
            __proto__: null,
            type: 'Text',
            props: { __proto__: null, color: 'yellow' },
            children: ['Controls:'],
          },
          {
            __proto__: null,
            type: 'Text',
            props: { __proto__: null },
            children: ['  ↑ : Increment  |  ↓ : Decrement  |  Space: Reset'],
          },
          {
            __proto__: null,
            type: 'Text',
            props: { __proto__: null },
            children: ['  q/Esc: Quit'],
          },
        ],
      },

      // Stats
      {
        __proto__: null,
        type: 'Box',
        props: {
          __proto__: null,
          flex_direction: 'column',
          gap: 0,
          border_style: 'single',
          padding: 1,
        },
        children: [
          {
            __proto__: null,
            type: 'Text',
            props: { __proto__: null, color: 'cyan' },
            children: [`Renders: ${renderCount}`],
          },
          {
            __proto__: null,
            type: 'Text',
            props: { __proto__: null, color: 'dim' },
            children: [`Last event: ${lastEvent}`],
          },
        ],
      },
    ],
  }
}

// ============================================================================
// Event Handler
// ============================================================================

function handleEvent(event, renderer) {
  // Update last event for display
  let eventDesc = 'Unknown'

  if (event.eventType === 'key' && event.key) {
    const { code, char, modifiers } = event.key
    const mods = []
    if (modifiers.ctrl) {
      mods.push('Ctrl')
    }
    if (modifiers.alt) {
      mods.push('Alt')
    }
    if (modifiers.shift) {
      mods.push('Shift')
    }

    const modStr = mods.length > 0 ? mods.join('+') + '+' : ''
    eventDesc = `Key: ${modStr}${char || code}`

    // Handle key actions
    if (code === 'Up') {
      state.counter.set(state.counter.get() + 1)
    } else if (code === 'Down') {
      state.counter.set(state.counter.get() - 1)
    } else if (code === 'Char' && char === ' ') {
      state.counter.set(0)
    } else if ((code === 'Char' && char === 'q') || code === 'Esc') {
      renderer.stop()
      process.exit(0)
    }
  } else if (event.eventType === 'mouse' && event.mouse) {
    const { kind, column, row, button } = event.mouse
    eventDesc = `Mouse: ${kind} at (${column}, ${row})${button ? ` [${button}]` : ''}`
  } else if (event.eventType === 'resize' && event.resize) {
    const [width, height] = event.resize
    eventDesc = `Resize: ${width}x${height}`
  }

  state.lastEvent.set(eventDesc)

  // Increment render count
  state.renderCount.set(state.renderCount.get() + 1)

  // Update UI and request re-render
  const tree = buildUI()
  renderer.updateTree(tree)
  renderer.requestRender()
}

// ============================================================================
// Main Application
// ============================================================================

async function main() {
  console.clear()
  console.log('Starting interactive counter demo...\n')

  // Create renderer
  const renderer = new TuiRenderer()

  // Set initial tree
  const initialTree = buildUI()
  renderer.updateTree(initialTree)

  // Start interactive mode with event handling
  // fullscreen=true, mouse_capture=true
  renderer.startInteractive(
    event => handleEvent(event, renderer),
    true, // fullscreen
    true, // mouse_capture
  )

  console.log('Interactive mode started! Use arrow keys to change the counter.')
}

// Error handling
process.on('uncaughtException', err => {
  console.error('\nFatal error:', err)
  process.exit(1)
})

process.on('unhandledRejection', err => {
  console.error('\nUnhandled rejection:', err)
  process.exit(1)
})

main().catch(err => {
  console.error('Failed to start:', err)
  process.exit(1)
})

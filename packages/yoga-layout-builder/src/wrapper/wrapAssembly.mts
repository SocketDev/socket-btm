/**
 * Yoga Layout Assembly Wrapper
 *
 * Converted from upstream yoga/javascript/src/wrapAssembly.ts
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * MIT License
 *
 * This wrapper provides a nicer JavaScript API on top of the raw
 * Emscripten bindings, adding conveniences like:
 * - Node.create() factory method
 * - node.free() for cleanup
 * - Patched setters that accept strings like "100%" or "auto"
 * - calculateLayout with default parameters
 */

import {
  Align,
  BoxSizing,
  Dimension,
  Direction,
  Display,
  Edge,
  Errata,
  ExperimentalFeature,
  FlexDirection,
  Gutter,
  Justify,
  LogLevel,
  MeasureMode,
  NodeType,
  Overflow,
  PositionType,
  Unit,
  Wrap,
} from './YGEnums.mts'
import YGEnums from './YGEnums.mts'

/**
 * Wrap raw Emscripten yoga module with convenience API.
 *
 * @param {object} lib - Raw Emscripten module
 * @returns {object} Wrapped Yoga API
 */
export default function wrapAssembly(lib) {
  function patch(prototype, name, fn) {
    const original = prototype[name]

    prototype[name] = function (...args) {
      return fn.call(this, original, ...args)
    }
  }

  for (const fnName of [
    'setPosition',
    'setMargin',
    'setFlexBasis',
    'setWidth',
    'setHeight',
    'setMinWidth',
    'setMinHeight',
    'setMaxWidth',
    'setMaxHeight',
    'setPadding',
    'setGap',
  ]) {
    const methods = {
      [Unit.Point]: lib.Node.prototype[fnName],
      [Unit.Percent]: lib.Node.prototype[`${fnName}Percent`],
      [Unit.Auto]: lib.Node.prototype[`${fnName}Auto`],
    }

    patch(lib.Node.prototype, fnName, function (original, ...args) {
      // We patch all these functions to add support for the following calls:
      // .setWidth(100) / .setWidth("100%") / .setWidth(.getWidth()) / .setWidth("auto")

      const value = args.pop()
      let unit, asNumber

      if (value === 'auto') {
        unit = Unit.Auto
        asNumber = undefined
      } else if (typeof value === 'object') {
        unit = value.unit
        asNumber = value.valueOf()
      } else {
        unit =
          typeof value === 'string' && value.endsWith('%')
            ? Unit.Percent
            : Unit.Point
        asNumber = parseFloat(value)
        if (
          value !== undefined &&
          !Number.isNaN(value) &&
          Number.isNaN(asNumber)
        ) {
          throw new Error(`Invalid value ${value} for ${fnName}`)
        }
      }

      if (!methods[unit]) {
        throw new Error(
          `Failed to execute "${fnName}": Unsupported unit '${value}'`,
        )
      }

      if (asNumber !== undefined) {
        return methods[unit].call(this, ...args, asNumber)
      } else {
        return methods[unit].call(this, ...args)
      }
    })
  }

  function wrapMeasureFunction(measureFunction) {
    return lib.MeasureCallback.implement({
      measure: (...args) => {
        const { width, height } = measureFunction(...args)
        return {
          width: width ?? NaN,
          height: height ?? NaN,
        }
      },
    })
  }

  patch(lib.Node.prototype, 'setMeasureFunc', function (original, measureFunc) {
    // This patch is just a convenience patch, since it helps write more
    // idiomatic source code (such as .setMeasureFunc(null))
    if (measureFunc) {
      return original.call(this, wrapMeasureFunction(measureFunc))
    } else {
      return this.unsetMeasureFunc()
    }
  })

  function wrapDirtiedFunc(dirtiedFunction) {
    return lib.DirtiedCallback.implement({ dirtied: dirtiedFunction })
  }

  patch(lib.Node.prototype, 'setDirtiedFunc', function (original, dirtiedFunc) {
    original.call(this, wrapDirtiedFunc(dirtiedFunc))
  })

  patch(lib.Config.prototype, 'free', function () {
    // Since we handle the memory allocation ourselves (via lib.Config.create),
    // we also need to handle the deallocation
    lib.Config.destroy(this)
  })

  patch(lib.Node, 'create', (_, config) => {
    // We decide the constructor we want to call depending on the parameters
    return config ? lib.Node.createWithConfig(config) : lib.Node.createDefault()
  })

  patch(lib.Node.prototype, 'free', function () {
    // Since we handle the memory allocation ourselves (via lib.Node.create),
    // we also need to handle the deallocation
    lib.Node.destroy(this)
  })

  patch(lib.Node.prototype, 'freeRecursive', function () {
    for (let t = 0, T = this.getChildCount(); t < T; ++t) {
      this.getChild(0).freeRecursive()
    }
    this.free()
  })

  patch(
    lib.Node.prototype,
    'calculateLayout',
    function (original, width = NaN, height = NaN, direction = Direction.LTR) {
      // Just a small patch to add support for the function default parameters
      return original.call(this, width, height, direction)
    },
  )

  return {
    // Core classes.
    Config: lib.Config,
    Node: lib.Node,
    // Flat constants (POSITION_TYPE_ABSOLUTE, DIRECTION_LTR, etc.).
    ...YGEnums,
    // Enum objects (PositionType, Direction, etc.) for upstream API compatibility.
    Align,
    BoxSizing,
    Dimension,
    Direction,
    Display,
    Edge,
    Errata,
    ExperimentalFeature,
    FlexDirection,
    Gutter,
    Justify,
    LogLevel,
    MeasureMode,
    NodeType,
    Overflow,
    PositionType,
    Unit,
    Wrap,
  }
}

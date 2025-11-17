# yoga-layout-builder

Yoga Layout WASM build for flexbox calculations.

## Building

```bash
pnpm build
```

## Requirements

- Emscripten SDK (emsdk)
- CMake 3.13+

## Output

- `dist/yoga.wasm` (~65KB)
- `dist/yoga.js` (~46KB)

## Usage

```javascript
import Yoga from './yoga.js'

const root = Yoga.Node.create()
root.setWidth(500)
root.setFlexDirection(Yoga.FLEX_DIRECTION_ROW)
root.calculateLayout()
```

Based on Yoga Layout v3.1.0.

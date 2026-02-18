# yoga-layout-builder

Yoga Layout WASM build for flexbox calculations.

## Building

```bash
# Standard production build
pnpm build

# Force clean rebuild
pnpm build:force

# Development build (faster, less optimized)
pnpm build --dev

# Production build (slower, optimized)
pnpm build --prod
```

## Testing

```bash
# Run all tests
pnpm test

# Run specific test suite
pnpm test:suite
```

## Requirements

- Emscripten SDK (emsdk)
- CMake 3.13+

## Output

Production builds output to `build/prod/out/Final/`:
- `yoga.wasm` (~115KB)
- `yoga.mjs` (~133KB)
- `yoga-sync.cjs` (~287KB)
- `yoga-sync.mjs` (~287KB)

Development builds output to `build/dev/out/Final/`:
- `yoga.wasm` (~252KB)
- `yoga.mjs` (~133KB)
- `yoga-sync.cjs` (~423KB)
- `yoga-sync.mjs` (~423KB)

## Usage

```javascript
import Yoga from './build/prod/out/Final/yoga.mjs'

const root = Yoga.Node.create()
root.setWidth(500)
root.setFlexDirection(Yoga.FLEX_DIRECTION_ROW)
root.calculateLayout()
```

Based on Yoga Layout v3.1.0.

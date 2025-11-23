# Tests

Test suite for node-smol-builder.

## Running Tests

```bash
pnpm test              # Run all tests
pnpm test:watch        # Watch mode
pnpm test package.test # Run specific test
```

## Test Files

- `package.test.mjs` - Package structure validation
- `sea.test.mjs` - SEA (Single Executable Application) tests
- `cache.test.mjs` - Cache system tests

## Prerequisites

SEA tests require a built binary:

```bash
pnpm build  # Build binary first
pnpm test   # Then run tests
```

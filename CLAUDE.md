# Claude Code Guidelines for Socket BTM

## Critical Rules

### spawn() Usage
**NEVER change `shell: WIN32` to `shell: true`**

- `shell: WIN32` is the correct pattern for cross-platform compatibility
- It enables shell on Windows (where it's needed) and disables on Unix (where it's not)
- If spawn fails with ENOENT, the issue is NOT the shell parameter
- Instead, fix by properly separating command and arguments:
  ```javascript
  // WRONG - passing full command as string
  spawn('python3 -m module arg1 arg2', [], { shell: WIN32 })

  // CORRECT - separate command and args
  spawn('python3', ['-m', 'module', 'arg1', 'arg2'], { shell: WIN32 })
  ```

This pattern is canonical across Socket Security codebases.

### ESLint Disable Comments
**ALWAYS use `eslint-disable-next-line` above the line, NEVER use trailing `eslint-disable-line`**

- Place ESLint disable directives on the line above the code, not as trailing comments
- This is a manual style convention across all Socket Security repositories
- Note: Not enforced by tooling, relies on code review
  ```javascript
  // WRONG - trailing comment
  process.exit(1) // eslint-disable-line n/no-process-exit

  // CORRECT - line above
  // eslint-disable-next-line n/no-process-exit
  process.exit(1)
  ```

This pattern is consistent across Socket Security codebases.

### Integration and E2E Test Binary Selection
**ALWAYS use Final binary for integration and E2E tests, NEVER use intermediate build stages**

- Integration tests must use `getLatestFinalBinary()` from `test/paths.mjs`
- NEVER change tests to use `getLatestCompressedBinary()`, `getLatestStrippedBinary()`, or other intermediate stages
- The Final binary is the production-ready binary that may be compressed or uncompressed depending on build flags
- This ensures tests validate the actual binary that will be shipped to users
- Example:
  ```javascript
  // CORRECT - use Final binary
  import { getLatestFinalBinary } from '../paths.mjs'
  const binaryPath = getLatestFinalBinary()

  // WRONG - don't use intermediate stages
  import { getLatestCompressedBinary } from '../paths.mjs'
  const binaryPath = getLatestCompressedBinary()
  ```

This ensures integration tests validate the production binary users will receive.

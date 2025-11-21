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

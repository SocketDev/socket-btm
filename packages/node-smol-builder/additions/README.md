# Build Additions

Additional files added to the Node.js source tree during the build process.

## Organization

- `release/` - Files added during initial Node.js compilation phase
  - `localeCompare.polyfill.js` - ICU localeCompare polyfill for reduced binary size

These files are copied into the Node.js source tree automatically during `pnpm build`.

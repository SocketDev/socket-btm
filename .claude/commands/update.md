# update - Update a specific dependency

Invoke the `updating-$ARGUMENTS` skill to update a dependency.

## Usage

```
/update <name>
```

For example, `/update node` invokes the `updating-node` skill.

## Available Names

- `node` - Update Node.js submodule, regenerate patches
- `curl` - Update curl and mbedtls submodules
- `lief` - Update LIEF binary manipulation library
- `stubs` - Rebuild self-extracting stub binaries
- `binsuite` - Orchestrate LIEF and stubs updates
- `cjson` - Update cJSON library
- `libdeflate` - Update libdeflate compression library
- `lzfse` - Update LZFSE Apple compression library
- `onnxruntime` - Update ONNX Runtime ML engine
- `ink` - Update ink TUI framework
- `iocraft` - Update iocraft TUI library
- `yoga` - Update Yoga layout library
- `fast-webstreams` - Vendor fast-webstreams from npm
- `checksums` - Sync SHA-256 checksums from releases

## Instructions

Use the Skill tool to invoke the skill named `updating-$ARGUMENTS`.

If `$ARGUMENTS` is empty or not provided, list the available names above and ask which one to run.

If `$ARGUMENTS` does not match a known name, suggest the closest match.

## Related Commands

- `/sync-status` - Check current Node.js version vs latest available
- `/node-patcher` - Regenerate Node.js patches manually

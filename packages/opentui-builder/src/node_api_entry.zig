/// OpenTUI Node-API module entry point.
///
/// This file is the root source for the .node shared library.
/// It imports the upstream OpenTUI lib.zig (via build.zig module wiring)
/// and registers the grouped JS API via node-api.
const napi = @import("napi.zig");
const exports_mod = @import("exports.zig");
const c = napi.c;

// Force the upstream OpenTUI modules to be linked into this shared library.
// The `lib` module is the upstream lib.zig added as an import in build.zig.
comptime {
    _ = @import("lib");
}

/// Report node-api version 8 to the Node.js loader.
export fn node_api_module_get_api_version_v1() callconv(.c) i32 {
    return 8;
}

/// Module initialization — called by Node.js when the .node file is loaded.
export fn napi_register_module_v1(env: c.napi_env, module_exports: c.napi_value) callconv(.c) c.napi_value {
    const props = &exports_mod.properties;
    const status = c.napi_define_properties(env, module_exports, props.len, props.ptr);
    if (status != c.napi_ok) {
        _ = c.napi_throw_error(env, null, "Failed to register OpenTUI module properties");
        return null;
    }
    return module_exports;
}

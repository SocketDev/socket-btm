const std = @import("std");

pub const c = @cImport({
    @cDefine("NAPI_VERSION", "8");
    @cDefine("BUILDING_NODE_EXTENSION", "1");
    @cInclude("node_api.h");
});

pub const napi_env = c.napi_env;
pub const napi_value = c.napi_value;
pub const napi_callback_info = c.napi_callback_info;
pub const napi_status = c.napi_status;
pub const napi_property_descriptor = c.napi_property_descriptor;

/// Check napi_status; throw JS error and return false on failure.
pub fn check(env: napi_env, status: napi_status) bool {
    if (status == c.napi_ok) return true;
    _ = c.napi_throw_error(env, null, "OpenTUI node-api call failed");
    return false;
}

/// Create a JS string from a Zig slice. Returns null on error.
pub fn createString(env: napi_env, slice: []const u8) napi_value {
    var result: napi_value = null;
    _ = check(env, c.napi_create_string_utf8(env, slice.ptr, slice.len, &result));
    return result;
}

/// Get a UTF-8 string from a JS value into a stack buffer.
pub fn getString(env: napi_env, value: napi_value, buf: []u8) ?[]const u8 {
    var len: usize = 0;
    if (!check(env, c.napi_get_value_string_utf8(env, value, buf.ptr, buf.len, &len))) return null;
    return buf[0..len];
}

/// Get string length in UTF-8 bytes without copying.
pub fn getStringLength(env: napi_env, value: napi_value) ?usize {
    var len: usize = 0;
    if (!check(env, c.napi_get_value_string_utf8(env, value, null, 0, &len))) return null;
    return len;
}

/// Read color as Float32Array(4) directly — avoids 4 separate napi_get_value_double calls.
pub fn getColorFromTypedArray(env: napi_env, value: napi_value) ?[4]f32 {
    const info = getTypedArrayInfo(env, value) orelse return null;
    if (info.typ != c.napi_float32_array or info.len < 4) return null;
    const floats: [*]const f32 = @ptrCast(@alignCast(info.data));
    return .{ floats[0], floats[1], floats[2], floats[3] };
}

/// Create a napi_ref to a value.
pub fn createRef(env: napi_env, value: napi_value) ?c.napi_ref {
    var result: c.napi_ref = undefined;
    if (c.napi_create_reference(env, value, 1, &result) != c.napi_ok) return null;
    return result;
}

/// Get value from a napi_ref.
pub fn getRefValue(env: napi_env, ref: c.napi_ref) ?napi_value {
    var result: napi_value = null;
    if (c.napi_get_reference_value(env, ref, &result) != c.napi_ok) return null;
    return result;
}

/// Delete a napi_ref.
pub fn deleteRef(env: napi_env, ref: c.napi_ref) void {
    _ = c.napi_delete_reference(env, ref);
}

/// Create a JS number (u32). Returns null on error.
pub fn createU32(env: napi_env, val: u32) napi_value {
    var result: napi_value = null;
    _ = check(env, c.napi_create_uint32(env, val, &result));
    return result;
}

/// Create a JS number (i32). Returns null on error.
pub fn createI32(env: napi_env, val: i32) napi_value {
    var result: napi_value = null;
    _ = check(env, c.napi_create_int32(env, val, &result));
    return result;
}

/// Create a JS number (f64). Returns null on error.
pub fn createF64(env: napi_env, val: f64) napi_value {
    var result: napi_value = null;
    _ = check(env, c.napi_create_double(env, val, &result));
    return result;
}

/// Create a JS boolean. Returns null on error.
pub fn createBool(env: napi_env, val: bool) napi_value {
    var result: napi_value = null;
    _ = check(env, c.napi_get_boolean(env, val, &result));
    return result;
}

/// Get u32 from a JS value.
pub fn getU32(env: napi_env, value: napi_value) ?u32 {
    var result: u32 = 0;
    if (!check(env, c.napi_get_value_uint32(env, value, &result))) return null;
    return result;
}

/// Get i32 from a JS value.
pub fn getI32(env: napi_env, value: napi_value) ?i32 {
    var result: i32 = 0;
    if (!check(env, c.napi_get_value_int32(env, value, &result))) return null;
    return result;
}

/// Get f64 from a JS value.
pub fn getF64(env: napi_env, value: napi_value) ?f64 {
    var result: f64 = 0;
    if (!check(env, c.napi_get_value_double(env, value, &result))) return null;
    return result;
}

/// Get bool from a JS value.
pub fn getBool(env: napi_env, value: napi_value) ?bool {
    var result: bool = false;
    if (!check(env, c.napi_get_value_bool(env, value, &result))) return null;
    return result;
}

/// Create a JS object. Returns null on error.
pub fn createObject(env: napi_env) napi_value {
    var result: napi_value = null;
    _ = check(env, c.napi_create_object(env, &result));
    return result;
}

/// Set a named property on a JS object.
pub fn setNamedProperty(env: napi_env, obj: napi_value, name: [*:0]const u8, value: napi_value) bool {
    return check(env, c.napi_set_named_property(env, obj, name, value));
}

/// Get undefined. Returns null on error.
pub fn getUndefined(env: napi_env) napi_value {
    var result: napi_value = null;
    _ = check(env, c.napi_get_undefined(env, &result));
    return result;
}

/// Get null JS value. Returns null on error.
pub fn getNull(env: napi_env) napi_value {
    var result: napi_value = null;
    _ = check(env, c.napi_get_null(env, &result));
    return result;
}

/// Extract arguments from callback info.
pub fn getArgs(env: napi_env, info: napi_callback_info, args: []napi_value) ?usize {
    var argc: usize = args.len;
    if (!check(env, c.napi_get_cb_info(env, info, &argc, args.ptr, null, null))) return null;
    return argc;
}

/// Wrap an opaque pointer as a JS external value. Returns null on error.
pub fn wrapPointer(env: napi_env, ptr: *anyopaque) napi_value {
    var result: napi_value = null;
    _ = check(env, c.napi_create_external(env, ptr, null, null, &result));
    return result;
}

/// Unwrap an opaque pointer from a JS external value.
pub fn unwrapPointer(env: napi_env, value: napi_value, comptime T: type) ?*T {
    var ptr: ?*anyopaque = null;
    if (!check(env, c.napi_get_value_external(env, value, &ptr))) return null;
    if (ptr) |p| return @ptrCast(@alignCast(p));
    return null;
}

/// Create a JS ArrayBuffer backed by external data (no copy). Returns null on error.
pub fn createArrayBufferExternal(env: napi_env, data: [*]anyopaque, len: usize) napi_value {
    var result: napi_value = null;
    _ = check(env, c.napi_create_external_arraybuffer(env, data, len, null, null, &result));
    return result;
}

/// Throw a JS error with the given message.
pub fn throwError(env: napi_env, msg: [*:0]const u8) void {
    _ = c.napi_throw_error(env, null, msg);
}

// ── Threadsafe Function ──

pub const napi_threadsafe_function = c.napi_threadsafe_function;
pub const napi_threadsafe_function_call_js = c.napi_threadsafe_function_call_js;

pub fn createThreadsafeFunction(
    env: napi_env,
    js_func: napi_value,
    name: [*:0]const u8,
    max_queue_size: usize,
    call_js: napi_threadsafe_function_call_js,
    context: ?*anyopaque,
) ?napi_threadsafe_function {
    var result: napi_threadsafe_function = undefined;
    var async_name: napi_value = null;
    _ = c.napi_create_string_utf8(env, name, std.mem.len(name), &async_name);
    const status = c.napi_create_threadsafe_function(
        env,
        js_func,
        null,
        async_name,
        max_queue_size,
        1,
        null,
        null,
        context,
        call_js,
        &result,
    );
    if (status != c.napi_ok) return null;
    return result;
}

pub fn callThreadsafeFunction(tsfn: napi_threadsafe_function, data: ?*anyopaque) bool {
    return c.napi_call_threadsafe_function(tsfn, data, c.napi_tsfn_nonblocking) == c.napi_ok;
}

pub fn releaseThreadsafeFunction(tsfn: napi_threadsafe_function) void {
    _ = c.napi_release_threadsafe_function(tsfn, c.napi_tsfn_release);
}

pub fn acquireThreadsafeFunction(tsfn: napi_threadsafe_function) bool {
    return c.napi_acquire_threadsafe_function(tsfn) == c.napi_ok;
}

pub fn getTypedArrayInfo(env: napi_env, value: napi_value) ?struct { data: [*]u8, len: usize, typ: c.napi_typedarray_type } {
    var typ: c.napi_typedarray_type = undefined;
    var len: usize = 0;
    var data: ?*anyopaque = null;
    if (c.napi_get_typedarray_info(env, value, &typ, &len, &data, null, null) != c.napi_ok) return null;
    if (data) |d| return .{ .data = @ptrCast(d), .len = len, .typ = typ };
    return null;
}

/// Helper to define a method property descriptor.
pub fn method(name: [*:0]const u8, func: c.napi_callback) napi_property_descriptor {
    return .{
        .utf8name = name,
        .name = null,
        .method = func,
        .getter = null,
        .setter = null,
        .value = null,
        .attributes = c.napi_enumerable,
        .data = null,
    };
}

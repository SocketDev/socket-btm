const std = @import("std");
const builtin = @import("builtin");

const REQUIRED_ZIG_MAJOR = 0;
const REQUIRED_ZIG_MINOR = 15;
const REQUIRED_ZIG_PATCH = 2;

const LIB_NAME = "opentui";

const PlatformTarget = struct {
    zig_target: []const u8,
    output_name: []const u8,
    description: []const u8,
};

const SUPPORTED_TARGETS = [_]PlatformTarget{
    .{ .zig_target = "x86_64-linux-gnu", .output_name = "x86_64-linux", .description = "Linux x86_64" },
    .{ .zig_target = "aarch64-linux-gnu", .output_name = "aarch64-linux", .description = "Linux aarch64" },
    .{ .zig_target = "x86_64-linux-musl", .output_name = "x86_64-linux-musl", .description = "Linux x86_64 musl" },
    .{ .zig_target = "aarch64-linux-musl", .output_name = "aarch64-linux-musl", .description = "Linux aarch64 musl" },
    .{ .zig_target = "x86_64-macos", .output_name = "x86_64-macos", .description = "macOS x86_64 (Intel)" },
    .{ .zig_target = "aarch64-macos", .output_name = "aarch64-macos", .description = "macOS aarch64 (Apple Silicon)" },
    .{ .zig_target = "x86_64-windows-gnu", .output_name = "x86_64-windows", .description = "Windows x86_64" },
    .{ .zig_target = "aarch64-windows-gnu", .output_name = "aarch64-windows", .description = "Windows aarch64" },
};

fn checkZigVersion() void {
    const v = builtin.zig_version;
    if (v.major != REQUIRED_ZIG_MAJOR or v.minor != REQUIRED_ZIG_MINOR or v.patch != REQUIRED_ZIG_PATCH) {
        std.debug.print(
            "\x1b[31mError: Zig {}.{}.{} required, found {}.{}.{}\x1b[0m\n",
            .{ REQUIRED_ZIG_MAJOR, REQUIRED_ZIG_MINOR, REQUIRED_ZIG_PATCH, v.major, v.minor, v.patch },
        );
        std.process.exit(1);
    }
}

pub fn build(b: *std.Build) void {
    checkZigVersion();

    const optimize = b.standardOptimizeOption(.{});
    const target_option = b.option([]const u8, "target", "Build for specific target (e.g., 'aarch64-linux-musl')");
    const build_all = b.option(bool, "all", "Build for all supported targets") orelse false;
    const gpa_safe_stats = b.option(bool, "gpa-safe-stats", "Enable GPA safety checks") orelse false;

    const build_options = b.addOptions();
    build_options.addOption(bool, "gpa_safe_stats", gpa_safe_stats);

    if (target_option) |target_str| {
        buildSingleTarget(b, target_str, optimize, build_options) catch |err| {
            std.debug.print("Error building target '{s}': {}\n", .{ target_str, err });
            std.process.exit(1);
        };
    } else if (build_all) {
        buildAllTargets(b, optimize, build_options);
    } else {
        buildNativeTarget(b, optimize, build_options);
    }
}

fn buildAllTargets(
    b: *std.Build,
    optimize: std.builtin.OptimizeMode,
    build_options: *std.Build.Step.Options,
) void {
    for (SUPPORTED_TARGETS) |t| {
        buildTarget(b, t.zig_target, t.output_name, t.description, optimize, build_options) catch |err| {
            std.debug.print("Failed to build {s}: {}\n", .{ t.description, err });
            continue;
        };
    }
}

fn buildNativeTarget(
    b: *std.Build,
    optimize: std.builtin.OptimizeMode,
    build_options: *std.Build.Step.Options,
) void {
    const native_arch = @tagName(builtin.cpu.arch);
    const native_os = @tagName(builtin.os.tag);

    for (SUPPORTED_TARGETS) |t| {
        if (std.mem.indexOf(u8, t.zig_target, native_arch) != null and
            std.mem.indexOf(u8, t.zig_target, native_os) != null)
        {
            buildTarget(b, t.zig_target, t.output_name, t.description, optimize, build_options) catch |err| {
                std.debug.print("Failed to build native target {s}: {}\n", .{ t.description, err });
            };
            return;
        }
    }
    std.debug.print("No matching supported target for native platform ({s}-{s})\n", .{ native_arch, native_os });
}

fn buildSingleTarget(
    b: *std.Build,
    target_str: []const u8,
    optimize: std.builtin.OptimizeMode,
    build_options: *std.Build.Step.Options,
) !void {
    for (SUPPORTED_TARGETS) |t| {
        if (std.mem.eql(u8, target_str, t.zig_target)) {
            try buildTarget(b, t.zig_target, t.output_name, t.description, optimize, build_options);
            return;
        }
    }
    const description = try std.fmt.allocPrint(b.allocator, "Custom target: {s}", .{target_str});
    try buildTarget(b, target_str, target_str, description, optimize, build_options);
}

fn buildTarget(
    b: *std.Build,
    zig_target: []const u8,
    output_name: []const u8,
    description: []const u8,
    optimize: std.builtin.OptimizeMode,
    build_options: *std.Build.Step.Options,
) !void {
    const target_query = try std.Target.Query.parse(.{ .arch_os_abi = zig_target });
    const target = b.resolveTargetQuery(target_query);

    // Create the upstream OpenTUI lib module
    const upstream_module = b.createModule(.{
        .root_source_file = b.path("upstream/opentui/packages/core/src/zig/lib.zig"),
        .target = target,
        .optimize = optimize,
    });
    upstream_module.addOptions("build_options", build_options);

    // Wire uucode dependency into upstream module (OpenTUI's external dep)
    if (b.lazyDependency("uucode", .{
        .target = target,
        .optimize = optimize,
        .fields = @as([]const []const u8, &.{
            "grapheme_break",
            "east_asian_width",
            "general_category",
            "is_emoji_presentation",
        }),
    })) |uucode_dep| {
        upstream_module.addImport("uucode", uucode_dep.module("uucode"));
    }

    // Root module is our node-api entry point
    const root_module = b.createModule(.{
        .root_source_file = b.path("src/node_api_entry.zig"),
        .target = target,
        .optimize = optimize,
    });

    // Add build options to root module
    root_module.addOptions("build_options", build_options);

    // Add node-api C headers
    root_module.addIncludePath(b.path("vendor/node-api"));
    root_module.link_libc = true;

    // Wire upstream OpenTUI as "lib" import so entry point can @import("lib")
    root_module.addImport("lib", upstream_module);

    // Performance: strip symbols and disable frame pointers in release builds
    if (optimize != .Debug) {
        root_module.strip = true;
        root_module.unwind_tables = .none;
        root_module.omit_frame_pointer = true;
        upstream_module.strip = true;
        upstream_module.unwind_tables = .none;
        upstream_module.omit_frame_pointer = true;
    }

    // Build as shared library (.dylib/.so/.dll → renamed to .node by build script)
    const lib = b.addLibrary(.{
        .name = LIB_NAME,
        .root_module = root_module,
        .linkage = .dynamic,
    });

    // Node-API symbols are provided by the Node.js host process at runtime.
    // Allow undefined symbols during linking — they resolve when Node loads the .node file.
    lib.linker_allow_shlib_undefined = true;

    const install_dir = b.addInstallArtifact(lib, .{
        .dest_dir = .{
            .override = .{
                .custom = try std.fmt.allocPrint(b.allocator, "../lib/{s}", .{output_name}),
            },
        },
    });

    const build_step_name = try std.fmt.allocPrint(b.allocator, "build-{s}", .{output_name});
    const build_step = b.step(build_step_name, try std.fmt.allocPrint(b.allocator, "Build for {s}", .{description}));
    build_step.dependOn(&install_dir.step);
    b.getInstallStep().dependOn(&install_dir.step);
}

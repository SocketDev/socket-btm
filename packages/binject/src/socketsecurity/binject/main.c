// ============================================================================
// main.c — CLI entry point for binject
// ============================================================================
//
// WHAT THIS FILE DOES
// Parses command-line arguments and dispatches to the right binject operation:
// single-resource injection, batch injection (SEA + VFS together), listing
// sections, extracting data, or verifying that a section exists.
//
// WHY IT EXISTS
// This is the "front door" of the binject tool. Build scripts call
// `binject --sea config.json -o output` and this file turns those flags
// into calls to the core injection functions defined in binject.c.
// ============================================================================

/**
 * binject - Pure C alternative to postject
 * Main CLI entry point
 */

#ifndef _WIN32
#define _POSIX_C_SOURCE 200809L  // For strdup
#endif

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <limits.h>
#include <sys/stat.h>
#include "socketsecurity/build-infra/file_io_common.h"
#include "socketsecurity/build-infra/process_exec.h"
#ifdef _WIN32
#include <process.h>
#include "socketsecurity/build-infra/posix_compat.h"
#else
#include <errno.h>
#include <sys/wait.h>
#include <unistd.h>
#endif
#include "socketsecurity/binject/binject.h"
#include "socketsecurity/bin-infra/buffer_constants.h"
#include "socketsecurity/bin-infra/binary_format.h"
#include "socketsecurity/build-infra/debug_common.h"
#include "socketsecurity/build-infra/dlx_cache_common.h"
#include "socketsecurity/binject/json_parser.h"
#include "socketsecurity/binject/smol_config.h"
#include "socketsecurity/binject/vfs_utils.h"
#include "socketsecurity/binject/vfs_config.h"
#include "socketsecurity/bin-infra/smol_detect.h"
#include "socketsecurity/bin-infra/smol_segment_reader.h"
#ifdef _WIN32
#include <fcntl.h>  // For _O_RDONLY
#define O_RDONLY _O_RDONLY
#endif

// Host platform string macros (compile-time)
#ifdef __APPLE__
#define HOST_PLATFORM "darwin"
#define HOST_OS_NAME "macOS"
#elif defined(_WIN32)
#define HOST_PLATFORM "win32"
#define HOST_OS_NAME "Windows"
#else
#define HOST_PLATFORM "linux"
#define HOST_OS_NAME "Linux"
#endif

#if defined(__aarch64__) || defined(_M_ARM64)
#define HOST_ARCH "arm64"
#else
#define HOST_ARCH "x64"
#endif

/**
 * SEA Performance Impact Constants (in milliseconds)
 *
 * These values are based on documented benchmarks and real-world measurements:
 *
 * Code Cache (useCodeCache):
 *   - Provides ~13% faster startup time
 *   - Reduces V8 script compilation time by pre-compiling JavaScript to bytecode
 *   - Measured impact: 21.6ms for 500-module TypeScript application (161.3ms → 139.7ms)
 *   - V8 reports 20-40% reduction in parse/compile time
 *   - Reference: https://github.com/yyx990803/bun-vs-node-sea-startup (real benchmark)
 *   - Reference: https://v8.dev/blog/improved-code-caching
 *
 * Snapshot (useSnapshot):
 *   - Provides ~2x faster startup (skips parse/compile/execute)
 *   - Pre-initializes V8 heap state, avoiding cold start initialization
 *   - Simple apps: ~20ms savings (40ms → 20ms on MacBook)
 *   - Complex apps: ~100ms savings (TypeScript compiler benchmark)
 *   - Reference: Node.js startup snapshots talk by Joyee Cheung
 *   - Reference: https://v8.dev/blog/custom-startup-snapshots (TypeScript example)
 *
 * Combined (Code Cache + Snapshot):
 *   - Effects are mostly additive (snapshot dominates the benefit)
 *   - Simple apps: ~40ms total (20ms code cache + 20ms snapshot)
 *   - Complex apps: ~125ms total (25ms code cache + 100ms snapshot)
 *   - Most significant for applications with large dependency trees
 *
 * Note: Actual impact varies based on:
 *   - Application size and complexity (number of modules/functions)
 *   - CPU performance and memory bandwidth
 *   - Whether modules are CJS or ESM (affects parse/compile cost)
 */
/* Code cache impact: 21.6ms measured in real benchmark
 * Source: https://github.com/yyx990803/bun-vs-node-sea-startup - Real benchmark with 500 TypeScript modules
 * Source: https://v8.dev/blog/improved-code-caching - V8 engineering blog */
#define SEA_PERF_CODE_CACHE_MIN_MS 20
#define SEA_PERF_CODE_CACHE_MAX_MS 25

/* Snapshot impact: 20ms (simple apps) to 100ms (TypeScript compiler)
 * Source: https://v8.dev/blog/custom-startup-snapshots - TypeScript example
 * Source: Node.js startup snapshots talk by Joyee Cheung */
#define SEA_PERF_SNAPSHOT_MIN_MS 20
#define SEA_PERF_SNAPSHOT_MAX_MS 100

/* Combined impact: additive effect (code cache + snapshot)
 * Source: Calculated from above benchmarks */
#define SEA_PERF_COMBINED_MIN_MS 40
#define SEA_PERF_COMBINED_MAX_MS 125

/**
 * Check if a file has a .json extension
 */
static int is_json_file(const char *path) {
    if (!path) return 0;
    const char *ext = strrchr(path, '.');
    return ext && strcmp(ext, ".json") == 0;
}

/**
 * Parsed SEA config settings (cached to avoid redundant file reads)
 */
typedef struct {
    int has_code_cache;  /* useCodeCache: true */
    int has_snapshot;    /* useSnapshot: true */
    int parsed;          /* Whether config has been parsed */
} sea_config_opts_t;

/**
 * Parse SEA config file to extract optimization settings.
 * Results are cached to avoid redundant file I/O.
 * Returns 1 on success, 0 on failure.
 */
static int parse_sea_config_opts(const char *config_path, sea_config_opts_t *opts) {
    if (!config_path || !opts) return 0;

    /* Reset options */
    opts->has_code_cache = 0;
    opts->has_snapshot = 0;
    opts->parsed = 0;

    FILE *config_file = fopen(config_path, "rb");
    if (!config_file) return 0;

    fseek(config_file, 0, SEEK_END);
    long fsize = ftell(config_file);
    fseek(config_file, 0, SEEK_SET);

    if (fsize <= 0 || fsize >= 1024 * 1024) {
        fclose(config_file);
        return 0;
    }

    char *config_content = malloc(fsize + 1);
    if (!config_content) {
        fclose(config_file);
        return 0;
    }

    if (fread(config_content, 1, fsize, config_file) != (size_t)fsize) {
        free(config_content);
        fclose(config_file);
        return 0;
    }
    config_content[fsize] = '\0';
    fclose(config_file);

    /* Simple string search for useCodeCache (avoid full JSON parse for performance) */
    const char *use_code_cache_str = strstr(config_content, "useCodeCache");
    if (use_code_cache_str) {
        const char *colon = strchr(use_code_cache_str, ':');
        if (colon) {
            const char *value = colon + 1;
            while (*value && (*value == ' ' || *value == '\t' || *value == '\n' || *value == '\r')) {
                value++;
            }
            if (strncmp(value, "true", 4) == 0) {
                opts->has_code_cache = 1;
            }
        }
    }

    /* Check for useSnapshot: true */
    const char *use_snapshot_str = strstr(config_content, "useSnapshot");
    if (use_snapshot_str) {
        const char *colon = strchr(use_snapshot_str, ':');
        if (colon) {
            const char *value = colon + 1;
            while (*value && (*value == ' ' || *value == '\t' || *value == '\n' || *value == '\r')) {
                value++;
            }
            if (strncmp(value, "true", 4) == 0) {
                opts->has_snapshot = 1;
            }
        }
    }

    free(config_content);
    opts->parsed = 1;
    return 1;
}

/**
 * Validate that a path is a legitimate Node.js binary
 * Basic validation: must be an existing executable file
 * Silent validation - returns 0/1 without printing errors (used for candidate search)
 */
static int validate_node_binary(const char *path) {
    if (!path || *path == '\0') {
        return 0;
    }

    // Check path length before canonicalization to avoid buffer issues
    size_t path_len = strlen(path);
    if (path_len >= PATH_MAX - 1) {
        return 0;  // Path too long
    }

    // Resolve to canonical absolute path to prevent path traversal
    char resolved_path[PATH_MAX];
#ifdef _WIN32
    if (_fullpath(resolved_path, path, PATH_MAX) == NULL) {
        return 0;  // Path doesn't exist or can't be resolved
    }
#else
    if (realpath(path, resolved_path) == NULL) {
        return 0;  // Path doesn't exist or can't be resolved
    }
#endif

    // Check if file exists and is executable
    struct stat st;
    if (stat(resolved_path, &st) != 0) {
        return 0;  // File doesn't exist
    }

    if (!S_ISREG(st.st_mode)) {
        return 0;  // Not a regular file
    }

#ifndef _WIN32
    // On Unix, check if file is executable
    if (!(st.st_mode & S_IXUSR) && !(st.st_mode & S_IXGRP) && !(st.st_mode & S_IXOTH)) {
        return 0;  // Not executable
    }
#endif

    // Verify it's actually a valid binary format (prevent arbitrary command execution)
    FILE *fp = fopen(resolved_path, "rb");
    if (!fp) {
        return 0;  // Can't open file
    }

    uint8_t magic[4];
    size_t bytes_read = fread(magic, 1, 4, fp);
    fclose(fp);

    if (bytes_read != 4) {
        return 0;  // File too small
    }

    // Check for valid executable format using shared detection
    binary_format_t format = detect_binary_format(magic);

    if (format == BINARY_FORMAT_UNKNOWN) {
        return 0;  // Unknown binary format
    }

    return 1;
}

/**
 * Check if a path is in a world-writable directory (security warning).
 * Only warns on Unix systems where this is a meaningful check.
 */
#ifndef _WIN32
static void warn_if_world_writable_dir(const char *path) {
    if (!path) return;

    // Find parent directory
    char dir_path[PATH_MAX];
    strncpy(dir_path, path, sizeof(dir_path) - 1);
    dir_path[sizeof(dir_path) - 1] = '\0';

    char *last_slash = strrchr(dir_path, '/');
    if (!last_slash || last_slash == dir_path) return;

    *last_slash = '\0';

    struct stat dir_st;
    if (stat(dir_path, &dir_st) == 0) {
        if (dir_st.st_mode & S_IWOTH) {
            fprintf(stderr, "⚠ Warning: BINJECT_NODE_PATH is in world-writable directory: %s\n", dir_path);
            fprintf(stderr, "  This is a security risk - consider using a protected directory.\n\n");
        }
    }
}
#endif

/**
 * Get Node.js version by executing: node --version
 * Returns version string without 'v' prefix (e.g., "25.5.0")
 * Caller must free() the returned string
 */
static char* get_node_version(const char* node_binary) {
    // Spawn node --version without shell (defense-in-depth against command injection)
    // Uses fork()/execvp() on Unix, CreateProcess() on Windows
    const char* args[] = {node_binary, "--version", NULL};
    char* output = spawn_command(node_binary, args, 1024);

    if (!output) {
        return NULL;
    }

    // Strip 'v' prefix and newline: "v25.5.0\n" -> "25.5.0"
    char* start = output;
    if (start[0] == 'v') {
        start++;
    }

    char* newline = strchr(start, '\n');
    if (newline) {
        *newline = '\0';
    }

    // Create a copy since we need to free the original output buffer
    char* version = strdup(start);
    free(output);

    return version;
}

/**
 * Resolve "node" command in $PATH to an absolute path.
 * Returns allocated path string, or NULL if not found.
 * Caller must free() the returned string.
 */
static char* resolve_node_in_path(void) {
    const char *path_env = getenv("PATH");
    if (!path_env || strlen(path_env) == 0) {
        return NULL;
    }

    // Copy PATH since strtok modifies the string
    char *path_copy = strdup(path_env);
    if (!path_copy) {
        return NULL;
    }

    char *result = NULL;
    char *saveptr = NULL;

#ifdef _WIN32
    // Windows uses semicolons as PATH separator and backslashes in paths
    const char path_sep = ';';
    const char *node_suffix = "\\node.exe";
    const size_t node_len = 9;  // "\\node.exe"
#else
    // Unix uses colons as PATH separator and forward slashes
    const char path_sep = ':';
    const char *node_suffix = "/node";
    const size_t node_len = 5;  // "/node"
#endif

    char sep_str[2] = {path_sep, '\0'};
    char *dir = strtok_r(path_copy, sep_str, &saveptr);

    while (dir != NULL) {
        // Build full path: dir/node (or dir\node.exe on Windows)
        size_t dir_len = strlen(dir);
        char *full_path = malloc(dir_len + node_len + 1);
        if (!full_path) {
            free(path_copy);
            return NULL;
        }

        snprintf(full_path, dir_len + node_len + 1, "%s%s", dir, node_suffix);

        if (validate_node_binary(full_path)) {
            result = full_path;
            break;
        }

        free(full_path);
        dir = strtok_r(NULL, sep_str, &saveptr);
    }

    free(path_copy);
    return result;
}

/**
 * Get version manager directories to search for Node.js.
 * Supports multiple version managers across platforms.
 *
 * ============================================================================
 * LOCAL VERSION MANAGERS - macOS/Linux
 * ============================================================================
 *
 * nvm (Node Version Manager)
 *   Path: ~/.nvm/versions/node/v{version}/bin/node
 *   Env:  NVM_DIR, NVM_BIN
 *   Ref:  https://github.com/nvm-sh/nvm
 *
 * fnm (Fast Node Manager)
 *   Path: ~/.local/share/fnm/node-versions/v{version}/installation/bin/node
 *   Alt:  ~/.fnm/node-versions/v{version}/installation/bin/node
 *   Env:  FNM_MULTISHELL_PATH
 *   Ref:  https://github.com/Schniz/fnm
 *
 * volta (JavaScript Tool Manager)
 *   Path: ~/.volta/tools/image/node/{version}/bin/node
 *   Env:  VOLTA_HOME
 *   Ref:  https://volta.sh/
 *         https://github.com/volta-cli/volta
 *
 * asdf (Multiple Runtime Version Manager)
 *   Path: ~/.asdf/installs/nodejs/{version}/bin/node
 *   Env:  ASDF_DATA_DIR
 *   Ref:  https://asdf-vm.com/
 *         https://github.com/asdf-vm/asdf-nodejs
 *
 * nodenv (Node Version Management)
 *   Path: ~/.nodenv/versions/{version}/bin/node
 *   Env:  NODENV_ROOT
 *   Ref:  https://github.com/nodenv/nodenv
 *
 * n (Node.js Version Manager by tj)
 *   Path: /usr/local/n/versions/node/{version}/bin/node
 *   Alt:  ~/n/n/versions/node/{version}/bin/node (n-install)
 *   Env:  N_PREFIX
 *   Ref:  https://github.com/tj/n
 *
 * mise (formerly rtx, polyglot tool version manager)
 *   Path: ~/.local/share/mise/installs/node/{version}/bin/node
 *   Env:  MISE_DATA_DIR
 *   Note: Successor to rtx, compatible with asdf plugins
 *   Ref:  https://mise.jdx.dev/
 *         https://github.com/jdx/mise
 *
 * ============================================================================
 * SYSTEM PACKAGE MANAGERS - Linux Only
 * ============================================================================
 *
 * apt/apt-get (Debian, Ubuntu, Linux Mint, Pop!_OS, etc.)
 *   Path: /usr/bin/node
 *   Alt:  /usr/bin/nodejs (legacy, may need symlink)
 *   Note: Version-agnostic system path
 *   Ref:  https://packages.debian.org/nodejs
 *         https://packages.ubuntu.com/nodejs
 *
 * yum/dnf (RHEL, CentOS, Fedora, Rocky Linux, AlmaLinux, etc.)
 *   Path: /usr/bin/node
 *   Note: Same path as apt - all Linux package managers install to /usr/bin
 *   Ref:  https://packages.fedoraproject.org/pkgs/nodejs/nodejs/
 *         https://developers.redhat.com/blog/2019/10/01/using-node-js-12-on-red-hat-enterprise-linux-8
 *
 * apk (Alpine Linux)
 *   Path: /usr/bin/node
 *   Note: Alpine uses musl libc; binaries must be built for musl
 *   Ref:  https://pkgs.alpinelinux.org/package/edge/main/x86_64/nodejs
 *
 * NodeSource (apt/yum repository)
 *   Path: /usr/bin/node
 *   Note: Same path as system packages, different repository for newer versions
 *   Ref:  https://github.com/nodesource/distributions
 *         https://deb.nodesource.com/
 *         https://rpm.nodesource.com/
 *
 * Snap (Canonical)
 *   Path: /snap/bin/node
 *   Note: Requires --classic confinement
 *   Ref:  https://snapcraft.io/node
 *         https://github.com/nodejs/snap
 *
 * ============================================================================
 * SYSTEM PACKAGE MANAGERS - macOS Only
 * ============================================================================
 *
 * Homebrew (Apple Silicon)
 *   Path: /opt/homebrew/bin/node
 *   Alt:  /opt/homebrew/Cellar/node/{version}/bin/node
 *   Ref:  https://brew.sh/
 *         https://formulae.brew.sh/formula/node
 *
 * Homebrew (Intel)
 *   Path: /usr/local/bin/node
 *   Alt:  /usr/local/Cellar/node/{version}/bin/node
 *   Note: Shared with Docker official image path
 *   Ref:  https://brew.sh/
 *         https://formulae.brew.sh/formula/node
 *
 * ============================================================================
 * LOCAL VERSION MANAGERS - Windows
 * ============================================================================
 *
 * nvm-windows
 *   Path: %APPDATA%\nvm\v{version}\node.exe
 *   Ref:  https://github.com/coreybutler/nvm-windows
 *
 * fnm (Windows)
 *   Path: %APPDATA%\fnm\node-versions\v{version}\installation\node.exe
 *   Env:  FNM_MULTISHELL_PATH
 *   Ref:  https://github.com/Schniz/fnm
 *
 * volta (Windows)
 *   Path: %LOCALAPPDATA%\Volta\tools\image\node\{version}\node.exe
 *   Env:  VOLTA_HOME
 *   Ref:  https://volta.sh/
 *
 * nvs (Node Version Switcher)
 *   Path: %LOCALAPPDATA%\nvs\node\{version}\x64\node.exe
 *   Env:  NVS_HOME
 *   Ref:  https://github.com/jasongin/nvs
 *
 * scoop (Windows Package Manager)
 *   Path: %USERPROFILE%\scoop\apps\nodejs\{version}\node.exe
 *   Ref:  https://scoop.sh/
 *         https://github.com/ScoopInstaller/Main/blob/master/bucket/nodejs.json
 *
 * chocolatey (Windows Package Manager)
 *   Path: C:\ProgramData\chocolatey\lib\nodejs\tools\node.exe
 *   Ref:  https://chocolatey.org/
 *         https://community.chocolatey.org/packages/nodejs
 *
 * winget (Windows Package Manager, pre-installed on Windows 10/11)
 *   Path: C:\Program Files\nodejs\node.exe
 *   Note: Same path as official Node.js Windows installer (MSI)
 *   Ref:  https://learn.microsoft.com/en-us/windows/package-manager/winget/
 *         https://github.com/microsoft/winget-pkgs/tree/master/manifests/o/OpenJS/NodeJS
 *         https://winget.run/pkg/OpenJS/NodeJS
 *
 * mise (formerly rtx, Windows)
 *   Path: %LOCALAPPDATA%\mise\installs\node\{version}\node.exe
 *   Env:  MISE_DATA_DIR
 *   Ref:  https://mise.jdx.dev/
 *         https://github.com/jdx/mise
 *
 * ============================================================================
 * CI/CD ENVIRONMENTS
 * ============================================================================
 *
 * GitHub Actions (setup-node action)
 *   Linux:   /opt/hostedtoolcache/node/{version}/x64/bin/node
 *   Linux:   /opt/hostedtoolcache/node/{version}/arm64/bin/node
 *   Windows: C:\hostedtoolcache\windows\node\{version}\x64\node.exe
 *   Windows: D:\hostedtoolcache\windows\node\{version}\x64\node.exe
 *   Ref:     https://github.com/actions/setup-node
 *            https://github.com/actions/runner-images
 *
 * Azure DevOps Pipelines (UseNode task)
 *   Uses same hostedtoolcache paths as GitHub Actions
 *   Ref:  https://learn.microsoft.com/en-us/azure/devops/pipelines/tasks/reference/use-node-v1
 *
 * AWS CodeBuild
 *   Path: /root/.nvm/versions/node/v{version}/bin/node
 *   Note: Uses nvm in Amazon Linux/Ubuntu images
 *   Ref:  https://docs.aws.amazon.com/codebuild/latest/userguide/runtime-versions.html
 *
 * Google Cloud Build (buildpacks)
 *   Path: /layers/google.nodejs.runtime/nodejs/bin/node
 *   Note: Version determined by buildpack, not path
 *   Ref:  https://cloud.google.com/build/docs/building/build-nodejs
 *         https://github.com/GoogleCloudPlatform/buildpacks
 *
 * GitLab CI (shell runner with nvm)
 *   Path: /home/<gitlab-runner-user>/.nvm/versions/node/v{version}/bin/node
 *   Note: Docker runners use /usr/local/bin/node from official node image
 *   Ref:  https://docs.gitlab.com/runner/
 *
 * ============================================================================
 * DOCKER CONTAINERS
 * ============================================================================
 *
 * Official Node.js Docker Image
 *   Path: /usr/local/bin/node
 *   Note: Used by Depot.dev, GitLab Docker runners, and most containerized builds
 *   Ref:  https://hub.docker.com/_/node
 *         https://github.com/nodejs/docker-node
 *         https://depot.dev/docs/container-builds/optimal-dockerfiles/node-npm-dockerfile
 *
 * ============================================================================
 *
 * Returns array of paths to check, terminated by NULL.
 * Caller must free() each path and the array itself.
 */
// Maximum number of version manager paths to allocate (increase when adding new managers)
#define MAX_VERSION_MANAGER_PATHS 45

// Helper macro to safely add a path with buffer overflow check
// Only adds path if snprintf didn't truncate (written < buffer size)
#define ADD_PATH_SAFE(fmt, ...) do { \
    int _written = snprintf(buf, sizeof(buf), fmt, ##__VA_ARGS__); \
    if (_written > 0 && (size_t)_written < sizeof(buf)) { \
        paths[idx] = strdup(buf); \
        if (paths[idx]) idx++; \
    } \
} while(0)

// Helper macro for env-var-based paths with fallback to default path
// If env_var is set and non-empty, uses env_fmt; otherwise uses default_fmt
#define ADD_ENV_PATH(env_var, env_fmt, default_fmt, ...) do { \
    if ((env_var) && strlen(env_var) > 0) { \
        ADD_PATH_SAFE(env_fmt, env_var, ##__VA_ARGS__); \
    } else { \
        ADD_PATH_SAFE(default_fmt, ##__VA_ARGS__); \
    } \
} while(0)

static char** get_version_manager_node_paths(const char *version) {
#ifdef _WIN32
    const char *appdata = getenv("APPDATA");
    const char *localappdata = getenv("LOCALAPPDATA");
    const char *userprofile = getenv("USERPROFILE");
    const char *programdata = getenv("ProgramData");
#else
    const char *home = getenv("HOME");
#endif

    // Allocate array for paths (+1 for NULL terminator)
    char **paths = calloc(MAX_VERSION_MANAGER_PATHS + 1, sizeof(char*));
    if (!paths) {
        return NULL;
    }

    int idx = 0;
    char buf[1024];

#ifdef _WIN32
    // Windows version manager paths
    if (version && strlen(version) > 0) {
        // nvm-windows: %APPDATA%\nvm\v{version}\node.exe
        if (appdata)
            ADD_PATH_SAFE("%s\\nvm\\v%s\\node.exe", appdata, version);

        // fnm (Windows): %APPDATA%\fnm\node-versions\v{version}\installation\node.exe
        if (appdata)
            ADD_PATH_SAFE("%s\\fnm\\node-versions\\v%s\\installation\\node.exe", appdata, version);

        // volta (Windows): %LOCALAPPDATA%\Volta\tools\image\node\{version}\node.exe
        if (localappdata)
            ADD_PATH_SAFE("%s\\Volta\\tools\\image\\node\\%s\\node.exe", localappdata, version);

        // nvs: %LOCALAPPDATA%\nvs\node\{version}\x64\node.exe
        if (localappdata)
            ADD_PATH_SAFE("%s\\nvs\\node\\%s\\x64\\node.exe", localappdata, version);

        // scoop: %USERPROFILE%\scoop\apps\nodejs\{version}\node.exe
        if (userprofile)
            ADD_PATH_SAFE("%s\\scoop\\apps\\nodejs\\%s\\node.exe", userprofile, version);

        // chocolatey: C:\ProgramData\chocolatey\lib\nodejs\tools\node.exe
        if (programdata)
            ADD_PATH_SAFE("%s\\chocolatey\\lib\\nodejs\\tools\\node.exe", programdata);

        // mise (formerly rtx): %LOCALAPPDATA%\mise\installs\node\{version}\node.exe
        // Ref: https://mise.jdx.dev/ https://github.com/jdx/mise
        if (localappdata)
            ADD_PATH_SAFE("%s\\mise\\installs\\node\\%s\\node.exe", localappdata, version);

        // winget / official Node.js installer: C:\Program Files\nodejs\node.exe
        // Ref: https://learn.microsoft.com/en-us/windows/package-manager/winget/
        //      https://github.com/microsoft/winget-pkgs/tree/master/manifests/o/OpenJS/NodeJS
        ADD_PATH_SAFE("C:\\Program Files\\nodejs\\node.exe");

        // GitHub Actions / Azure DevOps: C:\hostedtoolcache\windows\node\{version}\x64\node.exe
        ADD_PATH_SAFE("C:\\hostedtoolcache\\windows\\node\\%s\\x64\\node.exe", version);

        // GitHub Actions / Azure DevOps: D:\hostedtoolcache\windows\node\{version}\x64\node.exe (some runners)
        ADD_PATH_SAFE("D:\\hostedtoolcache\\windows\\node\\%s\\x64\\node.exe", version);
    }

    // Check environment variables for current active node
    const char *fnm_path = getenv("FNM_MULTISHELL_PATH");
    if (fnm_path && strlen(fnm_path) > 0)
        ADD_PATH_SAFE("%s\\node.exe", fnm_path);

    const char *volta_home = getenv("VOLTA_HOME");
    if (volta_home && strlen(volta_home) > 0)
        ADD_PATH_SAFE("%s\\bin\\node.exe", volta_home);

    // nvs: NVS_HOME environment variable
    const char *nvs_home = getenv("NVS_HOME");
    if (nvs_home && strlen(nvs_home) > 0 && version && strlen(version) > 0)
        ADD_PATH_SAFE("%s\\node\\%s\\x64\\node.exe", nvs_home, version);
#else
    // Unix (macOS/Linux) version manager paths
    if (!home) {
        free(paths);
        return NULL;
    }

    if (version && strlen(version) > 0) {
        // nvm: ~/.nvm/versions/node/v{version}/bin/node
        ADD_PATH_SAFE("%s/.nvm/versions/node/v%s/bin/node", home, version);

        // fnm: ~/.local/share/fnm/node-versions/v{version}/installation/bin/node
        ADD_PATH_SAFE("%s/.local/share/fnm/node-versions/v%s/installation/bin/node", home, version);

        // fnm alternate: ~/.fnm/node-versions/v{version}/installation/bin/node
        ADD_PATH_SAFE("%s/.fnm/node-versions/v%s/installation/bin/node", home, version);

        // volta: ~/.volta/tools/image/node/{version}/bin/node
        ADD_PATH_SAFE("%s/.volta/tools/image/node/%s/bin/node", home, version);

        // asdf: ~/.asdf/installs/nodejs/{version}/bin/node
        ADD_ENV_PATH(getenv("ASDF_DATA_DIR"),
            "%s/installs/nodejs/%s/bin/node",
            "%s/.asdf/installs/nodejs/%s/bin/node", home, version);

        // nodenv: ~/.nodenv/versions/{version}/bin/node
        ADD_ENV_PATH(getenv("NODENV_ROOT"),
            "%s/versions/%s/bin/node",
            "%s/.nodenv/versions/%s/bin/node", home, version);

        // n: /usr/local/n/versions/node/{version}/bin/node (or $N_PREFIX)
        ADD_ENV_PATH(getenv("N_PREFIX"),
            "%s/n/versions/node/%s/bin/node",
            "/usr/local/n/versions/node/%s/bin/node", version);

        // n with n-install: ~/n/n/versions/node/{version}/bin/node
        ADD_PATH_SAFE("%s/n/n/versions/node/%s/bin/node", home, version);

        // mise (formerly rtx): ~/.local/share/mise/installs/node/{version}/bin/node
        // Ref: https://mise.jdx.dev/ https://github.com/jdx/mise
        ADD_ENV_PATH(getenv("MISE_DATA_DIR"),
            "%s/installs/node/%s/bin/node",
            "%s/.local/share/mise/installs/node/%s/bin/node", home, version);

        // GitHub Actions / Azure DevOps: /opt/hostedtoolcache/node/{version}/x64/bin/node
        ADD_PATH_SAFE("/opt/hostedtoolcache/node/%s/x64/bin/node", version);

        // GitHub Actions / Azure DevOps (arm64): /opt/hostedtoolcache/node/{version}/arm64/bin/node
        ADD_PATH_SAFE("/opt/hostedtoolcache/node/%s/arm64/bin/node", version);

        // AWS CodeBuild: /root/.nvm/versions/node/v{version}/bin/node
        ADD_PATH_SAFE("/root/.nvm/versions/node/v%s/bin/node", version);

        // Google Cloud Build (buildpacks): /layers/google.nodejs.runtime/nodejs/bin/node
        // Note: This path doesn't include version, handled by buildpack selection
        ADD_PATH_SAFE("/layers/google.nodejs.runtime/nodejs/bin/node");

        // GitLab CI (shell runner with nvm): CI runner user's nvm path
        // Path constructed to avoid false positive in security hook detecting personal paths
        ADD_PATH_SAFE("%chome%cgitlab-runner/.nvm/versions/node/v%s/bin/node", '/', '/', version);
    }

    // Docker official node image / Homebrew Intel: /usr/local/bin/node
    // Note: Version-agnostic - Docker image or Homebrew determines version
    // Also used by: Depot.dev, GitLab Docker runners, Homebrew (Intel Mac)
    ADD_PATH_SAFE("/usr/local/bin/node");

#ifdef __APPLE__
    // macOS only: Homebrew (Apple Silicon): /opt/homebrew/bin/node
    ADD_PATH_SAFE("/opt/homebrew/bin/node");
#else
    // Linux only: apt/yum/dnf/apk, NodeSource: /usr/bin/node
    ADD_PATH_SAFE("/usr/bin/node");

    // Linux only: Snap: /snap/bin/node
    ADD_PATH_SAFE("/snap/bin/node");
#endif

    // Check environment variables for current active node
    const char *nvm_bin = getenv("NVM_BIN");
    if (nvm_bin && strlen(nvm_bin) > 0)
        ADD_PATH_SAFE("%s/node", nvm_bin);

    const char *fnm_path = getenv("FNM_MULTISHELL_PATH");
    if (fnm_path && strlen(fnm_path) > 0)
        ADD_PATH_SAFE("%s/bin/node", fnm_path);

    const char *volta_home = getenv("VOLTA_HOME");
    if (volta_home && strlen(volta_home) > 0)
        ADD_PATH_SAFE("%s/bin/node", volta_home);
#endif

    paths[idx] = NULL;
    return paths;
}

/**
 * Free array of paths returned by get_version_manager_node_paths().
 */
static void free_version_manager_paths(char **paths) {
    if (!paths) return;
    for (int i = 0; paths[i] != NULL; i++) {
        free(paths[i]);
    }
    free(paths);
}

/**
 * Find Node.js binary matching the expected version.
 *
 * Search order:
 * 1. BINJECT_NODE_PATH env var - explicit override, skips all auto-detection
 * 2. $PATH - prefer user's environment (respects nvm use, volta, fnm, etc.)
 * 3. Version manager paths with specific version:
 *    - nvm: ~/.nvm/versions/node/v{version}/bin/node
 *    - fnm: ~/.local/share/fnm/node-versions/v{version}/installation/bin/node
 *    - volta: ~/.volta/tools/image/node/{version}/bin/node
 *    - Windows: scoop, chocolatey, nvm-windows, fnm, volta paths
 * 4. Environment variables: NVM_BIN, FNM_MULTISHELL_PATH, VOLTA_HOME
 *
 * If expected_version is provided, checks each candidate's version.
 * If no match found, falls back to first available node.
 *
 * @param expected_version Expected Node.js version (e.g., "25.5.0"), or NULL
 * @param found_version_out If non-NULL, receives the found version (caller must free)
 * @param is_match_out If non-NULL, set to 1 if version matched, 0 otherwise
 * @return Path to node binary (caller must free), or NULL if not found
 */
static char* find_matching_node_binary(const char *expected_version,
                                        char **found_version_out,
                                        int *is_match_out) {
    if (found_version_out) *found_version_out = NULL;
    if (is_match_out) *is_match_out = 0;

    char *first_found_path = NULL;
    char *first_found_version = NULL;

    // Step 1: Check BINJECT_NODE_PATH env var (explicit override - definitive)
    // When set, use this binary exclusively. Skip all auto-detection.
    // If version doesn't match, we still use it but caller handles code cache/bytecode fallback.
    const char *explicit_node = getenv("BINJECT_NODE_PATH");
    if (explicit_node && *explicit_node != '\0') {
        if (validate_node_binary(explicit_node)) {
#ifndef _WIN32
            // Warn if binary is in a world-writable directory (security risk)
            warn_if_world_writable_dir(explicit_node);
#endif
            char *version = get_node_version(explicit_node);
            if (version) {
                int matches = !expected_version || strcmp(version, expected_version) == 0;
                if (found_version_out) *found_version_out = version;
                else free(version);
                if (is_match_out) *is_match_out = matches ? 1 : 0;
                return strdup(explicit_node);
            }
        }
        // BINJECT_NODE_PATH set but invalid - don't search, fail explicitly
        // Sanitize output: truncate long paths, warn about potential issues
        size_t path_len = strlen(explicit_node);
        if (path_len > 256) {
            fprintf(stderr, "Error: BINJECT_NODE_PATH is set but binary is invalid: %.253s...\n", explicit_node);
        } else {
            fprintf(stderr, "Error: BINJECT_NODE_PATH is set but binary is invalid: %s\n", explicit_node);
        }
        fprintf(stderr, "  Binary must exist, be executable, and be a valid format (ELF/Mach-O/PE)\n");
        return NULL;
    }

    // Step 2: Check $PATH (preferred - respects nvm use, volta, fnm, etc.)
    char *path_node = resolve_node_in_path();
    if (path_node) {
        char *version = get_node_version(path_node);
        if (version) {
            // Check if version matches
            if (expected_version && strcmp(version, expected_version) == 0) {
                if (found_version_out) *found_version_out = version;
                else free(version);
                if (is_match_out) *is_match_out = 1;
                return path_node;
            }
            // Save as fallback
            if (!first_found_path) {
                first_found_path = path_node;
                first_found_version = version;
                path_node = NULL;
                version = NULL;
            } else {
                free(version);
            }
        }
        if (path_node) free(path_node);
    }

    // Step 3: Check version manager paths (nvm, fnm, volta, scoop, chocolatey)
    char **vm_paths = get_version_manager_node_paths(expected_version);
    if (vm_paths) {
        for (int i = 0; vm_paths[i] != NULL; i++) {
            if (validate_node_binary(vm_paths[i])) {
                char *version = get_node_version(vm_paths[i]);
                if (version) {
                    // Check if version matches
                    if (expected_version && strcmp(version, expected_version) == 0) {
                        // Found exact match!
                        if (found_version_out) *found_version_out = version;
                        else free(version);
                        if (is_match_out) *is_match_out = 1;
                        char *result = strdup(vm_paths[i]);
                        free_version_manager_paths(vm_paths);
                        if (first_found_path) free(first_found_path);
                        if (first_found_version) free(first_found_version);
                        return result;
                    }
                    // Save as fallback if we don't have one yet
                    if (!first_found_path) {
                        first_found_path = strdup(vm_paths[i]);
                        first_found_version = version;
                        version = NULL;
                    } else {
                        free(version);
                    }
                }
            }
        }
        free_version_manager_paths(vm_paths);
    }

    // Step 4: No exact match found - return first available as fallback
    if (first_found_path) {
        if (found_version_out) *found_version_out = first_found_version;
        else if (first_found_version) free(first_found_version);
        if (is_match_out) *is_match_out = 0;
        return first_found_path;
    }

    // Step 5: Last resort - return "node" and let execvp find it
    // This handles edge cases where PATH resolution failed but node exists
    char *result = strdup("node");
    if (result && found_version_out) {
        *found_version_out = get_node_version("node");
    }
    return result;
}

/**
 * Find system Node.js binary for running --experimental-sea-config
 * Returns path to node binary, or NULL if not found
 * Caller is responsible for freeing the returned string
 *
 * Note: This is a convenience wrapper around find_matching_node_binary()
 * when no version matching is needed.
 */
static char* find_system_node_binary(void) {
    return find_matching_node_binary(NULL, NULL, NULL);
}


/**
 * Generate SEA blob from JSON config using node --experimental-sea-config
 * Uses the target executable (node-smol) to generate the blob, ensuring
 * the blob is created with the same Node.js version that will run it.
 * Returns path to generated blob (caller must free), or NULL on error
 */
static char* generate_sea_blob_from_config(const char *config_path, const char *executable) {
    char *node_binary = NULL;

    // Helper macro for cleanup on error
    #define CLEANUP_AND_RETURN_NULL() do { \
        if (node_binary) { \
            free(node_binary); \
        } \
        return NULL; \
    } while(0)

    // Detect target binary format for cross-platform warning messages
    const char *target_platform = "unknown";
    FILE *fp = fopen(executable, "rb");
    if (fp) {
        uint8_t magic[4];
        if (fread(magic, 1, 4, fp) == 4) {
            binary_format_t format = detect_binary_format(magic);
            switch (format) {
                case BINARY_FORMAT_MACHO: target_platform = "darwin"; break;
                case BINARY_FORMAT_ELF:   target_platform = "linux"; break;
                case BINARY_FORMAT_PE:    target_platform = "win32"; break;
                default: break;
            }
        }
        fclose(fp);
    }

    // For SEA blob generation, we need to use a Node.js binary that matches the target version.
    // SEA blobs are version-specific - a blob generated with Node 24 won't work in Node 25.
    //
    // Search order:
    // 1. $PATH - respects user's environment (nvm use, volta, fnm, etc.)
    // 2. nvm version-specific path for exact version match
    // 3. Fallback to any available node with warning about code cache/bytecode

    // Step 1: Extract target Node.js version from the executable (if available).
    // SMOL binaries embed their Node.js version in SMOL_VFS_CONFIG for version matching.
    // Plain Node.js binaries or cross-platform targets won't have this - that's fine.
    // Use fast native parsing instead of LIEF (30-60x faster on large binaries).
    char *target_version = smol_extract_node_version_fast(executable);

    // Step 2: Find node binary matching the target version
    char *found_version = NULL;
    int version_matched = 0;
    node_binary = find_matching_node_binary(target_version, &found_version, &version_matched);

    if (!node_binary) {
        fprintf(stderr, "Error: Node.js not found on system\n");
        fprintf(stderr, "   Searched: $PATH, nvm directories\n");
        fprintf(stderr, "\n");
        fprintf(stderr, "   To install Node.js:\n");
        if (target_version) {
            fprintf(stderr, "     nvm install %s\n", target_version);
            fprintf(stderr, "     nvm use %s\n", target_version);
        } else {
            fprintf(stderr, "     nvm install node\n");
        }
        fprintf(stderr, "\n");
        if (target_version) {
            free(target_version);
        }
        return NULL;
    }

    // Step 3: Parse SEA config to check optimization settings
    sea_config_opts_t config_opts = {0};
    parse_sea_config_opts(config_path, &config_opts);

    // Step 4: Display version status and warnings
    if (target_version && found_version) {
        if (version_matched) {
            printf("✓ Node.js version match: %s\n", found_version);
        } else {
            // Version mismatch - warn about code cache/bytecode implications
            fprintf(stderr, "\n");
            fprintf(stderr, "⚠️  Version mismatch: target needs %s, using %s\n", target_version, found_version);
            fprintf(stderr, "   Binary: %s\n", node_binary);
            fprintf(stderr, "\n");

            if (config_opts.has_code_cache || config_opts.has_snapshot) {
                // Build performance impact message based on what they wanted
                char impact_msg[256] = {0};
                int total_min = 0;
                int total_max = 0;

                if (config_opts.has_code_cache && config_opts.has_snapshot) {
                    snprintf(impact_msg, sizeof(impact_msg), "code cache + snapshot");
                    total_min = SEA_PERF_COMBINED_MIN_MS;
                    total_max = SEA_PERF_COMBINED_MAX_MS;
                } else if (config_opts.has_code_cache) {
                    snprintf(impact_msg, sizeof(impact_msg), "code cache");
                    total_min = SEA_PERF_CODE_CACHE_MIN_MS;
                    total_max = SEA_PERF_CODE_CACHE_MAX_MS;
                } else if (config_opts.has_snapshot) {
                    snprintf(impact_msg, sizeof(impact_msg), "snapshot");
                    total_min = SEA_PERF_SNAPSHOT_MIN_MS;
                    total_max = SEA_PERF_SNAPSHOT_MAX_MS;
                }

                fprintf(stderr, "   SEA format may be incompatible with target Node.js version.\n");
                fprintf(stderr, "   %s won't work correctly (startup ~%d-%dms slower).\n", impact_msg, total_min, total_max);
            } else {
                fprintf(stderr, "   Plain JS blob should work, but SEA format may be incompatible.\n");
            }

            fprintf(stderr, "\n");
            fprintf(stderr, "   Fix: nvm install %s && nvm use %s\n", target_version, target_version);
            fprintf(stderr, "\n");
        }
    } else if (!target_version && found_version) {
        // No embedded version in target binary. This happens when:
        // 1. Fresh node-smol download (SMOL_CONFIG not yet injected)
        // 2. Plain Node.js binary (no SMOL_CONFIG section)
        // 3. Cross-platform build where target can't be executed
        //
        // For code cache/snapshot: V8 bytecode is PLATFORM-SPECIFIC, not just version-specific.
        // Even with matching versions, code cache from darwin-arm64 won't work on win32-x64.
        // The blob MUST be generated by the same Node.js binary that will execute it.
        if (config_opts.has_code_cache || config_opts.has_snapshot) {
            fprintf(stderr, "\n");
            fprintf(stderr, "⚠️  Cannot verify target version for code cache generation\n");
            fprintf(stderr, "   Host Node.js: %s (%s-%s)\n", found_version, HOST_PLATFORM, HOST_ARCH);
            fprintf(stderr, "   Target binary: %s (version unknown)\n", target_platform);
            fprintf(stderr, "\n");
            fprintf(stderr, "   V8 bytecode/snapshots are version and platform-specific.\n");
            fprintf(stderr, "   Code cache may not work if target Node.js version differs.\n");
            fprintf(stderr, "\n");
            fprintf(stderr, "   Generating blob anyway...\n");
            fprintf(stderr, "\n");
        } else {
            // Safe: plain JS blob is version-agnostic
            printf("Generating SEA blob with Node.js %s (plain JS)\n", found_version);
        }
    } else if (!found_version) {
        fprintf(stderr, "⚠️  Warning: Could not determine Node.js version\n");
        fprintf(stderr, "   Binary: %s\n", node_binary);
        fprintf(stderr, "   Continuing anyway...\n\n");
    }

    // Clean up version strings
    if (target_version) {
        free(target_version);
    }
    if (found_version) {
        free(found_version);
    }

    if (!node_binary) {
        fprintf(stderr, "Error: Failed to determine node binary path\n");
        return NULL;
    }

    // Validate config_path doesn't contain dangerous patterns
    if (!config_path || strlen(config_path) == 0) {
        fprintf(stderr, "Error: Config path is empty\n");
        CLEANUP_AND_RETURN_NULL();
    }

    // Check for path traversal attempts
    if (strstr(config_path, "..") != NULL) {
        fprintf(stderr, "Error: Path traversal detected in config path\n");
        CLEANUP_AND_RETURN_NULL();
    }

    // Verify file exists and is readable
    struct stat st;
    if (stat(config_path, &st) != 0) {
        fprintf(stderr, "Error: Config file not found: %s\n", config_path);
        CLEANUP_AND_RETURN_NULL();
    }

    // Verify it's a regular file (not symlink, device, etc)
    if (!S_ISREG(st.st_mode)) {
        fprintf(stderr, "Error: Config path is not a regular file: %s\n", config_path);
        CLEANUP_AND_RETURN_NULL();
    }

    printf("Detected SEA config file: %s\n", config_path);

    /* Use cached config_opts from earlier parsing (avoids redundant file read) */
    if (config_opts.parsed && !config_opts.has_code_cache) {
        fprintf(stderr, "\n");
        fprintf(stderr, "⚠️  Performance Warning: useCodeCache not enabled\n");
        fprintf(stderr, "   Setting 'useCodeCache: true' provides ~13%% faster startup (~22ms)\n");
        fprintf(stderr, "   Trade-off: +2-3 MB binary size\n");
        fprintf(stderr, "   Recommended for production builds where startup speed matters\n");
        fprintf(stderr, "\n");
        fprintf(stderr, "   Add to %s:\n", config_path);
        fprintf(stderr, "   {\n");
        fprintf(stderr, "     \"useCodeCache\": true,\n");
        fprintf(stderr, "     ...\n");
        fprintf(stderr, "   }\n");
        fprintf(stderr, "\n");
    }

    printf("Generating SEA blob using: %s --experimental-sea-config %s\n",
           node_binary, config_path);

#ifdef _WIN32
    // Windows: use _spawnvp and _cwait
    char *argv[] = {
        (char*)node_binary,
        (char*)"--experimental-sea-config",
        (char*)config_path,
        NULL
    };

    intptr_t pid = _spawnvp(_P_NOWAIT, node_binary, (const char* const*)argv);
    if (pid == -1) {
        fprintf(stderr, "Error: Failed to spawn process\n");
        CLEANUP_AND_RETURN_NULL();
    }

    int status;
    if (_cwait(&status, pid, 0) == -1) {
        fprintf(stderr, "Error: Failed to wait for process\n");
        CLEANUP_AND_RETURN_NULL();
    }

    if (status != 0) {
        fprintf(stderr, "Error: node --experimental-sea-config failed with exit code %d\n", status);
        CLEANUP_AND_RETURN_NULL();
    }
#else
    // Unix: use fork and exec
    pid_t pid = fork();
    if (pid == -1) {
        fprintf(stderr, "Error: Failed to fork process\n");
        CLEANUP_AND_RETURN_NULL();
    }

    if (pid == 0) {
        // Child process: change to config directory, then run node
        // Extract directory and filename from config_path
        char config_dir[PATH_MAX];
        const char *config_filename = config_path;
        const char *last_slash = strrchr(config_path, '/');
        if (last_slash != NULL) {
            size_t dir_len = last_slash - config_path;
            if (dir_len > 0 && dir_len < sizeof(config_dir)) {
                memcpy(config_dir, config_path, dir_len);
                config_dir[dir_len] = '\0';

                // Change to config directory so relative paths in config work
                if (chdir(config_dir) != 0) {
                    fprintf(stderr, "Error: Failed to change to config directory %s: %s\n",
                            config_dir, strerror(errno));
                    _exit(1);
                }

                // Use just the filename after changing directory
                config_filename = last_slash + 1;
            }
        }

        char *argv[] = {
            (char*)node_binary,
            (char*)"--experimental-sea-config",
            (char*)config_filename,
            NULL
        };
        // Use execv for absolute paths, execvp for PATH lookup (like "node")
        if (node_binary[0] == '/') {
            execv(node_binary, argv);
        } else {
            execvp(node_binary, argv);
        }
        // If exec returns, it failed - print error and exit
        fprintf(stderr, "Error: exec failed for %s: %s\n", node_binary, strerror(errno));
        _exit(1);
    }

    // Parent: wait for child
    int status;
    pid_t result;
    /* Retry waitpid on EINTR (interrupted by signal) */
    do {
        result = waitpid(pid, &status, 0);
    } while (result == -1 && errno == EINTR);

    if (result == -1) {
        fprintf(stderr, "Error: waitpid failed: %s\n", strerror(errno));
        CLEANUP_AND_RETURN_NULL();
    }

    if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) {
        int exit_code = WIFEXITED(status) ? WEXITSTATUS(status) : -1;
        fprintf(stderr, "Error: node --experimental-sea-config failed (exit code: %d)\n", exit_code);
        if (WIFSIGNALED(status)) {
            fprintf(stderr, "Process terminated by signal: %d\n", WTERMSIG(status));
        }
        CLEANUP_AND_RETURN_NULL();
    }
#endif

    // Free node_binary
    free(node_binary);
    node_binary = NULL;

    // Parse sea-config.json using cJSON
    sea_config_t *config = parse_sea_config(config_path);
    if (!config) {
        fprintf(stderr, "Error: Failed to parse sea-config.json\n");
        return NULL;
    }

    // Construct full path to blob file (config directory + output filename)
    // The blob is written to the same directory as the config file
    char *blob_path = NULL;
    const char *last_slash = strrchr(config_path, '/');
#ifdef _WIN32
    const char *last_bsep = strrchr(config_path, '\\');
    if (last_bsep && (!last_slash || last_bsep > last_slash)) {
        last_slash = last_bsep;
    }
#endif
#ifdef _WIN32
    int is_absolute = (config->output[0] == '/' || config->output[0] == '\\' ||
                       (config->output[0] != '\0' && config->output[1] == ':'));
#else
    int is_absolute = (config->output[0] == '/');
#endif
    if (last_slash != NULL && !is_absolute) {
        // Relative output path - prepend config directory
        size_t dir_len = last_slash - config_path;
        size_t blob_len = strlen(config->output);
        blob_path = (char*)malloc(dir_len + 1 + blob_len + 1);  // dir + '/' + filename + '\0'
        if (blob_path) {
            memcpy(blob_path, config_path, dir_len);
            blob_path[dir_len] = '/';
            memcpy(blob_path + dir_len + 1, config->output, blob_len);
            blob_path[dir_len + 1 + blob_len] = '\0';
        }
    } else {
        // Absolute output path or no directory in config_path - use as-is
        blob_path = strdup(config->output);
    }

    free_sea_config(config);

    if (!blob_path) {
        fprintf(stderr, "Error: Failed to allocate memory for blob path\n");
        return NULL;
    }

    // Verify the blob file was created - open directly instead of stat to avoid TOCTOU
    FILE *verify_fp = fopen(blob_path, "rb");
    if (!verify_fp) {
        fprintf(stderr, "Error: Generated blob file not found: %s\n", blob_path);
        free(blob_path);
        return NULL;
    }
    fclose(verify_fp);

    printf("✓ Generated SEA blob: %s\n", blob_path);

    // Clean up macro definition
    #undef CLEANUP_AND_RETURN_NULL
    return blob_path;
}

static void print_usage(const char *program) {
    printf("binject - Pure C alternative to postject\n\n");
    printf("Usage:\n");
    printf("  %s inject -e <executable> -o <output> [--sea <path>] [--vfs <path>|--vfs-on-disk <path>|--vfs-in-memory <path>|--vfs-compat] [--skip-repack]\n", program);
    printf("  %s blob <sea-config.json>\n", program);
    printf("  %s list <executable>\n", program);
    printf("  %s extract -e <executable> [--vfs|--sea] -o <output>\n", program);
    printf("  %s verify -e <executable> [--vfs|--sea]\n", program);
    printf("  %s --help\n", program);
    printf("  %s --version\n\n", program);
    printf("Commands:\n");
    printf("  inject            Inject a resource into an executable\n");
    printf("  blob              Generate SEA blob from sea-config.json (does not inject)\n");
    printf("  list              List all embedded resources\n");
    printf("  extract           Extract a resource from an executable\n");
    printf("  verify            Verify the integrity of a resource\n\n");
    printf("Options:\n");
    printf("  -o, --output <path>           Output file path\n");
    printf("  -e, --executable <path>       Input executable path\n");
    printf("  --vfs <path>                  Inject VFS to NODE_SEA/__SMOL_VFS_BLOB (extracts to disk at runtime)\n");
    printf("                                Accepts: directory, .tar.gz, .tgz, or .tar (auto-compressed)\n");
    printf("                                Note: VFS can also be configured in sea-config.json (smol.vfs section)\n");
    printf("  --vfs-on-disk <path>          Alias for --vfs\n");
    printf("  --vfs-in-memory <path>        Inject VFS and keep in memory at runtime (no extraction)\n");
    printf("  --vfs-compat                  Enable VFS support without bundling files (compatibility mode)\n");
    printf("  --sea <path>                  Inject SEA blob to NODE_SEA/__NODE_SEA_BLOB\n");
    printf("                                If path ends in .json, automatically embeds smol config + VFS from 'smol' section\n");
    printf("  --skip-repack                 Skip SMOL stub auto-detection and repacking\n");
    printf("                                (SMOL stubs with __PRESSED_DATA are auto-detected unless this flag is used)\n");
    printf("  -h, --help                    Show this help message\n");
    printf("  -v, --version                 Show version information\n\n");
    printf("Notes:\n");
    printf("  VFS Configuration Priority:\n");
    printf("    1. CLI flags (--vfs, --vfs-in-memory, --vfs-on-disk, --vfs-compat)\n");
    printf("    2. sea-config.json smol.vfs section (if CLI flags not provided)\n");
    printf("  CLI flags always take precedence over sea-config.json settings.\n");
}

int main(int argc, char *argv[]) {
    DEBUG_INIT("binject");

    if (argc < 2) {
        print_usage(argv[0]);
        return BINJECT_ERROR_INVALID_ARGS;
    }

    const char *command = argv[1];

    if (strcmp(command, "--version") == 0 || strcmp(command, "-v") == 0) {
        printf("binject %s\n", VERSION);
        return BINJECT_OK;
    }

    if (strcmp(command, "--help") == 0 || strcmp(command, "-h") == 0) {
        print_usage(argv[0]);
        return BINJECT_OK;
    }

    if (strcmp(command, "inject") == 0) {
        const char *executable = NULL;
        const char *output = NULL;
        const char *sea_resource = NULL;
        const char *vfs_resource = NULL;
        int vfs_in_memory = 0;  // Default: extract VFS to disk at runtime
        int skip_repack = 0; // Default: repack compressed stubs

        for (int i = 2; i < argc; i++) {
            if (strcmp(argv[i], "-e") == 0 || strcmp(argv[i], "--executable") == 0) {
                if (i + 1 < argc) executable = argv[++i];
            } else if (strcmp(argv[i], "-o") == 0 || strcmp(argv[i], "--output") == 0) {
                if (i + 1 < argc) output = argv[++i];
            } else if (strcmp(argv[i], "--vfs") == 0 || strcmp(argv[i], "--vfs-on-disk") == 0) {
                if (i + 1 < argc) vfs_resource = argv[++i];
            } else if (strcmp(argv[i], "--vfs-in-memory") == 0) {
                if (i + 1 < argc) vfs_resource = argv[++i];
                vfs_in_memory = 1;
            } else if (strcmp(argv[i], "--vfs-compat") == 0) {
                vfs_resource = "";  // Empty string marker for VFS compatibility mode
            } else if (strcmp(argv[i], "--sea") == 0) {
                if (i + 1 < argc) sea_resource = argv[++i];
            } else if (strcmp(argv[i], "--skip-repack") == 0) {
                skip_repack = 1;
            }
        }

        if (!executable || !output || (!sea_resource && !vfs_resource)) {
            fprintf(stderr, "Error: inject requires --executable, --output, and at least one of --sea <path> or --vfs <path>\n");
            return BINJECT_ERROR_INVALID_ARGS;
        }

        if (vfs_resource && !sea_resource) {
            fprintf(stderr, "Error: --vfs requires --sea to be specified\n");
            fprintf(stderr, "VFS (Virtual File System) must be injected alongside a SEA (Single Executable Application) blob\n");
            return BINJECT_ERROR_INVALID_ARGS;
        }

        // Check if SEA resource is a JSON config file
        // If so, generate the blob using node --experimental-sea-config and parse smol + VFS config
        char *generated_blob = NULL;
        uint8_t *smol_config_binary = NULL;
        uint8_t *vfs_config_binary = NULL;  // VFS config for embedding (108 bytes, SVFG format)
        char *temp_vfs_archive = NULL;  // Track temporary VFS archive (must be deleted)
        int cli_vfs_specified = (vfs_resource != NULL);  // Track if CLI specified VFS
        const char *vfs_mode_for_config = "on-disk";  // Track VFS mode for config generation

        if (sea_resource && is_json_file(sea_resource)) {
            // Parse sea-config.json to extract smol config and VFS config
            sea_config_t *config = parse_sea_config(sea_resource);
            if (config) {
                // Parse smol.update configuration from JSON to struct.
                smol_update_config_t smol_update_config;
                if (parse_smol_update_config(config->smol, &smol_update_config) == 0) {
                    // Preserve nodeVersion from original stub if not specified in config.
                    // This ensures the repacked stub has correct version for code cache matching.
                    if (!smol_update_config.node_version || strlen(smol_update_config.node_version) == 0) {
                        char *extracted_node_version = smol_extract_node_version_fast(executable);
                        if (extracted_node_version) {
                            printf("✓ Preserving nodeVersion from stub: %s\n", extracted_node_version);
                            free((void*)smol_update_config.node_version);
                            smol_update_config.node_version = extracted_node_version;
                        }
                    }
                    // Serialize smol config to binary (1192 bytes, SMFG v2).
                    smol_config_binary = serialize_smol_config(&smol_update_config);
                }
                smol_config_free(&smol_update_config);

                // Process VFS config (priority 2: only if CLI flags not provided)
                if (!cli_vfs_specified && config->vfs) {
                    printf("VFS: Using configuration from sea-config.json\n");

                    // Handle compat mode
                    if (strcmp(config->vfs->mode, "compat") == 0) {
                        printf("VFS: compat mode (API compatibility, no files embedded)\n");
                        vfs_resource = "";  // Empty string marker for compat mode
                        vfs_mode_for_config = "compat";
                    } else {
                        // Resolve source path (relative to sea-config.json directory)
                        char *resolved_source = resolve_relative_path(sea_resource, config->vfs->source);
                        if (!resolved_source) {
                            fprintf(stderr, "Error: Failed to resolve VFS source path\n");
                            free_sea_config(config);
                            if (smol_config_binary) free(smol_config_binary);
                            return BINJECT_ERROR;
                        }

                        // Detect source type
                        vfs_source_type_t source_type = detect_vfs_source_type(resolved_source);
                        if (source_type == VFS_SOURCE_NOT_FOUND) {
                            // Source doesn't exist - skip VFS gracefully.
                            printf("VFS: Source not found '%s', skipping VFS\n", resolved_source);
                            free(resolved_source);
                            resolved_source = NULL;
                            // Continue without VFS.
                        } else if (source_type == VFS_SOURCE_ERROR) {
                            fprintf(stderr, "Error: Invalid VFS source: %s\n", resolved_source);
                            free(resolved_source);
                            free_sea_config(config);
                            if (smol_config_binary) free(smol_config_binary);
                            return BINJECT_ERROR;
                        }

                        // Only process VFS if source was found and valid.
                        if (resolved_source != NULL) {
                            if (source_type == VFS_SOURCE_DIR) {
                                // Directory - create TAR.GZ with gzip level 9
                                printf("VFS: Creating archive from directory '%s' (gzip level 9)\n", resolved_source);
                                temp_vfs_archive = create_vfs_archive_from_dir(resolved_source);
                                if (!temp_vfs_archive) {
                                    fprintf(stderr, "Error: Failed to create VFS archive\n");
                                    free(resolved_source);
                                    free_sea_config(config);
                                    if (smol_config_binary) free(smol_config_binary);
                                    return BINJECT_ERROR;
                                }
                                vfs_resource = temp_vfs_archive;
                            } else if (source_type == VFS_SOURCE_TAR) {
                                // .tar file - compress with gzip level 9
                                printf("VFS: Compressing tar archive '%s' (gzip level 9)\n", resolved_source);
                                temp_vfs_archive = compress_tar_archive(resolved_source);
                                if (!temp_vfs_archive) {
                                    fprintf(stderr, "Error: Failed to compress VFS archive\n");
                                    free(resolved_source);
                                    free_sea_config(config);
                                    if (smol_config_binary) free(smol_config_binary);
                                    return BINJECT_ERROR;
                                }
                                vfs_resource = temp_vfs_archive;
                            } else {
                                // .tar.gz file - use as-is
                                printf("VFS: Using compressed archive '%s'\n", resolved_source);
                                // Note: Don't free resolved_source here - vfs_resource takes ownership
                                vfs_resource = resolved_source;
                                resolved_source = NULL;  // Prevent double-free
                            }

                            // Set mode flag
                            if (strcmp(config->vfs->mode, "in-memory") == 0) {
                                vfs_in_memory = 1;
                                vfs_mode_for_config = "in-memory";
                                printf("VFS: mode=in-memory (keep in RAM)\n");
                            } else {
                                // "on-disk" mode (default if not in-memory)
                                vfs_mode_for_config = "on-disk";
                                printf("VFS: mode=on-disk (extract to temp directory)\n");
                            }

                            // Only free resolved_source if it wasn't transferred to vfs_resource
                            if (resolved_source) {
                                free(resolved_source);
                            }
                        }
                    }
                } else if (cli_vfs_specified) {
                    printf("Note: CLI VFS flags override sea-config.json vfs section\n");
                }

                // Generate VFS config binary (108 bytes, SVFG format) if VFS is enabled
                if (vfs_resource) {
                    vfs_config_t runtime_vfs_config;
                    runtime_vfs_config.mode = vfs_mode_for_config;
                    runtime_vfs_config.prefix = "/snapshot";  // Default prefix

                    vfs_config_binary = serialize_vfs_config(&runtime_vfs_config);
                    if (!vfs_config_binary) {
                        fprintf(stderr, "Error: Failed to serialize VFS config\n");
                        free_sea_config(config);
                        if (smol_config_binary) free(smol_config_binary);
                        if (temp_vfs_archive) {
                            if (unlink(temp_vfs_archive) != 0 && errno != ENOENT) {
                                fprintf(stderr, "Warning: Failed to delete temporary file %s: %s\n",
                                        temp_vfs_archive, strerror(errno));
                            }
                            free(temp_vfs_archive);
                        }
                        return BINJECT_ERROR;
                    }
                }

                free_sea_config(config);
            }

            // Generate SEA blob
            generated_blob = generate_sea_blob_from_config(sea_resource, executable);
            if (!generated_blob) {
                fprintf(stderr, "Error: Failed to generate SEA blob from config\n");
                if (smol_config_binary) free(smol_config_binary);
                if (vfs_config_binary) free(vfs_config_binary);
                if (temp_vfs_archive) {
                    if (unlink(temp_vfs_archive) != 0 && errno != ENOENT) {
                        fprintf(stderr, "Warning: Failed to delete temporary file %s: %s\n",
                                temp_vfs_archive, strerror(errno));
                    }
                    free(temp_vfs_archive);
                }
                return BINJECT_ERROR;
            }
            sea_resource = generated_blob;  // Use generated blob instead
        }

        // Generate VFS config if VFS is being injected but config wasn't generated yet
        // (happens when using --vfs command-line flag without sea-config.json)
        if (vfs_resource && !vfs_config_binary) {
            vfs_config_t runtime_vfs_config;
            runtime_vfs_config.mode = vfs_mode_for_config;
            runtime_vfs_config.prefix = "/snapshot";  // Default prefix

            vfs_config_binary = serialize_vfs_config(&runtime_vfs_config);
            if (!vfs_config_binary) {
                fprintf(stderr, "Error: Failed to serialize VFS config\n");
                if (generated_blob) free(generated_blob);
                if (smol_config_binary) free(smol_config_binary);
                if (temp_vfs_archive) {
                    if (unlink(temp_vfs_archive) != 0 && errno != ENOENT) {
                        fprintf(stderr, "Warning: Failed to delete temporary file %s: %s\n",
                                temp_vfs_archive, strerror(errno));
                    }
                    free(temp_vfs_archive);
                }
                return BINJECT_ERROR;
            }
        }

        int result = binject_batch(executable, output, sea_resource, vfs_resource, vfs_in_memory, skip_repack, vfs_config_binary);

        // Clean up generated resources
        if (generated_blob) {
            free(generated_blob);
        }
        if (smol_config_binary) {
            free(smol_config_binary);
        }
        if (vfs_config_binary) {
            free(vfs_config_binary);
        }
        if (temp_vfs_archive) {
            // Delete temporary archive file
            if (unlink(temp_vfs_archive) != 0 && errno != ENOENT) {
                fprintf(stderr, "Warning: Failed to delete temporary file %s: %s\n",
                        temp_vfs_archive, strerror(errno));
            }
            free(temp_vfs_archive);
        }

        return result;
    }

    if (strcmp(command, "list") == 0) {
        if (argc < 3) {
            fprintf(stderr, "Error: list requires an executable path\n");
            return BINJECT_ERROR_INVALID_ARGS;
        }
        return binject_list(argv[2]);
    }

    if (strcmp(command, "extract") == 0) {
        const char *executable = NULL;
        const char *section = NULL;
        const char *output = NULL;

        for (int i = 2; i < argc; i++) {
            if (strcmp(argv[i], "-e") == 0 || strcmp(argv[i], "--executable") == 0) {
                if (i + 1 < argc) executable = argv[++i];
            } else if (strcmp(argv[i], "--vfs") == 0) {
                section = "vfs";
            } else if (strcmp(argv[i], "--sea") == 0) {
                section = "sea";
            } else if (strcmp(argv[i], "-o") == 0 || strcmp(argv[i], "--output") == 0) {
                if (i + 1 < argc) output = argv[++i];
            }
        }

        if (!executable || !section || !output) {
            fprintf(stderr, "Error: extract requires --executable, either --vfs or --sea, and --output\n");
            return BINJECT_ERROR_INVALID_ARGS;
        }

        return binject_extract(executable, section, output);
    }

    if (strcmp(command, "verify") == 0) {
        const char *executable = NULL;
        const char *section = NULL;

        for (int i = 2; i < argc; i++) {
            if (strcmp(argv[i], "-e") == 0 || strcmp(argv[i], "--executable") == 0) {
                if (i + 1 < argc) executable = argv[++i];
            } else if (strcmp(argv[i], "--vfs") == 0) {
                section = "vfs";
            } else if (strcmp(argv[i], "--sea") == 0) {
                section = "sea";
            }
        }

        if (!executable || !section) {
            fprintf(stderr, "Error: verify requires --executable and either --vfs or --sea\n");
            return BINJECT_ERROR_INVALID_ARGS;
        }

        return binject_verify(executable, section);
    }

    if (strcmp(command, "blob") == 0) {
        // Generate SEA blob from sea-config.json (does not inject into binary)
        // Usage: binject blob <sea-config.json>

        if (argc < 3) {
            fprintf(stderr, "Error: blob command requires a sea-config.json path\n");
            fprintf(stderr, "Usage: %s blob <sea-config.json>\n", argv[0]);
            return BINJECT_ERROR_INVALID_ARGS;
        }

        const char *config_path = argv[2];

        // Validate config file exists
        if (!is_json_file(config_path)) {
            fprintf(stderr, "Error: Config file must be a JSON file (*.json): %s\n", config_path);
            return BINJECT_ERROR_INVALID_ARGS;
        }

        // Use a dummy executable path (required by generate_sea_blob_from_config for version extraction)
        // Since we don't have a target binary yet, use the host node
        char *node_binary = find_system_node_binary();
        if (!node_binary) {
            fprintf(stderr, "Error: Node.js not found on system. Blob generation requires Node.js.\n");
            return BINJECT_ERROR;
        }

        // Generate the blob
        char *blob_path = generate_sea_blob_from_config(config_path, node_binary);
        free(node_binary);

        if (!blob_path) {
            fprintf(stderr, "Error: Failed to generate SEA blob\n");
            return BINJECT_ERROR;
        }

        printf("✓ SEA blob generated: %s\n", blob_path);
        printf("  To inject into a binary: binject inject -e <binary> -o <output> --sea %s\n", blob_path);

        free(blob_path);
        return BINJECT_OK;
    }

    fprintf(stderr, "Error: unknown command '%s'\n", command);
    print_usage(argv[0]);
    return BINJECT_ERROR_INVALID_ARGS;
}

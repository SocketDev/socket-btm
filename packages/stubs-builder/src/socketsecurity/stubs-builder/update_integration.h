/**
 * Update Integration for Self-Extracting Stubs
 *
 * Main integration point for update checking in stubs.
 * Provides a single function to check for updates before executing.
 *
 * Usage:
 *   #include "update_integration.h"
 *
 *   int main(int argc, char *argv[], char *envp[]) {
 *       update_config_t update_config;
 *       update_config_from_argv(&update_config, argc, argv);
 *
 *       // ... extract/cache binary ...
 *
 *       // Check for updates before executing.
 *       stub_check_for_updates(&update_config, base_dir, cache_key, "1.0.0", exe_path);
 *
 *       // ... execute binary ...
 *   }
 */

#ifndef UPDATE_INTEGRATION_H
#define UPDATE_INTEGRATION_H

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>

#include "update_config.h"
#include "update_metadata.h"
#include "update_checker.h"
#include "update_notifier.h"

/**
 * Filter out --update-config arguments from argv.
 * Modifies argc and argv in place to remove the update-config flag.
 * This prevents passing internal flags to the wrapped binary.
 */
static void stub_filter_update_args(int *argc, char *argv[]) {
    int new_argc = 0;
    int i = 0;

    while (i < *argc) {
        /* Check for --update-config=JSON format. */
        if (strncmp(argv[i], "--update-config=", 16) == 0) {
            /* Skip this argument. */
            i++;
            continue;
        }
        /* Check for --update-config JSON format. */
        if (strcmp(argv[i], "--update-config") == 0) {
            /* Skip this argument and the next. */
            i += 2;
            continue;
        }
        /* Keep this argument. */
        argv[new_argc++] = argv[i++];
    }

    *argc = new_argc;
    argv[new_argc] = NULL;
}

/**
 * Main stub update check function.
 * Called before executing the cached binary.
 *
 * @param config Update configuration (parsed from --update-config).
 * @param base_dir Cache base directory path.
 * @param cache_key 16-char hex cache key.
 * @param current_version Current stub version string.
 * @param binary_path Path to the binary for running update command.
 * @return 0 on success, non-zero on error (non-fatal, execution continues).
 */
static int stub_check_for_updates(const update_config_t *config,
                                   const char *base_dir,
                                   const char *cache_key,
                                   const char *current_version,
                                   const char *binary_path) {
    if (!config || !base_dir || !cache_key || !current_version || !binary_path) {
        return -1;
    }

    /* Skip if disabled. */
    if (!config->enabled) {
        return 0;
    }

    /* Skip based on environment (CI, non-TTY, skip_env, etc.). */
    if (update_config_should_skip(config)) {
        return 0;
    }

    /* Build metadata file path. */
    char metadata_path[1024];
    if (update_get_metadata_path(base_dir, cache_key, metadata_path, sizeof(metadata_path)) != 0) {
        return -1;
    }

    /* Read existing metadata. */
    update_metadata_t meta;
    if (update_read_metadata(metadata_path, &meta) != 0) {
        /* Metadata doesn't exist or can't be read - initialize. */
        memset(&meta, 0, sizeof(meta));
    }

    /* Check if update check is needed. */
    if (!update_should_check(config, &meta)) {
        /* Check interval not reached, but may still need to show notification. */
        if (meta.latest_known[0] != '\0' && update_should_notify(config, &meta)) {
            /* We know about a newer version - show notification. */
            update_check_result_t result;
            memset(&result, 0, sizeof(result));
            result.update_available = true;
            snprintf(result.current_version, UPDATE_CHECKER_MAX_VERSION_LEN, "%s", current_version);
            snprintf(result.latest_version, UPDATE_CHECKER_MAX_VERSION_LEN, "%s", meta.latest_known);

            if (compare_versions(meta.latest_known, current_version) > 0) {
                show_update_notification(config, &result);

                /* Handle prompt if enabled. */
                if (config->prompt) {
                    if (show_update_prompt(config, &result)) {
                        execute_update_command(config, binary_path);
                    }
                }

                /* Update notification timestamp. */
                meta.last_notification = update_get_current_time_ms();
                update_write_metadata(metadata_path, &meta);
            }
        }
        return 0;
    }

    /* Initialize curl. */
    update_checker_global_init();

    /* Check for updates. */
    update_check_result_t result;
    int check_result = check_for_updates(config, current_version, &result);

    /* Update metadata regardless of result. */
    meta.last_check = update_get_current_time_ms();
    if (check_result == 0 && result.update_available) {
        /* Store latest known version. */
        snprintf(meta.latest_known, sizeof(meta.latest_known), "%s", result.latest_version);
        meta.latest_known[sizeof(meta.latest_known) - 1] = '\0';
    }

    /* Handle notification if update available. */
    if (check_result == 0 && result.update_available) {
        if (update_should_notify(config, &meta)) {
            show_update_notification(config, &result);

            /* Handle prompt if enabled. */
            if (config->prompt) {
                if (show_update_prompt(config, &result)) {
                    execute_update_command(config, binary_path);
                }
            }

            meta.last_notification = update_get_current_time_ms();
        }
    }

    /* Save updated metadata. */
    update_write_metadata(metadata_path, &meta);

    /* Cleanup curl. */
    update_checker_global_cleanup();

    return 0;
}

#endif /* UPDATE_INTEGRATION_H */

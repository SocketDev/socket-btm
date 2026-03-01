/**
 * JSON Parser Implementation
 *
 * Uses cJSON to parse sea-config.json cleanly and safely.
 */

#ifndef _WIN32
#define _POSIX_C_SOURCE 200809L
#endif

#include "socketsecurity/binject/json_parser.h"
#include "socketsecurity/build-infra/posix_compat.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <inttypes.h>
#include <errno.h>

#define MAX_JSON_SIZE (1024 * 1024)  // 1MB max for config files.

// Forward declaration.
static vfs_config_t* parse_vfs_config_internal(cJSON *vfs);

/**
 * Read file contents into malloc'd buffer.
 */
static char* read_file_contents(const char *path, size_t *out_size) {
    FILE *fp = fopen(path, "rb");
    if (!fp) {
        fprintf(stderr, "Error: Cannot open file: %s\n", path);
        return NULL;
    }

    // Get file size.
    if (fseek(fp, 0, SEEK_END) != 0) {
        int saved_errno = errno;
        fprintf(stderr, "Error: Cannot seek to end of file: %s (errno: %d - %s)\n",
                path, saved_errno, strerror(saved_errno));
        fclose(fp);
        return NULL;
    }

    off_t size = ftello(fp);  /* Use ftello for large file support */
    if (size < 0) {
        int saved_errno = errno;
        fprintf(stderr, "Error: Cannot determine file size: %s (errno: %d - %s)\n",
                path, saved_errno, strerror(saved_errno));
        fclose(fp);
        return NULL;
    }

    if (size > MAX_JSON_SIZE) {
        fprintf(stderr, "Error: JSON file too large (%" PRId64 " bytes, max %d)\n", (int64_t)size, MAX_JSON_SIZE);
        fclose(fp);
        return NULL;
    }

    if (fseek(fp, 0, SEEK_SET) != 0) {
        int saved_errno = errno;
        fprintf(stderr, "Error: Cannot seek to start of file: %s (errno: %d - %s)\n",
                path, saved_errno, strerror(saved_errno));
        fclose(fp);
        return NULL;
    }

    // Validate size fits in size_t before casting (prevent truncation on 32-bit systems)
    if ((uint64_t)size > SIZE_MAX) {
        fprintf(stderr, "Error: File size exceeds SIZE_MAX on this platform\n");
        fclose(fp);
        return NULL;
    }

    // Allocate buffer and read.
    char *buffer = malloc(size + 1);
    if (!buffer) {
        fprintf(stderr, "Error: Cannot allocate memory for JSON\n");
        fclose(fp);
        return NULL;
    }

    size_t file_size = (size_t)size;  // Safe cast after validation
    size_t bytes_read = fread(buffer, 1, file_size, fp);
    fclose(fp);

    if (bytes_read != file_size) {
        fprintf(stderr, "Error: Failed to read complete file\n");
        free(buffer);
        return NULL;
    }

    buffer[size] = '\0';
    if (out_size) *out_size = size;
    return buffer;
}

/**
 * Parse sea-config.json file.
 */
sea_config_t* parse_sea_config(const char *config_path) {
    if (!config_path || strlen(config_path) == 0) {
        fprintf(stderr, "Error: Config path is empty\n");
        return NULL;
    }

    // Security: Check for path traversal.
    if (strstr(config_path, "..") != NULL) {
        fprintf(stderr, "Error: Path traversal detected in config path\n");
        return NULL;
    }

    // Verify file exists and is regular file.
    struct stat st;
    if (stat(config_path, &st) != 0) {
        fprintf(stderr, "Error: Config file not found: %s\n", config_path);
        return NULL;
    }

    if (!S_ISREG(st.st_mode)) {
        fprintf(stderr, "Error: Config path is not a regular file: %s\n", config_path);
        return NULL;
    }

    // Read file contents.
    size_t file_size;
    char *json_content = read_file_contents(config_path, &file_size);
    if (!json_content) {
        return NULL;
    }

    // Parse JSON.
    cJSON *root = cJSON_Parse(json_content);
    free(json_content);

    if (!root) {
        const char *error_ptr = cJSON_GetErrorPtr();
        if (error_ptr) {
            fprintf(stderr, "Error: JSON parse error before: %.20s\n", error_ptr);
        } else {
            fprintf(stderr, "Error: Failed to parse JSON\n");
        }
        return NULL;
    }

    // Allocate result structure.
    sea_config_t *config = calloc(1, sizeof(sea_config_t));
    if (!config) {
        fprintf(stderr, "Error: Cannot allocate memory for config\n");
        cJSON_Delete(root);
        return NULL;
    }

    // Extract "output" field (required).
    cJSON *output = cJSON_GetObjectItemCaseSensitive(root, "output");
    if (!output || !cJSON_IsString(output) || !output->valuestring) {
        fprintf(stderr, "Error: Missing or invalid 'output' field in sea-config.json\n");
        cJSON_Delete(root);
        free(config);
        return NULL;
    }

    config->output = strdup(output->valuestring);
    if (!config->output) {
        fprintf(stderr, "Error: Cannot allocate memory for output path\n");
        cJSON_Delete(root);
        free(config);
        return NULL;
    }

    // Extract "main" field (optional).
    cJSON *main = cJSON_GetObjectItemCaseSensitive(root, "main");
    if (main && cJSON_IsString(main) && main->valuestring) {
        config->main = strdup(main->valuestring);
        if (!config->main) {
            fprintf(stderr, "Error: Cannot allocate memory for main path\n");
            cJSON_Delete(root);
            free(config);
            return NULL;
        }
    }

    // Extract "smol" section (optional) - keep reference, don't detach.
    cJSON *smol = cJSON_GetObjectItemCaseSensitive(root, "smol");
    if (smol && cJSON_IsObject(smol)) {
        // Parse VFS config before detaching smol.
        config->vfs = parse_vfs_config(smol);

        // Detach from root so we can keep it after deleting root.
        config->smol = cJSON_DetachItemFromObject(root, "smol");
    }

    // Delete root JSON (we've extracted/detached what we need).
    cJSON_Delete(root);

    return config;
}

/**
 * Parse VFS configuration from smol.vfs (object or boolean).
 */
vfs_config_t* parse_vfs_config(cJSON *smol) {
    if (!smol || !cJSON_IsObject(smol)) {
        return NULL;
    }

    cJSON *vfs = cJSON_GetObjectItemCaseSensitive(smol, "vfs");
    if (!vfs) {
        return NULL;  // No VFS config.
    }

    // Handle "vfs": true (shorthand for defaults).
    if (cJSON_IsBool(vfs)) {
        if (!cJSON_IsTrue(vfs)) {
            return NULL;  // "vfs": false means no VFS.
        }
        // "vfs": true - use all defaults.
        // Create empty object to process with defaults.
        vfs = cJSON_CreateObject();
        if (!vfs) {
            fprintf(stderr, "Error: Cannot create VFS object\n");
            return NULL;
        }
        // Parse with defaults, then free the temporary object.
        vfs_config_t *config = parse_vfs_config_internal(vfs);
        cJSON_Delete(vfs);
        return config;
    }

    if (!cJSON_IsObject(vfs)) {
        fprintf(stderr, "Error: VFS config must be object or boolean\n");
        return NULL;
    }

    return parse_vfs_config_internal(vfs);
}

/**
 * Internal VFS config parser (assumes vfs is valid object).
 */
static vfs_config_t* parse_vfs_config_internal(cJSON *vfs) {

    vfs_config_t *config = calloc(1, sizeof(vfs_config_t));
    if (!config) {
        fprintf(stderr, "Error: Cannot allocate memory for VFS config\n");
        return NULL;
    }

    // Parse mode (optional, defaults to "in-memory").
    cJSON *mode = cJSON_GetObjectItemCaseSensitive(vfs, "mode");
    if (mode && cJSON_IsString(mode) && mode->valuestring) {
        config->mode = strdup(mode->valuestring);
        if (!config->mode) {
            fprintf(stderr, "Error: Cannot allocate memory for VFS mode\n");
            free(config);
            return NULL;
        }

        // Validate mode.
        if (strcmp(config->mode, "on-disk") != 0 &&
            strcmp(config->mode, "in-memory") != 0 &&
            strcmp(config->mode, "compat") != 0) {
            fprintf(stderr, "Error: Invalid VFS mode: %s (must be 'on-disk', 'in-memory', or 'compat')\n",
                    config->mode);
            free_vfs_config(config);
            return NULL;
        }
    } else {
        // Default to "in-memory".
        config->mode = strdup("in-memory");
        if (!config->mode) {
            fprintf(stderr, "Error: Cannot allocate memory for VFS mode\n");
            free(config);
            return NULL;
        }
    }

    // Parse source (optional, defaults to "node_modules").
    cJSON *source = cJSON_GetObjectItemCaseSensitive(vfs, "source");
    if (source && cJSON_IsString(source) && source->valuestring) {
        config->source = strdup(source->valuestring);
        if (!config->source) {
            fprintf(stderr, "Error: Cannot allocate memory for VFS source\n");
            free_vfs_config(config);
            return NULL;
        }
    } else {
        // Default to "node_modules" directory.
        config->source = strdup("node_modules");
        if (!config->source) {
            fprintf(stderr, "Error: Cannot allocate memory for VFS source\n");
            free_vfs_config(config);
            return NULL;
        }
    }

    return config;
}

/**
 * Free VFS config.
 */
void free_vfs_config(vfs_config_t *config) {
    if (!config) return;

    if (config->mode) free(config->mode);
    if (config->source) free(config->source);

    free(config);
}

/**
 * Free parsed config.
 */
void free_sea_config(sea_config_t *config) {
    if (!config) return;

    if (config->output) free(config->output);
    if (config->main) free(config->main);
    if (config->smol) cJSON_Delete(config->smol);
    if (config->vfs) free_vfs_config(config->vfs);

    free(config);
}

/**
 * Parse smol.update configuration into struct.
 */
int parse_smol_update_config(cJSON *smol, smol_update_config_t *config) {
    if (!config) {
        fprintf(stderr, "Error: config parameter is NULL\n");
        return -1;
    }

    // Initialize with defaults.
    smol_config_init(config);

    // If no smol section, use all defaults.
    if (!smol || !cJSON_IsObject(smol)) {
        return 0;
    }

    // Get the "update" sub-object.
    cJSON *update = cJSON_GetObjectItemCaseSensitive(smol, "update");
    if (!update || !cJSON_IsObject(update)) {
        return 0;  // No update config, use defaults.
    }

    // Extract string fields.
    cJSON *binname = cJSON_GetObjectItemCaseSensitive(update, "binname");
    if (binname && cJSON_IsString(binname) && binname->valuestring) {
        config->binname = binname->valuestring;
    }

    cJSON *command = cJSON_GetObjectItemCaseSensitive(update, "command");
    if (command && cJSON_IsString(command) && command->valuestring) {
        config->command = command->valuestring;
    }

    cJSON *url = cJSON_GetObjectItemCaseSensitive(update, "url");
    if (url && cJSON_IsString(url) && url->valuestring) {
        config->url = url->valuestring;
    }

    cJSON *tag = cJSON_GetObjectItemCaseSensitive(update, "tag");
    if (tag && cJSON_IsString(tag) && tag->valuestring) {
        config->tag = tag->valuestring;
    }

    cJSON *skip_env = cJSON_GetObjectItemCaseSensitive(update, "skipEnv");
    if (skip_env && cJSON_IsString(skip_env) && skip_env->valuestring) {
        config->skip_env = skip_env->valuestring;
    }

    cJSON *fake_argv_env = cJSON_GetObjectItemCaseSensitive(update, "fakeArgvEnv");
    if (fake_argv_env && cJSON_IsString(fake_argv_env) && fake_argv_env->valuestring) {
        config->fake_argv_env = fake_argv_env->valuestring;
    }

    // Extract boolean fields.
    cJSON *prompt = cJSON_GetObjectItemCaseSensitive(update, "prompt");
    if (prompt && cJSON_IsBool(prompt)) {
        config->prompt = cJSON_IsTrue(prompt);
    }

    // Extract promptDefault (string or char).
    cJSON *prompt_default = cJSON_GetObjectItemCaseSensitive(update, "promptDefault");
    if (prompt_default && cJSON_IsString(prompt_default) && prompt_default->valuestring) {
        const char *value = prompt_default->valuestring;
        if (strlen(value) > 0) {
            config->prompt_default = value[0];  // Take first char.
        }
    }

    // Extract numeric fields (milliseconds).
    cJSON *interval = cJSON_GetObjectItemCaseSensitive(update, "interval");
    if (interval && cJSON_IsNumber(interval)) {
        config->interval = (int64_t)interval->valuedouble;
    }

    cJSON *notify_interval = cJSON_GetObjectItemCaseSensitive(update, "notifyInterval");
    if (notify_interval && cJSON_IsNumber(notify_interval)) {
        config->notify_interval = (int64_t)notify_interval->valuedouble;
    }

    return 0;
}

/**
 * JSON Parser for binject
 *
 * Uses cJSON to parse sea-config.json and extract relevant fields.
 * Replaces manual string searching with proper JSON parsing.
 */

#ifndef JSON_PARSER_H
#define JSON_PARSER_H

#include "cJSON.h"
#include "socketsecurity/binject/smol_config.h"

/**
 * Parsed VFS configuration from smol.vfs section.
 */
typedef struct {
    char *mode;        // "on-disk", "in-memory", "compat".
    char *source;      // path to .tar, .tar.gz, or directory (NULL for compat mode).
} vfs_config_t;

/**
 * Parsed sea-config.json structure.
 */
typedef struct {
    char *output;           // "output" field - blob file path (required).
    char *main;             // "main" field - entry point script (optional).
    cJSON *smol;            // "smol" section - smol config object (optional, NOT owned).
    vfs_config_t *vfs;      // parsed VFS config (optional, owned).
} sea_config_t;

/**
 * Parse sea-config.json file and extract fields.
 *
 * @param config_path - Path to sea-config.json file.
 * @return Parsed config structure, or NULL on error. Caller must free with free_sea_config().
 */
sea_config_t* parse_sea_config(const char *config_path);

/**
 * Free parsed sea-config structure.
 *
 * @param config - Config structure to free.
 */
void free_sea_config(sea_config_t *config);

/**
 * Parse VFS configuration from smol.vfs (object or boolean).
 * Accepts: {"vfs": true}, {"vfs": {}}, or {"vfs": {mode: ..., source: ...}}.
 * Both true and {} use defaults: mode="in-memory", source="node_modules".
 *
 * @param smol - cJSON object containing smol section.
 * @return Parsed VFS config, or NULL if no VFS section or on error. Caller must free with free_vfs_config().
 */
vfs_config_t* parse_vfs_config(cJSON *smol);

/**
 * Free parsed VFS config structure.
 *
 * @param config - VFS config structure to free.
 */
void free_vfs_config(vfs_config_t *config);

/**
 * Parse smol.update configuration from cJSON object into struct.
 *
 * Extracts fields from smol.update JSON and fills smol_update_config_t struct.
 * Caller is responsible for managing string lifetimes (strings point into cJSON tree).
 *
 * @param smol - cJSON object containing smol section (optional, can be NULL).
 * @param config - Output struct to fill (must not be NULL, will be initialized with defaults).
 * @return 0 on success, -1 on error.
 */
int parse_smol_update_config(cJSON *smol, smol_update_config_t *config);

#endif // JSON_PARSER_H

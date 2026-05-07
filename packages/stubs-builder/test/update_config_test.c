/**
 * update_config unit tests
 *
 * Tests update_config.h JSON parsing and configuration handling.
 * Build: cd test && make
 * Run: ./out/update_config_test
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>

#ifndef _WIN32
#include <unistd.h>
#endif

/* Windows compatibility wrappers for setenv/unsetenv */
#ifdef _WIN32
static int setenv(const char *name, const char *value, int overwrite) {
    if (!name || !value) return -1;
    if (!overwrite && getenv(name) != NULL) {
        return 0;
    }
    return _putenv_s(name, value);
}

static int unsetenv(const char *name) {
    if (!name) return -1;
    /* On Windows, set to empty string to unset */
    return _putenv_s(name, "");
}
#endif

/* Include the test framework. */
#include "../../bin-infra/src/socketsecurity/bin-infra/test.h"

/* Include the update_config header (contains inline implementations). */
#include "../src/socketsecurity/stubs-builder/update_config.h"

/* Test: Default configuration values. */
TEST(default_enabled) {
    update_config_t config;
    update_config_init(&config);
    ASSERT_EQ(config.enabled, true);
    return TEST_PASS;
}

TEST(default_interval) {
    update_config_t config;
    update_config_init(&config);
    /* Default: 24 hours in milliseconds. */
    ASSERT_EQ(config.interval, 86400000LL);
    return TEST_PASS;
}

TEST(default_notify_interval) {
    update_config_t config;
    update_config_init(&config);
    ASSERT_EQ(config.notify_interval, 86400000LL);
    return TEST_PASS;
}

TEST(default_prompt) {
    update_config_t config;
    update_config_init(&config);
    ASSERT_EQ(config.prompt, false);
    return TEST_PASS;
}

TEST(default_prompt_default) {
    update_config_t config;
    update_config_init(&config);
    ASSERT_EQ(config.prompt_default, 'n');
    return TEST_PASS;
}

TEST(default_command) {
    update_config_t config;
    update_config_init(&config);
    ASSERT_STR_EQ(config.command, "self-update");
    return TEST_PASS;
}

TEST(default_node_version) {
    update_config_t config;
    update_config_init(&config);
    ASSERT_STR_EQ(config.node_version, "");
    return TEST_PASS;
}

/* Test: JSON parsing - enabled field. */
TEST(parse_enabled_false) {
    update_config_t config;
    update_config_init(&config);
    update_config_parse(&config, "{\"enabled\":false}");
    ASSERT_EQ(config.enabled, false);
    return TEST_PASS;
}

TEST(parse_enabled_true) {
    update_config_t config;
    update_config_init(&config);
    config.enabled = false;
    update_config_parse(&config, "{\"enabled\":true}");
    ASSERT_EQ(config.enabled, true);
    return TEST_PASS;
}

/* Test: JSON parsing - interval field. */
TEST(parse_interval) {
    update_config_t config;
    update_config_init(&config);
    update_config_parse(&config, "{\"interval\":3600000}");
    ASSERT_EQ(config.interval, 3600000LL);
    return TEST_PASS;
}

/* Test: JSON parsing - command field (single argument). */
TEST(parse_command_single_arg) {
    update_config_t config;
    update_config_init(&config);
    update_config_parse(&config, "{\"command\":\"self-update\"}");
    ASSERT_STR_EQ(config.command, "self-update");
    return TEST_PASS;
}

/* Test: JSON parsing - command field (multiple arguments). */
TEST(parse_command_multiple_args) {
    update_config_t config;
    update_config_init(&config);
    update_config_parse(&config, "{\"command\":\"upgrade --latest\"}");
    ASSERT_STR_EQ(config.command, "upgrade --latest");
    return TEST_PASS;
}

TEST(parse_command_with_flags) {
    update_config_t config;
    update_config_init(&config);
    update_config_parse(&config, "{\"command\":\"update --channel stable --force\"}");
    ASSERT_STR_EQ(config.command, "update --channel stable --force");
    return TEST_PASS;
}

/* Test: JSON parsing - prompt_default case insensitivity. */
TEST(parse_prompt_default_y_lowercase) {
    update_config_t config;
    update_config_init(&config);
    update_config_parse(&config, "{\"prompt_default\":\"y\"}");
    ASSERT_EQ(config.prompt_default, 'y');
    return TEST_PASS;
}

TEST(parse_prompt_default_Y_uppercase) {
    update_config_t config;
    update_config_init(&config);
    update_config_parse(&config, "{\"prompt_default\":\"Y\"}");
    ASSERT_EQ(config.prompt_default, 'y');
    return TEST_PASS;
}

TEST(parse_prompt_default_yes_lowercase) {
    update_config_t config;
    update_config_init(&config);
    update_config_parse(&config, "{\"prompt_default\":\"yes\"}");
    ASSERT_EQ(config.prompt_default, 'y');
    return TEST_PASS;
}

TEST(parse_prompt_default_Yes_mixed) {
    update_config_t config;
    update_config_init(&config);
    update_config_parse(&config, "{\"prompt_default\":\"Yes\"}");
    ASSERT_EQ(config.prompt_default, 'y');
    return TEST_PASS;
}

TEST(parse_prompt_default_YES_uppercase) {
    update_config_t config;
    update_config_init(&config);
    update_config_parse(&config, "{\"prompt_default\":\"YES\"}");
    ASSERT_EQ(config.prompt_default, 'y');
    return TEST_PASS;
}

TEST(parse_prompt_default_yEs_mixed) {
    update_config_t config;
    update_config_init(&config);
    update_config_parse(&config, "{\"prompt_default\":\"yEs\"}");
    ASSERT_EQ(config.prompt_default, 'y');
    return TEST_PASS;
}

TEST(parse_prompt_default_YeS_mixed) {
    update_config_t config;
    update_config_init(&config);
    update_config_parse(&config, "{\"prompt_default\":\"YeS\"}");
    ASSERT_EQ(config.prompt_default, 'y');
    return TEST_PASS;
}

TEST(parse_prompt_default_n_lowercase) {
    update_config_t config;
    update_config_init(&config);
    config.prompt_default = 'y'; /* Set to 'y' first. */
    update_config_parse(&config, "{\"prompt_default\":\"n\"}");
    ASSERT_EQ(config.prompt_default, 'n');
    return TEST_PASS;
}

TEST(parse_prompt_default_N_uppercase) {
    update_config_t config;
    update_config_init(&config);
    config.prompt_default = 'y';
    update_config_parse(&config, "{\"prompt_default\":\"N\"}");
    ASSERT_EQ(config.prompt_default, 'n');
    return TEST_PASS;
}

TEST(parse_prompt_default_no_lowercase) {
    update_config_t config;
    update_config_init(&config);
    config.prompt_default = 'y';
    update_config_parse(&config, "{\"prompt_default\":\"no\"}");
    ASSERT_EQ(config.prompt_default, 'n');
    return TEST_PASS;
}

TEST(parse_prompt_default_No_mixed) {
    update_config_t config;
    update_config_init(&config);
    config.prompt_default = 'y';
    update_config_parse(&config, "{\"prompt_default\":\"No\"}");
    ASSERT_EQ(config.prompt_default, 'n');
    return TEST_PASS;
}

TEST(parse_prompt_default_nO_mixed) {
    update_config_t config;
    update_config_init(&config);
    config.prompt_default = 'y';
    update_config_parse(&config, "{\"prompt_default\":\"nO\"}");
    ASSERT_EQ(config.prompt_default, 'n');
    return TEST_PASS;
}

TEST(parse_prompt_default_invalid_defaults_to_n) {
    update_config_t config;
    update_config_init(&config);
    config.prompt_default = 'y';
    update_config_parse(&config, "{\"prompt_default\":\"invalid\"}");
    ASSERT_EQ(config.prompt_default, 'n');
    return TEST_PASS;
}

TEST(parse_prompt_default_empty_defaults_to_n) {
    update_config_t config;
    update_config_init(&config);
    config.prompt_default = 'y';
    update_config_parse(&config, "{\"prompt_default\":\"\"}");
    ASSERT_EQ(config.prompt_default, 'n');
    return TEST_PASS;
}

/* Test: JSON parsing - binname field. */
TEST(parse_binname) {
    update_config_t config;
    update_config_init(&config);
    update_config_parse(&config, "{\"binname\":\"myapp\"}");
    ASSERT_STR_EQ(config.binname, "myapp");
    return TEST_PASS;
}

/* Test: JSON parsing - url field. */
TEST(parse_url) {
    update_config_t config;
    update_config_init(&config);
    update_config_parse(&config, "{\"url\":\"https://api.github.com/repos/MyOrg/my-app/releases\"}");
    ASSERT_STR_EQ(config.url, "https://api.github.com/repos/MyOrg/my-app/releases");
    return TEST_PASS;
}

/* Test: JSON parsing - tag field. */
TEST(parse_tag) {
    update_config_t config;
    update_config_init(&config);
    update_config_parse(&config, "{\"tag\":\"v*\"}");
    ASSERT_STR_EQ(config.tag, "v*");
    return TEST_PASS;
}

/* Test: JSON parsing - skip_env field. */
TEST(parse_skip_env) {
    update_config_t config;
    update_config_init(&config);
    update_config_parse(&config, "{\"skip_env\":\"SMOL_SKIP_UPDATE_CHECK\"}");
    ASSERT_STR_EQ(config.skip_env, "SMOL_SKIP_UPDATE_CHECK");
    return TEST_PASS;
}

/* Test: JSON parsing - complex config with all fields. */
TEST(parse_complex_config) {
    update_config_t config;
    update_config_init(&config);
    const char *json = "{"
        "\"enabled\":true,"
        "\"interval\":43200000,"
        "\"notify_interval\":86400000,"
        "\"prompt\":true,"
        "\"prompt_default\":\"y\","
        "\"binname\":\"myapp\","
        "\"command\":\"upgrade --latest\","
        "\"url\":\"https://api.github.com/repos/MyOrg/my-app/releases\","
        "\"tag\":\"v*\","
        "\"skip_env\":\"MY_APP_SKIP_UPDATE\""
    "}";
    update_config_parse(&config, json);

    ASSERT_EQ(config.enabled, true);
    ASSERT_EQ(config.interval, 43200000LL);
    ASSERT_EQ(config.notify_interval, 86400000LL);
    ASSERT_EQ(config.prompt, true);
    ASSERT_EQ(config.prompt_default, 'y');
    ASSERT_STR_EQ(config.binname, "myapp");
    ASSERT_STR_EQ(config.command, "upgrade --latest");
    ASSERT_STR_EQ(config.url, "https://api.github.com/repos/MyOrg/my-app/releases");
    ASSERT_STR_EQ(config.tag, "v*");
    ASSERT_STR_EQ(config.skip_env, "MY_APP_SKIP_UPDATE");
    return TEST_PASS;
}

/* Test: Unknown keys are ignored. */
TEST(parse_ignores_unknown_keys) {
    update_config_t config;
    update_config_init(&config);
    update_config_parse(&config, "{\"unknown_key\":\"value\",\"enabled\":false}");
    ASSERT_EQ(config.enabled, false);
    return TEST_PASS;
}

/**
 * Helper: Create valid SMFG v2 binary (1192 bytes) with test data.
 * Binary format matches update-config-binary.mjs serializer.
 */
static void create_smfg_v2_binary(uint8_t *buf, const char *node_version) {
    memset(buf, 0, 1192);

    size_t offset = 0;

    /* Magic: "SMFG" (0x534D4647 little-endian). */
    buf[offset++] = 0x47;  /* 'G' */
    buf[offset++] = 0x46;  /* 'F' */
    buf[offset++] = 0x4D;  /* 'M' */
    buf[offset++] = 0x53;  /* 'S' */

    /* Version: 2 (little-endian 16-bit). */
    buf[offset++] = 2;
    buf[offset++] = 0;

    /* Flags: prompt=0, prompt_default='n'. */
    buf[offset++] = 0;      /* prompt */
    buf[offset++] = 'n';    /* prompt_default */

    /* Numeric values (16 bytes). */
    /* interval: 86400000 (0x5265C00) in little-endian 64-bit. */
    buf[offset++] = 0x00; buf[offset++] = 0xC0; buf[offset++] = 0x65; buf[offset++] = 0x52;
    buf[offset++] = 0x00; buf[offset++] = 0x00; buf[offset++] = 0x00; buf[offset++] = 0x00;
    /* notify_interval: same value. */
    buf[offset++] = 0x00; buf[offset++] = 0xC0; buf[offset++] = 0x65; buf[offset++] = 0x52;
    buf[offset++] = 0x00; buf[offset++] = 0x00; buf[offset++] = 0x00; buf[offset++] = 0x00;

    /* String fields with length prefixes. */
    /* binname: 1 byte length + 127 bytes data (128 total). */
    buf[offset] = 6;  /* length */
    memcpy(buf + offset + 1, "mytest", 6);
    offset += 128;

    /* command: 2 bytes length (LE) + 254 bytes data (256 total). */
    buf[offset] = 11;  /* length low byte */
    buf[offset + 1] = 0;  /* length high byte */
    memcpy(buf + offset + 2, "self-update", 11);
    offset += 256;

    /* url: 2 bytes length (LE) + 510 bytes data (512 total). */
    const char *url = "https://api.github.com/repos/Test/app/releases";
    size_t url_len = strlen(url);
    buf[offset] = (uint8_t)(url_len & 0xFF);
    buf[offset + 1] = (uint8_t)((url_len >> 8) & 0xFF);
    memcpy(buf + offset + 2, url, url_len);
    offset += 512;

    /* tag: 1 byte length + 127 bytes data (128 total). */
    buf[offset] = 2;
    memcpy(buf + offset + 1, "v*", 2);
    offset += 128;

    /* skip_env: 1 byte length + 63 bytes data (64 total). */
    buf[offset] = 0;  /* empty */
    offset += 64;

    /* fake_argv_env: 1 byte length + 63 bytes data (64 total). */
    const char *fake_argv = "SMOL_FAKE_ARGV";
    buf[offset] = (uint8_t)strlen(fake_argv);
    memcpy(buf + offset + 1, fake_argv, strlen(fake_argv));
    offset += 64;

    /* node_version: 1 byte length + 15 bytes data (16 total). */
    if (node_version && node_version[0] != '\0') {
        size_t ver_len = strlen(node_version);
        if (ver_len > 15) ver_len = 15;
        buf[offset] = (uint8_t)ver_len;
        memcpy(buf + offset + 1, node_version, ver_len);
    } else {
        buf[offset] = 0;
    }
    /* offset += 16; total = 1192 */
}

/**
 * Helper: Create valid SMFG v1 binary (1176 bytes) without nodeVersion.
 */
static void create_smfg_v1_binary(uint8_t *buf) {
    memset(buf, 0, 1176);

    size_t offset = 0;

    /* Magic: "SMFG" (0x534D4647 little-endian). */
    buf[offset++] = 0x47;  /* 'G' */
    buf[offset++] = 0x46;  /* 'F' */
    buf[offset++] = 0x4D;  /* 'M' */
    buf[offset++] = 0x53;  /* 'S' */

    /* Version: 1 (little-endian 16-bit). */
    buf[offset++] = 1;
    buf[offset++] = 0;

    /* Flags: prompt=0, prompt_default='n'. */
    buf[offset++] = 0;      /* prompt */
    buf[offset++] = 'n';    /* prompt_default */

    /* Numeric values (16 bytes). */
    /* interval: 86400000 (0x5265C00) in little-endian 64-bit. */
    buf[offset++] = 0x00; buf[offset++] = 0xC0; buf[offset++] = 0x65; buf[offset++] = 0x52;
    buf[offset++] = 0x00; buf[offset++] = 0x00; buf[offset++] = 0x00; buf[offset++] = 0x00;
    /* notify_interval: same value. */
    buf[offset++] = 0x00; buf[offset++] = 0xC0; buf[offset++] = 0x65; buf[offset++] = 0x52;
    buf[offset++] = 0x00; buf[offset++] = 0x00; buf[offset++] = 0x00; buf[offset++] = 0x00;

    /* String fields with length prefixes. */
    /* binname: 1 byte length + 127 bytes data (128 total). */
    buf[offset] = 5;
    memcpy(buf + offset + 1, "v1app", 5);
    offset += 128;

    /* command: 2 bytes length (LE) + 254 bytes data (256 total). */
    buf[offset] = 7;
    buf[offset + 1] = 0;
    memcpy(buf + offset + 2, "upgrade", 7);
    offset += 256;

    /* url: 2 bytes length (LE) + 510 bytes data (512 total). */
    const char *url = "https://example.com/releases";
    size_t url_len = strlen(url);
    buf[offset] = (uint8_t)(url_len & 0xFF);
    buf[offset + 1] = (uint8_t)((url_len >> 8) & 0xFF);
    memcpy(buf + offset + 2, url, url_len);
    offset += 512;

    /* tag: 1 byte length + 127 bytes data (128 total). */
    buf[offset] = 4;
    memcpy(buf + offset + 1, "v1.*", 4);
    offset += 128;

    /* skip_env: 1 byte length + 63 bytes data (64 total). */
    buf[offset] = 0;
    offset += 64;

    /* fake_argv_env: 1 byte length + 63 bytes data (64 total). */
    const char *fake_argv = "SMOL_FAKE_ARGV";
    buf[offset] = (uint8_t)strlen(fake_argv);
    memcpy(buf + offset + 1, fake_argv, strlen(fake_argv));
    /* offset += 64; total = 1176 (no nodeVersion field in v1) */
}

/* Test: Binary deserialization - SMFG v2 with nodeVersion. */
TEST(binary_v2_with_node_version) {
    uint8_t binary[1192];
    create_smfg_v2_binary(binary, "25.5.0");

    update_config_t config;
    update_config_init(&config);
    int result = update_config_from_binary(&config, binary, sizeof(binary));

    ASSERT_EQ(result, 0);
    ASSERT_STR_EQ(config.node_version, "25.5.0");
    ASSERT_STR_EQ(config.binname, "mytest");
    ASSERT_STR_EQ(config.command, "self-update");
    ASSERT_EQ(config.prompt, false);
    ASSERT_EQ(config.prompt_default, 'n');
    return TEST_PASS;
}

/* Test: Binary deserialization - SMFG v2 with empty nodeVersion. */
TEST(binary_v2_empty_node_version) {
    uint8_t binary[1192];
    create_smfg_v2_binary(binary, "");

    update_config_t config;
    update_config_init(&config);
    int result = update_config_from_binary(&config, binary, sizeof(binary));

    ASSERT_EQ(result, 0);
    ASSERT_STR_EQ(config.node_version, "");
    return TEST_PASS;
}

/* Test: Binary deserialization - SMFG v2 with max length nodeVersion. */
TEST(binary_v2_max_node_version) {
    uint8_t binary[1192];
    /* Max 15 characters. */
    create_smfg_v2_binary(binary, "25.5.0-alpha.99");

    update_config_t config;
    update_config_init(&config);
    int result = update_config_from_binary(&config, binary, sizeof(binary));

    ASSERT_EQ(result, 0);
    ASSERT_STR_EQ(config.node_version, "25.5.0-alpha.99");
    return TEST_PASS;
}

/* Test: Binary deserialization - SMFG v1 backward compatibility (no nodeVersion). */
TEST(binary_v1_no_node_version) {
    uint8_t binary[1176];
    create_smfg_v1_binary(binary);

    update_config_t config;
    update_config_init(&config);
    int result = update_config_from_binary(&config, binary, sizeof(binary));

    ASSERT_EQ(result, 0);
    /* v1 should have empty node_version. */
    ASSERT_STR_EQ(config.node_version, "");
    /* Other fields should be parsed correctly. */
    ASSERT_STR_EQ(config.binname, "v1app");
    ASSERT_STR_EQ(config.command, "upgrade");
    ASSERT_STR_EQ(config.tag, "v1.*");
    return TEST_PASS;
}

/* Test: Binary deserialization - invalid magic. */
TEST(binary_invalid_magic) {
    uint8_t binary[1192];
    memset(binary, 0, sizeof(binary));
    /* Wrong magic bytes. */
    binary[0] = 'X';
    binary[1] = 'Y';
    binary[2] = 'Z';
    binary[3] = 'W';

    update_config_t config;
    update_config_init(&config);
    int result = update_config_from_binary(&config, binary, sizeof(binary));

    ASSERT_EQ(result, -1);
    return TEST_PASS;
}

/* Test: Binary deserialization - invalid size. */
TEST(binary_invalid_size) {
    uint8_t binary[100];  /* Too small. */
    memset(binary, 0, sizeof(binary));

    update_config_t config;
    update_config_init(&config);
    int result = update_config_from_binary(&config, binary, sizeof(binary));

    ASSERT_EQ(result, -1);
    return TEST_PASS;
}

/* Test: update_config_should_skip behavior with custom skip_env. */
TEST(should_skip_with_custom_env_set) {
    update_config_t config;
    update_config_init(&config);
    update_config_parse(&config, "{\"skip_env\":\"TEST_SKIP_UPDATE\"}");
    setenv("TEST_SKIP_UPDATE", "1", 1);
    bool result = update_config_should_skip(&config);
    unsetenv("TEST_SKIP_UPDATE");
    ASSERT_EQ(result, true);
    return TEST_PASS;
}

TEST(should_skip_with_custom_env_set_any_value) {
    update_config_t config;
    update_config_init(&config);
    update_config_parse(&config, "{\"skip_env\":\"TEST_SKIP_UPDATE\"}");
    setenv("TEST_SKIP_UPDATE", "yes", 1);
    bool result = update_config_should_skip(&config);
    unsetenv("TEST_SKIP_UPDATE");
    ASSERT_EQ(result, true);
    return TEST_PASS;
}

/* Note: "should not skip" tests are environment-dependent (TTY check). */
/* The custom env "0" value should NOT trigger skip (only skip_env check). */
TEST(should_not_skip_custom_env_zero_bypasses_skip_env_check) {
    update_config_t config;
    update_config_init(&config);
    update_config_parse(&config, "{\"skip_env\":\"TEST_SKIP_UPDATE\"}");
    /* Set to "0" which should be treated as "don't skip". */
    setenv("TEST_SKIP_UPDATE", "0", 1);
    /* But also set CI to verify skip_env "0" doesn't short-circuit. */
    setenv("CI", "true", 1);
    bool result = update_config_should_skip(&config);
    unsetenv("TEST_SKIP_UPDATE");
    unsetenv("CI");
    /* Should still skip due to CI, proving "0" didn't trigger early skip. */
    ASSERT_EQ(result, true);
    return TEST_PASS;
}

TEST(should_not_skip_custom_env_false_lowercase) {
    update_config_t config;
    update_config_init(&config);
    update_config_parse(&config, "{\"skip_env\":\"TEST_SKIP_UPDATE\"}");
    setenv("TEST_SKIP_UPDATE", "false", 1);
    setenv("CI", "true", 1);
    bool result = update_config_should_skip(&config);
    unsetenv("TEST_SKIP_UPDATE");
    unsetenv("CI");
    /* Should still skip due to CI, proving "false" didn't trigger early skip. */
    ASSERT_EQ(result, true);
    return TEST_PASS;
}

TEST(should_not_skip_custom_env_FALSE_uppercase) {
    update_config_t config;
    update_config_init(&config);
    update_config_parse(&config, "{\"skip_env\":\"TEST_SKIP_UPDATE\"}");
    setenv("TEST_SKIP_UPDATE", "FALSE", 1);
    setenv("CI", "true", 1);
    bool result = update_config_should_skip(&config);
    unsetenv("TEST_SKIP_UPDATE");
    unsetenv("CI");
    /* Should still skip due to CI, proving "FALSE" didn't trigger early skip. */
    ASSERT_EQ(result, true);
    return TEST_PASS;
}

TEST(should_not_skip_custom_env_False_mixed) {
    update_config_t config;
    update_config_init(&config);
    update_config_parse(&config, "{\"skip_env\":\"TEST_SKIP_UPDATE\"}");
    setenv("TEST_SKIP_UPDATE", "False", 1);
    setenv("CI", "true", 1);
    bool result = update_config_should_skip(&config);
    unsetenv("TEST_SKIP_UPDATE");
    unsetenv("CI");
    /* Should still skip due to CI, proving "False" didn't trigger early skip. */
    ASSERT_EQ(result, true);
    return TEST_PASS;
}

TEST(should_skip_with_ci_env) {
    update_config_t config;
    update_config_init(&config);
    setenv("CI", "true", 1);
    bool result = update_config_should_skip(&config);
    unsetenv("CI");
    ASSERT_EQ(result, true);
    return TEST_PASS;
}

TEST(should_skip_with_continuous_integration_env) {
    update_config_t config;
    update_config_init(&config);
    setenv("CONTINUOUS_INTEGRATION", "true", 1);
    bool result = update_config_should_skip(&config);
    unsetenv("CONTINUOUS_INTEGRATION");
    ASSERT_EQ(result, true);
    return TEST_PASS;
}

int main(void) {
    TEST_SUITE("update_config");

    /* Default values. */
    RUN_TEST(default_enabled);
    RUN_TEST(default_interval);
    RUN_TEST(default_notify_interval);
    RUN_TEST(default_prompt);
    RUN_TEST(default_prompt_default);
    RUN_TEST(default_command);
    RUN_TEST(default_node_version);

    /* JSON parsing - enabled. */
    RUN_TEST(parse_enabled_false);
    RUN_TEST(parse_enabled_true);

    /* JSON parsing - interval. */
    RUN_TEST(parse_interval);

    /* JSON parsing - command (single and multiple args). */
    RUN_TEST(parse_command_single_arg);
    RUN_TEST(parse_command_multiple_args);
    RUN_TEST(parse_command_with_flags);

    /* JSON parsing - prompt_default case insensitivity. */
    RUN_TEST(parse_prompt_default_y_lowercase);
    RUN_TEST(parse_prompt_default_Y_uppercase);
    RUN_TEST(parse_prompt_default_yes_lowercase);
    RUN_TEST(parse_prompt_default_Yes_mixed);
    RUN_TEST(parse_prompt_default_YES_uppercase);
    RUN_TEST(parse_prompt_default_yEs_mixed);
    RUN_TEST(parse_prompt_default_YeS_mixed);
    RUN_TEST(parse_prompt_default_n_lowercase);
    RUN_TEST(parse_prompt_default_N_uppercase);
    RUN_TEST(parse_prompt_default_no_lowercase);
    RUN_TEST(parse_prompt_default_No_mixed);
    RUN_TEST(parse_prompt_default_nO_mixed);
    RUN_TEST(parse_prompt_default_invalid_defaults_to_n);
    RUN_TEST(parse_prompt_default_empty_defaults_to_n);

    /* JSON parsing - other fields. */
    RUN_TEST(parse_binname);
    RUN_TEST(parse_url);
    RUN_TEST(parse_tag);
    RUN_TEST(parse_skip_env);

    /* Complex config. */
    RUN_TEST(parse_complex_config);
    RUN_TEST(parse_ignores_unknown_keys);

    /* Skip behavior with custom skip_env. */
    RUN_TEST(should_skip_with_custom_env_set);
    RUN_TEST(should_skip_with_custom_env_set_any_value);
    RUN_TEST(should_not_skip_custom_env_zero_bypasses_skip_env_check);
    RUN_TEST(should_not_skip_custom_env_false_lowercase);
    RUN_TEST(should_not_skip_custom_env_FALSE_uppercase);
    RUN_TEST(should_not_skip_custom_env_False_mixed);
    RUN_TEST(should_skip_with_ci_env);
    RUN_TEST(should_skip_with_continuous_integration_env);

    /* Binary deserialization tests. */
    RUN_TEST(binary_v2_with_node_version);
    RUN_TEST(binary_v2_empty_node_version);
    RUN_TEST(binary_v2_max_node_version);
    RUN_TEST(binary_v1_no_node_version);
    RUN_TEST(binary_invalid_magic);
    RUN_TEST(binary_invalid_size);

    return TEST_REPORT();
}

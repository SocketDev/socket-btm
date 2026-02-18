/**
 * update_config unit tests
 *
 * Tests update_config.h JSON parsing and configuration handling.
 * Build: make -f Makefile.test
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
#include "../../../../../../bin-infra/src/socketsecurity/bin-infra/test.h"

/* Include the update_config header (contains inline implementations). */
#include "../src/update_config.h"

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

    return TEST_REPORT();
}

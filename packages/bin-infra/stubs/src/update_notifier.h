/**
 * Update Notifier for Self-Extracting Stubs
 *
 * Handles displaying update notifications and interactive prompts.
 * Outputs to stderr to avoid interfering with stdout.
 *
 * Features:
 *   - Box-style notification display
 *   - Interactive y/n prompts
 *   - Default answer support
 *   - TTY detection
 *
 * Display format:
 *   ┌─────────────────────────────────────────────┐
 *   │  Update available: 1.0.0 → 1.1.0            │
 *   │  Run: socket update                         │
 *   └─────────────────────────────────────────────┘
 */

#ifndef UPDATE_NOTIFIER_H
#define UPDATE_NOTIFIER_H

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>

#if defined(_WIN32)
#include <io.h>
#include <conio.h>
#define isatty _isatty
#define fileno _fileno
#else
#include <unistd.h>
#include <termios.h>
#endif

#include "update_config.h"
#include "update_checker.h"

/* ANSI color codes. */
#define ANSI_RESET   "\033[0m"
#define ANSI_BOLD    "\033[1m"
#define ANSI_CYAN    "\033[36m"
#define ANSI_GREEN   "\033[32m"
#define ANSI_YELLOW  "\033[33m"
#define ANSI_GRAY    "\033[90m"

/* Box drawing characters (UTF-8). */
#define BOX_TOP_LEFT     "┌"
#define BOX_TOP_RIGHT    "┐"
#define BOX_BOTTOM_LEFT  "└"
#define BOX_BOTTOM_RIGHT "┘"
#define BOX_HORIZONTAL   "─"
#define BOX_VERTICAL     "│"

/* Simple ASCII fallback for non-UTF8 terminals. */
#define BOX_TOP_LEFT_ASCII     "+"
#define BOX_TOP_RIGHT_ASCII    "+"
#define BOX_BOTTOM_LEFT_ASCII  "+"
#define BOX_BOTTOM_RIGHT_ASCII "+"
#define BOX_HORIZONTAL_ASCII   "-"
#define BOX_VERTICAL_ASCII     "|"

/**
 * Check if stderr is a TTY.
 */
static bool is_tty(void) {
#if defined(_WIN32)
    return _isatty(_fileno(stderr)) != 0;
#else
    return isatty(fileno(stderr)) != 0;
#endif
}

/**
 * Check if terminal supports UTF-8.
 * Simple heuristic based on LANG/LC_ALL environment variables.
 */
static bool supports_utf8(void) {
    const char *lang = getenv("LANG");
    const char *lc_all = getenv("LC_ALL");

    if (lc_all && (strstr(lc_all, "UTF-8") || strstr(lc_all, "utf-8") || strstr(lc_all, "utf8"))) {
        return true;
    }
    if (lang && (strstr(lang, "UTF-8") || strstr(lang, "utf-8") || strstr(lang, "utf8"))) {
        return true;
    }

#if defined(_WIN32)
    /* Windows console may not support UTF-8 by default. */
    return false;
#else
    /* Default to true on Unix-like systems. */
    return true;
#endif
}

/**
 * Print a horizontal line for the box.
 */
static void print_box_line(int width, bool utf8, const char *left, const char *right,
                            const char *left_ascii, const char *right_ascii) {
    if (utf8) {
        fprintf(stderr, "%s", left);
        for (int i = 0; i < width; i++) {
            fprintf(stderr, "%s", BOX_HORIZONTAL);
        }
        fprintf(stderr, "%s\n", right);
    } else {
        fprintf(stderr, "%s", left_ascii);
        for (int i = 0; i < width; i++) {
            fprintf(stderr, "%s", BOX_HORIZONTAL_ASCII);
        }
        fprintf(stderr, "%s\n", right_ascii);
    }
}

/**
 * Print a content line with box borders.
 */
static void print_box_content(int width, bool utf8, const char *content) {
    int content_len = (int)strlen(content);
    int padding = width - content_len - 2; /* -2 for spaces on each side. */
    if (padding < 0) padding = 0;

    if (utf8) {
        fprintf(stderr, "%s  %s", BOX_VERTICAL, content);
    } else {
        fprintf(stderr, "%s  %s", BOX_VERTICAL_ASCII, content);
    }

    for (int i = 0; i < padding; i++) {
        fprintf(stderr, " ");
    }

    if (utf8) {
        fprintf(stderr, "  %s\n", BOX_VERTICAL);
    } else {
        fprintf(stderr, "  %s\n", BOX_VERTICAL_ASCII);
    }
}

/**
 * Display update notification.
 */
static void show_update_notification(const update_config_t *config,
                                      const update_check_result_t *result) {
    if (!config || !result || !result->update_available) return;

    bool utf8 = supports_utf8();
    bool tty = is_tty();
    int box_width = 45;

    /* Add newline before notification. */
    fprintf(stderr, "\n");

    /* Print top border. */
    print_box_line(box_width, utf8, BOX_TOP_LEFT, BOX_TOP_RIGHT,
                   BOX_TOP_LEFT_ASCII, BOX_TOP_RIGHT_ASCII);

    /* Print update message. */
    char msg[128];
    if (tty) {
        snprintf(msg, sizeof(msg), "%sUpdate available:%s %s%s%s → %s%s%s",
                 ANSI_BOLD, ANSI_RESET,
                 ANSI_GRAY, result->current_version, ANSI_RESET,
                 ANSI_GREEN, result->latest_version, ANSI_RESET);
    } else {
        snprintf(msg, sizeof(msg), "Update available: %s -> %s",
                 result->current_version, result->latest_version);
    }
    print_box_content(box_width, utf8, msg);

    /* Print command hint. */
    if (config->command[0] != '\0') {
        char cmd_msg[512];
        /* Build display command: "binname command" or just "command". */
        char display_cmd[384];
        if (config->binname[0] != '\0') {
            snprintf(display_cmd, sizeof(display_cmd), "%s %s",
                     config->binname, config->command);
        } else {
            snprintf(display_cmd, sizeof(display_cmd), "%s", config->command);
        }
        if (tty) {
            snprintf(cmd_msg, sizeof(cmd_msg), "Run: %s%s%s",
                     ANSI_CYAN, display_cmd, ANSI_RESET);
        } else {
            snprintf(cmd_msg, sizeof(cmd_msg), "Run: %s", display_cmd);
        }
        print_box_content(box_width, utf8, cmd_msg);
    }

    /* Print bottom border. */
    print_box_line(box_width, utf8, BOX_BOTTOM_LEFT, BOX_BOTTOM_RIGHT,
                   BOX_BOTTOM_LEFT_ASCII, BOX_BOTTOM_RIGHT_ASCII);

    fprintf(stderr, "\n");
}

/**
 * Read a single character from stdin (cross-platform).
 */
static int read_char(void) {
#if defined(_WIN32)
    return _getch();
#else
    struct termios old_termios, new_termios;
    int ch;

    /* Get current terminal settings. */
    if (tcgetattr(fileno(stdin), &old_termios) < 0) {
        return getchar();
    }

    /* Set terminal to raw mode. */
    new_termios = old_termios;
    new_termios.c_lflag &= ~(ICANON | ECHO);
    new_termios.c_cc[VMIN] = 1;
    new_termios.c_cc[VTIME] = 0;

    if (tcsetattr(fileno(stdin), TCSANOW, &new_termios) < 0) {
        return getchar();
    }

    /* Read character. */
    ch = getchar();

    /* Restore terminal settings. */
    tcsetattr(fileno(stdin), TCSANOW, &old_termios);

    return ch;
#endif
}

/**
 * Show interactive prompt and get user response.
 * Returns true for 'yes', false for 'no'.
 */
static bool show_update_prompt(const update_config_t *config,
                                const update_check_result_t *result) {
    if (!config || !result) return false;

    /* Can't prompt if not a TTY. */
    if (!is_tty()) {
        return config->prompt_default == 'y';
    }

    bool tty = is_tty();
    char default_str[16];
    if (config->prompt_default == 'y') {
        snprintf(default_str, sizeof(default_str), "[Y/n]");
    } else {
        snprintf(default_str, sizeof(default_str), "[y/N]");
    }

    /* Print prompt. */
    if (tty) {
        fprintf(stderr, "%sUpdate to %s?%s %s ",
                ANSI_BOLD, result->latest_version, ANSI_RESET, default_str);
    } else {
        fprintf(stderr, "Update to %s? %s ", result->latest_version, default_str);
    }
    fflush(stderr);

    /* Read response. */
    int ch = read_char();
    fprintf(stderr, "\n");

    /* Handle response. */
    if (ch == 'y' || ch == 'Y') {
        return true;
    }
    if (ch == 'n' || ch == 'N') {
        return false;
    }
    if (ch == '\n' || ch == '\r') {
        /* Use default. */
        return config->prompt_default == 'y';
    }

    /* Any other key uses default. */
    return config->prompt_default == 'y';
}

/**
 * Execute the update command.
 * Combines binary_path with config->command arguments.
 * Returns exit code from command.
 */
static int execute_update_command(const update_config_t *config, const char *binary_path) {
    if (!config || config->command[0] == '\0' || !binary_path) return -1;

    /* Build full command: "<binary_path>" <command_args> */
    char full_command[2048];
    int written = snprintf(full_command, sizeof(full_command), "\"%s\" %s",
                           binary_path, config->command);
    if (written < 0 || (size_t)written >= sizeof(full_command)) {
        return -1;
    }

    fprintf(stderr, "Running: %s\n", full_command);
    return system(full_command);
}

/**
 * Main update notification flow.
 * Checks for updates, displays notification, handles prompt if enabled.
 *
 * @param config Update configuration.
 * @param current_version Current installed version.
 * @param result Update check result structure.
 * @param binary_path Path to the current binary (for self-update command).
 * @return 0 if no update action needed, 1 if user requested update, -1 on error.
 */
static int handle_update_notification(const update_config_t *config,
                                       const char *current_version,
                                       update_check_result_t *result,
                                       const char *binary_path) {
    if (!config || !current_version || !result || !binary_path) return -1;

    /* Skip if disabled. */
    if (!config->enabled) return 0;

    /* Skip based on environment. */
    if (update_config_should_skip(config)) return 0;

    /* Check for updates. */
    if (check_for_updates(config, current_version, result) != 0) {
        /* Failed to check - silently continue. */
        return 0;
    }

    /* No update available. */
    if (!result->update_available) {
        return 0;
    }

    /* Show notification. */
    show_update_notification(config, result);

    /* Handle prompt if enabled. */
    if (config->prompt) {
        if (show_update_prompt(config, result)) {
            /* User wants to update - execute command. */
            int ret = execute_update_command(config, binary_path);
            return (ret == 0) ? 1 : -1;
        }
    }

    return 0;
}

#endif /* UPDATE_NOTIFIER_H */

/**
 * Lightweight C test framework - minunit style
 *
 * No external dependencies, simple assertions, colorized output.
 * Based on the minunit pattern.
 *
 * Usage:
 *   #include "test.h"
 *
 *   TEST(test_name) {
 *       ASSERT_EQ(1, 1);
 *       ASSERT_STR_EQ("hello", "hello");
 *       return TEST_PASS;
 *   }
 *
 *   int main() {
 *       TEST_SUITE("My Test Suite");
 *       RUN_TEST(test_name);
 *       return TEST_REPORT();
 *   }
 */

#ifndef TEST_H
#define TEST_H

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* ANSI color codes */
#define COLOR_RED     "\x1b[31m"
#define COLOR_GREEN   "\x1b[32m"
#define COLOR_YELLOW  "\x1b[33m"
#define COLOR_BLUE    "\x1b[34m"
#define COLOR_MAGENTA "\x1b[35m"
#define COLOR_CYAN    "\x1b[36m"
#define COLOR_RESET   "\x1b[0m"
#define COLOR_BOLD    "\x1b[1m"

/* Test return values */
#define TEST_PASS 0
#define TEST_FAIL 1

/* Global test counters */
static int _test_count = 0;
static int _test_passed = 0;
static int _test_failed = 0;
static const char *_current_test = NULL;
static const char *_test_suite_name = NULL;

/* Test suite declaration */
#define TEST_SUITE(name) \
    do { \
        _test_suite_name = name; \
        printf(COLOR_BOLD COLOR_CYAN "\n=== %s ===\n" COLOR_RESET, name); \
    } while (0)

/* Test function declaration */
#define TEST(name) \
    static int test_##name(void)

/* Run a test */
#define RUN_TEST(name) \
    do { \
        _current_test = #name; \
        _test_count++; \
        int result = test_##name(); \
        if (result == TEST_PASS) { \
            _test_passed++; \
            printf(COLOR_GREEN "  ✓ " COLOR_RESET "%s\n", #name); \
        } else { \
            _test_failed++; \
            printf(COLOR_RED "  ✗ " COLOR_RESET "%s\n", #name); \
        } \
    } while (0)

/* Assertions */
#define ASSERT(condition, message) \
    do { \
        if (!(condition)) { \
            printf(COLOR_RED "    Assertion failed: %s\n" COLOR_RESET, message); \
            printf(COLOR_YELLOW "    Location: %s:%d\n" COLOR_RESET, __FILE__, __LINE__); \
            return TEST_FAIL; \
        } \
    } while (0)

#define ASSERT_EQ(expected, actual) \
    do { \
        if ((expected) != (actual)) { \
            printf(COLOR_RED "    Expected: %ld, Got: %ld\n" COLOR_RESET, \
                   (long)(expected), (long)(actual)); \
            printf(COLOR_YELLOW "    Location: %s:%d\n" COLOR_RESET, __FILE__, __LINE__); \
            return TEST_FAIL; \
        } \
    } while (0)

#define ASSERT_NE(not_expected, actual) \
    do { \
        if ((not_expected) == (actual)) { \
            printf(COLOR_RED "    Expected not equal to: %ld, Got: %ld\n" COLOR_RESET, \
                   (long)(not_expected), (long)(actual)); \
            printf(COLOR_YELLOW "    Location: %s:%d\n" COLOR_RESET, __FILE__, __LINE__); \
            return TEST_FAIL; \
        } \
    } while (0)

#define ASSERT_GT(value, threshold) \
    do { \
        if ((value) <= (threshold)) { \
            printf(COLOR_RED "    Expected > %ld, Got: %ld\n" COLOR_RESET, \
                   (long)(threshold), (long)(value)); \
            printf(COLOR_YELLOW "    Location: %s:%d\n" COLOR_RESET, __FILE__, __LINE__); \
            return TEST_FAIL; \
        } \
    } while (0)

#define ASSERT_LT(value, threshold) \
    do { \
        if ((value) >= (threshold)) { \
            printf(COLOR_RED "    Expected < %ld, Got: %ld\n" COLOR_RESET, \
                   (long)(threshold), (long)(value)); \
            printf(COLOR_YELLOW "    Location: %s:%d\n" COLOR_RESET, __FILE__, __LINE__); \
            return TEST_FAIL; \
        } \
    } while (0)

#define ASSERT_NULL(pointer) \
    do { \
        if ((pointer) != NULL) { \
            printf(COLOR_RED "    Expected NULL, Got: %p\n" COLOR_RESET, (void*)(pointer)); \
            printf(COLOR_YELLOW "    Location: %s:%d\n" COLOR_RESET, __FILE__, __LINE__); \
            return TEST_FAIL; \
        } \
    } while (0)

#define ASSERT_NOT_NULL(pointer) \
    do { \
        if ((pointer) == NULL) { \
            printf(COLOR_RED "    Expected non-NULL pointer\n" COLOR_RESET); \
            printf(COLOR_YELLOW "    Location: %s:%d\n" COLOR_RESET, __FILE__, __LINE__); \
            return TEST_FAIL; \
        } \
    } while (0)

#define ASSERT_STR_EQ(expected, actual) \
    do { \
        if (strcmp((expected), (actual)) != 0) { \
            printf(COLOR_RED "    Expected: \"%s\", Got: \"%s\"\n" COLOR_RESET, \
                   (expected), (actual)); \
            printf(COLOR_YELLOW "    Location: %s:%d\n" COLOR_RESET, __FILE__, __LINE__); \
            return TEST_FAIL; \
        } \
    } while (0)

#define ASSERT_STR_NE(not_expected, actual) \
    do { \
        if (strcmp((not_expected), (actual)) == 0) { \
            printf(COLOR_RED "    Expected not equal to: \"%s\", Got: \"%s\"\n" COLOR_RESET, \
                   (not_expected), (actual)); \
            printf(COLOR_YELLOW "    Location: %s:%d\n" COLOR_RESET, __FILE__, __LINE__); \
            return TEST_FAIL; \
        } \
    } while (0)

#define ASSERT_MEM_EQ(expected, actual, size) \
    do { \
        if (memcmp((expected), (actual), (size)) != 0) { \
            printf(COLOR_RED "    Memory comparison failed (%zu bytes)\n" COLOR_RESET, (size_t)(size)); \
            printf(COLOR_YELLOW "    Location: %s:%d\n" COLOR_RESET, __FILE__, __LINE__); \
            return TEST_FAIL; \
        } \
    } while (0)

/* Test summary report */
#define TEST_REPORT() \
    ({ \
        printf(COLOR_BOLD "\n=== Test Summary ===\n" COLOR_RESET); \
        printf(COLOR_BLUE "  Total:  %d\n" COLOR_RESET, _test_count); \
        printf(COLOR_GREEN "  Passed: %d\n" COLOR_RESET, _test_passed); \
        if (_test_failed > 0) { \
            printf(COLOR_RED "  Failed: %d\n" COLOR_RESET, _test_failed); \
        } \
        printf("\n"); \
        (_test_failed == 0) ? 0 : 1; \
    })

#endif /* TEST_H */

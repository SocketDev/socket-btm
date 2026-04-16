/**
 * process_exec.h - Safe cross-platform process execution without shell
 *
 * Provides secure process execution that eliminates command injection
 * vulnerabilities by avoiding shell interpretation of metacharacters.
 *
 * Security guarantees:
 * - No shell execution (no /bin/sh -c or cmd.exe /c)
 * - Arguments passed directly to kernel (Unix) or CreateProcess (Windows)
 * - Eliminates metacharacter interpretation: ; | & $ ` () etc.
 *
 * Cross-platform support:
 * - Unix: fork()/execvp() with pipe for stdout capture
 * - Windows: CreateProcess with pipe for stdout capture
 */

#ifndef PROCESS_EXEC_H
#define PROCESS_EXEC_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Spawn a command safely without shell and capture stdout.
 *
 * This function provides defense-in-depth against command injection by
 * eliminating shell execution entirely. Arguments are passed as an array
 * (not a string), directly to the kernel (Unix) or CreateProcess (Windows),
 * with no interpretation of shell metacharacters.
 *
 * On Unix (Linux/macOS):
 * - Uses fork()/execvp() to spawn command
 * - execvp() searches PATH for the binary
 * - No shell is involved - arguments passed via execve() syscall
 *
 * On Windows:
 * - Uses CreateProcess() to spawn command
 * - Searches PATH via lpApplicationName=NULL + lpCommandLine
 * - No cmd.exe shell is involved
 *
 * The function captures stdout into a buffer and returns it as a
 * dynamically allocated string. Caller must free() the result.
 *
 * Error handling:
 * - Returns NULL if fork/CreateProcess fails
 * - Returns NULL if process exits with non-zero status
 * - Returns NULL if stdout cannot be captured
 * - Logs detailed errors to stderr
 *
 * @param command Command to execute (binary name, will be searched in PATH)
 * @param args NULL-terminated array of argument strings (including argv[0])
 * @param max_output_size Maximum bytes to capture from stdout (prevents DoS)
 * @return Dynamically allocated string with stdout (caller must free),
 *         or NULL on error
 *
 * @example
 * // Spawn "node --version" and capture output
 * const char* args[] = {"node", "--version", NULL};
 * char* output = spawn_command("node", args, 1024);
 * if (output) {
 *     printf("Node version: %s\n", output);
 *     free(output);
 * }
 */
char* spawn_command(const char* command, const char* const args[], size_t max_output_size);

#ifdef __cplusplus
}
#endif

#endif /* PROCESS_EXEC_H */

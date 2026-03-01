/**
 * process_exec.c - Safe cross-platform process execution without shell
 */

#include "process_exec.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
    #define WIN32_LEAN_AND_MEAN
    #include <windows.h>
#else
    #include <unistd.h>
    #include <sys/wait.h>
    #include <errno.h>
    #include <fcntl.h>
    #include <signal.h>
#endif

#ifdef _WIN32

/**
 * Windows implementation using CreateProcess (no cmd.exe shell)
 */
char* spawn_command(const char* command, const char* const args[], size_t max_output_size) {
    if (!command || !args || !args[0]) {
        fprintf(stderr, "Error: Invalid arguments to spawn_command\n");
        return NULL;
    }

    // Build command line from args array with proper escaping
    // Windows CreateProcess requires a single command line string
    // Per MSDN CommandLineToArgvW rules:
    // - Arguments with spaces, tabs, quotes, or empty strings must be quoted
    // - Backslashes before quotes must be doubled
    // - Quotes must be escaped as \"
    // Worst case: every character needs escaping (2x) + quotes + space + null
    size_t cmdline_size = 0;
    for (int i = 0; args[i] != NULL; i++) {
        cmdline_size += strlen(args[i]) * 2 + 4;  // *2 for escaping, +4 for quotes+space
    }

    char* cmdline = malloc(cmdline_size + 1);
    if (!cmdline) {
        fprintf(stderr, "Error: Failed to allocate command line buffer\n");
        return NULL;
    }

    size_t offset = 0;
    for (int i = 0; args[i] != NULL; i++) {
        if (i > 0) {
            cmdline[offset++] = ' ';
        }

        const char* arg = args[i];
        size_t arg_len = strlen(arg);

        // Quote argument if it contains spaces, tabs, quotes, or is empty
        int needs_quotes = (strchr(arg, ' ') != NULL) ||
                          (strchr(arg, '\t') != NULL) ||
                          (strchr(arg, '"') != NULL) ||
                          (arg_len == 0);

        if (needs_quotes) {
            cmdline[offset++] = '"';
        }

        // Escape quotes and backslashes per Windows rules
        for (const char* p = arg; *p; p++) {
            // Count consecutive backslashes
            int num_backslashes = 0;
            while (*p == '\\') {
                num_backslashes++;
                p++;
            }

            if (*p == '"') {
                // Backslashes before quote must be doubled, then escape the quote
                for (int j = 0; j < num_backslashes * 2; j++) {
                    cmdline[offset++] = '\\';
                }
                cmdline[offset++] = '\\';
                cmdline[offset++] = '"';
            } else if (*p == '\0') {
                // End of string - if we're quoting, double the trailing backslashes
                if (needs_quotes) {
                    for (int j = 0; j < num_backslashes * 2; j++) {
                        cmdline[offset++] = '\\';
                    }
                } else {
                    for (int j = 0; j < num_backslashes; j++) {
                        cmdline[offset++] = '\\';
                    }
                }
                break;
            } else {
                // Normal character - backslashes don't need escaping
                for (int j = 0; j < num_backslashes; j++) {
                    cmdline[offset++] = '\\';
                }
                cmdline[offset++] = *p;
            }
        }

        if (needs_quotes) {
            cmdline[offset++] = '"';
        }
    }

    cmdline[offset] = '\0';

    // Create pipe for stdout
    HANDLE hReadPipe, hWritePipe;
    SECURITY_ATTRIBUTES sa;
    sa.nLength = sizeof(SECURITY_ATTRIBUTES);
    sa.bInheritHandle = TRUE;
    sa.lpSecurityDescriptor = NULL;

    if (!CreatePipe(&hReadPipe, &hWritePipe, &sa, 0)) {
        fprintf(stderr, "Error: CreatePipe failed: %lu\n", GetLastError());
        free(cmdline);
        return NULL;
    }

    // Ensure read handle is not inherited
    SetHandleInformation(hReadPipe, HANDLE_FLAG_INHERIT, 0);

    // Setup process startup info
    STARTUPINFOA si;
    ZeroMemory(&si, sizeof(si));
    si.cb = sizeof(si);
    si.hStdOutput = hWritePipe;
    si.hStdError = GetStdHandle(STD_ERROR_HANDLE);
    si.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
    si.dwFlags |= STARTF_USESTDHANDLES;

    PROCESS_INFORMATION pi;
    ZeroMemory(&pi, sizeof(pi));

    // Create process (no shell - lpApplicationName=NULL searches PATH)
    BOOL success = CreateProcessA(
        NULL,           // lpApplicationName - NULL means search PATH
        cmdline,        // lpCommandLine
        NULL,           // lpProcessAttributes
        NULL,           // lpThreadAttributes
        TRUE,           // bInheritHandles
        0,              // dwCreationFlags (no shell flags)
        NULL,           // lpEnvironment
        NULL,           // lpCurrentDirectory
        &si,            // lpStartupInfo
        &pi             // lpProcessInformation
    );

    free(cmdline);

    if (!success) {
        fprintf(stderr, "Error: CreateProcess failed: %lu\n", GetLastError());
        CloseHandle(hReadPipe);
        CloseHandle(hWritePipe);
        return NULL;
    }

    // Close write end in parent
    CloseHandle(hWritePipe);

    // Read output
    char* output = malloc(max_output_size + 1);
    if (!output) {
        fprintf(stderr, "Error: Failed to allocate output buffer\n");
        CloseHandle(hReadPipe);
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);
        return NULL;
    }

    DWORD bytes_read = 0;
    DWORD total_read = 0;
    while (total_read < max_output_size) {
        BOOL read_success = ReadFile(
            hReadPipe,
            output + total_read,
            max_output_size - total_read,
            &bytes_read,
            NULL
        );

        if (!read_success || bytes_read == 0) {
            break;
        }

        total_read += bytes_read;
    }

    output[total_read] = '\0';
    CloseHandle(hReadPipe);

    // Wait for process to complete
    WaitForSingleObject(pi.hProcess, INFINITE);

    DWORD exit_code;
    GetExitCodeProcess(pi.hProcess, &exit_code);

    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);

    if (exit_code != 0) {
        fprintf(stderr, "Error: Process exited with code %lu\n", exit_code);
        free(output);
        return NULL;
    }

    return output;
}

#else

/**
 * Unix implementation using fork()/execvp() (no shell)
 */
char* spawn_command(const char* command, const char* const args[], size_t max_output_size) {
    if (!command || !args || !args[0]) {
        fprintf(stderr, "Error: Invalid arguments to spawn_command\n");
        return NULL;
    }

    // Create pipe for stdout
    int pipefd[2];
    if (pipe(pipefd) == -1) {
        fprintf(stderr, "Error: pipe() failed: %s\n", strerror(errno));
        return NULL;
    }

    pid_t pid = fork();
    if (pid == -1) {
        fprintf(stderr, "Error: fork() failed: %s\n", strerror(errno));
        close(pipefd[0]);
        close(pipefd[1]);
        return NULL;
    }

    if (pid == 0) {
        // Child process
        close(pipefd[0]);  // Close read end

        // Redirect stdout to pipe
        if (dup2(pipefd[1], STDOUT_FILENO) == -1) {
            fprintf(stderr, "Error: dup2() failed: %s\n", strerror(errno));
            _exit(127);
        }

        close(pipefd[1]);

        // Execute command - no shell, direct kernel exec
        // Cast away const for execvp (it doesn't modify args despite signature)
        execvp(command, (char* const*)args);

        // execvp only returns on error
        fprintf(stderr, "Error: execvp() failed for '%s': %s\n", command, strerror(errno));
        _exit(127);
    }

    // Parent process
    close(pipefd[1]);  // Close write end

    // Allocate output buffer
    char* output = malloc(max_output_size + 1);
    if (!output) {
        fprintf(stderr, "Error: Failed to allocate output buffer\n");
        close(pipefd[0]);
        // Kill child and wait
        kill(pid, SIGTERM);
        waitpid(pid, NULL, 0);
        return NULL;
    }

    // Read output in chunks
    size_t total_read = 0;
    ssize_t bytes_read;

    while (total_read < max_output_size) {
        bytes_read = read(pipefd[0], output + total_read, max_output_size - total_read);

        if (bytes_read == -1) {
            if (errno == EINTR) {
                continue;  // Interrupted by signal, retry
            }
            fprintf(stderr, "Error: read() failed: %s\n", strerror(errno));
            free(output);
            close(pipefd[0]);
            waitpid(pid, NULL, 0);
            return NULL;
        }

        if (bytes_read == 0) {
            break;  // EOF
        }

        total_read += bytes_read;
    }

    output[total_read] = '\0';
    close(pipefd[0]);

    // Wait for child process
    int status;
    if (waitpid(pid, &status, 0) == -1) {
        fprintf(stderr, "Error: waitpid() failed: %s\n", strerror(errno));
        free(output);
        return NULL;
    }

    // Check exit status
    if (!WIFEXITED(status)) {
        fprintf(stderr, "Error: Process did not exit normally\n");
        free(output);
        return NULL;
    }

    int exit_code = WEXITSTATUS(status);
    if (exit_code != 0) {
        fprintf(stderr, "Error: Process exited with code %d\n", exit_code);
        free(output);
        return NULL;
    }

    return output;
}

#endif

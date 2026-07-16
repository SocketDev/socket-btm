/*
 * socket-keychain — standalone C++ CLI for the shared keystore-infra API.
 *
 * Secret input comes from stdin and secret output goes to stdout. Values never
 * appear in argv or error messages. The platform backend is compiled beside
 * this file: macOS Keychain, Linux Secret Service, or Windows Credential
 * Manager.
 */

#include <cstdio>
#include <cstring>

#include "socketsecurity/keystore-infra/keystore.h"

#ifndef VERSION
#define VERSION "0.0.0"
#endif

namespace {

constexpr size_t kMaxFieldBytes = 255;
constexpr size_t kMaxValueBytes = 8191;

enum ExitCode {
  kSuccess = 0,
  kUsage = 2,
  kNotFound = 3,
  kDenied = 4,
  kUnavailable = 5,
  kIo = 6,
};

void secureZero(char* value, size_t length) {
  volatile unsigned char* cursor =
      reinterpret_cast<volatile unsigned char*>(value);
  while (length-- > 0) {
    *cursor++ = 0;
  }
}

void printUsage(FILE* stream) {
  std::fprintf(stream,
               "usage:\n"
               "  socket-keychain get <service> <account>\n"
               "  socket-keychain set <service> <account>\n"
               "  socket-keychain delete <service> <account>\n");
}

bool validField(const char* value) {
  if (value == nullptr || value[0] == '\0') {
    return false;
  }
  return std::strlen(value) <= kMaxFieldBytes;
}

int exitForKeystore(int status) {
  switch (status) {
    case KEYSTORE_OK:
      return kSuccess;
    case KEYSTORE_ERR_NOT_FOUND:
      return kNotFound;
    case KEYSTORE_ERR_DENIED:
      return kDenied;
    case KEYSTORE_ERR_UNAVAILABLE:
      return kUnavailable;
    default:
      return kIo;
  }
}

void printKeystoreError(int status) {
  switch (status) {
    case KEYSTORE_ERR_NOT_FOUND:
      std::fputs("credential not found\n", stderr);
      break;
    case KEYSTORE_ERR_DENIED:
      std::fputs("credential access denied\n", stderr);
      break;
    case KEYSTORE_ERR_UNAVAILABLE:
      std::fputs("credential store unavailable\n", stderr);
      break;
    default:
      std::fputs("credential store I/O error\n", stderr);
      break;
  }
}

bool readSecretFromStdin(char* output, size_t capacity, size_t* length) {
  size_t used = 0;
  while (used < capacity - 1) {
    const size_t count =
        std::fread(output + used, 1, capacity - 1 - used, stdin);
    used += count;
    if (count == 0) {
      break;
    }
  }
  if (used == capacity - 1) {
    const int extra = std::fgetc(stdin);
    if (extra != EOF) {
      return false;
    }
  }
  if (std::ferror(stdin) != 0) {
    return false;
  }
  output[used] = '\0';
  if (used == 0 || std::memchr(output, '\0', used) != nullptr) {
    return false;
  }
  *length = used;
  return true;
}

int runGet(const char* service, const char* account) {
  char value[kMaxValueBytes + 1] = {};
  const int status = keystore_get(service, account, value, sizeof(value));
  if (status != KEYSTORE_OK) {
    secureZero(value, sizeof(value));
    printKeystoreError(status);
    return exitForKeystore(status);
  }
  const size_t length = std::strlen(value);
  const size_t written = std::fwrite(value, 1, length, stdout);
  secureZero(value, sizeof(value));
  if (written != length || std::fflush(stdout) != 0) {
    std::fputs("could not write credential to stdout\n", stderr);
    return kIo;
  }
  return kSuccess;
}

int runSet(const char* service, const char* account) {
  char value[kMaxValueBytes + 1] = {};
  size_t length = 0;
  if (!readSecretFromStdin(value, sizeof(value), &length)) {
    secureZero(value, sizeof(value));
    std::fputs(
        "credential on stdin must be 1..8191 bytes and contain no NULs\n",
        stderr);
    return kUsage;
  }
  const int status = keystore_put(service, account, value);
  secureZero(value, length + 1);
  if (status != KEYSTORE_OK) {
    printKeystoreError(status);
    return exitForKeystore(status);
  }
  return kSuccess;
}

int runDelete(const char* service, const char* account) {
  const int status = keystore_delete(service, account);
  if (status != KEYSTORE_OK) {
    printKeystoreError(status);
    return exitForKeystore(status);
  }
  return kSuccess;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc == 2 && std::strcmp(argv[1], "--version") == 0) {
    std::printf("socket-keychain %s\n", VERSION);
    return kSuccess;
  }
  if (argc == 2 &&
      (std::strcmp(argv[1], "--help") == 0 ||
       std::strcmp(argv[1], "-h") == 0)) {
    printUsage(stdout);
    return kSuccess;
  }
  if (argc != 4 || !validField(argv[2]) || !validField(argv[3])) {
    printUsage(stderr);
    return kUsage;
  }

  const char* command = argv[1];
  const char* service = argv[2];
  const char* account = argv[3];
  if (std::strcmp(command, "get") == 0) {
    return runGet(service, account);
  }
  if (std::strcmp(command, "set") == 0) {
    return runSet(service, account);
  }
  if (std::strcmp(command, "delete") == 0) {
    return runDelete(service, account);
  }
  printUsage(stderr);
  return kUsage;
}

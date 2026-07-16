// Linux power-state detection via /sys/class/power_supply.
//
// Each AC adapter is its own dir (`AC`, `ADP1`, `AC0`, `ACAD`, …)
// with an `online` file holding "1" when power is connected.
// Containers / headless servers / VMs without a power_supply tree
// return AC — those environments are expected to run at full speed.
//
// All operations are direct POSIX syscalls (opendir / readdir /
// open / read). No D-Bus, no UPower, no shellout, no dynamic
// allocation.

#include "socketsecurity/power/power.h"

#include <cstdio>
#include <dirent.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

namespace node {
namespace socketsecurity {
namespace power {

namespace {

// Read the first byte of <path> and return true if it's '1'.
// sysfs scalars are tiny ("0\n" or "1\n"); a 2-byte buffer is enough.
bool ReadOnlineByte(const char* path) {
  int fd = open(path, O_RDONLY | O_CLOEXEC);
  if (fd < 0) {
    return false;
  }
  char buf[2];
  ssize_t n = read(fd, buf, sizeof(buf));
  close(fd);
  return n > 0 && buf[0] == '1';
}

}  // namespace

bool IsOnAcPowerImpl() {
  const char* base = "/sys/class/power_supply";
  DIR* dir = opendir(base);
  if (dir == nullptr) {
    // No power-supply tree — container / VPS / headless. Treat as AC.
    return true;
  }

  bool on_ac = false;
  bool any_supply = false;
  struct dirent* entry;
  while ((entry = readdir(dir)) != nullptr) {
    if (entry->d_name[0] == '.') {
      continue;
    }
    any_supply = true;
    // <base> is fixed-len 24, sysfs entry names are short — 256 char
    // buffer is well over what's needed.
    char path[256];
    int written = snprintf(path, sizeof(path),
                           "%s/%s/online", base, entry->d_name);
    if (written <= 0 || static_cast<size_t>(written) >= sizeof(path)) {
      continue;
    }
    if (ReadOnlineByte(path)) {
      on_ac = true;
      break;
    }
  }
  closedir(dir);

  // No supplies at all — same as no tree, treat as AC.
  if (!any_supply) {
    return true;
  }
  return on_ac;
}

}  // namespace power
}  // namespace socketsecurity
}  // namespace node

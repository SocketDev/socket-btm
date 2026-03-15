/**
 * debug.h - Debug logging utilities for stubs
 *
 * This is a thin wrapper that includes the shared debug_common.h from build-infra.
 *
 * Usage:
 *   #include "debug.h"
 *
 *   int main() {
 *       DEBUG_INIT("smol:stub");
 *       DEBUG_LOG("message %d\n", value);
 *       return 0;
 *   }
 *
 * Environment:
 *   DEBUG=1        -> debug enabled
 *   DEBUG=true     -> debug enabled
 *   DEBUG=0        -> debug disabled
 *   DEBUG=false    -> debug disabled
 *   (unset)        -> debug disabled
 */

#ifndef DEBUG_H
#define DEBUG_H

// Include shared implementation from build-infra
#include "socketsecurity/build-infra/debug_common.h"

#endif /* DEBUG_H */

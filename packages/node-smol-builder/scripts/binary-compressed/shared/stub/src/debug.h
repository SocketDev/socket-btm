/**
 * debug.h - Debug logging utilities for stubs
 *
 * This is a thin wrapper that includes the shared debug_common.h from build-infra
 * and provides backward compatibility macros for existing stub code.
 *
 * Usage:
 *   #include "debug.h"
 *
 *   int main() {
 *       INIT_DEBUG();  // or DEBUG_INIT() - both work
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
#include "debug_common.h"

// Backward compatibility: existing stub code uses INIT_DEBUG()
#define INIT_DEBUG() DEBUG_INIT()

#endif /* DEBUG_H */

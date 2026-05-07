#!/bin/bash
# Memory-limited test runner
# Usage: ./scripts/test-with-memory-limit.sh [vitest args...]

MAX_MEMORY_MB=2048  # 2GB limit
CHECK_INTERVAL=2    # Check every 2 seconds
TIMEOUT_SECONDS=300 # 5 minute timeout

# Set process memory limit
ulimit -v $((MAX_MEMORY_MB * 1024))

# Start the test process in background
NODE_OPTIONS="--max-old-space-size=${MAX_MEMORY_MB}" pnpm test "$@" &
TEST_PID=$!

# Monitor memory usage
START_TIME=$(date +%s)
while kill -0 $TEST_PID 2>/dev/null; do
    # Check timeout
    CURRENT_TIME=$(date +%s)
    ELAPSED=$((CURRENT_TIME - START_TIME))
    if [ $ELAPSED -gt $TIMEOUT_SECONDS ]; then
        echo "⚠️  TIMEOUT: Test exceeded ${TIMEOUT_SECONDS}s - killing process"
        kill -9 $TEST_PID
        pkill -9 -P $TEST_PID  # Kill all child processes
        exit 124
    fi

    # Check memory usage (macOS)
    if command -v ps &> /dev/null; then
        MEM_KB=$(ps -o rss= -p $TEST_PID 2>/dev/null || echo 0)
        MEM_MB=$((MEM_KB / 1024))

        if [ $MEM_MB -gt $MAX_MEMORY_MB ]; then
            echo "⚠️  MEMORY LIMIT EXCEEDED: ${MEM_MB}MB > ${MAX_MEMORY_MB}MB - killing process"
            kill -9 $TEST_PID
            pkill -9 -P $TEST_PID
            exit 125
        fi

        # Show progress
        echo "Memory: ${MEM_MB}MB / ${MAX_MEMORY_MB}MB | Elapsed: ${ELAPSED}s"
    fi

    sleep $CHECK_INTERVAL
done

# Wait for test to complete and get exit code
wait $TEST_PID
exit $?

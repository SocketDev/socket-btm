//! State management for interactive TUI components.
//!
//! This module provides React-like state hooks that bridge between JavaScript
//! and Rust, allowing state changes to trigger re-renders.
//!
//! PERFORMANCE OPTIMIZATIONS:
//! - Minimal lock hold time (acquire, update, release pattern)
//! - parking_lot::Mutex for faster uncontended locks (10-30% faster than std::Mutex)
//! - Inline all hot-path functions
//! - Notify after releasing lock to reduce contention

use napi::bindgen_prelude::*;
use napi_derive::napi;
use serde_json::Value;
use parking_lot::Mutex as ParkingLotMutex;
use std::sync::Arc;
use tokio::sync::Notify;

// ============================================================================
// State Handle (JavaScript)
// ============================================================================

/// JavaScript state handle for managing component state.
///
/// Similar to React's useState, this provides:
/// - Current state value (getter)
/// - State updater function (setter)
/// - Automatic re-render triggering on state changes
///
/// OPTIMIZATION: Uses parking_lot::Mutex which is 10-30% faster than std::Mutex
/// for uncontended locks (the common case). It also has no poisoning overhead.
#[napi]
pub struct JsStateHandle {
    /// Current state value (JSON)
    /// OPTIMIZATION: parking_lot::Mutex is faster and doesn't support poisoning
    value: Arc<ParkingLotMutex<Value>>,
    /// Notify when state changes (triggers re-render)
    changed: Arc<Notify>,
}

#[napi]
impl JsStateHandle {
    /// Create a new state handle with initial value.
    #[napi(constructor)]
    #[inline]
    pub fn new(initial_value: Value) -> Result<Self> {
        Ok(Self {
            value: Arc::new(ParkingLotMutex::new(initial_value)),
            changed: Arc::new(Notify::new()),
        })
    }

    /// Get current state value (synchronous).
    /// OPTIMIZATION: Fast path with minimal lock time using parking_lot::Mutex
    /// parking_lot::Mutex never panics, so no error handling needed
    #[napi]
    #[inline]
    pub fn get(&self) -> Result<Value> {
        // OPTIMIZATION: parking_lot::Mutex doesn't poison, so simple lock() works
        // Hold lock only for clone operation (minimal critical section)
        let value = self.value.lock().clone();
        Ok(value)
    }

    /// Set new state value and trigger re-render (synchronous).
    /// OPTIMIZATION: Fast path with minimal lock time and immediate notification.
    #[napi]
    #[inline]
    pub fn set(&self, new_value: Value) -> Result<()> {
        // OPTIMIZATION: Minimize critical section - lock, update, unlock
        {
            let mut value = self.value.lock();
            *value = new_value;
        } // Lock released here

        // OPTIMIZATION: Notify after releasing lock to reduce contention
        // notify_waiters() wakes ALL waiting tasks (ideal for state updates)
        self.changed.notify_waiters();
        Ok(())
    }

    /// Update state based on previous value (synchronous).
    /// Updater receives current value and returns new value.
    #[napi]
    #[inline]
    pub fn update(&self, env: Env, updater: Function<'_>) -> Result<()> {
        // OPTIMIZATION: Separate lock acquisitions to minimize hold time
        let new_value = {
            let value = self.value.lock();
            // Call JavaScript updater function with current value
            let current = env.to_js_value(&*value)?;
            updater.call(current)?
        };

        {
            let mut value = self.value.lock();
            *value = env.from_js_value(new_value)?;
        }

        // OPTIMIZATION: Notify after releasing lock
        self.changed.notify_waiters();
        Ok(())
    }

    /// Wait for state to change (for internal use by render loop).
    #[inline]
    pub async fn wait_for_change(&self) {
        self.changed.notified().await;
    }
}

// ============================================================================
// State Registry
// ============================================================================

/// Registry for tracking all state handles in a renderer.
///
/// When any state changes, the renderer should re-render.
/// OPTIMIZATION: Uses parking_lot::Mutex for faster synchronization
pub struct StateRegistry {
    /// All state handles being tracked
    /// OPTIMIZATION: parking_lot::Mutex is faster than std::Mutex
    handles: Arc<ParkingLotMutex<Vec<Arc<Notify>>>>,
    /// Notify when any state changes
    any_changed: Arc<Notify>,
}

impl StateRegistry {
    /// Create a new empty state registry.
    #[inline]
    pub fn new() -> Self {
        Self {
            handles: Arc::new(ParkingLotMutex::new(Vec::new())),
            any_changed: Arc::new(Notify::new()),
        }
    }

    /// Register a state handle for tracking.
    /// OPTIMIZATION: Minimal lock hold time, spawn task outside critical section
    pub fn register(&self, handle: &JsStateHandle) {
        // OPTIMIZATION: Minimize critical section - just push the notify handle
        {
            let mut handles = self.handles.lock();
            handles.push(handle.changed.clone());
        }

        // OPTIMIZATION: Spawn task outside of lock
        // This background task forwards state change notifications
        let any_changed = self.any_changed.clone();
        let notify = handle.changed.clone();
        tokio::spawn(async move {
            loop {
                notify.notified().await;
                any_changed.notify_waiters();
            }
        });
    }

    /// Wait for any state to change.
    #[inline]
    pub async fn wait_for_any_change(&self) {
        self.any_changed.notified().await;
    }

    /// Clear all registered handles.
    /// OPTIMIZATION: parking_lot::Mutex makes this trivially fast
    #[inline]
    pub fn clear(&self) {
        let mut handles = self.handles.lock();
        handles.clear();
    }
}

impl Default for StateRegistry {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// Testing Utilities
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_state_handle_get_set() {
        let handle = JsStateHandle::new(json!(42)).unwrap();

        let value = handle.get().unwrap();
        assert_eq!(value, json!(42));

        handle.set(json!(100)).unwrap();
        let value = handle.get().unwrap();
        assert_eq!(value, json!(100));
    }

    #[tokio::test]
    async fn test_state_change_notification() {
        let handle = JsStateHandle::new(json!("initial")).unwrap();

        // Spawn a task to wait for change
        let handle_clone = Arc::new(handle);
        let handle_ref = handle_clone.clone();
        let waiter = tokio::spawn(async move {
            handle_ref.wait_for_change().await;
        });

        // Give the waiter time to start
        tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;

        // Change state
        handle_clone.set(json!("changed")).unwrap();

        // Waiter should complete
        tokio::time::timeout(tokio::time::Duration::from_millis(100), waiter)
            .await
            .expect("Waiter should have been notified")
            .expect("Waiter task should succeed");
    }
}

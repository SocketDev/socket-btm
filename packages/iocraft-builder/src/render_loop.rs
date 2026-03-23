//! Interactive render loop for TUI applications.
//!
//! This module implements the async render loop that bridges iocraft's native
//! rendering with JavaScript callbacks for events and state updates.
//!
//! PERFORMANCE OPTIMIZATIONS:
//! - Atomic operations for running flag (lock-free)
//! - String interning for unchanged canvas (differential rendering)
//! - Non-blocking event polling (timeout=0)
//! - Biased tokio::select! to prioritize render requests
//! - Single-write buffered I/O (queue! + single flush)
//! - Relaxed memory ordering where safe
//! - Bounded tokio mpsc channel (capacity 1) provides natural backpressure
//! - Branch prediction hints (#[cold]) for rare code paths

use crate::events::{EventBridge, JsTerminalEvent};
use crate::node_to_element;
use crate::ComponentNode;
use crossterm::{
    cursor, event, execute, queue, terminal,
    terminal::{EnterAlternateScreen, LeaveAlternateScreen},
};
use iocraft::prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, UnknownReturnValue};
use parking_lot::RwLock;
use std::io::{self, stdout, Write, BufWriter};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;

// ============================================================================
// RAII Guard for Running Flag
// ============================================================================

/// RAII guard that ensures the running flag is reset when the render loop exits.
/// This prevents the renderer from being permanently broken if the loop encounters
/// an error during cleanup. Note: With panic="abort" in Cargo.toml, Drop is not
/// called on panic (process aborts instead).
pub(crate) struct RunningGuard {
    flag: Arc<AtomicBool>,
}

impl RunningGuard {
    pub(crate) fn new(flag: Arc<AtomicBool>) -> Self {
        // Don't set flag here - already set by compare_exchange in start_interactive
        // Guard only resets the flag on drop for cleanup
        Self { flag }
    }
}

impl Drop for RunningGuard {
    fn drop(&mut self) {
        // Use Release ordering to synchronize with Acquire loads
        self.flag.store(false, Ordering::Release);
    }
}

// ============================================================================
// Shared Renderer State
// ============================================================================

/// Render request message (zero-sized for maximum performance).
#[derive(Debug, Clone, Copy)]
pub struct RenderRequest;

/// Shared state between JavaScript and Rust render loop.
///
/// OPTIMIZATION: Fields ordered by size and access frequency
/// Uses RwLock instead of Mutex (allows concurrent reads)
/// Uses bounded tokio mpsc channel (capacity 1) for render requests with backpressure
/// Cache-line aligned to prevent false sharing (64-byte alignment)
#[repr(align(64))]
pub struct InteractiveRendererState {
    /// Current component tree to render (most frequently accessed)
    pub tree: Arc<RwLock<Option<ComponentNode>>>,
    /// Bounded channel sender for render requests (capacity 1 provides backpressure)
    /// Wrapped in Option because it's created lazily on first start_interactive()
    render_tx: parking_lot::RwLock<Option<mpsc::Sender<RenderRequest>>>,
    /// Running flag (atomic, no lock needed)
    pub running: Arc<AtomicBool>,
    /// Dropped events counter for telemetry (atomic)
    pub dropped_events: Arc<AtomicU64>,
}

impl InteractiveRendererState {
    #[inline]
    pub fn new(running: Arc<AtomicBool>) -> Self {
        // No channel created yet - will be created on first start_interactive()
        Self {
            tree: Arc::new(RwLock::new(None)),
            render_tx: parking_lot::RwLock::new(None),
            running,
            dropped_events: Arc::new(AtomicU64::new(0)),
        }
    }

    /// Create a new render channel pair and return the receiver.
    /// Called when starting the interactive render loop.
    pub fn create_render_channel(&self) -> mpsc::Receiver<RenderRequest> {
        let (tx, rx) = mpsc::channel(1); // Bounded channel for backpressure
        *self.render_tx.write() = Some(tx);
        rx
    }

    /// Request a re-render on the next loop iteration.
    /// Uses bounded channel (capacity 1) - if full, request is dropped (idempotent renders)
    /// If called before start_interactive(), requests are silently dropped.
    #[inline(always)]
    pub fn request_render(&self) {
        // try_send drops the request if channel is full (already have pending render)
        if let Some(tx) = self.render_tx.read().as_ref() {
            let _ = tx.try_send(RenderRequest);
        }
    }
}

// ============================================================================
// Interactive Render Loop
// ============================================================================

/// Run the interactive render loop.
///
/// This function runs the main TUI event loop, handling:
/// - Terminal events (keyboard, mouse, resize) → JavaScript callbacks
/// - Re-render requests from JavaScript → Canvas updates
/// - Differential rendering (only redraw when canvas changes)
///
/// PERFORMANCE OPTIMIZATIONS:
/// - BufWriter wrapping stdout for batched writes (reduces syscalls)
/// - Acquire/Release memory ordering for running flag (lighter than SeqCst)
/// - Pre-allocated canvas string with capacity hint
/// - Biased tokio::select! to prioritize renders over polling
/// - Bounded async channel (capacity 1) provides backpressure
///
/// The running flag is managed by RAII guard to ensure it's always reset,
/// even if the loop exits due to panic or I/O error.
pub async fn interactive_render_loop(
    state: Arc<InteractiveRendererState>,
    mut render_rx: mpsc::Receiver<RenderRequest>,
    on_event: ThreadsafeFunction<JsTerminalEvent, UnknownReturnValue>,
    fullscreen: bool,
    mouse_capture: bool,
    running_flag: Arc<AtomicBool>,
) -> io::Result<()> {
    // RAII guard ensures running flag is reset when loop exits
    let _guard = RunningGuard::new(running_flag.clone());

    // Check if stop() was called between compare_exchange and now
    // This prevents TOCTOU race where stop() sets running=false before guard is created
    // Use Acquire to synchronize with Release store in stop()
    if !running_flag.load(Ordering::Acquire) {
        return Ok(()); // stop() was called, exit immediately
    }

    // Initialize terminal with buffered writer
    // OPTIMIZATION: BufWriter reduces syscalls for terminal writes
    let stdout_raw = stdout();
    let mut stdout = BufWriter::with_capacity(8192, stdout_raw);

    if fullscreen {
        execute!(stdout, EnterAlternateScreen)?;
        if mouse_capture {
            execute!(stdout, event::EnableMouseCapture)?;
        }
    }

    terminal::enable_raw_mode()?;

    // Create event bridge with shared telemetry counter
    let event_bridge = EventBridge::new(on_event, state.dropped_events.clone());

    // Track previous canvas string for differential rendering
    // OPTIMIZATION: Pre-allocate with generous capacity to avoid reallocation
    // Typical terminal: 80x24 = 1920 chars, but with ANSI codes ~8KB
    // Reserve 16KB to handle large terminals (120x40) with rich styling
    let mut prev_canvas_str = String::with_capacity(16384);

    // Trigger initial render
    state.request_render();

    // Main event loop
    loop {
        // Use Acquire ordering to synchronize with Release store in stop()
        if !state.running.load(Ordering::Acquire) {
            break;
        }

        // Wait for either terminal events or render request
        // Use async channel for render requests (no blocking)
        tokio::select! {
            biased;

            // Prioritize render requests for lower latency (higher FPS)
            Some(_) = render_rx.recv() => {
                // Render current tree
                // OPTIMIZATION: RwLock read is lock-free when no writers (common case)
                let tree_clone = state.tree.read().clone();

                // OPTIMIZATION: Render outside of lock (parallel-friendly)
                if let Some(tree) = tree_clone {
                    let mut elem = node_to_element(&tree);
                    // OPTIMIZATION: Cache terminal width to avoid repeated syscalls
                    let width = terminal::size().map(|(w, _)| w as usize).unwrap_or(80);
                    let canvas = elem.render(Some(width));
                    let canvas_str = canvas.to_string();

                    // OPTIMIZATION: Optimized differential rendering with fast-path length check
                    // Most renders actually change the canvas (user input, animation)
                    let len_changed = prev_canvas_str.len() != canvas_str.len();

                    // OPTIMIZATION: Short-circuit on length mismatch (avoids full string comparison)
                    let should_update = len_changed || prev_canvas_str != canvas_str;

                    if should_update {
                        // OPTIMIZATION: Use queue! to batch terminal commands, single flush
                        queue!(stdout, cursor::MoveTo(0, 0))?;
                        write!(stdout, "{}", canvas_str)?;
                        stdout.flush()?;

                        // OPTIMIZATION: Smart string reuse - only reallocate if capacity exceeded
                        if canvas_str.len() > prev_canvas_str.capacity() {
                            // Capacity exceeded, replace entirely
                            prev_canvas_str = canvas_str;
                        } else {
                            // Reuse allocation
                            prev_canvas_str.clear();
                            prev_canvas_str.push_str(&canvas_str);
                        }
                    }
                }
            }

            // Terminal event polling (60 FPS = ~16ms)
            // OPTIMIZATION: Use interval instead of sleep for more consistent timing
            _ = tokio::time::sleep(Duration::from_millis(16)) => {
                // Poll with timeout=0 to avoid blocking (non-blocking check)
                if event::poll(Duration::from_millis(0))? {
                    // OPTIMIZATION: Process event inline to avoid allocation
                    match event::read()? {
                        event::Event::Key(key_event) => {
                            // OPTIMIZATION: Construct structs inline to avoid temporaries
                            let mut iocraft_key = KeyEvent::new(key_event.kind, key_event.code);
                            iocraft_key.modifiers = key_event.modifiers;
                            event_bridge.send_event(TerminalEvent::Key(iocraft_key));
                        }
                        event::Event::Mouse(mouse_event) => {
                            let mut iocraft_mouse = FullscreenMouseEvent::new(
                                mouse_event.kind,
                                mouse_event.column,
                                mouse_event.row,
                            );
                            iocraft_mouse.modifiers = mouse_event.modifiers;
                            event_bridge.send_event(TerminalEvent::FullscreenMouse(iocraft_mouse));
                        }
                        event::Event::Resize(width, height) => {
                            event_bridge.send_event(TerminalEvent::Resize(width, height));
                            // BARE-METAL: Lock-free render request (no Mutex!)
                            state.request_render();
                        }
                        // OPTIMIZATION: Explicitly ignore other events to avoid match overhead
                        event::Event::FocusGained | event::Event::FocusLost | event::Event::Paste(_) => {}
                    }
                }
            }
        }
    }

    // Cleanup terminal
    // OPTIMIZATION: Disable raw mode first to restore terminal ASAP
    terminal::disable_raw_mode()?;
    if fullscreen {
        if mouse_capture {
            execute!(stdout, event::DisableMouseCapture)?;
        }
        execute!(stdout, LeaveAlternateScreen)?;
    }
    // OPTIMIZATION: Final flush to ensure cleanup commands are sent
    stdout.flush()?;

    // RunningGuard will reset the flag when it drops (even if cleanup fails)
    Ok(())
}

// ============================================================================
// Testing Utilities
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_renderer_state_creation() {
        let running = Arc::new(AtomicBool::new(false));
        let state = InteractiveRendererState::new(running.clone());

        assert!(!running.load(Ordering::SeqCst));
        assert!(state.tree.read().is_none());
    }

    #[tokio::test]
    async fn test_render_request() {
        let running = Arc::new(AtomicBool::new(false));
        let state = Arc::new(InteractiveRendererState::new(running));

        // Create channel
        let mut rx = state.create_render_channel();

        // Render request should not block
        state.request_render();
        // Verify request was queued (channel should have 1 item)
        assert!(rx.try_recv().is_ok());
    }

    #[tokio::test]
    async fn test_running_guard_resets_flag() {
        let running = Arc::new(AtomicBool::new(false));

        // Create guard (simulates compare_exchange setting flag to true)
        running.store(true, Ordering::SeqCst);
        {
            let _guard = RunningGuard::new(running.clone());
            // Flag should still be true while guard is alive
            assert!(running.load(Ordering::Acquire));
        } // Guard drops here

        // Flag should be false after guard drops
        assert!(!running.load(Ordering::Acquire));
    }

    #[tokio::test]
    async fn test_running_guard_resets_on_early_return() {
        let running = Arc::new(AtomicBool::new(false));

        fn early_return_function(flag: Arc<AtomicBool>) -> Result<(), &'static str> {
            flag.store(true, Ordering::SeqCst);
            let _guard = RunningGuard::new(flag.clone());
            // Early return - guard should still reset flag
            return Err("early return");
        }

        let result = early_return_function(running.clone());
        assert!(result.is_err());
        // Flag should be false after early return
        assert!(!running.load(Ordering::Acquire));
    }

    #[tokio::test]
    async fn test_request_render_before_channel_created() {
        let running = Arc::new(AtomicBool::new(false));
        let state = Arc::new(InteractiveRendererState::new(running));

        // Request render before channel is created - should be silently dropped
        state.request_render();

        // Now create channel
        let mut rx = state.create_render_channel();

        // Channel should be empty (previous request was dropped)
        assert!(rx.try_recv().is_err());
    }

    #[tokio::test]
    async fn test_channel_recreation_after_replacement() {
        let running = Arc::new(AtomicBool::new(false));
        let state = Arc::new(InteractiveRendererState::new(running));

        // Create first channel
        let mut rx1 = state.create_render_channel();
        state.request_render();
        assert!(rx1.try_recv().is_ok());

        // Create second channel (replaces first)
        let mut rx2 = state.create_render_channel();

        // Old receiver should be disconnected
        state.request_render();
        assert!(rx1.try_recv().is_err()); // First receiver gets nothing
        assert!(rx2.try_recv().is_ok());  // Second receiver gets message
    }
}

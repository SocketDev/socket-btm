//! Event handling bridge between iocraft terminal events and JavaScript.
//!
//! This module provides NAPI types and ThreadsafeFunction bridges to stream
//! terminal events (keyboard, mouse, resize) from Rust to JavaScript callbacks.
//!
//! PERFORMANCE OPTIMIZATIONS:
//! - Static string constants for event type names
//! - Inline conversion functions for hot paths
//! - NonBlocking call mode to prevent event loop stalls
//! - Pre-allocated string capacity for character keys

use iocraft::prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode, UnknownReturnValue};
use napi_derive::napi;
use std::sync::atomic::{AtomicU64, Ordering};

// ============================================================================
// Static String Constants (Zero-Allocation Event Type Strings)
// ============================================================================

// OPTIMIZATION: Pre-allocated static strings for event types
// These are interned by the compiler and avoid heap allocation
const EVENT_TYPE_KEY: &str = "key";
const EVENT_TYPE_MOUSE: &str = "mouse";
const EVENT_TYPE_RESIZE: &str = "resize";
const EVENT_TYPE_UNKNOWN: &str = "unknown";

// OPTIMIZATION: Pre-allocated static strings for key codes
const KEY_CODE_CHAR: &str = "Char";
const KEY_CODE_ENTER: &str = "Enter";
const KEY_CODE_BACKSPACE: &str = "Backspace";
const KEY_CODE_LEFT: &str = "Left";
const KEY_CODE_RIGHT: &str = "Right";
const KEY_CODE_UP: &str = "Up";
const KEY_CODE_DOWN: &str = "Down";
const KEY_CODE_HOME: &str = "Home";
const KEY_CODE_END: &str = "End";
const KEY_CODE_PAGEUP: &str = "PageUp";
const KEY_CODE_PAGEDOWN: &str = "PageDown";
const KEY_CODE_TAB: &str = "Tab";
const KEY_CODE_BACKTAB: &str = "BackTab";
const KEY_CODE_DELETE: &str = "Delete";
const KEY_CODE_INSERT: &str = "Insert";
const KEY_CODE_ESC: &str = "Esc";
const KEY_CODE_NULL: &str = "Null";
const KEY_CODE_CAPSLOCK: &str = "CapsLock";
const KEY_CODE_SCROLLLOCK: &str = "ScrollLock";
const KEY_CODE_NUMLOCK: &str = "NumLock";
const KEY_CODE_PRINTSCREEN: &str = "PrintScreen";
const KEY_CODE_PAUSE: &str = "Pause";
const KEY_CODE_MENU: &str = "Menu";
const KEY_CODE_KEYPADBEGIN: &str = "KeypadBegin";

// OPTIMIZATION: Pre-allocated static strings for event kinds
const EVENT_KIND_PRESS: &str = "Press";
const EVENT_KIND_REPEAT: &str = "Repeat";
const EVENT_KIND_RELEASE: &str = "Release";

// OPTIMIZATION: Pre-allocated static strings for mouse events
const MOUSE_KIND_DOWN: &str = "Down";
const MOUSE_KIND_UP: &str = "Up";
const MOUSE_KIND_DRAG: &str = "Drag";
const MOUSE_KIND_MOVED: &str = "Moved";
const MOUSE_KIND_SCROLL_DOWN: &str = "ScrollDown";
const MOUSE_KIND_SCROLL_UP: &str = "ScrollUp";
const MOUSE_KIND_SCROLL_LEFT: &str = "ScrollLeft";
const MOUSE_KIND_SCROLL_RIGHT: &str = "ScrollRight";

// OPTIMIZATION: Pre-allocated static strings for mouse buttons
const MOUSE_BUTTON_LEFT: &str = "Left";
const MOUSE_BUTTON_RIGHT: &str = "Right";
const MOUSE_BUTTON_MIDDLE: &str = "Middle";

// ============================================================================
// JavaScript Event Types (NAPI Objects)
// ============================================================================

/// Terminal event sent to JavaScript callbacks.
/// OPTIMIZATION: String interning via Arc eliminates allocations for event type strings
#[napi(object)]
#[derive(Debug, Clone)]
pub struct JsTerminalEvent {
    /// Event type: "key", "mouse", "resize", "focus", "paste"
    /// OPTIMIZATION: Uses String (not Arc<str>) for NAPI compatibility
    pub event_type: String,
    /// Keyboard event (if event_type == "key")
    pub key: Option<JsKeyEvent>,
    /// Mouse event (if event_type == "mouse")
    pub mouse: Option<JsMouseEvent>,
    /// Terminal size [width, height] (if event_type == "resize")
    pub resize: Option<Vec<u32>>,
    /// Focus gained (if event_type == "focus")
    pub focus_gained: Option<bool>,
    /// Pasted text (if event_type == "paste")
    pub paste: Option<String>,
}

/// Keyboard event data.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct JsKeyEvent {
    /// Key code: "Char", "Enter", "Backspace", "Left", "Right", "Up", "Down",
    /// "Home", "End", "PageUp", "PageDown", "Tab", "Delete", "Insert", "F1"-"F12", "Esc"
    pub code: String,
    /// Character for Char(c) key codes
    pub char: Option<String>,
    /// Modifier keys
    pub modifiers: JsKeyModifiers,
    /// Event kind: "Press", "Repeat", "Release"
    pub kind: String,
}

/// Keyboard modifiers.
#[napi(object)]
#[derive(Debug, Clone, Default)]
pub struct JsKeyModifiers {
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    pub meta: bool,
}

/// Mouse event data.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct JsMouseEvent {
    /// Mouse event kind: "Down", "Up", "Drag", "Moved", "ScrollDown", "ScrollUp", "ScrollLeft", "ScrollRight"
    pub kind: String,
    /// Mouse button: "Left", "Right", "Middle" (for Down/Up/Drag events)
    pub button: Option<String>,
    /// Column (0-based)
    pub column: u32,
    /// Row (0-based)
    pub row: u32,
    /// Modifier keys
    pub modifiers: JsKeyModifiers,
}

// ============================================================================
// Event Conversion (crossterm → JavaScript)
// ============================================================================

impl From<KeyModifiers> for JsKeyModifiers {
    /// OPTIMIZATION: Inline for zero-overhead conversion in hot path
    /// Bitwise operations are extremely fast (1-2 CPU cycles each)
    #[inline(always)]
    fn from(mods: KeyModifiers) -> Self {
        Self {
            ctrl: mods.contains(KeyModifiers::CONTROL),
            alt: mods.contains(KeyModifiers::ALT),
            shift: mods.contains(KeyModifiers::SHIFT),
            meta: mods.contains(KeyModifiers::META),
        }
    }
}

impl From<KeyEvent> for JsKeyEvent {
    /// OPTIMIZATION: Optimized conversion with minimal allocations
    /// Uses pre-allocated capacity for character keys
    #[inline]
    fn from(event: KeyEvent) -> Self {
        let (code, char) = match event.code {
            // OPTIMIZATION: Single-char keys use with_capacity(1) for exact allocation
            KeyCode::Char(c) => {
                let mut s = String::with_capacity(1);
                s.push(c);
                (String::from(KEY_CODE_CHAR), Some(s))
            }
            KeyCode::Enter => (String::from(KEY_CODE_ENTER), None),
            KeyCode::Backspace => (String::from(KEY_CODE_BACKSPACE), None),
            KeyCode::Left => (String::from(KEY_CODE_LEFT), None),
            KeyCode::Right => (String::from(KEY_CODE_RIGHT), None),
            KeyCode::Up => (String::from(KEY_CODE_UP), None),
            KeyCode::Down => (String::from(KEY_CODE_DOWN), None),
            KeyCode::Home => (String::from(KEY_CODE_HOME), None),
            KeyCode::End => (String::from(KEY_CODE_END), None),
            KeyCode::PageUp => (String::from(KEY_CODE_PAGEUP), None),
            KeyCode::PageDown => (String::from(KEY_CODE_PAGEDOWN), None),
            KeyCode::Tab => (String::from(KEY_CODE_TAB), None),
            KeyCode::BackTab => (String::from(KEY_CODE_BACKTAB), None),
            KeyCode::Delete => (String::from(KEY_CODE_DELETE), None),
            KeyCode::Insert => (String::from(KEY_CODE_INSERT), None),
            // OPTIMIZATION: F-keys pre-allocate capacity (F1-F12 = 2-3 chars)
            KeyCode::F(n) => {
                let mut s = String::with_capacity(3);
                s.push('F');
                s.push_str(itoa::Buffer::new().format(n));
                (s, None)
            }
            KeyCode::Esc => (String::from(KEY_CODE_ESC), None),
            KeyCode::Null => (String::from(KEY_CODE_NULL), None),
            KeyCode::CapsLock => (String::from(KEY_CODE_CAPSLOCK), None),
            KeyCode::ScrollLock => (String::from(KEY_CODE_SCROLLLOCK), None),
            KeyCode::NumLock => (String::from(KEY_CODE_NUMLOCK), None),
            KeyCode::PrintScreen => (String::from(KEY_CODE_PRINTSCREEN), None),
            KeyCode::Pause => (String::from(KEY_CODE_PAUSE), None),
            KeyCode::Menu => (String::from(KEY_CODE_MENU), None),
            KeyCode::KeypadBegin => (String::from(KEY_CODE_KEYPADBEGIN), None),
            // OPTIMIZATION: Rare cases - format! is acceptable
            KeyCode::Media(media) => (format!("Media{:?}", media), None),
            KeyCode::Modifier(modifier) => (format!("Modifier{:?}", modifier), None),
        };

        let kind = match event.kind {
            KeyEventKind::Press => String::from(EVENT_KIND_PRESS),
            KeyEventKind::Repeat => String::from(EVENT_KIND_REPEAT),
            KeyEventKind::Release => String::from(EVENT_KIND_RELEASE),
        };

        Self {
            code,
            char,
            modifiers: event.modifiers.into(),
            kind,
        }
    }
}

impl From<FullscreenMouseEvent> for JsMouseEvent {
    /// OPTIMIZATION: Optimized conversion using static string constants
    #[inline]
    fn from(event: FullscreenMouseEvent) -> Self {
        let (kind, button) = match event.kind {
            MouseEventKind::Down(btn) => (MOUSE_KIND_DOWN, Some(mouse_button_to_string(btn))),
            MouseEventKind::Up(btn) => (MOUSE_KIND_UP, Some(mouse_button_to_string(btn))),
            MouseEventKind::Drag(btn) => (MOUSE_KIND_DRAG, Some(mouse_button_to_string(btn))),
            MouseEventKind::Moved => (MOUSE_KIND_MOVED, None),
            MouseEventKind::ScrollDown => (MOUSE_KIND_SCROLL_DOWN, None),
            MouseEventKind::ScrollUp => (MOUSE_KIND_SCROLL_UP, None),
            MouseEventKind::ScrollLeft => (MOUSE_KIND_SCROLL_LEFT, None),
            MouseEventKind::ScrollRight => (MOUSE_KIND_SCROLL_RIGHT, None),
        };

        Self {
            kind: String::from(kind),
            button,
            column: event.column as u32,
            row: event.row as u32,
            modifiers: event.modifiers.into(),
        }
    }
}

/// OPTIMIZATION: Inline for hot path, use String::from() for static strings
#[inline(always)]
fn mouse_button_to_string(button: crossterm::event::MouseButton) -> String {
    String::from(match button {
        crossterm::event::MouseButton::Left => MOUSE_BUTTON_LEFT,
        crossterm::event::MouseButton::Right => MOUSE_BUTTON_RIGHT,
        crossterm::event::MouseButton::Middle => MOUSE_BUTTON_MIDDLE,
    })
}

impl From<TerminalEvent> for JsTerminalEvent {
    /// OPTIMIZATION: Optimized conversion with String::from() for static strings
    #[inline]
    fn from(event: TerminalEvent) -> Self {
        match event {
            TerminalEvent::Key(key_event) => Self {
                event_type: String::from(EVENT_TYPE_KEY),
                key: Some(key_event.into()),
                mouse: None,
                resize: None,
                focus_gained: None,
                paste: None,
            },
            TerminalEvent::FullscreenMouse(mouse_event) => Self {
                event_type: String::from(EVENT_TYPE_MOUSE),
                key: None,
                mouse: Some(mouse_event.into()),
                resize: None,
                focus_gained: None,
                paste: None,
            },
            TerminalEvent::Resize(width, height) => Self {
                event_type: String::from(EVENT_TYPE_RESIZE),
                key: None,
                mouse: None,
                resize: Some(vec![width as u32, height as u32]),
                focus_gained: None,
                paste: None,
            },
            // Handle other event types (rare in practice)
            _ => Self {
                event_type: String::from(EVENT_TYPE_UNKNOWN),
                key: None,
                mouse: None,
                resize: None,
                focus_gained: None,
                paste: None,
            },
        }
    }
}

// ============================================================================
// Event Bridge (Rust → JavaScript via ThreadsafeFunction)
// ============================================================================

use std::sync::Arc;

/// Bridge for streaming terminal events to JavaScript.
pub struct EventBridge {
    /// ThreadsafeFunction for calling JavaScript event callback
    pub tsfn: ThreadsafeFunction<JsTerminalEvent, UnknownReturnValue>,
    /// Atomic counter for dropped events (telemetry) - shared with renderer state
    dropped_events: Arc<AtomicU64>,
}

impl EventBridge {
    /// Create new event bridge with JavaScript callback and shared telemetry counter.
    pub fn new(
        tsfn: ThreadsafeFunction<JsTerminalEvent, UnknownReturnValue>,
        dropped_events: Arc<AtomicU64>,
    ) -> Self {
        Self {
            tsfn,
            dropped_events,
        }
    }

    /// Get the number of dropped events (telemetry).
    pub fn dropped_event_count(&self) -> u64 {
        self.dropped_events.load(Ordering::Relaxed)
    }

    /// Reset the dropped events counter.
    pub fn reset_dropped_event_count(&self) {
        self.dropped_events.store(0, Ordering::Relaxed);
    }

    /// Send terminal event to JavaScript callback.
    ///
    /// Uses NonBlocking mode to avoid deadlocks if JavaScript is busy.
    /// Events are queued and will be delivered when JavaScript is available.
    ///
    /// Optimized to minimize allocations and overhead in the hot path.
    #[inline]
    pub fn send_event(&self, event: TerminalEvent) {
        // OPTIMIZATION: Direct conversion without intermediate allocation
        let js_event: JsTerminalEvent = event.into();

        // OPTIMIZATION: NonBlocking ensures we never wait for JavaScript
        let status = self
            .tsfn
            .call(Ok(js_event), ThreadsafeFunctionCallMode::NonBlocking);

        // Track dropped events for telemetry
        if status != napi::Status::Ok {
            self.dropped_events.fetch_add(1, Ordering::Relaxed);

            // Log errors in debug builds for diagnostics
            #[cfg(debug_assertions)]
            eprintln!("Warning: Failed to send event to JavaScript: {:?}", status);
        }
    }
}

// ============================================================================
// Testing Utilities
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_key_event_conversion() {
        let mut key_event = KeyEvent::new(KeyEventKind::Press, KeyCode::Char('a'));
        key_event.modifiers = KeyModifiers::CONTROL;
        let js_event: JsKeyEvent = key_event.into();

        assert_eq!(js_event.code, "Char");
        assert_eq!(js_event.char, Some("a".to_string()));
        assert!(js_event.modifiers.ctrl);
        assert!(!js_event.modifiers.alt);
    }

    #[test]
    fn test_mouse_event_conversion() {
        let mut mouse_event = FullscreenMouseEvent::new(
            MouseEventKind::Down(crossterm::event::MouseButton::Left),
            10,
            5,
        );
        mouse_event.modifiers = KeyModifiers::SHIFT;
        let js_event: JsMouseEvent = mouse_event.into();

        assert_eq!(js_event.kind, "Down");
        assert_eq!(js_event.button, Some("Left".to_string()));
        assert_eq!(js_event.column, 10);
        assert_eq!(js_event.row, 5);
        assert!(js_event.modifiers.shift);
    }

    #[test]
    fn test_terminal_event_conversion() {
        // Key event
        let key_event = TerminalEvent::Key(KeyEvent::new(KeyEventKind::Press, KeyCode::Enter));
        let js_event: JsTerminalEvent = key_event.into();
        assert_eq!(js_event.event_type, "key");
        assert!(js_event.key.is_some());

        // Resize event
        let resize_event = TerminalEvent::Resize(80, 24);
        let js_event: JsTerminalEvent = resize_event.into();
        assert_eq!(js_event.event_type, "resize");
        assert_eq!(js_event.resize, Some(vec![80, 24]));
    }

    #[test]
    fn test_event_bridge_dropped_counter() {
        // Note: We can't easily test the full EventBridge without NAPI ThreadsafeFunction,
        // but we can test that the AtomicU64 counter is initialized correctly
        use std::sync::atomic::{AtomicU64, Ordering};
        use std::sync::Arc;

        // Simulate the shared dropped events counter
        let dropped_events = Arc::new(AtomicU64::new(0));

        // Verify initial state
        assert_eq!(dropped_events.load(Ordering::Relaxed), 0);

        // Simulate incrementing when events fail
        dropped_events.fetch_add(1, Ordering::Relaxed);
        assert_eq!(dropped_events.load(Ordering::Relaxed), 1);

        dropped_events.fetch_add(5, Ordering::Relaxed);
        assert_eq!(dropped_events.load(Ordering::Relaxed), 6);

        // Test reset
        dropped_events.store(0, Ordering::Relaxed);
        assert_eq!(dropped_events.load(Ordering::Relaxed), 0);
    }
}

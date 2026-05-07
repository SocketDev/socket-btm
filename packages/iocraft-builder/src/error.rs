//! Error types for iocraft-builder.
//!
//! Provides domain-specific error types for better error handling and debugging.

use thiserror::Error;

/// Errors that can occur when working with iocraft components.
#[derive(Error, Debug)]
pub enum IocraftError {
    /// Failed to deserialize component tree from JSON
    #[error("Failed to deserialize component tree: {0}")]
    DeserializationError(#[from] serde_json::Error),

    /// Terminal operation failed
    #[error("Terminal operation failed: {0}")]
    TerminalError(#[from] std::io::Error),

    /// Renderer is already running
    #[error("Renderer is already running. Call stop() first.")]
    RendererAlreadyRunning,
}

/// Convert IocraftError to NAPI Error for JavaScript boundary
impl From<IocraftError> for napi::Error {
    fn from(err: IocraftError) -> Self {
        napi::Error::from_reason(err.to_string())
    }
}

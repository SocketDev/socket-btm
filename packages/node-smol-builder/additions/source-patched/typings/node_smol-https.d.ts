/**
 * node:smol-https - High-Performance HTTPS Server
 *
 * TLS wrapper around node:smol-http with all the same performance features:
 * - **llhttp parser**: Node.js native HTTP parser (same as core http module)
 * - **Trie-based router**: O(log n) route matching without array allocation
 * - **Object pooling**: Reuses parsers, buffers, and request objects
 * - **Socket corking**: Batches writes for optimal TCP performance
 * - **TLS via Node.js**: Uses native tls.createServer for secure connections
 *
 * Provides a Bun.serve-compatible API for direct performance comparison.
 * Default port is 443 (standard HTTPS).
 *
 * Like Node.js's https module, this only exports the serve() function.
 * For HTTP utilities (caching, fast responses, etc.), import from
 * node:smol-http directly.
 *
 * @example
 * ```ts
 * import { serve } from 'node:smol-https';
 * import { readFileSync } from 'node:fs';
 *
 * const server = serve({
 *   port: 443,
 *   key: readFileSync('server.key'),
 *   cert: readFileSync('server.cert'),
 *   fetch(req) {
 *     return new Response('Hello Secure World!');
 *   }
 * });
 *
 * console.log(`Listening on ${server.url}`);
 * ```
 *
 * @module
 */

declare module 'node:smol-https' {
  import type { TlsOptions } from 'tls';
  import type {
    ServeRequest,
    Server,
    Routes,
    WebSocketHandlers,
  } from 'node:smol-http';

  /**
   * Options for the serve() function with required TLS configuration.
   * Extends the base ServeOptions with TLS requirements.
   */
  export interface ServeHttpsOptions<T = unknown> {
    /** Port to listen on (default: 443 for HTTPS) */
    port?: number | undefined;
    /** Hostname to bind to (default: '0.0.0.0') */
    hostname?: string | undefined;
    /** Unix socket path (overrides port/hostname) */
    unix?: string | undefined;
    /** Connection idle timeout in seconds (default: 10, 0 to disable) */
    idleTimeout?: number | undefined;
    /**
     * Maximum request body size in bytes (default: 10485760 = 10MB).
     * Requests exceeding this limit receive 413 Payload Too Large with JSON error body.
     */
    maxBodySize?: number | undefined;
    /** Route handlers mapping patterns to handlers */
    routes?: Routes | undefined;
    /** WebSocket event handlers */
    websocket?: WebSocketHandlers<T> | undefined;
    /**
     * Error handler called when fetch handler throws.
     * Can return a Response for error recovery (e.g., custom error pages).
     * In development mode, errors are also logged to console.
     */
    error?: ((error: Error) => Response | void) | undefined;
    /**
     * Whether to run in development mode (default: NODE_ENV !== 'production').
     * In development mode, errors are logged to console.
     */
    development?: boolean | undefined;
    /** Request handler function - receives Request and Server like Bun */
    fetch: (request: ServeRequest, server: Server) => Response | Promise<Response> | object | string | undefined;

    // TLS Options (at least key/cert or tls object required)

    /** TLS private key (PEM format) - alternative to tls.key */
    key?: Buffer | string | undefined;
    /** TLS certificate (PEM format) - alternative to tls.cert */
    cert?: Buffer | string | undefined;
    /** TLS CA certificate(s) (PEM format) - alternative to tls.ca */
    ca?: Buffer | string | undefined;
    /** Passphrase for private key - alternative to tls.passphrase */
    passphrase?: string | undefined;
    /**
     * Full TLS options object (Node.js tls.createServer options).
     * Can be used instead of or in addition to individual key/cert/ca/passphrase.
     */
    tls?: TlsOptions | undefined;
  }

  /**
   * Create a high-performance HTTPS server with Bun.serve-compatible API.
   * Requires TLS options (key/cert or tls object).
   *
   * @example
   * ```ts
   * import { serve } from 'node:smol-https';
   * import { readFileSync } from 'node:fs';
   *
   * // Basic HTTPS server with key/cert
   * const server = serve({
   *   port: 443,
   *   key: readFileSync('server.key'),
   *   cert: readFileSync('server.cert'),
   *   fetch(req) {
   *     return new Response('Hello HTTPS!');
   *   }
   * });
   *
   * // With TLS options object
   * const server = serve({
   *   port: 8443,
   *   tls: {
   *     key: readFileSync('server.key'),
   *     cert: readFileSync('server.cert'),
   *     ca: readFileSync('ca.cert'),
   *     minVersion: 'TLSv1.2',
   *   },
   *   fetch(req) {
   *     return new Response('Hello HTTPS with TLS options!');
   *   }
   * });
   *
   * // With routes
   * const server = serve({
   *   port: 443,
   *   key: readFileSync('server.key'),
   *   cert: readFileSync('server.cert'),
   *   routes: {
   *     '/api/secure/:id': (req) => Response.json({ id: req.params.id }),
   *   },
   *   fetch(req) {
   *     return new Response('Not found', { status: 404 });
   *   }
   * });
   * ```
   *
   * @throws {TypeError} If no TLS options are provided
   */
  export function serve<T = unknown>(options: ServeHttpsOptions<T>): Server;

  // ============================================================================
  // Default Export
  // ============================================================================

  const _default: {
    serve: typeof serve;
  };

  export default _default;
}

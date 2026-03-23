/**
 * node:smol-http - High-Performance HTTP Server & Utilities
 *
 * A zero-overhead HTTP server optimized for maximum throughput with:
 * - **llhttp parser**: Node.js native HTTP parser (same as core http module)
 * - **Trie-based router**: O(log n) route matching without array allocation
 * - **Object pooling**: Reuses parsers, buffers, and request objects
 * - **Socket corking**: Batches writes for optimal TCP performance
 * - **Pre-computed headers**: Zero-allocation status lines and content-lengths
 * - **Primordials**: Prototype-pollution safe (no user code can break internals)
 *
 * Provides a Bun.serve-compatible API for direct performance comparison.
 *
 * @example
 * ```ts
 * import { serve } from 'node:smol-http';
 *
 * const server = serve({
 *   port: 3000,
 *   routes: {
 *     '/api/users/:id': (req) => Response.json({ id: req.params.id }),
 *   },
 *   fetch(req) {
 *     return new Response('Hello World');
 *   }
 * });
 *
 * console.log(`Listening on ${server.url}`);
 * ```
 *
 * @module
 */

declare module 'node:smol-http' {
  import type { IncomingMessage, ServerResponse } from 'http';
  import type { Socket } from 'net';

  // ============================================================================
  // Bun.serve-compatible API
  // ============================================================================

  /**
   * Request object passed to fetch handler (Web Request API compatible).
   * Extended with pathname, query, and params for convenience.
   */
  export interface ServeRequest {
    /** HTTP method (GET, POST, etc.) */
    method: string;
    /** Full URL including protocol and host */
    url: string;
    /** URL pathname (e.g., '/api/users/123') */
    pathname: string;
    /** Parsed query parameters */
    query: Record<string, string>;
    /** Route parameters from pattern matching (e.g., { id: '123' }) */
    params: Record<string, string>;
    /** Request headers (Headers-like interface) */
    headers: {
      get(name: string): string | undefined;
      has(name: string): boolean;
      entries(): IterableIterator<[string, string]>;
      keys(): IterableIterator<string>;
      values(): IterableIterator<string>;
      forEach(callback: (value: string, name: string) => void): void;
    };
    /** Request body as string */
    body: string;
    /** Get body as text */
    text(): Promise<string>;
    /** Parse body as JSON */
    json(): Promise<unknown>;
    /** Get body as ArrayBuffer */
    arrayBuffer(): Promise<ArrayBuffer>;
  }

  /**
   * Client IP information returned by server.requestIP().
   */
  export interface RequestIPInfo {
    /** IP address of the client */
    address: string;
    /** Port number of the client */
    port: number;
    /** IP family (IPv4 or IPv6) */
    family: string;
  }

  // ============================================================================
  // Routes API
  // ============================================================================

  /**
   * Route handler function.
   */
  export type RouteHandler = (request: ServeRequest, server: Server) => Response | Promise<Response> | object | string | null;

  /**
   * Per-method route handlers.
   */
  export interface MethodHandlers {
    GET?: RouteHandler | undefined;
    POST?: RouteHandler | undefined;
    PUT?: RouteHandler | undefined;
    DELETE?: RouteHandler | undefined;
    PATCH?: RouteHandler | undefined;
    HEAD?: RouteHandler | undefined;
    OPTIONS?: RouteHandler | undefined;
    '*'?: RouteHandler | undefined;
  }

  /**
   * Routes configuration object.
   * Keys are URL patterns supporting :param and * wildcards.
   */
  export interface Routes {
    [pattern: string]: RouteHandler | MethodHandlers;
  }

  // ============================================================================
  // WebSocket API
  // ============================================================================

  /**
   * WebSocket connection instance.
   */
  export interface ServerWebSocket<T = unknown> {
    /** User-attached data */
    data: T;
    /** WebSocket ready state (0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED) */
    readonly readyState: number;
    /** Remote IP address */
    readonly remoteAddress: string;
    /** Array of topics this WebSocket is subscribed to */
    readonly subscriptions: string[];

    /** Send data (auto-detects text vs binary) */
    send(data: string | Buffer, compress?: boolean | undefined): void;
    /** Send text message */
    sendText(text: string, compress?: boolean | undefined): void;
    /** Send binary message */
    sendBinary(data: Buffer, compress?: boolean | undefined): void;
    /** Close the connection gracefully */
    close(code?: number | undefined, reason?: string | undefined): void;
    /** Immediately terminate the connection (no close handshake) */
    terminate(): void;
    /** Send ping frame */
    ping(data?: string | Buffer | undefined): void;
    /** Send pong frame */
    pong(data?: string | Buffer | undefined): void;

    /** Subscribe to a pub/sub topic */
    subscribe(topic: string): void;
    /** Unsubscribe from a topic */
    unsubscribe(topic: string): void;
    /** Check if subscribed to topic */
    isSubscribed(topic: string): boolean;
    /**
     * Publish to all subscribers of a topic EXCEPT this WebSocket.
     * Use server.publish() to include all subscribers.
     * @returns Number of recipients
     */
    publish(topic: string, data: string | Buffer, compress?: boolean | undefined): number;
    /** Publish text to all subscribers except this WebSocket */
    publishText(topic: string, text: string, compress?: boolean | undefined): number;
    /** Publish binary to all subscribers except this WebSocket */
    publishBinary(topic: string, data: Buffer, compress?: boolean | undefined): number;

    /** Cork writes for batching */
    cork(callback: () => void): void;
  }

  /**
   * WebSocket event handlers.
   */
  export interface WebSocketHandlers<T = unknown> {
    /** Called when connection opens */
    open?: ((ws: ServerWebSocket<T>) => void) | undefined;
    /** Called when message received */
    message?: ((ws: ServerWebSocket<T>, message: string | Buffer) => void) | undefined;
    /** Called when connection closes */
    close?: ((ws: ServerWebSocket<T>, code: number, reason: string) => void) | undefined;
    /** Called when socket is ready for more data (backpressure relief) */
    drain?: ((ws: ServerWebSocket<T>) => void) | undefined;
    /** Called on ping frame */
    ping?: ((ws: ServerWebSocket<T>, data: Buffer) => void) | undefined;
    /** Called on pong frame */
    pong?: ((ws: ServerWebSocket<T>, data: Buffer) => void) | undefined;
    /** Called on error */
    error?: ((ws: ServerWebSocket<T>, error: Error) => void) | undefined;
  }

  /**
   * Options for the serve() function (Bun.serve-compatible).
   */
  export interface ServeOptions<T = unknown> {
    /** Port to listen on (default: 3000, 0 for random) */
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
  }

  /**
   * Server instance returned by serve() (Bun.serve-compatible).
   */
  export interface Server {
    /** Whether server is running in development mode */
    readonly development: boolean;
    /** Actual port the server is listening on */
    readonly port: number;
    /** Hostname the server is bound to */
    readonly hostname: string;
    /** Full URL of the server */
    readonly url: URL;
    /** Number of pending HTTP requests */
    readonly pendingRequests: number;
    /** Number of active WebSocket connections */
    readonly pendingWebSockets: number;

    /**
     * Get subscriber count for a pub/sub topic.
     * @param topic Topic name
     */
    subscriberCount(topic: string): number;

    /**
     * Publish message to all subscribers of a topic.
     * @param topic Topic name
     * @param data Message data
     * @param compress Whether to compress
     * @returns Number of recipients
     */
    publish(topic: string, data: string | Buffer, compress?: boolean | undefined): number;

    /**
     * Get the IP address and port of the client making the request.
     * @param req The request object from fetch handler
     * @returns Client IP info or null if not available
     */
    requestIP(req: ServeRequest): RequestIPInfo | undefined;

    /**
     * Upgrade an HTTP request to WebSocket.
     * Returns true if upgrade was requested, false if not a valid WebSocket request.
     * @param req The request object
     * @param data Optional data to attach to the WebSocket
     * @returns true if upgrade requested, false if invalid WebSocket request
     */
    upgrade<T = unknown>(req: ServeRequest, data?: T | undefined): boolean;

    /**
     * Reload the server with new options (hot reload).
     * @param options New options to apply
     */
    reload(options: Partial<ServeOptions>): void;

    /**
     * Stop the server.
     * @param closeActiveConnections Force close active connections (default: false)
     * @returns Promise that resolves when server is stopped
     */
    stop(closeActiveConnections?: boolean | undefined): Promise<void>;
  }

  /**
   * Create a high-performance HTTP server with Bun.serve-compatible API.
   *
   * @example
   * ```ts
   * // Basic server
   * const server = serve({
   *   port: 3000,
   *   fetch(req, server) {
   *     return new Response('Hello World');
   *   }
   * });
   *
   * // With routes
   * const server = serve({
   *   port: 3000,
   *   routes: {
   *     '/api/users/:id': (req) => Response.json({ id: req.params.id }),
   *     '/api/posts/*': (req) => Response.json({ path: req.params.$wildcard }),
   *     '/api/items': {
   *       GET: (req) => Response.json([]),
   *       POST: (req) => Response.json({ created: true }),
   *     },
   *   },
   *   fetch(req) {
   *     return new Response('Not found', { status: 404 });
   *   }
   * });
   *
   * // With WebSocket
   * const server = serve({
   *   port: 3000,
   *   websocket: {
   *     open(ws) {
   *       ws.subscribe('chat');
   *     },
   *     message(ws, msg) {
   *       ws.publish('chat', msg);
   *     },
   *     close(ws) {
   *       console.log('Disconnected');
   *     },
   *   },
   *   fetch(req, server) {
   *     if (req.headers.get('upgrade') === 'websocket') {
   *       return server.upgrade(req, { userId: 123 });
   *     }
   *     return new Response('Hello');
   *   }
   * });
   *
   * // Unix socket
   * const server = serve({
   *   unix: '/tmp/my-app.sock',
   *   fetch(req) {
   *     return new Response('Hello from Unix socket');
   *   }
   * });
   * ```
   */
  export function serve<T = unknown>(options: ServeOptions<T>): Server;

  // ============================================================================
  // Response Writers
  // ============================================================================

  /**
   * Write a JSON response directly to the socket.
   */
  export function writeJsonResponse(
    res: ServerResponse,
    data: object,
    statusCode?: number | undefined
  ): void;

  /**
   * Write a 404 Not Found response.
   */
  export function writeNotFound(res: ServerResponse): void;

  /**
   * Write a 304 Not Modified response.
   */
  export function writeNotModified(res: ServerResponse): void;

  /**
   * Write a tarball response with appropriate headers.
   */
  export function writeTarballResponse(
    res: ServerResponse,
    data: Buffer,
    filename: string
  ): void;

  // ============================================================================
  // Fast Responses (Native Bindings)
  // ============================================================================

  /**
   * Fast JSON response using native bindings.
   */
  export function fastJsonResponse(
    res: ServerResponse,
    data: object,
    statusCode?: number | undefined
  ): boolean;

  /**
   * Fast binary response using native bindings.
   */
  export function fastBinaryResponse(
    res: ServerResponse,
    data: Buffer,
    contentType: string,
    statusCode?: number | undefined
  ): boolean;

  /**
   * Fast 304 Not Modified response.
   */
  export function fastNotModified(res: ServerResponse): boolean;

  /**
   * Fast error response.
   */
  export function fastErrorResponse(
    res: ServerResponse,
    statusCode: number,
    message: string
  ): boolean;

  /**
   * Fast packument (npm package metadata) response.
   */
  export function fastPackumentResponse(
    res: ServerResponse,
    packument: object
  ): boolean;

  /**
   * Fast tarball response.
   */
  export function fastTarballResponse(
    res: ServerResponse,
    data: Buffer
  ): boolean;

  // ============================================================================
  // Cork Manager
  // ============================================================================

  /**
   * Manager for socket corking to batch writes.
   */
  export class CorkManager {
    cork(socket: Socket): void;
    uncork(socket: Socket): void;
  }

  /**
   * Execute a function with corked socket for batched writes.
   */
  export function withCork<T>(socket: Socket, fn: () => T): T;

  // ============================================================================
  // Header Cache
  // ============================================================================

  /**
   * Get cached Content-Length header.
   */
  export function getContentLength(length: number): string;

  /**
   * Get cached header value.
   */
  export function getHeader(name: string, value: string): string;

  /**
   * Get cached HTTP status line.
   */
  export function getStatusLine(statusCode: number): string;

  // ============================================================================
  // JSON Cache
  // ============================================================================

  /**
   * Clear the JSON cache.
   */
  export function clearCache(): void;

  /**
   * Create a cache key for JSON data.
   */
  export function createCacheKey(data: object): string;

  /**
   * Get cached JSON string.
   */
  export function getCachedJson(key: string): string | undefined;

  /**
   * Get cache statistics.
   */
  export function getCacheStats(): {
    hits: number;
    misses: number;
    size: number;
  };

  /**
   * Invalidate a cache entry.
   */
  export function invalidate(key: string): void;

  /**
   * Stringify and cache JSON data.
   */
  export function stringifyWithCache(key: string, data: object): string;

  // ============================================================================
  // ETag Cache
  // ============================================================================

  /**
   * ETag cache for HTTP caching.
   */
  export class ETagCache {
    set(path: string, etag: string, data: Buffer | string): void;
    get(path: string, clientEtag: string): Buffer | string | undefined;
    has(path: string): boolean;
    delete(path: string): void;
    clear(): void;
  }

  /**
   * Global ETag cache instance.
   */
  export const etagCache: ETagCache;

  // ============================================================================
  // Auth Cache
  // ============================================================================

  /**
   * Authentication token cache.
   */
  export class AuthCache {
    set(token: string, user: object, ttlMs?: number | undefined): void;
    get(token: string): object | undefined;
    has(token: string): boolean;
    delete(token: string): void;
    clear(): void;
  }

  /**
   * Global auth cache instance.
   */
  export const authCache: AuthCache;

  // ============================================================================
  // Compression Cache
  // ============================================================================

  /**
   * Compression result cache.
   */
  export class CompressionCache {
    set(key: string, compressed: Buffer): void;
    get(key: string): Buffer | undefined;
    has(key: string): boolean;
    delete(key: string): void;
    clear(): void;
  }

  /**
   * Global compression cache instance.
   */
  export const compressionCache: CompressionCache;

  // ============================================================================
  // Version Subset
  // ============================================================================

  /**
   * Get version subset statistics.
   */
  export function getSubsetStats(): { processed: number; cached: number };

  /**
   * SemVer utilities.
   */
  export const semver: {
    satisfies(version: string, range: string): boolean;
    maxSatisfying(versions: string[], range: string): string | undefined;
  };

  /**
   * Create a subset of a packument for a specific version range.
   */
  export function subsetPackument(
    packument: object,
    range: string
  ): object;

  // ============================================================================
  // Dependency Graph
  // ============================================================================

  /**
   * Dependency graph for package resolution.
   */
  export class DependencyGraph {
    addPackage(name: string, version: string, deps: Record<string, string>): void;
    getPackage(name: string, version: string): object | undefined;
    getDependencies(name: string, version: string): string[];
    resolve(name: string, range: string): string | undefined;
  }

  /**
   * Global dependency graph instance.
   */
  export const dependencyGraph: DependencyGraph;

  // ============================================================================
  // HTTP/2 Helpers
  // ============================================================================

  /**
   * Create an HTTP/2 server with optimizations.
   */
  export function createHttp2Server(
    handler: (req: object, res: object) => void
  ): object;

  /**
   * Get HTTP/2 statistics.
   */
  export function getHttp2Stats(): {
    streams: number;
    pushes: number;
  };

  /**
   * Optimize an HTTP/2 session.
   */
  export function optimizeHttp2Session(session: object): void;

  /**
   * Send packument with dependency preloads via HTTP/2 push.
   */
  export function sendPackumentWithDeps(
    res: object,
    packument: object,
    deps: string[]
  ): void;

  /**
   * Send response with preloaded resources via HTTP/2 push.
   */
  export function sendWithPreloads(
    res: object,
    data: Buffer | string,
    preloads: string[]
  ): void;

  // ============================================================================
  // Default Export
  // ============================================================================

  const _default: {
    serve: typeof serve;
    writeJsonResponse: typeof writeJsonResponse;
    writeNotFound: typeof writeNotFound;
    writeNotModified: typeof writeNotModified;
    writeTarballResponse: typeof writeTarballResponse;
    CorkManager: typeof CorkManager;
    withCork: typeof withCork;
    getContentLength: typeof getContentLength;
    getHeader: typeof getHeader;
    getStatusLine: typeof getStatusLine;
    fastBinaryResponse: typeof fastBinaryResponse;
    fastErrorResponse: typeof fastErrorResponse;
    fastJsonResponse: typeof fastJsonResponse;
    fastNotModified: typeof fastNotModified;
    fastPackumentResponse: typeof fastPackumentResponse;
    fastTarballResponse: typeof fastTarballResponse;
    clearCache: typeof clearCache;
    createCacheKey: typeof createCacheKey;
    getCachedJson: typeof getCachedJson;
    getCacheStats: typeof getCacheStats;
    invalidate: typeof invalidate;
    stringifyWithCache: typeof stringifyWithCache;
    ETagCache: typeof ETagCache;
    etagCache: typeof etagCache;
    AuthCache: typeof AuthCache;
    authCache: typeof authCache;
    CompressionCache: typeof CompressionCache;
    compressionCache: typeof compressionCache;
    getSubsetStats: typeof getSubsetStats;
    semver: typeof semver;
    subsetPackument: typeof subsetPackument;
    DependencyGraph: typeof DependencyGraph;
    dependencyGraph: typeof dependencyGraph;
    createHttp2Server: typeof createHttp2Server;
    getHttp2Stats: typeof getHttp2Stats;
    optimizeHttp2Session: typeof optimizeHttp2Session;
    sendPackumentWithDeps: typeof sendPackumentWithDeps;
    sendWithPreloads: typeof sendWithPreloads;
  };

  export default _default;
}

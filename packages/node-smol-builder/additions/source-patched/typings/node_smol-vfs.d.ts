/**
 * node:smol-vfs - Virtual Filesystem for SEA Applications
 *
 * A read-only embedded filesystem for Single Executable Applications (SEA).
 * Files are stored in a TAR archive format embedded in the binary.
 */
declare module 'node:smol-vfs' {
  import { Readable } from 'node:stream';
  import { Stats, Dirent } from 'node:fs';

  /** VFS operation modes */
  export const MODE_COMPAT: number;
  export const MODE_IN_MEMORY: number;
  export const MODE_ON_DISK: number;

  /** Maximum symlink recursion depth (matches uvwasi) */
  export const MAX_SYMLINK_DEPTH: 32;

  /** Error class for VFS operations */
  export class VFSError extends Error {
    code: string;
    path?: string;
    syscall?: string;
    errno?: number;
    constructor(message: string, options?: { code?: string; path?: string; syscall?: string });
  }

  // ============================================================================
  // Core State
  // ============================================================================

  /** Check if running as SEA with embedded VFS files */
  export function hasVFS(): boolean;

  /** Get VFS configuration */
  export function config(): {
    available: boolean;
    prefix?: string;
    mode?: number;
    source?: string;
  };

  /** Get the VFS mount prefix (e.g., '/snapshot') */
  export function prefix(): string;

  /** Get total number of entries in VFS */
  export function size(): number;

  /** Check if LIEF support is available for SEA building */
  export function canBuildSea(): boolean;

  // ============================================================================
  // Sync File Operations (fs-compatible)
  // ============================================================================

  /** Check if a file exists in VFS */
  export function existsSync(filepath: string): boolean;

  /** Read a file from VFS */
  export function readFileSync(filepath: string): Buffer;
  export function readFileSync(filepath: string, options: { encoding: BufferEncoding }): string;
  export function readFileSync(filepath: string, options: BufferEncoding): string;
  export function readFileSync(filepath: string, options?: { encoding?: BufferEncoding } | BufferEncoding): Buffer | string;

  /** Get file stats from VFS */
  export function statSync(filepath: string, options?: object): Stats;

  /** Get file stats without following symlinks */
  export function lstatSync(filepath: string, options?: object): Stats;

  /** Read directory contents from VFS */
  export function readdirSync(filepath: string, options?: { withFileTypes?: false; recursive?: boolean }): string[];
  export function readdirSync(filepath: string, options: { withFileTypes: true; recursive?: boolean }): Dirent[];
  export function readdirSync(filepath: string, options: { recursive: true; withFileTypes?: false }): string[];
  export function readdirSync(filepath: string, options: { recursive: true; withFileTypes: true }): Dirent[];

  /** Check file accessibility */
  export function accessSync(filepath: string, mode?: number): void;

  /** Get real path (resolves symlinks) */
  export function realpathSync(filepath: string, options?: object): string;

  /** Read symlink target */
  export function readlinkSync(filepath: string, options?: object): string;

  // ============================================================================
  // File Descriptor Operations
  // ============================================================================

  /** Open a VFS file and return a real file descriptor */
  export function openSync(filepath: string, flags?: string | number, mode?: number): number;

  /** Close a file descriptor */
  export function closeSync(fd: number): void;

  /** Read from a file descriptor */
  export function readSync(fd: number, buffer: Buffer, offset: number, length: number, position: number | null): number;

  /** Get stats for an open file descriptor */
  export function fstatSync(fd: number, options?: object): Stats;

  /** Check if a file descriptor was opened via VFS */
  export function isVfsFd(fd: number): boolean;

  /** Get the original VFS path for a VFS-opened file descriptor */
  export function getVfsPath(fd: number): string | undefined;

  /** Get the real filesystem path for a VFS-opened file descriptor */
  export function getRealPath(fd: number): string | undefined;

  // ============================================================================
  // Async Operations (fs/promises compatible)
  // ============================================================================

  export namespace promises {
    export function exists(filepath: string): Promise<boolean>;
    export function readFile(filepath: string, options?: { encoding?: BufferEncoding } | BufferEncoding): Promise<Buffer | string>;
    export function stat(filepath: string, options?: object): Promise<Stats>;
    export function lstat(filepath: string, options?: object): Promise<Stats>;
    export function readdir(filepath: string, options?: { withFileTypes?: boolean }): Promise<string[] | Dirent[]>;
    export function access(filepath: string, mode?: number): Promise<void>;
    export function realpath(filepath: string, options?: object): Promise<string>;
    export function readlink(filepath: string, options?: object): Promise<string>;
    export function open(filepath: string, flags?: string | number, mode?: number): Promise<number>;
    export function fstat(fd: number, options?: object): Promise<Stats>;

    // Convenience methods (async wrappers)
    export function readFileAsJSON<T = unknown>(filepath: string): Promise<T>;
    export function readFileAsText(filepath: string, encoding?: BufferEncoding): Promise<string>;
    export function readFileAsBuffer(filepath: string): Promise<Buffer>;
    export function readMultiple(filepaths: string[], options?: { encoding?: BufferEncoding } | BufferEncoding): Promise<Array<{
      path: string;
      content: Buffer | string | undefined;
      error?: Error;
    }>>;
  }

  // ============================================================================
  // Streams
  // ============================================================================

  /** Create a readable stream from VFS file */
  export function createReadStream(filepath: string, options?: {
    start?: number;
    end?: number;
    encoding?: BufferEncoding;
    highWaterMark?: number;
  }): Readable;

  // ============================================================================
  // VFS-Specific Operations
  // ============================================================================

  /** List all files in the VFS */
  export function listFiles(options?: {
    prefix?: string;
    extension?: string;
  }): string[];

  /** Extract a VFS file to the real filesystem */
  export function mount(vfsPath: string, options?: { destPath?: string }): Promise<string>;

  /** Extract a VFS file to the real filesystem (sync) */
  export function mountSync(vfsPath: string, options?: { destPath?: string }): string;

  // ============================================================================
  // Native Addon Support
  // ============================================================================

  /** Handle loading a native addon from VFS */
  export function handleNativeAddon(path: string): string;

  /** Check if a path is a native addon (.node file) */
  export function isNativeAddon(path: string): boolean;

  // ============================================================================
  // Convenience Methods
  // ============================================================================

  /** Check if a path is a VFS path (starts with VFS prefix) */
  export function isVFSPath(filepath: string): boolean;

  /** Read a file from VFS and parse as JSON */
  export function readFileAsJSON<T = unknown>(filepath: string): T;

  /** Read a file from VFS as a text string */
  export function readFileAsText(filepath: string, encoding?: BufferEncoding): string;

  /** Read a file from VFS as a Buffer */
  export function readFileAsBuffer(filepath: string): Buffer;

  /** Read multiple files from VFS */
  export function readMultiple(filepaths: string[], options?: { encoding?: BufferEncoding } | BufferEncoding): Array<{
    path: string;
    content: Buffer | string | undefined;
    error?: Error;
  }>;

  /** Get comprehensive VFS stats in one call */
  export function getVFSStats(): {
    available: boolean;
    fileCount: number;
    prefix: string;
    mode: number | undefined;
  };

  /** Cache statistics for debugging */
  export interface CacheStats {
    /** Extraction mode ('on-disk', 'in-memory', or 'compat') */
    mode: string;
    /** Cache directory path (undefined for compat mode) */
    cacheDir: string | undefined;
    /** Number of files currently extracted */
    extractedCount: number;
    /** Whether cache persists across process restarts */
    persistent: boolean;
  }

  /** Get extraction cache statistics for debugging */
  export function getCacheStats(): CacheStats;
}

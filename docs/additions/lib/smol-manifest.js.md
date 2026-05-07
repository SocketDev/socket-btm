node:smol-manifest - High-Performance Manifest and Lockfile Parser
Supports package.json, package-lock.json, yarn.lock, pnpm-lock.yaml, etc.

Usage:
import { parse, parseLockfile, detectFormat } from 'node:smol-manifest';

// Auto-detect format from filename
const result = parse('package.json', content);

// Parse manifest
const manifest = parseManifest(content, 'npm');

// Parse lockfile
const lock = parseLockfile(content, 'npm');

// O(1) package lookup
const pkg = getPackage(lock, 'lodash');

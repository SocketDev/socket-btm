#!/usr/bin/env node
/**
 * Validate fast-webstreams integration in built Node.js binary
 *
 * Tests that the patched global WebStreams work correctly.
 * Based on tests from experimental-fast-webstreams but adapted
 * for our bootstrap-patched environment.
 *
 * Usage: node scripts/vendor-fast-webstreams/validate.mjs [binary-path]
 *
 * If no binary path provided, uses the dev Final binary.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PACKAGE_ROOT = path.resolve(__dirname, '../..')
const DEFAULT_BINARY = path.join(PACKAGE_ROOT, 'build/dev/out/Final/node/node')

// Test code to run in the built binary
// Tests are based on experimental-fast-webstreams test suite
const TEST_CODE = `
'use strict';

const assert = require('assert');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result
        .then(() => { passed++; console.log('  ✓', name); })
        .catch(err => { failed++; console.log('  ✗', name, '-', err.message); });
    }
    passed++;
    console.log('  ✓', name);
  } catch (err) {
    failed++;
    console.log('  ✗', name, '-', err.message);
  }
  return Promise.resolve();
}

async function runTests() {
  console.log('\\n=== fast-webstreams Integration Tests ===\\n');

  // Test 1: Globals are patched (ReadableStream is not native)
  console.log('Global Patching:');
  await test('ReadableStream is defined', () => {
    assert.strictEqual(typeof ReadableStream, 'function');
  });
  await test('WritableStream is defined', () => {
    assert.strictEqual(typeof WritableStream, 'function');
  });
  await test('TransformStream is defined', () => {
    assert.strictEqual(typeof TransformStream, 'function');
  });

  // Test 2: Basic ReadableStream functionality
  console.log('\\nReadableStream:');
  await test('read chunks from stream', async () => {
    const rs = new ReadableStream({
      start(controller) {
        controller.enqueue('hello');
        controller.enqueue('world');
        controller.close();
      }
    });
    const reader = rs.getReader();
    const r1 = await reader.read();
    assert.deepStrictEqual(r1, { value: 'hello', done: false });
    const r2 = await reader.read();
    assert.deepStrictEqual(r2, { value: 'world', done: false });
    const r3 = await reader.read();
    assert.deepStrictEqual(r3, { value: undefined, done: true });
  });

  // Test 3: Basic WritableStream functionality
  console.log('\\nWritableStream:');
  await test('write chunks to stream', async () => {
    const chunks = [];
    const ws = new WritableStream({
      write(chunk) { chunks.push(chunk); }
    });
    const writer = ws.getWriter();
    await writer.write('a');
    await writer.write('b');
    await writer.close();
    assert.deepStrictEqual(chunks, ['a', 'b']);
  });

  await test('desiredSize works (circular dep test)', async () => {
    const ws = new WritableStream({ write() {} }, { highWaterMark: 1024 });
    const writer = ws.getWriter();
    assert.strictEqual(typeof writer.desiredSize, 'number');
    assert.ok(writer.desiredSize > 0);
  });

  // Test 4: Basic TransformStream functionality
  console.log('\\nTransformStream:');
  await test('transform chunks', async () => {
    const ts = new TransformStream({
      transform(chunk, controller) {
        controller.enqueue(chunk.toUpperCase());
      }
    });
    const writer = ts.writable.getWriter();
    const reader = ts.readable.getReader();
    writer.write('hello');
    const r1 = await reader.read();
    assert.deepStrictEqual(r1, { value: 'HELLO', done: false });
    writer.close();
  });

  // Test 5: pipeTo between streams
  console.log('\\npipeTo:');
  await test('pipe readable to writable', async () => {
    const chunks = [];
    const rs = new ReadableStream({
      start(controller) {
        controller.enqueue(1);
        controller.enqueue(2);
        controller.enqueue(3);
        controller.close();
      }
    });
    const ws = new WritableStream({
      write(chunk) { chunks.push(chunk); }
    });
    await rs.pipeTo(ws);
    assert.deepStrictEqual(chunks, [1, 2, 3]);
  });

  // Test 6: pipeThrough with transform
  console.log('\\npipeThrough:');
  await test('pipe through transform', async () => {
    const results = [];
    const rs = new ReadableStream({
      start(controller) {
        controller.enqueue('a');
        controller.enqueue('b');
        controller.close();
      }
    });
    const ts = new TransformStream({
      transform(chunk, controller) {
        controller.enqueue(chunk + '!');
      }
    });
    const ws = new WritableStream({
      write(chunk) { results.push(chunk); }
    });
    await rs.pipeThrough(ts).pipeTo(ws);
    assert.deepStrictEqual(results, ['a!', 'b!']);
  });

  // Test 7: Byte streams
  console.log('\\nByte Streams:');
  await test('byte stream with start+enqueue pattern', async () => {
    const rs = new ReadableStream({
      type: 'bytes',
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      }
    });
    const reader = rs.getReader();
    const r1 = await reader.read();
    assert.ok(r1.value instanceof Uint8Array);
    assert.deepStrictEqual([...r1.value], [1, 2, 3]);
  });

  await test('byte stream with pull', async () => {
    const rs = new ReadableStream({
      type: 'bytes',
      pull(controller) {
        controller.enqueue(new Uint8Array([65, 66]));
        controller.close();
      }
    });
    const reader = rs.getReader();
    const { value } = await reader.read();
    assert.strictEqual(new TextDecoder().decode(value), 'AB');
  });

  // Test 8: Tee (concurrent drain)
  console.log('\\nTee:');
  await test('tee concurrent drain', async () => {
    const rs = new ReadableStream({
      start(controller) {
        controller.enqueue('x');
        controller.enqueue('y');
        controller.close();
      }
    });
    const [b1, b2] = rs.tee();

    async function drain(reader) {
      const chunks = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      return chunks;
    }

    const [c1, c2] = await Promise.all([
      drain(b1.getReader()),
      drain(b2.getReader())
    ]);
    assert.deepStrictEqual(c1, ['x', 'y']);
    assert.deepStrictEqual(c2, ['x', 'y']);
  });

  // Test 9: Response integration
  console.log('\\nResponse Integration:');
  await test('new Response(stream).text()', async () => {
    const rs = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('hello'));
        controller.close();
      }
    });
    const text = await new Response(rs).text();
    assert.strictEqual(text, 'hello');
  });

  await test('Response.json() with stream body', async () => {
    const rs = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"a":1}'));
        controller.close();
      }
    });
    const json = await new Response(rs).json();
    assert.deepStrictEqual(json, { a: 1 });
  });

  // Test 10: Async iteration
  console.log('\\nAsync Iteration:');
  await test('for await...of stream', async () => {
    const rs = new ReadableStream({
      start(controller) {
        controller.enqueue(1);
        controller.enqueue(2);
        controller.enqueue(3);
        controller.close();
      }
    });
    const chunks = [];
    for await (const chunk of rs) {
      chunks.push(chunk);
    }
    assert.deepStrictEqual(chunks, [1, 2, 3]);
  });

  // Summary
  console.log('\\n=== Results ===');
  console.log('Passed:', passed);
  console.log('Failed:', failed);

  process.exitCode = failed > 0 ? 1 : 0;
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exitCode = 1;
});
`

async function main() {
  const binaryPath = process.argv[2] || DEFAULT_BINARY

  if (!existsSync(binaryPath)) {
    logger.fail(`Binary not found: ${binaryPath}`)
    logger.log('\nBuild the binary first:')
    logger.log(
      '  pnpm --filter node-smol-builder clean && pnpm --filter node-smol-builder build',
    )
    process.exitCode = 1
    return
  }

  logger.info('=== fast-webstreams Validation ===')
  logger.info(`Binary: ${binaryPath}`)

  // Run tests in the built binary
  const child = spawn(binaryPath, ['-e', TEST_CODE], {
    stdio: 'inherit',
    env: { ...process.env },
  })

  child.on('close', code => {
    process.exitCode = code
  })

  child.on('error', err => {
    logger.fail('Failed to run validation:', err.message)
    process.exitCode = 1
  })
}

main()

/**
 * @fileoverview Tests for the re-exported `errorMessage` helper.
 *
 * `../lib/error-utils.mts` is a thin re-export of
 * `@socketsecurity/lib/errors#errorMessage`. Its spec: return the message
 * (with cause chain) for Errors; coerce primitives to string; fall back to
 * the shared `UNKNOWN_ERROR` sentinel ("Unknown error") for null,
 * undefined, empty string, `[object Object]`, and Errors whose chain
 * produces no message.
 */

import { UNKNOWN_ERROR } from '@socketsecurity/lib/errors'

import { errorMessage } from '../lib/error-utils.mts'

describe('errorMessage', () => {
  it('returns message for Error instances', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom')
  })

  it('returns message for subclasses of Error', () => {
    expect(errorMessage(new TypeError('bad type'))).toBe('bad type')
  })

  it('stringifies thrown strings', () => {
    expect(errorMessage('just a string')).toBe('just a string')
  })

  it('stringifies thrown numbers', () => {
    expect(errorMessage(42)).toBe('42')
  })

  it('returns UNKNOWN_ERROR for undefined', () => {
    expect(errorMessage(undefined)).toBe(UNKNOWN_ERROR)
  })

  it('returns UNKNOWN_ERROR for null', () => {
    expect(errorMessage(null)).toBe(UNKNOWN_ERROR)
  })

  it('returns UNKNOWN_ERROR for plain objects that stringify to [object Object]', () => {
    expect(errorMessage({ foo: 'bar' })).toBe(UNKNOWN_ERROR)
  })

  it('returns UNKNOWN_ERROR for Error without a message', () => {
    expect(errorMessage(new Error())).toBe(UNKNOWN_ERROR)
  })
})

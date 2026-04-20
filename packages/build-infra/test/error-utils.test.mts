/**
 * @fileoverview Tests for error-utils helper.
 */

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

  it('handles undefined without returning "undefined" via error.message', () => {
    expect(errorMessage(undefined)).toBe('undefined')
  })

  it('handles null', () => {
    expect(errorMessage(null)).toBe('null')
  })

  it('stringifies plain objects', () => {
    expect(errorMessage({ foo: 'bar' })).toBe('[object Object]')
  })

  it('returns empty string for Error without message', () => {
    expect(errorMessage(new Error())).toBe('')
  })
})

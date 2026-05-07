import { describe, expect, it } from 'vitest'

import { load } from '../lib/index.mts'

describe('ultraviolet decoder binding', () => {
  it('decodes the CSI up-arrow sequence', async () => {
    const uv = await load()
    const dec = uv.newDecoder()
    const events = uv.decode(dec, Buffer.from('\x1b[A'))
    expect(events.length).toBeGreaterThan(0)
    expect(events[0].type).toBe('KeyPress')
  })

  it('decodes a plain ASCII key press', async () => {
    const uv = await load()
    const dec = uv.newDecoder()
    const events = uv.decode(dec, Buffer.from('a'))
    expect(events.length).toBeGreaterThan(0)
    expect(events[0].type).toBe('KeyPress')
    expect((events[0] as any).text).toBe('a')
  })

  it('decodes an SGR mouse event', async () => {
    const uv = await load()
    const dec = uv.newDecoder()
    // CSI < 0 ; 10 ; 5 M — left click at (10, 5)
    const events = uv.decode(dec, Buffer.from('\x1b[<0;10;5M'))
    expect(events.length).toBeGreaterThan(0)
    expect(events[0].type).toBe('MouseClick')
    expect((events[0] as any).x).toBe(9) // ultraviolet zero-indexes
    expect((events[0] as any).y).toBe(4)
  })

  it('decodes bracketed paste wrappers', async () => {
    const uv = await load()
    const dec = uv.newDecoder()
    const events = uv.decode(dec, Buffer.from('\x1b[200~'))
    expect(events.length).toBeGreaterThan(0)
    expect(events[0].type).toBe('PasteStart')
  })

  it('decoders are independent across instances', async () => {
    const uv = await load()
    const a = uv.newDecoder()
    const b = uv.newDecoder()
    expect(a).not.toBe(b)
    const eva = uv.decode(a, Buffer.from('x'))
    const evb = uv.decode(b, Buffer.from('y'))
    expect((eva[0] as any).text).toBe('x')
    expect((evb[0] as any).text).toBe('y')
  })
})

# @node-smol/ai

`@node-smol/ai` provides a text-only implementation of Chrome's Prompt API for
Node.js. The same API is built into Socket's Node runtime as `node:smol-ai`.

```js
const { LanguageModel } = require('@node-smol/ai')

if ((await LanguageModel.availability()) !== 'unavailable') {
  const session = await LanguageModel.create({
    seed: 42,
    temperature: 0,
    threads: 1,
    topK: 1,
  })
  console.log(await session.prompt('Write one short sentence.'))
  session.destroy()
}
```

The native implementation is API-compatible, not engine-identical, with
Chrome. Chrome manages Gemini Nano through its on-device model service. This
package pins llama.cpp and acquires a checksum-pinned GGUF model on first
`create()`. Calling `availability()` or `params()` never starts a download.

Downloads are written to a content-addressed user cache, resumed after
transient failures, and promoted atomically only after their byte length and
SHA-256 match the manifest. The GGUF is not bundled in this package. Set
`SMOL_AI_MODEL_CACHE` to choose a cache root.

Every session exposes its backend, model checksum, seed, sampling values, and
thread count through `session.reproducibility`. For repeatable CPU inference,
keep `temperature: 0`, `topK: 1`, `threads: 1`, and a fixed seed.

The initial implementation supports text prompts and text messages. Image,
audio, and tool inputs reject with `NotSupportedError` instead of silently
changing behavior.

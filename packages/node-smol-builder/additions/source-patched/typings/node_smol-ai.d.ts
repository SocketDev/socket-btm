declare module 'node:smol-ai' {
  export interface LanguageModelCreateOptions {
    readonly expectedInputs?: readonly LanguageModelModality[]
    readonly expectedOutputs?: readonly LanguageModelModality[]
    readonly maxTokens?: number
    monitor?(monitor: LanguageModelMonitor): void
    readonly seed?: number
    readonly signal?: AbortSignal
    readonly temperature?: number
    readonly threads?: number
    readonly topK?: number
  }

  export interface LanguageModelMessage {
    readonly content: string
    readonly role: 'assistant' | 'system' | 'user'
  }

  export interface LanguageModelModality {
    readonly languages?: readonly string[]
    readonly type: string
  }

  export interface LanguageModelMonitor {
    addEventListener(
      type: 'downloadprogress',
      listener: (event: { readonly loaded: number }) => void,
    ): void
  }

  export interface LanguageModelSession {
    readonly inputQuota: number
    readonly inputUsage: number
    readonly reproducibility: Readonly<{
      backend: string
      model: string
      modelSha256: string
      seed: number
      temperature: number
      threads: number
      topK: number
    }>
    clone(): Promise<LanguageModelSession>
    destroy(): void
    measureInputUsage(input: LanguageModelPrompt): Promise<number>
    prompt(
      input: LanguageModelPrompt,
      options?: { readonly signal?: AbortSignal },
    ): Promise<string>
    promptStreaming(
      input: LanguageModelPrompt,
      options?: { readonly signal?: AbortSignal },
    ): ReadableStream<string>
  }

  export type LanguageModelPrompt =
    | string
    | LanguageModelMessage
    | readonly LanguageModelMessage[]

  export const LanguageModel: Readonly<{
    availability(): Promise<
      'available' | 'downloadable' | 'downloading' | 'unavailable'
    >
    readonly capabilities: Readonly<{
      deterministicSeed: true
      text: true
      tools: false
      vision: false
    }>
    create(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>
    params(): Promise<Readonly<{
      defaultTemperature: number
      defaultTopK: number
      maxTemperature: number
      maxTopK: number
    }>>
  }>
}

export interface LanguageModelCreateOptions {
  readonly expectedInputs?: readonly LanguageModelModality[] | undefined
  readonly expectedOutputs?: readonly LanguageModelModality[] | undefined
  readonly maxTokens?: number | undefined
  monitor?(monitor: LanguageModelMonitor): void
  readonly seed?: number | undefined
  readonly signal?: AbortSignal | undefined
  readonly temperature?: number | undefined
  readonly threads?: number | undefined
  readonly topK?: number | undefined
}

export interface LanguageModelMessage {
  readonly content: string
  readonly role: 'assistant' | 'system' | 'user'
}

export interface LanguageModelModality {
  readonly languages?: readonly string[] | undefined
  readonly type: string
}

export interface LanguageModelMonitor {
  addEventListener(
    type: 'downloadprogress',
    listener: (event: { readonly loaded: number }) => void,
  ): void
}

export interface LanguageModelParams {
  readonly defaultTemperature: number
  readonly defaultTopK: number
  readonly maxTemperature: number
  readonly maxTopK: number
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
  measureInputUsage(
    input: string | LanguageModelMessage | readonly LanguageModelMessage[],
  ): Promise<number>
  prompt(
    input: string | LanguageModelMessage | readonly LanguageModelMessage[],
    options?: { readonly signal?: AbortSignal | undefined },
  ): Promise<string>
  promptStreaming(
    input: string | LanguageModelMessage | readonly LanguageModelMessage[],
    options?: { readonly signal?: AbortSignal | undefined },
  ): ReadableStream<string>
}

export interface LanguageModelFactory {
  readonly capabilities: Readonly<{
    deterministicSeed: true
    text: true
    tools: false
    vision: false
  }>
  availability(): Promise<
    'available' | 'downloadable' | 'downloading' | 'unavailable'
  >
  create(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>
  params(): Promise<LanguageModelParams>
}

export const LanguageModel: LanguageModelFactory

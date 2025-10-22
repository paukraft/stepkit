export type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (
  k: infer I
) => void
  ? I
  : never

export type MergeOutputs<TOutputs extends readonly unknown[]> = UnionToIntersection<
  TOutputs[number]
>

export type WithoutIndex<T> = {
  [K in keyof T as string extends K
    ? never
    : number extends K
      ? never
      : symbol extends K
        ? never
        : K]: T[K]
}

// Step functions can return output or void (treated as {})
export type StepFunction<TContext, TOutput extends Record<string, unknown>> = (
  context: TContext
) => TOutput | Promise<TOutput> | void | Promise<void>

export type MergePolicy = 'override' | 'error' | 'warn' | 'skip'

export type ParallelMode = 'all' | 'settled'

export type RetryConfig = {
  retries?: number
  retryDelayMs?: number | ((attempt: number, error: Error) => number)
  shouldRetry?: (error: Error) => boolean
}

export type CircuitBreakerConfig = {
  failureThreshold?: number
  cooldownMs?: number
  behaviorOnOpen?: 'throw' | 'skip'
}

export type StepConfig<TCtx = unknown> = {
  name?: string
  condition?: boolean | ((context: TCtx) => boolean | Promise<boolean>)
  onError?: 'throw' | 'continue' | 'skip-remaining'
  log?: boolean
  timeout?: number
  parallelMode?: ParallelMode
  mergePolicy?: MergePolicy
} & RetryConfig & { circuitBreaker?: CircuitBreakerConfig }

// Helper type to make outputs optional when step has a condition
export type MakeConditionalOutputOptional<TConfig, TOutput> = TConfig extends {
  condition: any
}
  ? Partial<TOutput>
  : TOutput

// Make outputs optional when onError allows failure or timeout is set
// (step might not complete successfully, so outputs may not be present)
export type MakeErrorHandlingOutputOptional<TConfig, TOutput> = TConfig extends {
  onError: infer H
}
  ? H extends 'continue' | 'skip-remaining'
    ? Partial<TOutput>
    : TConfig extends { timeout: number }
      ? Partial<TOutput>
      : TOutput
  : TConfig extends { timeout: number }
    ? Partial<TOutput>
    : TOutput

// Combine both conditional and error handling optionality
export type MakeSafeOutput<TConfig, TOutput> = MakeConditionalOutputOptional<
  TConfig,
  MakeErrorHandlingOutputOptional<TConfig, TOutput>
>

type HasKey<T, K extends PropertyKey> = K extends keyof T ? true : false

// For transform(): when a condition is present, runtime either keeps previous context
// (when skipped) or replaces it with new context (when executed). To reflect both
// possibilities statically, expose both shapes as optional properties so downstream
// steps can safely access either with undefined checks.
// Also applies when onError allows failures or timeout is set.
export type TransformResultContext<TPrev, TNew, TConfig> =
  HasKey<TConfig, 'condition'> extends true
    ? Partial<TPrev> & Partial<TNew>
    : HasKey<TConfig, 'onError'> extends true
      ? TConfig extends { onError: infer H }
        ? H extends 'continue' | 'skip-remaining'
          ? Partial<TPrev> & Partial<TNew>
          : HasKey<TConfig, 'timeout'> extends true
            ? Partial<TPrev> & Partial<TNew>
            : TNew
        : TNew
      : HasKey<TConfig, 'timeout'> extends true
        ? Partial<TPrev> & Partial<TNew>
        : TNew

export type StepHistoryRecord<TName extends string, TCtx> = {
  name: TName
  ctx: TCtx
}

export type AppendHistory<
  THistory extends readonly StepHistoryRecord<string, unknown>[],
  TName extends string,
  TCtx
> = [...THistory, StepHistoryRecord<TName, TCtx>]

// Prefix each step name in a sub-history with a parent prefix
export type PrefixHistory<
  TH extends readonly StepHistoryRecord<string, unknown>[],
  P extends string
> = TH extends readonly [infer H, ...infer T]
  ? H extends StepHistoryRecord<infer N, infer C>
    ? [
        StepHistoryRecord<`${P}/${Extract<N, string>}`, C>,
        ...PrefixHistory<Extract<T, readonly StepHistoryRecord<string, unknown>[]>, P>
      ]
    : []
  : []

// Append multiple history records in order
export type AppendMany<
  TH extends readonly StepHistoryRecord<string, unknown>[],
  TMore extends readonly StepHistoryRecord<string, unknown>[]
> = [...TH, ...TMore]

// Append a union of history tuples to an existing history producing a union of results
export type AppendHistoryUnion<
  TH extends readonly StepHistoryRecord<string, unknown>[],
  U
> = U extends readonly StepHistoryRecord<string, unknown>[] ? [...TH, ...U] : never

export type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (
  k: infer I
) => void
  ? I
  : never

export type MergeOutputs<TOutputs extends readonly unknown[]> = UnionToIntersection<
  TOutputs[number]
>

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

// For transform(): when a condition is present, runtime either keeps previous context
// (when skipped) or replaces it with new context (when executed). To reflect both
// possibilities statically, expose both shapes as optional properties so downstream
// steps can safely access either with undefined checks.
// Also applies when onError allows failures or timeout is set.
export type TransformResultContext<TPrev, TNew, TConfig> = TConfig extends {
  condition: any
}
  ? Partial<TPrev> & Partial<TNew>
  : TConfig extends { onError: infer H }
    ? H extends 'continue' | 'skip-remaining'
      ? Partial<TPrev> & Partial<TNew>
      : TConfig extends { timeout: number }
        ? Partial<TPrev> & Partial<TNew>
        : TNew
    : TConfig extends { timeout: number }
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

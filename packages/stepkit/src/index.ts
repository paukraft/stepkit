import { StepkitBuilder } from './builder'
import type { PipelineConfig } from './runtime'

export const stepkit = <TInput extends Record<string, unknown> = {}>(config?: PipelineConfig) =>
  new StepkitBuilder<TInput, TInput>(config)

/**
 * Extract all step names from a pipeline builder.
 * Only works with explicitly named steps (not anonymous steps).
 *
 * @example
 * const pipeline = stepkit()
 *   .step('fetch-user', () => ({ name: 'John' }))
 *   .step('process', () => ({ result: 'done' }))
 *
 * type Names = StepNames<typeof pipeline> // 'fetch-user' | 'process'
 */
export type StepNames<TBuilder> = TBuilder extends {
  __history: readonly (infer TRecord)[]
}
  ? TRecord extends { name: infer TName }
    ? TName extends string
      ? string extends TName
        ? never
        : TName
      : never
    : never
  : never

/**
 * Get the input context available to a specific named step.
 * This is the context as it exists when the step begins execution.
 *
 * @example
 * const pipeline = stepkit<{ id: string }>()
 *   .step('fetch-user', ({ id }) => ({ name: 'John' }))
 *   .step('process', ({ name }) => ({ result: 'done' }))
 *
 * type ProcessInput = StepInput<typeof pipeline, 'process'>
 * // { id: string; name: string }
 */
type WithoutIndex<T> = {
  [K in keyof T as string extends K
    ? never
    : number extends K
      ? never
      : symbol extends K
        ? never
        : K]: T[K]
}

export type StepInput<TBuilder, TName extends StepNames<TBuilder>> = TBuilder extends {
  __history: readonly (infer TRecord)[]
}
  ? Extract<TRecord, { name: TName }> extends { ctx: infer TCtx }
    ? TCtx
    : never
  : never

type BuilderHistory<TBuilder> = TBuilder extends { __history: infer TH }
  ? TH extends readonly { name: string; ctx: unknown }[]
    ? TH
    : never
  : never

type BuilderFinalContext<TBuilder> =
  TBuilder extends StepkitBuilder<any, infer TCtx, any> ? TCtx : never

type StepAfterCtxMap<TH, TFinalCtx> = TH extends readonly [infer TFirst, ...infer TRest]
  ? TFirst extends { name: infer TStepName; ctx: any }
    ? TRest extends readonly [infer TNext, ...infer _]
      ? TNext extends { ctx: infer TNextCtx }
        ? { [K in Extract<TStepName, string>]: TNextCtx } & StepAfterCtxMap<
            Extract<TRest, readonly unknown[]>,
            TFinalCtx
          >
        : { [K in Extract<TStepName, string>]: TFinalCtx } & StepAfterCtxMap<
            Extract<TRest, readonly unknown[]>,
            TFinalCtx
          >
      : { [K in Extract<TStepName, string>]: TFinalCtx } & StepAfterCtxMap<
          Extract<TRest, readonly unknown[]>,
          TFinalCtx
        >
    : StepAfterCtxMap<Extract<TRest, readonly unknown[]>, TFinalCtx>
  : {}

type LookupAfterCtx<M, K extends string, F> = K extends keyof M ? M[K] : F

/**
 * Get the output context from a pipeline.
 *
 * Without a step name: returns the final context after all steps.
 * With a step name: returns the context after the named step completes
 * (or the final context if it's the last step).
 *
 * @example
 * const pipeline = stepkit<{ id: string }>()
 *   .step('fetch-user', ({ id }) => ({ name: 'John' }))
 *   .step('process', ({ name }) => ({ result: 'done' }))
 *
 * type FinalOutput = StepOutput<typeof pipeline>
 * // { id: string; name: string; result: string }
 *
 * type AfterFetch = StepOutput<typeof pipeline, 'fetch-user'>
 * // { id: string; name: string } (context right before 'process')
 */
export type StepOutput<TBuilder, TName extends StepNames<TBuilder> | never = never> = [
  TName
] extends [never]
  ? BuilderFinalContext<TBuilder>
  : LookupAfterCtx<
      StepAfterCtxMap<BuilderHistory<TBuilder>, BuilderFinalContext<TBuilder>>,
      Extract<TName, string>,
      BuilderFinalContext<TBuilder>
    >

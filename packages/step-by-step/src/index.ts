import { StepkitBuilder } from './builder'
import type { PipelineConfig } from './runtime'

export const stepkit = <TInput extends Record<string, unknown> = Record<string, unknown>>(
  config?: PipelineConfig
) => new StepkitBuilder<TInput, TInput>(config)

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
    ? TName
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

type StepOutputFromHistory<TH, TFinalCtx, TName extends string> = TH extends readonly [
  infer TFirst,
  ...infer TRest
]
  ? TFirst extends { name: infer TStepName; ctx: any }
    ? TStepName extends TName
      ? TRest extends readonly [infer _TNext, infer TNext2, ...infer _]
        ? TNext2 extends { ctx: infer TNext2Ctx }
          ? TNext2Ctx
          : TFinalCtx
        : TFinalCtx
      : StepOutputFromHistory<TRest, TFinalCtx, TName>
    : never
  : never

/**
 * Get the output context from a pipeline.
 *
 * Without a step name: returns the final context after all steps.
 * With a step name: returns the context after the step immediately following the named step
 * (or the final context if it's the last/penultimate step).
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
 * // { id: string; name: string; result: string } (includes next step's output)
 */
export type StepOutput<TBuilder, TName extends StepNames<TBuilder> | never = never> = [
  TName
] extends [never]
  ? BuilderFinalContext<TBuilder>
  : StepOutputFromHistory<
      BuilderHistory<TBuilder>,
      BuilderFinalContext<TBuilder>,
      Extract<TName, string>
    >

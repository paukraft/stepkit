import {
  formatDuration,
  getDisplayName,
  type InternalRuntime,
  type PipelineConfig,
  type StepTimingInfo
} from './runtime'
import {
  AppendHistory,
  MakeSafeOutput,
  MergeOutputs,
  StepConfig,
  StepFunction,
  TransformResultContext,
  UnionToIntersection
} from './types'
import { deepClone, isPlainObject, mergeWithPolicy } from './utils'

type DiffNewKeys<TNew, TOld> = Omit<TNew, keyof TOld>

type StepExecutor<TCtx = unknown> = {
  name: string
  fn: (context: TCtx, runtime?: InternalRuntime) => Promise<Record<string, unknown>>
  config: StepConfig<TCtx>
  replaceContext?: boolean
  kind?: 'step' | 'transform' | 'branch'
  branchCases?: (
    | {
        name?: string
        when: (ctx: TCtx) => boolean | Promise<boolean>
        then:
          | StepkitBuilder<TCtx, any, any>
          | ((builder: StepkitBuilder<any, TCtx, any>) => StepkitBuilder<any, any, any>)
      }
    | {
        name?: string
        default:
          | StepkitBuilder<TCtx, any, any>
          | ((builder: StepkitBuilder<any, TCtx, any>) => StepkitBuilder<any, any, any>)
      }
  )[]
}

type CaseReturnContext<TCtx, TCase> = TCase extends { then: (b: any) => infer R }
  ? R extends StepkitBuilder<any, infer TSubCtx, any>
    ? DiffNewKeys<TSubCtx, TCtx>
    : never
  : TCase extends { then: StepkitBuilder<TCtx, infer TSubCtx, any> }
    ? DiffNewKeys<TSubCtx, TCtx>
    : TCase extends { default: (b: any) => infer R2 }
      ? R2 extends StepkitBuilder<any, infer TSubCtx2, any>
        ? DiffNewKeys<TSubCtx2, TCtx>
        : never
      : TCase extends { default: StepkitBuilder<TCtx, infer TSubCtx3, any> }
        ? DiffNewKeys<TSubCtx3, TCtx>
        : never

type MergeBranchOutputs<TCtx, TCases extends readonly unknown[]> = Partial<
  UnionToIntersection<CaseReturnContext<TCtx, TCases[number]>>
>

export class StepkitBuilder<
  TInput,
  TContext,
  THistory extends readonly { name: string; ctx: unknown }[] = readonly []
> {
  private steps: StepExecutor<TContext>[] = []
  private config: PipelineConfig
  readonly __history!: THistory
  private circuitState = new Map<string, { failures: number; openedAt: number | null }>()

  constructor(config: PipelineConfig = {}) {
    this.config = config
  }

  step<TOutputs extends readonly Record<string, unknown>[]>(
    ...fns: {
      [K in keyof TOutputs]: StepFunction<TContext, TOutputs[K]>
    }
  ): StepkitBuilder<
    TInput,
    TContext & MergeOutputs<TOutputs>,
    AppendHistory<THistory, string, TContext>
  >

  step<TOutputs extends readonly Record<string, unknown>[], TName extends string>(
    name: TName,
    ...fns: {
      [K in keyof TOutputs]: StepFunction<TContext, TOutputs[K]>
    }
  ): StepkitBuilder<
    TInput,
    TContext & MergeOutputs<TOutputs>,
    AppendHistory<THistory, TName, TContext>
  >

  step<
    TOutputs extends readonly Record<string, unknown>[],
    TName extends string,
    TConfig extends StepConfig<TContext> & { name: TName }
  >(
    config: TConfig,
    ...fns: {
      [K in keyof TOutputs]: StepFunction<TContext, TOutputs[K]>
    }
  ): StepkitBuilder<
    TInput,
    TContext & MakeSafeOutput<TConfig, MergeOutputs<TOutputs>>,
    AppendHistory<THistory, TName, TContext>
  >

  step<TOutputs extends readonly Record<string, unknown>[], TConfig extends StepConfig<TContext>>(
    config: TConfig,
    ...fns: {
      [K in keyof TOutputs]: StepFunction<TContext, TOutputs[K]>
    }
  ): StepkitBuilder<
    TInput,
    TContext & MakeSafeOutput<TConfig, MergeOutputs<TOutputs>>,
    AppendHistory<THistory, string, TContext>
  >

  step<TOutputs extends readonly Record<string, unknown>[]>(
    nameOrConfigOrFn: string | StepConfig<TContext> | StepFunction<TContext, TOutputs[0]>,
    ...fns: {
      [K in keyof TOutputs]: StepFunction<TContext, TOutputs[K]>
    }
  ): any {
    let stepName: string
    let stepConfig: StepConfig<TContext>
    let allFns: StepFunction<TContext, Record<string, unknown>>[]

    if (typeof nameOrConfigOrFn === 'string') {
      stepName = nameOrConfigOrFn
      stepConfig = {}
      allFns = fns as StepFunction<TContext, Record<string, unknown>>[]
    } else if (typeof nameOrConfigOrFn === 'object') {
      stepConfig = nameOrConfigOrFn
      stepName = stepConfig.name ?? `step-${this.steps.length + 1}`
      allFns = fns as StepFunction<TContext, Record<string, unknown>>[]
    } else {
      stepName = `step-${this.steps.length + 1}`
      stepConfig = {}
      allFns = [nameOrConfigOrFn, ...fns] as unknown as StepFunction<
        TContext,
        Record<string, unknown>
      >[]
    }

    const stepExecutor = async (context: TContext, runtime?: InternalRuntime) => {
      const policy = stepConfig.mergePolicy ?? 'override'
      const parallelMode = stepConfig.parallelMode ?? 'all'
      if (parallelMode === 'settled') {
        const results = await Promise.allSettled(allFns.map((fn) => Promise.resolve(fn(context))))
        const merged: Record<string, unknown> = {}
        for (const r of results) {
          if (r.status === 'fulfilled') {
            const value = r.value
            if (!isPlainObject(value)) throw new TypeError('Step function must return an object')
            const cloned = deepClone(value)
            const onCollision = (key: string) => runtime?.logFn?.(`⚠️ Key collision on '${key}'`)
            const out = mergeWithPolicy(merged, cloned, policy, onCollision)
            Object.assign(merged, out)
          } else {
            runtime?.errorLogFn?.('   Parallel function failed:', r.reason)
          }
        }
        return merged
      } else {
        const results = await Promise.all(allFns.map((fn) => Promise.resolve(fn(context))))
        return results.reduce<Record<string, unknown>>((acc, result) => {
          if (!isPlainObject(result)) throw new TypeError('Step function must return an object')
          const cloned = deepClone(result)
          const onCollision = (key: string) => runtime?.logFn?.(`⚠️ Key collision on '${key}'`)
          return mergeWithPolicy(acc, cloned, policy, onCollision)
        }, {})
      }
    }

    const newBuilder = new StepkitBuilder<TInput, any, any>(this.config)
    newBuilder.steps = [
      ...this.steps,
      { name: stepName, fn: stepExecutor as any, config: stepConfig as any, kind: 'step' }
    ]
    return newBuilder as any
  }

  branchOn<
    TCases extends readonly (
      | {
          name?: string
          when: (ctx: TContext) => boolean | Promise<boolean>
          then:
            | StepkitBuilder<TContext, any, any>
            | ((builder: StepkitBuilder<any, TContext, any>) => StepkitBuilder<any, any, any>)
        }
      | {
          name?: string
          default:
            | StepkitBuilder<TContext, any, any>
            | ((builder: StepkitBuilder<any, TContext, any>) => StepkitBuilder<any, any, any>)
        }
    )[]
  >(
    ...cases: TCases
  ): StepkitBuilder<
    TInput,
    TContext & MergeBranchOutputs<TContext, TCases>,
    AppendHistory<THistory, string, TContext>
  >

  branchOn<
    TName extends string,
    TCases extends readonly (
      | {
          name?: string
          when: (ctx: TContext) => boolean | Promise<boolean>
          then:
            | StepkitBuilder<TContext, any, any>
            | ((builder: StepkitBuilder<any, TContext, any>) => StepkitBuilder<any, any, any>)
        }
      | {
          name?: string
          default:
            | StepkitBuilder<TContext, any, any>
            | ((builder: StepkitBuilder<any, TContext, any>) => StepkitBuilder<any, any, any>)
        }
    )[]
  >(
    name: TName,
    ...cases: TCases
  ): StepkitBuilder<
    TInput,
    TContext & MergeBranchOutputs<TContext, TCases>,
    AppendHistory<THistory, TName, TContext>
  >

  branchOn<
    TName extends string,
    TCases extends readonly (
      | {
          name?: string
          when: (ctx: TContext) => boolean | Promise<boolean>
          then:
            | StepkitBuilder<TContext, any, any>
            | ((builder: StepkitBuilder<any, TContext, any>) => StepkitBuilder<any, any, any>)
        }
      | {
          name?: string
          default:
            | StepkitBuilder<TContext, any, any>
            | ((builder: StepkitBuilder<any, TContext, any>) => StepkitBuilder<any, any, any>)
        }
    )[]
  >(
    config: StepConfig<TContext> & { name: TName },
    ...cases: TCases
  ): StepkitBuilder<
    TInput,
    TContext & MergeBranchOutputs<TContext, TCases>,
    AppendHistory<THistory, TName, TContext>
  >

  branchOn<
    TCases extends readonly (
      | {
          name?: string
          when: (ctx: TContext) => boolean | Promise<boolean>
          then:
            | StepkitBuilder<TContext, any, any>
            | ((builder: StepkitBuilder<any, TContext, any>) => StepkitBuilder<any, any, any>)
        }
      | {
          name?: string
          default:
            | StepkitBuilder<TContext, any, any>
            | ((builder: StepkitBuilder<any, TContext, any>) => StepkitBuilder<any, any, any>)
        }
    )[]
  >(
    config: StepConfig<TContext>,
    ...cases: TCases
  ): StepkitBuilder<
    TInput,
    TContext & MergeBranchOutputs<TContext, TCases>,
    AppendHistory<THistory, string, TContext>
  >

  branchOn(
    nameOrConfigOrCase:
      | string
      | StepConfig<TContext>
      | {
          name?: string
          when?: (ctx: TContext) => boolean | Promise<boolean>
          then?:
            | StepkitBuilder<TContext, any, any>
            | ((builder: StepkitBuilder<any, TContext, any>) => StepkitBuilder<any, any, any>)
          default?:
            | StepkitBuilder<TContext, any, any>
            | ((builder: StepkitBuilder<any, TContext, any>) => StepkitBuilder<any, any, any>)
        },
    ...restCases: (
      | {
          name?: string
          when: (ctx: TContext) => boolean | Promise<boolean>
          then:
            | StepkitBuilder<TContext, any, any>
            | ((builder: StepkitBuilder<any, TContext, any>) => StepkitBuilder<any, any, any>)
        }
      | {
          name?: string
          default:
            | StepkitBuilder<TContext, any, any>
            | ((builder: StepkitBuilder<any, TContext, any>) => StepkitBuilder<any, any, any>)
        }
    )[]
  ): any {
    let stepName: string
    let stepConfig: StepConfig<TContext>
    let cases: (
      | {
          name?: string
          when: (ctx: TContext) => boolean | Promise<boolean>
          then:
            | StepkitBuilder<TContext, any, any>
            | ((builder: StepkitBuilder<any, TContext, any>) => StepkitBuilder<any, any, any>)
        }
      | {
          name?: string
          default:
            | StepkitBuilder<TContext, any, any>
            | ((builder: StepkitBuilder<any, TContext, any>) => StepkitBuilder<any, any, any>)
        }
    )[]

    const isBranchSpec = (obj: unknown): boolean => {
      if (!obj || typeof obj !== 'object') return false
      const o = obj as any
      return (
        (typeof o.when === 'function' &&
          (typeof o.then === 'function' || o.then instanceof StepkitBuilder)) ||
        typeof o.default === 'function' ||
        o.default instanceof StepkitBuilder
      )
    }

    if (typeof nameOrConfigOrCase === 'string') {
      stepName = nameOrConfigOrCase
      stepConfig = {}
      cases = restCases
    } else if (isBranchSpec(nameOrConfigOrCase)) {
      stepConfig = {}
      stepName = `branch-${this.steps.length + 1}`
      cases = [nameOrConfigOrCase as any, ...restCases]
    } else {
      stepConfig = (nameOrConfigOrCase as StepConfig<TContext>) ?? {}
      stepName = stepConfig.name ?? `branch-${this.steps.length + 1}`
      cases = restCases
    }

    const stepExecutor = async (context: TContext, runtime?: InternalRuntime) => {
      let selected:
        | {
            name?: string
            when?: (ctx: TContext) => boolean | Promise<boolean>
            then?:
              | StepkitBuilder<TContext, any, any>
              | ((builder: StepkitBuilder<any, TContext, any>) => StepkitBuilder<any, any, any>)
            default?:
              | StepkitBuilder<TContext, any, any>
              | ((builder: StepkitBuilder<any, TContext, any>) => StepkitBuilder<any, any, any>)
          }
        | undefined
      let defaultCase:
        | {
            name?: string
            default:
              | StepkitBuilder<TContext, any, any>
              | ((builder: StepkitBuilder<any, TContext, any>) => StepkitBuilder<any, any, any>)
          }
        | undefined

      for (const c of cases) {
        if (
          'default' in c &&
          (typeof (c as any).default === 'function' || (c as any).default instanceof StepkitBuilder)
        ) {
          defaultCase = c as any
          continue
        }
        if ('when' in c && typeof c.when === 'function') {
          const match = await Promise.resolve(c.when(context))
          if (match) {
            selected = c as any
            break
          }
        }
      }

      const chosen = selected ?? defaultCase
      if (!chosen) return {}

      const caseName = chosen.name ?? ('when' in chosen ? 'branch-case' : 'default-case')

      if (runtime?.globalLog) {
        const displayName = getDisplayName(runtime, caseName)
        runtime.logFn(`   ↳ Executing: ${displayName}`)
      }

      const base = new StepkitBuilder<TContext, TContext>(this.config)
      let built: StepkitBuilder<any, any, any>
      if ('then' in chosen && chosen.then !== undefined) {
        built =
          typeof chosen.then === 'function'
            ? (
                chosen.then as (
                  b: StepkitBuilder<any, TContext, any>
                ) => StepkitBuilder<any, any, any>
              )(base as StepkitBuilder<any, TContext, any>)
            : (chosen.then as StepkitBuilder<TContext, any, any>)
      } else {
        const def = (chosen as any).default
        built =
          typeof def === 'function'
            ? (def as (b: StepkitBuilder<any, TContext, any>) => StepkitBuilder<any, any, any>)(
                base as StepkitBuilder<any, TContext, any>
              )
            : (def as StepkitBuilder<TContext, any, any>)
      }

      if (runtime) {
        const nestedRuntime: InternalRuntime = {
          ...runtime,
          namePrefix: [...runtime.namePrefix, caseName]
        }
        const subContext = await built.runWithRuntime(context, nestedRuntime)
        const output: Record<string, unknown> = {}
        const existingKeys = new Set(Object.keys(context as Record<string, unknown>))
        for (const [key, value] of Object.entries(subContext as Record<string, unknown>))
          if (!existingKeys.has(key)) output[key] = value
        return output
      } else {
        const subContext = await built.run(context)
        const output: Record<string, unknown> = {}
        const existingKeys = new Set(Object.keys(context as Record<string, unknown>))
        for (const [key, value] of Object.entries(subContext as Record<string, unknown>))
          if (!existingKeys.has(key)) output[key] = value
        return output
      }
    }

    const newBuilder = new StepkitBuilder<TInput, any, any>(this.config)
    newBuilder.steps = [
      ...this.steps,
      {
        name: stepName,
        fn: stepExecutor as any,
        config: stepConfig as any,
        kind: 'branch',
        branchCases: cases as any
      }
    ]
    return newBuilder as any
  }

  transform<TNewContext extends Record<string, any>>(
    fn: (context: TContext) => TNewContext | Promise<TNewContext>
  ): StepkitBuilder<TInput, TNewContext, AppendHistory<THistory, string, TContext>>

  transform<TNewContext extends Record<string, any>, TName extends string>(
    name: TName,
    fn: (context: TContext) => TNewContext | Promise<TNewContext>
  ): StepkitBuilder<TInput, TNewContext, AppendHistory<THistory, TName, TContext>>

  transform<
    TNewContext extends Record<string, any>,
    TName extends string,
    TConfig extends StepConfig<TContext> & { name: TName }
  >(
    config: TConfig,
    fn: (context: TContext) => TNewContext | Promise<TNewContext>
  ): StepkitBuilder<
    TInput,
    TransformResultContext<TContext, TNewContext, TConfig>,
    AppendHistory<THistory, TName, TContext>
  >

  transform<TNewContext extends Record<string, any>, TConfig extends StepConfig<TContext>>(
    config: TConfig,
    fn: (context: TContext) => TNewContext | Promise<TNewContext>
  ): StepkitBuilder<
    TInput,
    TransformResultContext<TContext, TNewContext, TConfig>,
    AppendHistory<THistory, string, TContext>
  >

  transform<TNewContext extends Record<string, any>>(
    nameOrConfigOrFn:
      | string
      | StepConfig<TContext>
      | ((context: TContext) => TNewContext | Promise<TNewContext>),
    maybeFn?: (context: TContext) => TNewContext | Promise<TNewContext>
  ): any {
    let transformName: string
    let transformConfig: StepConfig<TContext>
    let fn: (context: TContext) => TNewContext | Promise<TNewContext>

    if (typeof nameOrConfigOrFn === 'string') {
      transformName = nameOrConfigOrFn
      transformConfig = {}
      fn = maybeFn!
    } else if (typeof nameOrConfigOrFn === 'object') {
      transformConfig = nameOrConfigOrFn
      transformName = transformConfig.name ?? `transform-${this.steps.length + 1}`
      fn = maybeFn!
    } else {
      transformName = `transform-${this.steps.length + 1}`
      transformConfig = {}
      fn = nameOrConfigOrFn
    }

    const newBuilder = new StepkitBuilder<TInput, any, any>(this.config)
    newBuilder.steps = [
      ...this.steps,
      {
        name: transformName,
        fn: async (context: TContext) => {
          const result = await Promise.resolve(fn(context))
          return result as unknown as Record<string, unknown>
        },
        config: transformConfig as any,
        replaceContext: true,
        kind: 'transform'
      }
    ]
    return newBuilder as any
  }

  run = async (input: TInput, options?: PipelineConfig): Promise<TContext> => {
    const configLog = this.config.log
    const optionsLog = options?.log
    const globalLog =
      optionsLog !== undefined
        ? typeof optionsLog === 'boolean'
          ? optionsLog
          : true
        : typeof configLog === 'boolean'
          ? configLog
          : configLog !== undefined
    const configLogFn = typeof configLog === 'object' ? configLog.logFn : undefined
    const optionsLogFn = typeof optionsLog === 'object' ? optionsLog.logFn : undefined
    const logFn = optionsLogFn ?? configLogFn ?? console.log
    const configErrorLogFn = typeof configLog === 'object' ? configLog.errorLogFn : undefined
    const optionsErrorLogFn = typeof optionsLog === 'object' ? optionsLog.errorLogFn : undefined
    const errorLogFn = optionsErrorLogFn ?? configErrorLogFn ?? console.error
    const configStopwatch = typeof configLog === 'object' ? configLog.stopwatch : undefined
    const optionsStopwatch = typeof optionsLog === 'object' ? optionsLog.stopwatch : undefined
    const stopwatchConfig = optionsStopwatch ?? configStopwatch
    const stopwatchEnabled = stopwatchConfig !== undefined && stopwatchConfig !== false
    const showStepDuration =
      typeof stopwatchConfig === 'object'
        ? (stopwatchConfig.showStepDuration ?? true)
        : stopwatchEnabled
    const showSummary =
      typeof stopwatchConfig === 'object' ? (stopwatchConfig.showSummary ?? true) : stopwatchEnabled
    const showTotal =
      typeof stopwatchConfig === 'object' ? (stopwatchConfig.showTotal ?? true) : stopwatchEnabled
    const stepTimings: StepTimingInfo[] = []
    const pipelineStartTime = Date.now()

    const onStepComplete = (stepName: string, output: any, duration: number) => {
      this.config.onStepComplete?.(stepName, output, duration)
      options?.onStepComplete?.(stepName, output, duration)
    }
    const onError = (stepName: string, error: Error) => {
      this.config.onError?.(stepName, error)
      options?.onError?.(stepName, error)
    }

    const runtime: InternalRuntime = {
      globalLog,
      logFn,
      errorLogFn,
      stopwatchEnabled,
      showStepDuration,
      showSummary,
      showTotal,
      stepTimings,
      pipelineStartTime,
      onStepComplete,
      onError,
      namePrefix: [],
      signal: options?.signal ?? this.config.signal
    }

    if (globalLog) logFn('🚀 Starting pipeline with input:', input)
    const result = await this.runWithRuntime(input, runtime)

    if (stopwatchEnabled && globalLog) {
      const totalDuration = Date.now() - pipelineStartTime
      if (showSummary && stepTimings.length > 0) {
        logFn('\n⏱️  Performance Summary:')
        const boxWidth = 54
        const border = '─'.repeat(boxWidth)
        logFn(`┌${border}┐`)
        stepTimings.forEach((timing) => {
          const statusIcon =
            timing.status === 'success' ? '✅' : timing.status === 'failed' ? '❌' : '⏭️'
          const durationStr =
            timing.status === 'skipped' ? 'skipped' : formatDuration(timing.duration)
          const availableForName = boxWidth - 5 - durationStr.length
          const name = timing.name.padEnd(availableForName)
          logFn(`│ ${statusIcon} ${name}${durationStr} │`)
        })
        logFn(`└${border}┘`)
        const successfulSteps = stepTimings.filter((t) => t.status === 'success')
        if (successfulSteps.length > 0) {
          const totalStepTime = successfulSteps.reduce((acc, t) => acc + t.duration, 0)
          const avgDuration = Math.round(totalStepTime / successfulSteps.length)
          const slowestStep = successfulSteps.reduce((max, step) =>
            step.duration > max.duration ? step : max
          )
          const fastestStep = successfulSteps.reduce((min, step) =>
            step.duration < min.duration ? step : min
          )
          logFn(`\n📊 Statistics:`)
          logFn(`   Average: ${formatDuration(avgDuration)}`)
          logFn(`   Slowest: ${slowestStep.name} (${formatDuration(slowestStep.duration)})`)
          logFn(`   Fastest: ${fastestStep.name} (${formatDuration(fastestStep.duration)})`)
        }
      }
      if (showTotal) logFn(`\n⏰ Total Pipeline Time: ${formatDuration(totalDuration)}`)
    }

    if (globalLog) logFn('\n✨ Pipeline completed successfully')
    return result
  }

  runWithRuntime = async (input: TInput, runtime: InternalRuntime): Promise<TContext> => {
    let context: any = deepClone(input as unknown as Record<string, unknown>)
    for (const stepExecutor of this.steps) {
      const stepLog = stepExecutor.config.log ?? runtime.globalLog
      const displayName = getDisplayName(runtime, stepExecutor.name)

      if (runtime.signal?.aborted) {
        const abortError = new Error('Pipeline aborted')
        runtime.onError?.(displayName, abortError)
        if (stepExecutor.config.onError === 'skip-remaining') break
        throw abortError
      }

      if (stepExecutor.config.condition !== undefined) {
        const shouldExecute =
          typeof stepExecutor.config.condition === 'function'
            ? await Promise.resolve(stepExecutor.config.condition(context))
            : stepExecutor.config.condition
        if (!shouldExecute) {
          if (stepLog) runtime.logFn(`\n⏭️  Step: ${displayName} (skipped)`)
          if (runtime.stopwatchEnabled)
            runtime.stepTimings.push({ name: displayName, duration: 0, status: 'skipped' })
          continue
        }
      }

      const startTime = Date.now()
      try {
        if (stepLog) {
          const stepIcon =
            stepExecutor.kind === 'transform' ? '🔄' : stepExecutor.kind === 'branch' ? '🔀' : '📍'
          const stepLabel =
            stepExecutor.kind === 'transform'
              ? 'Transform'
              : stepExecutor.kind === 'branch'
                ? 'Branch'
                : 'Step'
          runtime.logFn(`\n${stepIcon} ${stepLabel}: ${displayName}`)
        }

        let stepOutput: unknown
        const timeoutMs = stepExecutor.config.timeout
        const hasValidTimeout =
          typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
        if (hasValidTimeout) {
          let timeoutId: NodeJS.Timeout | undefined
          try {
            const timeoutPromise = new Promise((_, reject) => {
              timeoutId = setTimeout(
                () => reject(new Error(`Step '${displayName}' timed out after ${timeoutMs}ms`)),
                timeoutMs
              )
            })
            const abortPromise = runtime.signal
              ? new Promise((_, reject) => {
                  const onAbort = () => reject(new Error('Pipeline aborted'))
                  if (runtime.signal?.aborted) {
                    onAbort()
                    return
                  }
                  runtime.signal?.addEventListener('abort', onAbort, { once: true })
                })
              : undefined

            const attemptOnce = async () => stepExecutor.fn(context, runtime)

            const withRace = async () =>
              abortPromise
                ? Promise.race([attemptOnce(), timeoutPromise, abortPromise])
                : Promise.race([attemptOnce(), timeoutPromise])

            const retries = stepExecutor.config.retries ?? 0
            const retryDelay = stepExecutor.config.retryDelayMs
            const shouldRetry = stepExecutor.config.shouldRetry ?? (() => false)

            let lastError: unknown
            for (let attempt = 0; attempt <= retries; attempt++) {
              try {
                const out = await withRace()
                stepOutput = out
                break
              } catch (e) {
                lastError = e
                if (
                  attempt === retries ||
                  !shouldRetry(e instanceof Error ? e : new Error(String(e)))
                )
                  throw e
                const delayMs =
                  typeof retryDelay === 'function'
                    ? retryDelay(attempt + 1, e instanceof Error ? e : new Error(String(e)))
                    : (retryDelay ?? 0)
                if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
              }
            }
          } finally {
            // Clear the timeout to prevent hanging handles
            if (timeoutId !== undefined) {
              clearTimeout(timeoutId)
            }
          }
        } else {
          const attemptOnce = async () => stepExecutor.fn(context, runtime)
          const retries = stepExecutor.config.retries ?? 0
          const retryDelay = stepExecutor.config.retryDelayMs
          const shouldRetry = stepExecutor.config.shouldRetry ?? (() => false)

          const withAbort = async () =>
            runtime.signal
              ? new Promise((resolve, reject) => {
                  const onAbort = () => reject(new Error('Pipeline aborted'))
                  if (runtime.signal?.aborted) {
                    onAbort()
                    return
                  }
                  runtime.signal?.addEventListener('abort', onAbort, { once: true })
                  Promise.resolve(attemptOnce()).then(resolve, reject)
                })
              : attemptOnce()

          for (let attempt = 0; attempt <= retries; attempt++) {
            try {
              stepOutput = await withAbort()
              break
            } catch (e) {
              if (
                attempt === retries ||
                !shouldRetry(e instanceof Error ? e : new Error(String(e)))
              )
                throw e
              const delayMs =
                typeof retryDelay === 'function'
                  ? retryDelay(attempt + 1, e instanceof Error ? e : new Error(String(e)))
                  : (retryDelay ?? 0)
              if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
            }
          }
        }

        // Circuit breaker state management (on success)
        const cb = stepExecutor.config.circuitBreaker
        if (cb) this.circuitState.set(stepExecutor.name, { failures: 0, openedAt: null })

        // Validate outputs and merge
        if (stepExecutor.replaceContext) {
          if (!isPlainObject(stepOutput)) throw new TypeError('Transform must return an object')
          context = deepClone(stepOutput as Record<string, unknown>)
        } else {
          if (!isPlainObject(stepOutput)) throw new TypeError('Step must return an object')
          const policy = stepExecutor.config.mergePolicy ?? 'override'
          const cloned = deepClone(stepOutput as Record<string, unknown>)
          const onCollision = (key: string) => runtime.logFn(`⚠️ Key collision on '${key}'`)
          context = mergeWithPolicy(context as Record<string, unknown>, cloned, policy, onCollision)
        }
        const duration = Date.now() - startTime
        if (stepLog) {
          if (runtime.showStepDuration)
            runtime.logFn(`✅ ${displayName} completed in ${formatDuration(duration)}`)
          else runtime.logFn(`✅ ${displayName} completed`)
          if (stepOutput && Object.keys(stepOutput).length > 0)
            runtime.logFn('   Output:', Object.keys(stepOutput).join(', '))
        }
        if (runtime.stopwatchEnabled)
          runtime.stepTimings.push({ name: displayName, duration, status: 'success' })
        runtime.onStepComplete?.(displayName, stepOutput, duration)
      } catch (error) {
        // Circuit breaker state management (on failure)
        const cb = stepExecutor.config.circuitBreaker
        if (cb) {
          const state = this.circuitState.get(stepExecutor.name) ?? {
            failures: 0,
            openedAt: null
          }
          state.failures += 1
          const threshold = cb.failureThreshold ?? Infinity
          if (state.failures >= threshold) state.openedAt = Date.now()
          this.circuitState.set(stepExecutor.name, state)
        }
        const duration = Date.now() - startTime
        if (stepLog) {
          if (runtime.showStepDuration)
            runtime.errorLogFn(`❌ ${displayName} failed after ${formatDuration(duration)}`)
          else runtime.errorLogFn(`❌ ${displayName} failed`)
          runtime.errorLogFn('   Error:', error)
        }
        if (runtime.stopwatchEnabled)
          runtime.stepTimings.push({ name: displayName, duration, status: 'failed' })
        const normalizedError =
          error instanceof Error
            ? error
            : new Error('Non-Error thrown', { cause: error as unknown })
        runtime.onError?.(displayName, normalizedError)
        const errorHandling = stepExecutor.config.onError ?? 'throw'
        if (errorHandling === 'throw') throw error
        else if (errorHandling === 'skip-remaining') break
      }
    }
    return context
  }

  describe(): string[] {
    return this.steps.map((s) => s.name)
  }
}

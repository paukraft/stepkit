import type { StepNames as BuilderStepNames } from './index'
import {
  formatDuration,
  getDisplayName,
  type InternalRuntime,
  type PipelineConfig,
  type StepTimingInfo
} from './runtime'
import {
  AppendHistory,
  AppendHistoryUnion,
  AppendMany,
  MakeSafeOutput,
  MergeOutputs,
  PrefixHistory,
  StepConfig,
  StepFunction,
  TransformResultContext,
  UnionToIntersection
} from './types'
import { computePatch, deepClone, isPlainObject, mergeContext } from './utils'

type KnownKeys<T> = {
  [K in keyof T]: string extends K ? never : number extends K ? never : symbol extends K ? never : K
}[keyof T]

type DiffNewKeys<TNew, TOld> = Omit<TNew, KnownKeys<TOld>>

type StepExecutor<TCtx extends Record<string, unknown> = Record<string, unknown>> = {
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

type CaseReturnContext<TCtx extends Record<string, unknown>, TCase> = TCase extends {
  then: (b: any) => infer R
}
  ? R extends StepkitBuilder<any, infer TSubCtx, any>
    ? DiffNewKeys<TSubCtx, TCtx>
    : never
  : TCase extends { then: StepkitBuilder<TCtx, infer TSubCtx, any> }
    ? DiffNewKeys<TSubCtx, TCtx>
    : TCase extends { then: StepkitBuilder<any, infer TSubCtx4, any> }
      ? DiffNewKeys<TSubCtx4, TCtx>
      : TCase extends { default: (b: any) => infer R2 }
        ? R2 extends StepkitBuilder<any, infer TSubCtx2, any>
          ? DiffNewKeys<TSubCtx2, TCtx>
          : never
        : TCase extends { default: StepkitBuilder<TCtx, infer TSubCtx3, any> }
          ? DiffNewKeys<TSubCtx3, TCtx>
          : TCase extends { default: StepkitBuilder<any, infer TSubCtx5, any> }
            ? DiffNewKeys<TSubCtx5, TCtx>
            : never

type MergeBranchOutputs<
  TCtx extends Record<string, unknown>,
  TCases extends readonly unknown[]
> = Partial<UnionToIntersection<CaseReturnContext<TCtx, TCases[number]>>>

type CaseSubHistory<TCtx extends Record<string, unknown>, TCase> = TCase extends {
  then: (b: any) => infer R
}
  ? R extends StepkitBuilder<any, any, infer TH>
    ? TH
    : never
  : TCase extends { then: StepkitBuilder<TCtx, any, infer TH> }
    ? TH
    : TCase extends { default: (b: any) => infer R2 }
      ? R2 extends StepkitBuilder<any, any, infer TH2>
        ? TH2
        : never
      : TCase extends { default: StepkitBuilder<TCtx, any, infer TH3> }
        ? TH3
        : never

type CaseNameOf<TCase> = TCase extends { default: any }
  ? TCase extends { name: infer N }
    ? Extract<N, string>
    : 'default-case'
  : TCase extends { name: infer N }
    ? Extract<N, string>
    : 'branch-case'

type CasePrefixedHistory<
  TCtx extends Record<string, unknown>,
  TCase,
  TName extends string
> = PrefixHistory<
  CaseSubHistory<TCtx, TCase> extends readonly { name: string; ctx: unknown }[]
    ? CaseSubHistory<TCtx, TCase>
    : readonly [],
  `${TName}/${CaseNameOf<TCase>}`
>

type MergeBranchHistory<
  TCtx extends Record<string, unknown>,
  TCases extends readonly unknown[],
  TName extends string
> = TCases extends readonly [infer F, ...infer R]
  ?
      | CasePrefixedHistory<TCtx, F, TName>
      | MergeBranchHistory<TCtx, Extract<R, readonly unknown[]>, TName>
  : never

// --- Variadic item support (mixing functions and sub-pipelines) ---
type ItemOutput<TCtx extends Record<string, unknown>, T> =
  T extends StepFunction<TCtx, infer O>
    ? O
    : T extends StepkitBuilder<any, infer TSubOut, any>
      ? DiffNewKeys<TSubOut, TCtx>
      : never

type ItemsOutputs<
  TCtx extends Record<string, unknown>,
  TItems extends readonly unknown[]
> = TItems extends readonly [infer F, ...infer R]
  ? ItemOutput<TCtx, F> | ItemsOutputs<TCtx, Extract<R, readonly unknown[]>>
  : never

type ItemsPrefixedHistory<
  TItems extends readonly unknown[],
  TName extends string
> = TItems extends readonly [infer F, ...infer R]
  ? F extends StepkitBuilder<any, any, infer TH>
    ? AppendMany<
        PrefixHistory<TH, TName>,
        ItemsPrefixedHistory<Extract<R, readonly unknown[]>, TName>
      >
    : ItemsPrefixedHistory<Extract<R, readonly unknown[]>, TName>
  : readonly []

export class StepkitBuilder<
  TInput extends Record<string, unknown>,
  TContext extends Record<string, unknown>,
  THistory extends readonly { name: string; ctx: unknown }[] = readonly []
> {
  private steps: StepExecutor<TContext>[] = []
  private config: PipelineConfig<
    TContext,
    BuilderStepNames<StepkitBuilder<TInput, TContext, THistory>>
  >
  readonly __history!: THistory
  private circuitState = new Map<string, { failures: number; openedAt: number | null }>()

  constructor(
    config: PipelineConfig<
      TContext,
      BuilderStepNames<StepkitBuilder<TInput, TContext, THistory>>
    > = {}
  ) {
    this.config = config
  }

  // General: name omitted, any mix of fns and sub-pipelines
  step<
    TItems extends readonly (
      | StepFunction<TContext, Record<string, unknown> | never>
      | StepkitBuilder<any, any, any>
    )[]
  >(
    ...items: TItems
  ): StepkitBuilder<
    TInput,
    TContext & UnionToIntersection<ItemsOutputs<TContext, TItems>>,
    AppendMany<AppendHistory<THistory, string, TContext>, ItemsPrefixedHistory<TItems, string>>
  >

  // General: named, any mix of fns and sub-pipelines
  step<
    TName extends string,
    TItems extends readonly (
      | StepFunction<TContext, Record<string, unknown> | never>
      | StepkitBuilder<any, any, any>
    )[]
  >(
    name: TName,
    ...items: TItems
  ): StepkitBuilder<
    TInput,
    TContext & UnionToIntersection<ItemsOutputs<TContext, TItems>>,
    AppendMany<AppendHistory<THistory, TName, TContext>, ItemsPrefixedHistory<TItems, TName>>
  >

  // General: config with name, any mix of fns and sub-pipelines
  step<
    TItems extends readonly (
      | StepFunction<TContext, Record<string, unknown> | never>
      | StepkitBuilder<any, any, any>
    )[],
    TName extends string,
    TConfig extends Omit<StepConfig<TContext>, 'name'> & { name: TName }
  >(
    config: TConfig,
    ...items: TItems
  ): StepkitBuilder<
    TInput,
    TContext & MakeSafeOutput<TConfig, UnionToIntersection<ItemsOutputs<TContext, TItems>>>,
    AppendMany<AppendHistory<THistory, TName, TContext>, ItemsPrefixedHistory<TItems, TName>>
  >

  // General: config without name, any mix of fns and sub-pipelines
  step<
    TItems extends readonly (
      | StepFunction<TContext, Record<string, unknown> | never>
      | StepkitBuilder<any, any, any>
    )[],
    TConfig extends StepConfig<TContext>
  >(
    config: TConfig,
    ...items: TItems
  ): StepkitBuilder<
    TInput,
    TContext & MakeSafeOutput<TConfig, UnionToIntersection<ItemsOutputs<TContext, TItems>>>,
    AppendMany<AppendHistory<THistory, string, TContext>, ItemsPrefixedHistory<TItems, string>>
  >

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
    TName extends string,
    TSubIn extends Record<string, unknown>,
    TSubOut extends Record<string, unknown>,
    TSubHistory extends readonly { name: string; ctx: unknown }[],
    TOutputs extends readonly Record<string, unknown>[]
  >(
    name: TName,
    sub: TContext extends TSubIn ? StepkitBuilder<TSubIn, TSubOut, TSubHistory> : never,
    ...fns: {
      [K in keyof TOutputs]: StepFunction<TContext, TOutputs[K]>
    }
  ): StepkitBuilder<
    TInput,
    TContext & DiffNewKeys<TSubOut, TContext> & MergeOutputs<TOutputs>,
    AppendMany<AppendHistory<THistory, TName, TContext>, PrefixHistory<TSubHistory, TName>>
  >

  step<
    TOutputs extends readonly Record<string, unknown>[],
    TName extends string,
    TConfig extends Omit<StepConfig<TContext>, 'name'> & { name: TName }
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

  step<
    TOutputs extends readonly Record<string, unknown>[],
    TName extends string,
    TConfig extends Omit<StepConfig<TContext>, 'name'> & { name: TName },
    TSubIn extends Record<string, unknown>,
    TSubOut extends Record<string, unknown>,
    TSubHistory extends readonly { name: string; ctx: unknown }[]
  >(
    config: TConfig,
    sub: TContext extends TSubIn ? StepkitBuilder<TSubIn, TSubOut, TSubHistory> : never,
    ...fns: {
      [K in keyof TOutputs]: StepFunction<TContext, TOutputs[K]>
    }
  ): StepkitBuilder<
    TInput,
    TContext & MakeSafeOutput<TConfig, DiffNewKeys<TSubOut, TContext> & MergeOutputs<TOutputs>>,
    AppendMany<AppendHistory<THistory, TName, TContext>, PrefixHistory<TSubHistory, TName>>
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

  step<
    TOutputs extends readonly Record<string, unknown>[],
    TSubIn extends Record<string, unknown>,
    TSubOut extends Record<string, unknown>,
    TSubHistory extends readonly { name: string; ctx: unknown }[]
  >(
    sub: TContext extends TSubIn ? StepkitBuilder<TSubIn, TSubOut, TSubHistory> : never,
    ...fns: {
      [K in keyof TOutputs]: StepFunction<TContext, TOutputs[K]>
    }
  ): StepkitBuilder<
    TInput,
    TContext & DiffNewKeys<TSubOut, TContext> & MergeOutputs<TOutputs>,
    AppendMany<AppendHistory<THistory, string, TContext>, PrefixHistory<TSubHistory, string>>
  >

  step<TOutputs extends readonly Record<string, unknown>[]>(
    nameOrConfigOrFn:
      | string
      | StepConfig<TContext>
      | StepFunction<TContext, TOutputs[0]>
      | StepkitBuilder<any, any, any>,
    ...fns: Array<StepFunction<TContext, Record<string, unknown>> | StepkitBuilder<any, any, any>>
  ): any {
    let stepName: string
    let stepConfig: StepConfig<TContext>
    let allFns: StepFunction<TContext, Record<string, unknown>>[]
    const isBuilder = (x: unknown): x is StepkitBuilder<any, any, any> =>
      x instanceof StepkitBuilder
    const wrapBuilder = (
      builder: StepkitBuilder<any, any, any>
    ): StepFunction<TContext, Record<string, unknown>> => {
      return async (context: TContext, runtime?: InternalRuntime) => {
        if (runtime) {
          const nestedRuntime: InternalRuntime = {
            ...runtime,
            namePrefix: [...runtime.namePrefix, stepName]
          }
          const subContext = await builder.runWithRuntime(context, nestedRuntime)
          return computePatch(
            context as unknown as Record<string, unknown>,
            subContext as unknown as Record<string, unknown>
          )
        } else {
          const subContext = await builder.run(context)
          return computePatch(
            context as unknown as Record<string, unknown>,
            subContext as unknown as Record<string, unknown>
          )
        }
      }
    }

    if (typeof nameOrConfigOrFn === 'string') {
      stepName = nameOrConfigOrFn
      stepConfig = {}
      const args = fns as unknown as unknown[]
      allFns = args.map((a) =>
        isBuilder(a) ? wrapBuilder(a) : (a as StepFunction<TContext, Record<string, unknown>>)
      )
    } else if (typeof nameOrConfigOrFn === 'object') {
      if (isBuilder(nameOrConfigOrFn)) {
        stepConfig = {}
        stepName = `step-${this.steps.length + 1}`
        const args = [nameOrConfigOrFn, ...fns] as unknown[]
        allFns = args.map((a) =>
          isBuilder(a) ? wrapBuilder(a) : (a as StepFunction<TContext, Record<string, unknown>>)
        )
      } else {
        stepConfig = nameOrConfigOrFn
        stepName = stepConfig.name ?? `step-${this.steps.length + 1}`
        const args = fns as unknown as unknown[]
        allFns = args.map((a) =>
          isBuilder(a) ? wrapBuilder(a) : (a as StepFunction<TContext, Record<string, unknown>>)
        )
      }
    } else {
      stepName = `step-${this.steps.length + 1}`
      stepConfig = {}
      const args = [nameOrConfigOrFn, ...fns] as unknown[]
      allFns = args.map((a) =>
        isBuilder(a) ? wrapBuilder(a) : (a as StepFunction<TContext, Record<string, unknown>>)
      )
    }

    const stepExecutor = async (context: TContext, runtime?: InternalRuntime) => {
      const policy = stepConfig.mergePolicy ?? 'override'
      const parallelMode = stepConfig.parallelMode ?? 'all'
      if (parallelMode === 'settled') {
        const results = await Promise.allSettled(
          allFns.map((fn) => {
            const call = (fn as any).length >= 2 ? (fn as any)(context, runtime) : fn(context)
            return Promise.resolve(call)
          })
        )
        const merged: Record<string, unknown> = {}
        for (const r of results) {
          if (r.status === 'fulfilled') {
            const value = r.value ?? {}
            if (!isPlainObject(value))
              throw new TypeError('Step function must return an object or void')
            const cloned = deepClone(value)
            const onCollision = (key: string) => runtime?.logFn?.(`⚠️ Key collision on '${key}'`)
            const out = mergeContext(merged, cloned, policy, onCollision)
            Object.assign(merged, out)
          } else {
            runtime?.errorLogFn?.('   Parallel function failed:', r.reason)
          }
        }
        return merged
      } else {
        const results = await Promise.all(
          allFns.map((fn) => {
            const call = (fn as any).length >= 2 ? (fn as any)(context, runtime) : fn(context)
            return Promise.resolve(call)
          })
        )
        return results.reduce<Record<string, unknown>>((acc, result) => {
          const value = result ?? {}
          if (!isPlainObject(value))
            throw new TypeError('Step function must return an object or void')
          const cloned = deepClone(value)
          const onCollision = (key: string) => runtime?.logFn?.(`⚠️ Key collision on '${key}'`)
          return mergeContext(acc, cloned, policy, onCollision)
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
    AppendHistoryUnion<
      AppendHistory<THistory, string, TContext>,
      MergeBranchHistory<TContext, TCases, string>
    >
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
    AppendHistoryUnion<
      AppendHistory<THistory, TName, TContext>,
      MergeBranchHistory<TContext, TCases, TName>
    >
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
    config: Omit<StepConfig<TContext>, 'name'> & { name: TName },
    ...cases: TCases
  ): StepkitBuilder<
    TInput,
    TContext & MergeBranchOutputs<TContext, TCases>,
    AppendHistoryUnion<
      AppendHistory<THistory, TName, TContext>,
      MergeBranchHistory<TContext, TCases, TName>
    >
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
    AppendHistoryUnion<
      AppendHistory<THistory, string, TContext>,
      MergeBranchHistory<TContext, TCases, string>
    >
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
          namePrefix: [...runtime.namePrefix, stepName, caseName]
        }
        const subContext = await built.runWithRuntime(context, nestedRuntime)
        return computePatch(
          context as unknown as Record<string, unknown>,
          subContext as unknown as Record<string, unknown>
        )
      } else {
        const subContext = await built.run(context)
        return computePatch(
          context as unknown as Record<string, unknown>,
          subContext as unknown as Record<string, unknown>
        )
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

  transform<TNewContext extends Record<string, any>, TName extends string>(
    config: Omit<StepConfig<TContext>, 'name'> & { name: TName },
    fn: (context: TContext) => TNewContext | Promise<TNewContext>
  ): StepkitBuilder<
    TInput,
    TransformResultContext<
      TContext,
      TNewContext,
      Omit<StepConfig<TContext>, 'name'> & { name: TName }
    >,
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

  run = async (
    input: TInput,
    options?: PipelineConfig<TContext, BuilderStepNames<StepkitBuilder<TInput, TContext, THistory>>>
  ): Promise<TContext> => {
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
      onStepComplete: async (event) => {
        // Bubble event to both config and run options, awaiting async handlers
        await Promise.resolve(
          (
            this.config as PipelineConfig<
              TContext,
              BuilderStepNames<StepkitBuilder<TInput, TContext, THistory>>
            >
          ).onStepComplete?.(event as any)
        )
        await Promise.resolve(options?.onStepComplete?.(event as any))
      },
      onError,
      namePrefix: [],
      signal: options?.signal ?? this.config.signal,
      stopController: { requested: false },
      resumeController: { target: null }
    }

    if (globalLog) logFn('🚀 Starting pipeline with input:', input)
    const result = await this.runWithRuntime(input, runtime)

    if (stopwatchEnabled && globalLog) {
      const totalDuration = Date.now() - pipelineStartTime
      if (showSummary && stepTimings.length > 0) {
        logFn('\n⏱️  Performance Summary:')
        if (runtime.resumeFrom) logFn(`↪️ Resumed from checkpoint: ${runtime.resumeFrom}`)
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
        if (runtime.stopController.requested) {
          const by = runtime.stopController.requestedBy
            ? ` (requested by ${runtime.stopController.requestedBy})`
            : ''
          logFn(`\n⏹️  Stopped early${by}`)
        }
      }
      if (showTotal) logFn(`\n⏰ Total Pipeline Time: ${formatDuration(totalDuration)}`)
    }

    if (globalLog)
      logFn(
        `\n${runtime.stopController.requested ? '✨ Pipeline stopped early' : '✨ Pipeline completed successfully'}`
      )
    return result
  }

  runWithRuntime = async (input: TInput, runtime: InternalRuntime): Promise<TContext> => {
    let context: any = deepClone(input as unknown as Record<string, unknown>)
    for (const stepExecutor of this.steps) {
      const stepLog = stepExecutor.config.log ?? runtime.globalLog
      const displayName = getDisplayName(runtime, stepExecutor.name)

      // Resume-from-checkpoint: skip logic
      const target = runtime.resumeController?.target ?? null
      if (target) {
        const isContainer = target.startsWith(displayName + '/')
        if (displayName === target) {
          // This is the exact checkpoint step: skip executing it and clear target
          if (stepLog) runtime.logFn(`\n⏭️  Step: ${displayName} (resume-skip)`)
          if (runtime.stopwatchEnabled)
            runtime.stepTimings.push({ name: displayName, duration: 0, status: 'skipped' })
          runtime.resumeController.target = null
          continue
        }
        if (!isContainer) {
          // Still before the container that will include the checkpoint; skip
          if (stepLog) runtime.logFn(`\n⏭️  Step: ${displayName} (resume-skip)`)
          if (runtime.stopwatchEnabled)
            runtime.stepTimings.push({ name: displayName, duration: 0, status: 'skipped' })
          continue
        }
        // isContainer === true: execute this step to descend into nested pipeline where
        // the nested runtime will encounter and clear the target when matched.
      }

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
          // Transform must return a value (not void/undefined)
          if (stepOutput === null || stepOutput === undefined) {
            throw new TypeError(
              `Transform '${displayName}' must return an object, not ${stepOutput === null ? 'null' : 'undefined'}. ` +
                'Transforms replace the entire context, so returning nothing would clear all data. ' +
                'Return at least an empty object {} if you want to clear the context intentionally.'
            )
          }
          if (!isPlainObject(stepOutput)) {
            throw new TypeError(`Transform '${displayName}' must return a plain object`)
          }
          context = deepClone(stepOutput as Record<string, unknown>)
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
          const checkpoint = JSON.stringify({ stepName: displayName, output: deepClone(context) })
          await runtime.onStepComplete?.({
            stepName: displayName,
            duration,
            context: deepClone(context),
            checkpoint,
            stopPipeline: () => {
              if (runtime.stopController) {
                runtime.stopController.requested = true
                runtime.stopController.requestedBy = displayName
              }
            }
          })
          if (runtime.stopController?.requested) {
            if (stepLog)
              runtime.logFn(
                `\n⏹️ Early stop requested by: ${runtime.stopController.requestedBy ?? displayName}`
              )
            break
          }
        } else {
          // Steps can return void (treated as {})
          const normalizedOutput = stepOutput ?? {}
          if (!isPlainObject(normalizedOutput)) {
            throw new TypeError(`Step '${displayName}' must return an object or void`)
          }
          const policy = stepExecutor.config.mergePolicy ?? 'override'
          const cloned = deepClone(normalizedOutput as Record<string, unknown>)
          const onCollision = (key: string) => runtime.logFn(`⚠️ Key collision on '${key}'`)
          context = mergeContext(context as Record<string, unknown>, cloned, policy, onCollision)
          const duration = Date.now() - startTime
          if (stepLog) {
            if (runtime.showStepDuration)
              runtime.logFn(`✅ ${displayName} completed in ${formatDuration(duration)}`)
            else runtime.logFn(`✅ ${displayName} completed`)
            if (normalizedOutput && Object.keys(normalizedOutput).length > 0)
              runtime.logFn('   Output:', Object.keys(normalizedOutput).join(', '))
          }
          if (runtime.stopwatchEnabled)
            runtime.stepTimings.push({ name: displayName, duration, status: 'success' })
          const checkpoint = JSON.stringify({ stepName: displayName, output: deepClone(context) })
          await runtime.onStepComplete?.({
            stepName: displayName,
            duration,
            context: deepClone(context),
            checkpoint,
            stopPipeline: () => {
              if (runtime.stopController) {
                runtime.stopController.requested = true
                runtime.stopController.requestedBy = displayName
              }
            }
          })
          if (runtime.stopController?.requested) {
            if (stepLog)
              runtime.logFn(
                `\n⏹️ Early stop requested by: ${runtime.stopController.requestedBy ?? displayName}`
              )
            break
          }
        }
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

  // Simplified overloads: only string or { checkpoint, overrideData? }
  runCheckpoint(
    checkpoint: string,
    options?: PipelineConfig<TContext, BuilderStepNames<StepkitBuilder<TInput, TContext, THistory>>>
  ): Promise<TContext>
  runCheckpoint(
    params: { checkpoint: string; overrideData?: Partial<TContext> },
    options?: PipelineConfig<TContext, BuilderStepNames<StepkitBuilder<TInput, TContext, THistory>>>
  ): Promise<TContext>
  async runCheckpoint(
    arg: string | { checkpoint: string; overrideData?: Partial<TContext> },
    options?: PipelineConfig<TContext, BuilderStepNames<StepkitBuilder<TInput, TContext, THistory>>>
  ): Promise<TContext> {
    const parsedAny: any = typeof arg === 'string' ? { checkpoint: arg } : arg
    const cp: { stepName: string; output: Record<string, unknown> } = JSON.parse(
      parsedAny.checkpoint
    ) as { stepName: string; output: Record<string, unknown> }

    const base = deepClone(cp.output)
    const override = (parsedAny.overrideData ?? undefined) as Record<string, unknown> | undefined
    const startContext = override ? mergeContext(base, override, 'override') : base

    // Build runtime like in run(), but set resume target
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
      onStepComplete: async (event) => {
        await Promise.resolve(
          (
            this.config as PipelineConfig<
              TContext,
              BuilderStepNames<StepkitBuilder<TInput, TContext, THistory>>
            >
          ).onStepComplete?.(event as any)
        )
        await Promise.resolve(options?.onStepComplete?.(event as any))
      },
      onError,
      namePrefix: [],
      signal: options?.signal ?? this.config.signal,
      stopController: { requested: false },
      resumeController: { target: cp.stepName },
      resumeFrom: cp.stepName
    }

    if (globalLog) logFn('🚀 Resuming pipeline from checkpoint step:', cp.stepName)
    const result = await this.runWithRuntime(startContext as TInput, runtime)

    if (stopwatchEnabled && globalLog) {
      const totalDuration = Date.now() - pipelineStartTime
      if (showSummary && stepTimings.length > 0) {
        logFn('\n⏱️  Performance Summary:')
        if (runtime.resumeFrom) logFn(`↪️ Resumed from checkpoint: ${runtime.resumeFrom}`)
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
        if (runtime.stopController.requested) {
          const by = runtime.stopController.requestedBy
            ? ` (requested by ${runtime.stopController.requestedBy})`
            : ''
          logFn(`\n⏹️  Stopped early${by}`)
        }
      }
      if (showTotal) logFn(`\n⏰ Total Pipeline Time: ${formatDuration(totalDuration)}`)
    }

    if (globalLog)
      logFn(
        `\n${runtime.stopController.requested ? '✨ Pipeline stopped early' : '✨ Pipeline completed successfully'}`
      )
    return result
  }

  describe(): string[] {
    return this.steps.map((s) => s.name)
  }
}

import { describe, expect, it } from '@jest/globals'
import { stepkit } from '../src/index'

describe('Enhanced Type Safety', () => {
  it('should require non-void returns from step functions', async () => {
    // This should compile - explicit object return
    const result = await stepkit<{ value: number }>()
      .step('double', ({ value }) => ({ doubled: value * 2 }))
      .run({ value: 5 })

    expect(result.doubled).toBe(10)
  })

  it('should make outputs optional when onError is continue', async () => {
    const pipeline = stepkit<{ shouldFail: boolean }>()
      .step('step-1', () => ({ value: 1 }))
      .step({ name: 'step-2', onError: 'continue' }, ({ shouldFail }) => {
        if (shouldFail) throw new Error('Failed')
        return { risky: 'value' }
      })
      .step('step-3', ({ risky }) => {
        // risky should be optional due to onError: 'continue'
        // TypeScript should force us to check for undefined
        return { final: risky ? risky.toUpperCase() : 'NO VALUE' }
      })

    const result = await pipeline.run({ shouldFail: true })
    expect(result.final).toBe('NO VALUE')
  })

  it('should make outputs optional when timeout is set', async () => {
    const pipeline = stepkit<{ delay: number }>()
      .step('step-1', () => ({ value: 1 }))
      .step(
        {
          name: 'step-2',
          timeout: 50,
          onError: 'continue'
        },
        async ({ delay }) => {
          await new Promise((r) => setTimeout(r, delay))
          return { timedOut: 'no' }
        }
      )
      .step('step-3', ({ timedOut }) => {
        // timedOut should be optional due to timeout + onError
        return { result: timedOut ?? 'yes' }
      })

    const result = await pipeline.run({ delay: 200 })
    expect(result.result).toBe('yes')
  })

  it('should make outputs optional when condition is present', async () => {
    const pipeline = stepkit<{ isPremium: boolean }>()
      .step('init', () => ({ base: 'data' }))
      .step(
        {
          name: 'premium-step',
          condition: ({ isPremium }) => isPremium
        },
        () => ({ premium: 'feature' })
      )
      .step('final', ({ premium }) => {
        // premium should be optional due to condition
        return { hasPremium: !!premium }
      })

    const result1 = await pipeline.run({ isPremium: true })
    expect(result1.hasPremium).toBe(true)

    const result2 = await pipeline.run({ isPremium: false })
    expect(result2.hasPremium).toBe(false)
  })

  it('should handle transform with error handling', async () => {
    const pipeline = stepkit<{ value: number }>()
      .step('double', ({ value }) => ({ doubled: value * 2 }))
      .transform(
        {
          name: 'risky-transform',
          condition: ({ doubled }) => doubled > 5,
          onError: 'continue'
        },
        ({ doubled }) => ({ result: doubled * 10 })
      )
      .step('after', ({ doubled, result }) => {
        // Both doubled and result should be optional
        return { final: (doubled ?? 0) + (result ?? 0) }
      })

    const result1 = await pipeline.run({ value: 10 })
    expect(result1.final).toBe(200) // transform executed

    const result2 = await pipeline.run({ value: 2 })
    expect(result2.final).toBe(4) // transform skipped, doubled still available
  })

  it('should make branch outputs optional when configured with error handling', async () => {
    const pipeline = stepkit<{ plan: string }>()
      .step('init', () => ({ initialized: true }))
      .branchOn(
        {
          name: 'branch',
          // Could add onError or timeout here if branches support it
          condition: ({ plan }) => plan === 'premium'
        },
        {
          when: ({ plan }) => plan === 'premium',
          then: (builder) => builder.step('premium', () => ({ features: ['a', 'b'] }))
        },
        {
          default: (builder) => builder.step('basic', () => ({ features: ['c'] }))
        }
      )
      .step('after', ({ features }) => {
        // features should be optional since it comes from a branch
        return { featureCount: features?.length ?? 0 }
      })

    const result = await pipeline.run({ plan: 'premium' })
    expect(result.featureCount).toBe(2)
  })

  it('should combine multiple optional conditions', async () => {
    const pipeline = stepkit<{ shouldFail: boolean; shouldRun: boolean }>()
      .step('step-1', () => ({ value: 1 }))
      .step(
        {
          name: 'complex-step',
          condition: ({ shouldRun }) => shouldRun,
          onError: 'continue',
          timeout: 1000
        },
        ({ shouldFail }) => {
          if (shouldFail) throw new Error('Failed')
          return { complex: 'data' }
        }
      )
      .step('final', ({ complex }) => {
        // complex has THREE reasons to be optional:
        // 1. condition might be false
        // 2. onError: 'continue' means it might fail
        // 3. timeout means it might timeout
        return { hasComplex: !!complex }
      })

    // All scenarios work
    const result1 = await pipeline.run({ shouldFail: false, shouldRun: true })
    expect(result1.hasComplex).toBe(true)

    const result2 = await pipeline.run({ shouldFail: true, shouldRun: true })
    expect(result2.hasComplex).toBe(false)

    const result3 = await pipeline.run({ shouldFail: false, shouldRun: false })
    expect(result3.hasComplex).toBe(false)
  })

  it('should handle skip-remaining error strategy', async () => {
    const pipeline = stepkit<{ shouldFail: boolean }>()
      .step('step-1', () => ({ value: 1 }))
      .step(
        {
          name: 'step-2',
          onError: 'skip-remaining'
        },
        ({ shouldFail }) => {
          if (shouldFail) throw new Error('Stop here')
          return { continued: true }
        }
      )
      .step('step-3', ({ continued }) => {
        // continued should be optional due to onError: 'skip-remaining'
        return { final: continued ?? false }
      })

    const result1 = await pipeline.run({ shouldFail: false })
    expect(result1.final).toBe(true)

    const result2 = await pipeline.run({ shouldFail: true })
    // step-3 never runs, but type system makes continued optional
    expect(result2.continued).toBeUndefined()
  })
})

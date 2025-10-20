import { describe, expect, it } from '@jest/globals'
import { stepkit, type StepOutput } from '../src/index'

describe('Branch (branchOn)', () => {
  it('should execute the matching branch case', async () => {
    const result = await stepkit<{ plan: string }>()
      .step('init', ({ plan }) => ({ initialized: true }))
      .branchOn(
        {
          name: 'premium-path',
          when: ({ plan }) => plan === 'premium',
          then: (builder) => builder.step('fetch-premium', () => ({ features: ['a', 'b'] }))
        },
        {
          name: 'normal-path',
          default: (builder) => builder.step('fetch-normal', () => ({ features: ['c'] }))
        }
      )
      .run({ plan: 'premium' })

    expect(result.initialized).toBe(true)
    expect(result.features).toEqual(['a', 'b'])
  })

  it('should execute default branch when no condition matches', async () => {
    const result = await stepkit<{ plan: string }>()
      .step('init', ({ plan }) => ({ initialized: true }))
      .branchOn(
        {
          name: 'premium-path',
          when: ({ plan }) => plan === 'premium',
          then: (builder) => builder.step('fetch-premium', () => ({ features: ['a', 'b'] }))
        },
        {
          name: 'normal-path',
          default: (builder) => builder.step('fetch-normal', () => ({ features: ['c'] }))
        }
      )
      .run({ plan: 'basic' })

    expect(result.initialized).toBe(true)
    expect(result.features).toEqual(['c'])
  })

  it('should merge only new keys from branch back to main context', async () => {
    const result = await stepkit<{ userId: string }>()
      .step('fetch-data', ({ userId }) => {
        return { plan: 'premium', credits: 150 }
      })
      .branchOn(
        {
          when: ({ plan }) => plan === 'premium',
          then: (builder) =>
            builder
              .step('fetch-premium-user', ({ userId }) => {
                return { userName: 'Jane Doe' }
              })
              .step('fetch-premium-features', () => {
                return { premiumFeatures: ['feature1', 'feature2'] }
              })
        },
        {
          default: (builder) =>
            builder.step('fetch-normal-user', ({ userId }) => {
              return { userName: 'John Doe' }
            })
        }
      )
      .step('after-branch', ({ userName }) => {
        return { processed: true }
      })
      .run({ userId: '123' })

    expect(result.userId).toBe('123')
    expect(result.plan).toBe('premium')
    expect(result.credits).toBe(150)
    expect(result.userName).toBe('Jane Doe')
    expect(result.premiumFeatures).toEqual(['feature1', 'feature2'])
    expect(result.processed).toBe(true)
  })

  it('should support named branches', async () => {
    const result = await stepkit<{ type: string }>()
      .branchOn(
        'type-selector',
        {
          name: 'type-a',
          when: ({ type }) => type === 'a',
          then: (builder) => builder.step('handle-a', () => ({ result: 'A' }))
        },
        {
          name: 'type-b',
          when: ({ type }) => type === 'b',
          then: (builder) => builder.step('handle-b', () => ({ result: 'B' }))
        },
        {
          default: (builder) => builder.step('handle-default', () => ({ result: 'DEFAULT' }))
        }
      )
      .run({ type: 'b' })

    expect(result.result).toBe('B')
  })

  it('should support prebuilt pipeline in branch', async () => {
    const fetchUserBase = stepkit<{ userId: string }>().step('fetch-data', ({ userId }) => {
      return { plan: 'premium' }
    })

    type FetchUserBranchCtx = StepOutput<typeof fetchUserBase, 'fetch-data'>

    const premiumFlowPrebuilt = stepkit<FetchUserBranchCtx>()
      .step('fetch-premium-user', ({ userId }) => ({ userName: 'Jane Doe' }))
      .step('fetch-premium-features', () => ({
        premiumFeatures: ['feature1', 'feature2']
      }))

    const result = await fetchUserBase
      .branchOn(
        {
          when: ({ plan }) => plan === 'premium',
          then: premiumFlowPrebuilt
        },
        {
          default: (builder) => builder.step('fetch-normal', () => ({ userName: 'John' }))
        }
      )
      .run({ userId: '123' })

    expect(result.userName).toBe('Jane Doe')
    expect(result.premiumFeatures).toEqual(['feature1', 'feature2'])
  })

  it('should support async branch conditions', async () => {
    const result = await stepkit<{ value: number }>()
      .branchOn(
        {
          when: async ({ value }) => {
            await new Promise((r) => setTimeout(r, 10))
            return value > 10
          },
          then: (builder) => builder.step('large', () => ({ size: 'large' }))
        },
        {
          default: (builder) => builder.step('small', () => ({ size: 'small' }))
        }
      )
      .run({ value: 15 })

    expect(result.size).toBe('large')
  })

  it('should execute first matching branch in order', async () => {
    const result = await stepkit<{ value: number }>()
      .branchOn(
        {
          name: 'first',
          when: ({ value }) => value > 5,
          then: (builder) => builder.step('first', () => ({ match: 'first' }))
        },
        {
          name: 'second',
          when: ({ value }) => value > 3,
          then: (builder) => builder.step('second', () => ({ match: 'second' }))
        },
        {
          default: (builder) => builder.step('default', () => ({ match: 'default' }))
        }
      )
      .run({ value: 10 })

    // Should match first condition
    expect(result.match).toBe('first')
  })
})

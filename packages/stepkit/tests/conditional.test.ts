import { describe, expect, it } from '@jest/globals'
import { stepkit } from '../src/index'

describe('Conditional Steps', () => {
  it('should execute step when condition is true', async () => {
    const result = await stepkit<{ userId: string; isPremium: boolean }>()
      .step('fetch-user', ({ userId }) => {
        return { userName: 'Jane Doe' }
      })
      .step(
        {
          name: 'fetch-premium-features',
          condition: ({ isPremium }) => isPremium
        },
        () => {
          return { premiumFeatures: ['feature1', 'feature2'] }
        }
      )
      .run({ userId: '123', isPremium: true })

    expect(result.userName).toBe('Jane Doe')
    expect(result.premiumFeatures).toEqual(['feature1', 'feature2'])
  })

  it('should skip step when condition is false', async () => {
    const result = await stepkit<{ userId: string; isPremium: boolean }>()
      .step('fetch-user', ({ userId }) => {
        return { userName: 'Jane Doe' }
      })
      .step(
        {
          name: 'fetch-premium-features',
          condition: ({ isPremium }) => isPremium
        },
        () => {
          return { premiumFeatures: ['feature1', 'feature2'] }
        }
      )
      .step('finalize', () => {
        return { processed: true }
      })
      .run({ userId: '123', isPremium: false })

    expect(result.userName).toBe('Jane Doe')
    expect(result.premiumFeatures).toBeUndefined()
    expect(result.processed).toBe(true)
  })

  it('should support async condition functions', async () => {
    const result = await stepkit<{ value: number }>()
      .step('init', ({ value }) => ({ doubled: value * 2 }))
      .step(
        {
          name: 'conditional-step',
          condition: async ({ doubled }) => {
            await new Promise((r) => setTimeout(r, 10))
            return doubled > 10
          }
        },
        () => ({ large: true })
      )
      .run({ value: 10 })

    expect(result.large).toBe(true)
  })

  it('should support static boolean conditions', async () => {
    const result = await stepkit<{ value: number }>()
      .step('init', ({ value }) => ({ doubled: value * 2 }))
      .step(
        {
          name: 'always-skip',
          condition: false
        },
        () => ({ skipped: 'yes' })
      )
      .step(
        {
          name: 'always-run',
          condition: true
        },
        () => ({ ran: 'yes' })
      )
      .run({ value: 5 })

    expect(result.skipped).toBeUndefined()
    expect(result.ran).toBe('yes')
  })
})


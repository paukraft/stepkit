import { describe, expect, it } from '@jest/globals'
import { stepkit } from '../src/index'

describe('Step Timeout', () => {
  it('should timeout when step exceeds timeout', async () => {
    await expect(
      stepkit<{ delay: number }>()
        .step('fast-step', () => {
          return { fast: 'done' }
        })
        .step({ name: 'slow-step', timeout: 50 }, async ({ delay }) => {
          await new Promise((r) => setTimeout(r, delay))
          return { slow: 'done' }
        })
        .run({ delay: 200 })
    ).rejects.toThrow(/timed out after 50ms/)
  })

  it('should complete when step finishes within timeout', async () => {
    const result = await stepkit<{ delay: number }>()
      .step('fast-step', () => {
        return { fast: 'done' }
      })
      .step({ name: 'slow-step', timeout: 200 }, async ({ delay }) => {
        await new Promise((r) => setTimeout(r, delay))
        return { slow: 'done' }
      })
      .run({ delay: 50 })

    expect(result.fast).toBe('done')
    expect(result.slow).toBe('done')
  })

  it('should handle timeout with error handling strategy', async () => {
    const result = await stepkit<{ delay: number }>()
      .step('step-1', () => ({ value: 'success' }))
      .step(
        {
          name: 'timeout-step',
          timeout: 50,
          onError: 'continue'
        },
        async ({ delay }) => {
          await new Promise((r) => setTimeout(r, delay))
          return { timedOut: 'no' }
        }
      )
      .step('step-3', ({ value }) => ({ final: value + ' continued' }))
      .run({ delay: 200 })

    expect(result.value).toBe('success')
    expect(result.final).toBe('success continued')
    expect(result.timedOut).toBeUndefined()
  })
})


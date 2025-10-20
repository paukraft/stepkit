import { describe, expect, it } from '@jest/globals'
import { stepkit } from '../src/index'

describe('Basic Pipeline', () => {
  it('should execute a simple pipeline with sequential steps', async () => {
    const result = await stepkit<{ userId: string }>()
      .step('fetch-user', ({ userId }) => {
        return { userName: 'John Doe' }
      })
      .step('fetch-settings', ({ userName }) => {
        return { theme: 'dark', language: 'en' }
      })
      .run({ userId: '123' })

    expect(result.userId).toBe('123')
    expect(result.userName).toBe('John Doe')
    expect(result.theme).toBe('dark')
    expect(result.language).toBe('en')
  })

  it('should execute steps without input', async () => {
    const result = await stepkit()
      .step('fetch', () => {
        return { data: [1, 2, 3, 4, 5] }
      })
      .step('process', ({ data }) => {
        return { sum: data.reduce((a, b) => a + b, 0) }
      })
      .run({})

    expect(result.sum).toBe(15)
    expect(result.data).toEqual([1, 2, 3, 4, 5])
  })

  it('should support anonymous steps', async () => {
    const result = await stepkit<{ value: number }>()
      .step(({ value }) => ({ doubled: value * 2 }))
      .step(({ doubled }) => ({ final: doubled + 10 }))
      .run({ value: 5 })

    expect(result.final).toBe(20)
  })

  it('should return step descriptions', () => {
    const pipeline = stepkit<{ input: string }>()
      .step('fetch-data', ({ input }) => ({ data: input }))
      .step('process-data', ({ data }) => ({ processed: data.toUpperCase() }))
      .step('save-data', ({ processed }) => ({ saved: true }))

    const steps = pipeline.describe()
    expect(steps).toEqual(['fetch-data', 'process-data', 'save-data'])
  })
})


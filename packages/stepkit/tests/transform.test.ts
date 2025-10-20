import { describe, expect, it } from '@jest/globals'
import { stepkit } from '../src/index'

describe('Context Transformation', () => {
  it('should replace context instead of merging', async () => {
    const result = await stepkit<{ rawData: string }>()
      .step('parse', ({ rawData }) => {
        const parsed = JSON.parse(rawData)
        return { parsed }
      })
      .transform('reshape', ({ parsed }) => ({
        id: parsed.id,
        name: parsed.name
      }))
      .run({ rawData: '{"id":"123","name":"Test","extra":"data"}' })

    expect(result.id).toBe('123')
    expect(result.name).toBe('Test')
    // @ts-expect-error - rawData and parsed should not exist after transform
    expect(result.rawData).toBeUndefined()
    // @ts-expect-error - extra should not exist
    expect(result.parsed).toBeUndefined()
  })

  it('should support named transforms', async () => {
    const result = await stepkit<{ input: string }>()
      .step('process', ({ input }) => ({ data: input.toUpperCase() }))
      .transform('extract-length', ({ data }) => ({ length: data.length }))
      .run({ input: 'hello' })

    expect(result.length).toBe(5)
    // @ts-expect-error - input and data should not exist
    expect(result.input).toBeUndefined()
  })

  it('should support anonymous transforms', async () => {
    const result = await stepkit<{ a: number; b: number }>()
      .transform(({ a, b }) => ({ sum: a + b }))
      .run({ a: 5, b: 10 })

    expect(result.sum).toBe(15)
  })

  it('should support transforms with config', async () => {
    const result = await stepkit<{ value: number }>()
      .step('double', ({ value }) => ({ doubled: value * 2 }))
      .transform(
        {
          name: 'conditional-transform',
          condition: ({ doubled }) => doubled > 10
        },
        ({ doubled }) => ({ result: doubled * 10 })
      )
      .run({ value: 10 })

    expect(result.result).toBe(200)
  })

  it('should skip transform when condition is false', async () => {
    const result = await stepkit<{ value: number }>()
      .step('double', ({ value }) => ({ doubled: value * 2 }))
      .transform(
        {
          name: 'conditional-transform',
          condition: ({ doubled }) => doubled > 100
        },
        ({ doubled }) => ({ result: doubled * 10 })
      )
      .step('after', ({ doubled, result }) => {
        // When transform is skipped, doubled is still there; when not skipped, result is
        return { final: (doubled ?? 0) + (result ?? 0) + 1 }
      })
      .run({ value: 10 })

    // Transform was skipped, context should still have original fields
    // Since condition is false (20 > 100 is false), transform is skipped
    expect(result.doubled).toBe(20)
    expect(result.final).toBe(21)
  })
})

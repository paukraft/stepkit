import { stepkit } from '../src/index'

describe('Void/undefined return handling', () => {
  it('should allow steps to return void', async () => {
    const pipeline = stepkit<{ count: number }>()
      .step('initialize', ({ count }) => ({ value: count }))
      .step('side-effect', ({ value }) => {
        // Just do something, don't return anything
      })
      .step('continue', ({ value }) => ({ result: value * 2 }))

    const result = await pipeline.run({ count: 5 })

    expect(result.value).toBe(5)
    expect(result.result).toBe(10)
  })

  it('should allow steps to explicitly return undefined', async () => {
    const pipeline = stepkit<{ id: string }>()
      .step('fetch', ({ id }) => ({ data: `data-${id}` }))
      .step('log', ({ data }) => {
        return undefined
      })
      .step('process', ({ data }) => ({ processed: data.toUpperCase() }))

    const result = await pipeline.run({ id: 'test' })

    expect(result.data).toBe('data-test')
    expect(result.processed).toBe('DATA-TEST')
  })

  it('should work with parallel steps returning void', async () => {
    let sideEffect1 = false
    let sideEffect2 = false

    const pipeline = stepkit<{ input: string }>()
      .step(
        'parallel-side-effects',
        ({ input }) => {
          sideEffect1 = true
        },
        ({ input }) => {
          sideEffect2 = true
        }
      )
      .step('continue', ({ input }) => ({ output: input.toUpperCase() }))

    const result = await pipeline.run({ input: 'hello' })

    expect(sideEffect1).toBe(true)
    expect(sideEffect2).toBe(true)
    expect(result.output).toBe('HELLO')
  })

  it('should work with mix of void and data-returning functions in parallel', async () => {
    const pipeline = stepkit<{ base: number }>().step(
      'mixed-parallel',
      ({ base }) => {
        // Side effect only
      },
      ({ base }) => ({ doubled: base * 2 }),
      ({ base }) => {
        // Another side effect
      },
      ({ base }) => ({ tripled: base * 3 })
    )

    const result = await pipeline.run({ base: 10 })

    expect(result.doubled).toBe(20)
    expect(result.tripled).toBe(30)
  })

  it('should work with void return in settled parallel mode', async () => {
    let executed = false

    const pipeline = stepkit<{ value: number }>().step(
      { parallelMode: 'settled' },
      ({ value }) => {
        executed = true
      },
      ({ value }) => ({ result: value + 1 })
    )

    const result = await pipeline.run({ value: 5 })

    expect(executed).toBe(true)
    expect(result.result).toBe(6)
  })

  it('should throw helpful error when transform returns void', async () => {
    const pipeline = stepkit<{ initial: string }>()
      .step('setup', () => ({ data: 'test' }))
      // @ts-expect-error - intentionally testing runtime error for void return
      .transform('clear', () => {
        // Transform that returns nothing (should error)
      })

    await expect(pipeline.run({ initial: 'value' })).rejects.toThrow(
      /Transform 'clear' must return an object, not undefined/
    )
    await expect(pipeline.run({ initial: 'value' })).rejects.toThrow(
      /Transforms replace the entire context/
    )
    await expect(pipeline.run({ initial: 'value' })).rejects.toThrow(
      /Return at least an empty object \{\}/
    )
  })

  it('should allow transform to explicitly return empty object', async () => {
    const pipeline = stepkit<{ initial: string }>()
      .step('setup', () => ({ data: 'test' }))
      .transform('clear', () => {
        // Explicitly return empty object to clear context
        return {}
      })

    const result = await pipeline.run({ initial: 'value' })

    // After transform with {}, context should be empty
    expect(result).toEqual({})
  })
})

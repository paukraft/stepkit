import { describe, expect, it } from '@jest/globals'
import { stepkit, type StepInput, type StepNames, type StepOutput } from '../src/index'

describe('Type Safety and Inference', () => {
  it('should infer types correctly through pipeline', async () => {
    const pipeline = stepkit<{ userId: string }>()
      .step('fetch-user', ({ userId }) => {
        return { userName: 'John', age: 30 }
      })
      .step('fetch-settings', ({ userName, age }) => {
        // TypeScript should infer userName and age are available
        expect(typeof userName).toBe('string')
        expect(typeof age).toBe('number')
        return { theme: 'dark' }
      })

    const result = await pipeline.run({ userId: '123' })

    // All fields should be present
    expect(result.userId).toBe('123')
    expect(result.userName).toBe('John')
    expect(result.age).toBe(30)
    expect(result.theme).toBe('dark')
  })

  it('should support StepNames type helper', () => {
    const pipeline = stepkit<{ input: string }>()
      .step('step-one', ({ input }) => ({ output1: input + '1' }))
      .step('step-two', ({ output1 }) => ({ output2: output1 + '2' }))
      .step('step-three', ({ output2 }) => ({ output3: output2 + '3' }))

    type Names = StepNames<typeof pipeline>

    // This is compile-time validation
    const name1: Names = 'step-one'
    const name2: Names = 'step-two'
    const name3: Names = 'step-three'

    expect(name1).toBe('step-one')
    expect(name2).toBe('step-two')
    expect(name3).toBe('step-three')
  })

  it('should support StepInput type helper', async () => {
    const pipeline = stepkit<{ userId: string }>()
      .step('fetch-user', ({ userId }) => {
        return { userName: 'John' }
      })
      .step('fetch-settings', ({ userName }) => {
        return { theme: 'dark' }
      })

    // StepInput should give us the context at that step
    type FetchSettingsInput = StepInput<typeof pipeline, 'fetch-settings'>

    const testInput: FetchSettingsInput = {
      userId: '123',
      userName: 'John'
    }

    expect(testInput.userId).toBe('123')
    expect(testInput.userName).toBe('John')
  })

  it('should support StepOutput type helper for final context', async () => {
    const pipeline = stepkit<{ input: string }>()
      .step('step-one', ({ input }) => ({ output1: input + '1' }))
      .step('step-two', ({ output1 }) => ({ output2: output1 + '2' }))

    type FinalOutput = StepOutput<typeof pipeline>

    const result = await pipeline.run({ input: 'test' })
    const typedResult: FinalOutput = result

    expect(typedResult.input).toBe('test')
    expect(typedResult.output1).toBe('test1')
    expect(typedResult.output2).toBe('test12')
  })

  it('should support StepOutput type helper for intermediate steps', async () => {
    const pipeline = stepkit<{ input: string }>()
      .step('step-one', ({ input }) => ({ output1: input + '1' }))
      .step('step-two', ({ output1 }) => ({ output2: output1 + '2' }))
      .step('step-three', ({ output2 }) => ({ output3: output2 + '3' }))

    // Get context after step-one (context right after 'step-one' completes)
    type AfterStepOne = StepOutput<typeof pipeline, 'step-one'>

    // This should have input and output1 only (not output2)
    const afterOne: AfterStepOne = {
      input: 'test',
      output1: 'test1'
    }

    expect(afterOne.output1).toBe('test1')
  })

  it('should infer optional types for conditional steps', async () => {
    const pipeline = stepkit<{ isPremium: boolean }>()
      .step('init', () => ({ initialized: true }))
      .step(
        {
          name: 'premium-features',
          condition: ({ isPremium }) => isPremium
        },
        () => ({ premiumData: 'data' })
      )
      .step('final', ({ premiumData }) => {
        // TypeScript should know premiumData might be undefined
        return { hasPremium: !!premiumData }
      })

    const result = await pipeline.run({ isPremium: false })
    expect(result.hasPremium).toBe(false)
  })

  it('should handle transform type changes correctly', async () => {
    const result = await stepkit<{ a: number; b: number }>()
      .step('sum', ({ a, b }) => ({ sum: a + b }))
      .transform('extract', ({ sum }) => ({
        result: sum,
        doubled: sum * 2
      }))
      .step('final', ({ result, doubled }) => {
        // TypeScript should know result and doubled are available
        // but a, b, and sum are not
        return { total: result + doubled }
      })
      .run({ a: 5, b: 10 })

    expect(result.result).toBe(15)
    expect(result.doubled).toBe(30)
    expect(result.total).toBe(45)
  })

  it('should run pipeline correctly', async () => {
    const result = await stepkit<{ value: number }>()
      .step('double', ({ value }) => ({ doubled: value * 2 }))
      .run({ value: 5 })

    expect(result.doubled).toBe(10)
  })

  it('should preserve type safety in branches', async () => {
    const result = await stepkit<{ userId: string; plan: string }>()
      .step('init', ({ userId }) => ({ initialized: true }))
      .branchOn(
        {
          when: ({ plan }) => plan === 'premium',
          then: (builder) =>
            builder.step('premium', ({ userId }) => {
              // userId should be available here
              expect(typeof userId).toBe('string')
              return { features: ['a', 'b'] }
            })
        },
        {
          default: (builder) =>
            builder.step('normal', ({ userId }) => {
              // userId should be available here too
              expect(typeof userId).toBe('string')
              return { features: ['c'] }
            })
        }
      )
      .run({ userId: '123', plan: 'premium' })

    expect(result.features).toEqual(['a', 'b'])
  })
})

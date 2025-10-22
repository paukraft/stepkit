import { describe, expect, it, jest } from '@jest/globals'
import { stepkit, type StepNames, type StepOutput } from '../src/index'

describe('Step with nested pipeline', () => {
  it('should execute a prebuilt pipeline and merge only new keys (by diff)', async () => {
    const sub = stepkit<{ passOn: boolean }>().step('sub', ({ passOn }) => ({
      test: ['1', '2', '3']
    }))

    const result = await stepkit()
      .step('before', () => ({ passOn: true }))
      .step('sub-flow', sub)
      .step('after', ({ passOn, test }) => {
        expect(passOn).toBe(true)
        expect(test).toEqual(['1', '2', '3'])
        return { done: true }
      })
      .run({})

    expect(result.passOn).toBe(true)
    expect(result.test).toEqual(['1', '2', '3'])
    expect(result.done).toBe(true)
  })

  it('should apply wrapping mergePolicy to nested outputs (override)', async () => {
    const sub = stepkit<{ k: number }>().step('inner', () => ({ k: 2, extra: true }))
    const result = await stepkit<{ k: number }>()
      .step({ name: 'sub', mergePolicy: 'override' }, sub)
      .run({ k: 1 })
    expect(result.k).toBe(2)
    expect(result.extra).toBe(true)
  })

  it('should apply wrapping mergePolicy to nested outputs (skip)', async () => {
    const sub = stepkit<{ k: number }>().step('inner', () => ({ k: 2, extra: true }))
    const result = await stepkit<{ k: number }>()
      .step({ name: 'sub', mergePolicy: 'skip' }, sub)
      .run({ k: 1 })
    expect(result.k).toBe(1)
    expect(result.extra).toBe(true)
  })

  it('should accept a prebuilt pipeline and infer types', async () => {
    const compute = stepkit<{ x: number; y: number }>()
      .step('sum', ({ x, y }) => ({ sum: x + y }))
      .step('doubled', ({ sum }) => ({ doubled: sum * 2 }))

    const result = await stepkit<{ x: number }>()
      .step('provide-y', () => ({ y: 2 }))
      .step('compute', compute)
      .step('final', ({ doubled }) => ({ ok: doubled > 0 }))
      .run({ x: 5 })

    expect(result.sum).toBe(7)
    expect(result.doubled).toBe(14)
    expect(result.ok).toBe(true)
  })

  it('should respect condition and make outputs optional when skipped', async () => {
    const maybeSub = stepkit<{ enabled: boolean }>().step('sub', () => ({ onlyWhenEnabled: true }))
    const result = await stepkit<{ enabled: boolean }>()
      .step({ name: 'maybe-sub', condition: ({ enabled }) => enabled }, maybeSub)
      .step('after', ({ onlyWhenEnabled }) => ({ seen: onlyWhenEnabled === true }))
      .run({ enabled: false })

    expect(result.seen).toBe(false)
  })

  it('should nest logging with name prefix', async () => {
    const logFn = jest.fn()
    const inner = stepkit().step('inner', () => ({ k: 1 }))
    await stepkit({ log: { logFn } })
      .step('before', () => ({ passOn: true }))
      .step('sub-flow', inner)
      .run({})

    const logs = logFn.mock.calls.map((c) => String(c[0]))
    expect(logs.some((m) => m.includes('sub-flow'))).toBe(true)
    expect(logs.some((m) => m.includes('inner'))).toBe(true)
  })

  it('should accept a pipeline as an argument to step() and merge outputs', async () => {
    const sub = stepkit<{ a: number }>().step('add-b', ({ a }) => ({ b: a + 1 }))

    const res = await stepkit<{ a: number }>()
      .step('use-sub', sub)
      .step('next', ({ b }) => ({ c: b * 2 }))
      .run({ a: 1 })

    expect(res.b).toBe(2)
    expect(res.c).toBe(4)
  })

  it('should expose nested sub-step names via prefix for typing', async () => {
    const inner = stepkit<{ passOn: boolean }>().step('inner', ({ passOn }) => ({ seen: passOn }))
    const pipeline = stepkit()
      .step('before', () => ({ passOn: true }))
      .step('sub-flow', inner)
      .step('after', ({ seen }) => ({ done: !!seen }))

    type Names = StepNames<typeof pipeline>
    const stepName: Names = 'sub-flow/inner'
    expect(stepName).toBe('sub-flow/inner')

    type AfterInner = StepOutput<typeof pipeline, 'sub-flow/inner'>
    const x: AfterInner = { passOn: true, seen: true }
    expect(x.seen).toBe(true)
  })
})

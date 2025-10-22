import { describe, expect, it } from '@jest/globals'
import { stepkit, type StepNames, type StepOutput } from '../src/index'

describe('Nested types in branches', () => {
  it('should expose prefixed child names in branch cases', async () => {
    const pipeline = stepkit<{ x: number; flag: boolean }>()
      .branchOn(
        'route',
        {
          name: 'case-a',
          when: ({ flag }) => flag,
          then: (b) => b.step('child', ({ x }) => ({ y: x + 1 }))
        },
        {
          name: 'case-b',
          default: (b) => b.step('child', ({ x }) => ({ y: x + 1 }))
        }
      )
      .step('final', ({ y }) => ({ z: (y ?? 0) * 2 }))

    type Names = StepNames<typeof pipeline>
    const n1: Names = 'route'
    const n2: Names = 'final'
    expect(n1).toBe('route')
    expect(n2).toBe('final')

    type AfterRoute = StepOutput<typeof pipeline, 'route'>
    const a: AfterRoute = { x: 1, flag: true, y: 2 }
    expect(a.y).toBe(2)

    const result = await pipeline.run({ x: 1, flag: true })
    expect(result.z).toBe(4)
  })
})

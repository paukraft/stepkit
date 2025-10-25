import { describe, expect, it } from '@jest/globals'
import { stepkit } from '../src/index'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('Checkpoints and Resume', () => {
  it('resumes from a top-level step checkpoint and matches full-run output', async () => {
    const pipeline = stepkit<{ x: number }>()
      .step('inc', ({ x }) => ({ x: x + 1 }))
      .step('mul', ({ x }) => ({ x: x * 3 }))
      .step('final', ({ x }) => ({ y: x + 10 }))

    let checkpointStr = ''
    const full = await pipeline.run(
      { x: 1 },
      {
        onStepComplete: (e) => {
          if (e.stepName === 'mul') checkpointStr = e.checkpoint
        }
      }
    )

    const resumed = await pipeline.runCheckpoint(checkpointStr)

    expect(resumed).toEqual(full)
  })

  it('applies overrideData shallowly when resuming', async () => {
    const pipeline = stepkit<{ a: number; b?: number }>()
      .step('one', ({ a }) => ({ a: a + 1 }))
      .step('two', ({ a }) => ({ a: a * 2 }))
      .step('end', ({ a, b }) => ({ sum: (a ?? 0) + (b ?? 0) }))

    let cp = ''
    await pipeline.run(
      { a: 2 },
      {
        onStepComplete: (e) => {
          if (e.stepName === 'two') cp = e.checkpoint
        }
      }
    )

    // With string checkpoint + explicit stepName, overrideData is typed to that step's output
    await pipeline.runCheckpoint({
      checkpoint: cp,
      overrideData: { b: 5 }
    })

    const resumed = await pipeline.runCheckpoint({
      checkpoint: cp,
      stepName: 'two',
      overrideData: { b: 5 }
    })
    expect(resumed).toHaveProperty('sum', (2 + 1) * 2 + 5)
  })

  it('overrides boolean flags additively without removing others', async () => {
    const pipeline = stepkit<{ a: boolean; b?: boolean }>()
      .step('flags', () => ({ a: true, b: true }))
      .step('noop', () => ({}))

    let cp = ''
    await pipeline.run(
      { a: false },
      {
        onStepComplete: (e) => {
          if (e.stepName === 'flags') cp = e.checkpoint
        }
      }
    )

    const resumed = await pipeline.runCheckpoint({ checkpoint: cp, overrideData: { b: false } })
    expect(resumed).toEqual({ a: true, b: false })
  })

  it('supports nested branch resume from a sub-step', async () => {
    const nested = stepkit<{ v: number }>()
      .step('a', ({ v }) => ({ v: v + 1 }))
      .branchOn(
        'route',
        {
          name: 'even',
          when: ({ v }) => v % 2 === 0,
          then: (b) => b.step('even-step', ({ v }) => ({ tag: `even-${v}` }))
        },
        {
          name: 'odd',
          default: (b) => b.step('odd-step', ({ v }) => ({ tag: `odd-${v}` }))
        }
      )
      .step('done', ({ tag }) => ({ out: tag }))

    let cp = ''
    await nested.run(
      { v: 0 },
      {
        onStepComplete: (e) => {
          if (e.stepName.endsWith('route/odd/odd-step')) cp = e.checkpoint
        }
      }
    )

    const resumed = await nested.runCheckpoint(cp)
    expect(resumed).toHaveProperty('out', 'odd-1')
  })

  it('can stop via stopPipeline and return partial context', async () => {
    const pipeline = stepkit<{ t: number }>()
      .step('s1', ({ t }) => ({ t: t + 1 }))
      .step('s2', async ({ t }) => {
        await sleep(5)
        return { t: t + 1 }
      })
      .step('s3', ({ t }) => ({ t: t + 1 }))

    const out = await pipeline.run(
      { t: 0 },
      {
        onStepComplete: (e) => {
          if (e.stepName === 's2') e.stopPipeline()
        }
      }
    )

    expect(out).toEqual({ t: 2 })
  })

  it('allows overriding whole object/array keys shallowly at resume', async () => {
    const pipeline = stepkit<{}>()
      .step('init', () => ({ user: { id: 'u1', name: 'A' } }))
      .step('fetch', () => ({ orders: [{ id: 'o1' }] as Array<{ id: string }> }))
      .step('calc', ({ user, orders }) => ({ userId: user.id, count: orders.length }))

    let cp = ''
    await pipeline.run(
      {},
      {
        onStepComplete: (e) => {
          if (e.stepName === 'fetch') cp = e.checkpoint
        }
      }
    )

    const resumed = await pipeline.runCheckpoint({
      checkpoint: cp,
      overrideData: {
        user: { id: 'u2', name: 'B' },
        orders: [{ id: 'o2' }, { id: 'o3' }]
      }
    })

    expect(resumed).toMatchObject({ user: { id: 'u2', name: 'B' }, count: 2 })
  })
})

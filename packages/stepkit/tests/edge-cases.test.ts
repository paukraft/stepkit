import { stepkit } from '../src'

describe('edge cases', () => {
  test('invalid timeout values do not enable timeout', async () => {
    const pipeline = stepkit<{ a: number }>()
      .step({ name: 'one', timeout: NaN } as any, () => ({ x: 1 }))
      .step({ name: 'two', timeout: -1 } as any, () => ({ y: 2 }))
    const out = await pipeline.run({ a: 1 })
    expect(out).toMatchObject({ a: 1, x: 1, y: 2 })
  })

  test('non-object step return throws', async () => {
    const pipeline = stepkit<{ a: number }>().step(
      'bad',
      () => 42 as unknown as Record<string, unknown>
    )
    await expect(pipeline.run({ a: 1 })).rejects.toThrow('Step function must return an object')
  })

  test('merge policy error on collision', async () => {
    const pipeline = stepkit<{ a: number }>()
      .step({ name: 's1', mergePolicy: 'error' }, () => ({ k: 1 }))
      .step({ name: 's2', mergePolicy: 'error' }, () => ({ k: 2 }))
    await expect(pipeline.run({ a: 1 })).rejects.toThrow(/Context key collision: 'k'/)
  })
})

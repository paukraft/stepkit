import { describe, expect, it } from '@jest/globals'
import { stepkit } from '../src/index'

describe('Nested pipeline merge policy collisions', () => {
  it('warn: should log a warning on collision and override value', async () => {
    const logs: string[] = []
    const logFn = (m: string) => logs.push(String(m))
    const sub = stepkit<{ k: number }>().step('inner', () => ({ k: 2 }))
    const res = await stepkit<{ k: number }>({ log: { logFn } })
      .step({ name: 'sub', mergePolicy: 'warn' }, sub)
      .run({ k: 1 })
    expect(res.k).toBe(2)
    expect(logs.some((m) => m.includes("Key collision on 'k'"))).toBe(true)
  })

  it('error: should throw on collision', async () => {
    const sub = stepkit<{ k: number }>().step('inner', () => ({ k: 2 }))
    await expect(
      stepkit<{ k: number }>().step({ name: 'sub', mergePolicy: 'error' }, sub).run({ k: 1 })
    ).rejects.toThrow(/Context key collision/)
  })
})

import { describe, expect, it } from '@jest/globals'
import { stepkit } from '../src/index'

describe('Parallel Execution', () => {
  it('should execute multiple functions in parallel within a step', async () => {
    const executionOrder: string[] = []

    const result = await stepkit<{ companyId: string }>()
      .step('fetch-company', ({ companyId }) => {
        return { company: { id: companyId, name: 'ACME Corp' } }
      })
      .step(
        'enrich-data',
        async ({ company }) => {
          executionOrder.push('start-employees')
          await new Promise((r) => setTimeout(r, 50))
          executionOrder.push('end-employees')
          return { employees: 150 }
        },
        async ({ company }) => {
          executionOrder.push('start-revenue')
          await new Promise((r) => setTimeout(r, 25))
          executionOrder.push('end-revenue')
          return { revenue: 5000000 }
        }
      )
      .run({ companyId: 'abc123' })

    // Both should start before either ends (parallel execution)
    expect(executionOrder.indexOf('start-employees')).toBeLessThan(
      executionOrder.indexOf('end-employees')
    )
    expect(executionOrder.indexOf('start-revenue')).toBeLessThan(
      executionOrder.indexOf('end-revenue')
    )

    expect(result.company.name).toBe('ACME Corp')
    expect(result.employees).toBe(150)
    expect(result.revenue).toBe(5000000)
  })

  it('should merge outputs from parallel functions', async () => {
    const result = await stepkit<{ id: string }>()
      .step(
        'parallel-fetch',
        ({ id }) => ({ name: 'Test Name' }),
        ({ id }) => ({ email: 'test@example.com' }),
        ({ id }) => ({ age: 30 })
      )
      .run({ id: '123' })

    expect(result.name).toBe('Test Name')
    expect(result.email).toBe('test@example.com')
    expect(result.age).toBe(30)
  })
})


import { describe, expect, it, jest } from '@jest/globals'
import { stepkit } from '../src/index'

describe('Stopwatch / Performance Tracking', () => {
  it('should track timing when stopwatch is enabled', async () => {
    const logFn = jest.fn()

    await stepkit<{ count: number }>({
      log: { stopwatch: true, logFn }
    })
      .step('initialize', ({ count }) => {
        return { items: Array.from({ length: count }, (_, i) => i) }
      })
      .step('process-items', async ({ items }) => {
        await new Promise((r) => setTimeout(r, 50))
        return { processed: items.map((i) => i * 2) }
      })
      .run({ count: 10 })

    const logMessages = logFn.mock.calls.map((call) => call[0] as string).join('\n')

    // Should show performance summary
    expect(logMessages).toContain('Performance Summary')

    // Should show step durations
    expect(logMessages).toContain('initialize')
    expect(logMessages).toContain('process-items')

    // Should show total pipeline time
    expect(logMessages).toContain('Total Pipeline Time')
  })

  it('should support granular stopwatch control', async () => {
    const logFn = jest.fn()

    await stepkit<{ data: string }>({
      log: {
        stopwatch: {
          showStepDuration: false,
          showSummary: true,
          showTotal: true
        },
        logFn
      }
    })
      .step('step-1', ({ data }) => ({ output1: data + '1' }))
      .step('step-2', ({ output1 }) => ({ output2: output1 + '2' }))
      .run({ data: 'test' })

    const logMessages = logFn.mock.calls.map((call) => call[0] as string)

    // Should NOT show duration in step completion message (only "completed", not "completed in Xms")
    const stepCompletionMessages = logMessages.filter(
      (msg) => msg?.includes('completed') && !msg.includes('Performance Summary')
    )
    expect(
      stepCompletionMessages.some(
        (msg) => msg.includes(' in ') && (msg.includes('ms') || msg.includes('s'))
      )
    ).toBe(false)

    // Should show summary table
    const fullLog = logMessages.join('\n')
    expect(fullLog).toContain('Performance Summary')

    // Should show total time
    expect(fullLog).toContain('Total Pipeline Time')
  })

  it('should show statistics in performance summary', async () => {
    const logFn = jest.fn()

    await stepkit<{ value: number }>({
      log: { stopwatch: true, logFn }
    })
      .step('fast', ({ value }) => ({ fast: value * 2 }))
      .step('slow', async ({ fast }) => {
        await new Promise((r) => setTimeout(r, 50))
        return { slow: fast + 1 }
      })
      .step('medium', async ({ slow }) => {
        await new Promise((r) => setTimeout(r, 25))
        return { medium: slow + 1 }
      })
      .run({ value: 5 })

    const logMessages = logFn.mock.calls.map((call) => call[0] as string).join('\n')

    // Should show statistics
    expect(logMessages).toContain('Statistics')
    expect(logMessages).toContain('Average')
    expect(logMessages).toContain('Slowest')
    expect(logMessages).toContain('Fastest')
  })

  it('should not show stopwatch when disabled', async () => {
    const logFn = jest.fn()

    await stepkit<{ data: string }>({
      log: { stopwatch: false, logFn }
    })
      .step('step-1', ({ data }) => ({ output: data + '1' }))
      .run({ data: 'test' })

    const logMessages = logFn.mock.calls.map((call) => call[0] as string).join('\n')

    expect(logMessages).not.toContain('Performance Summary')
    expect(logMessages).not.toContain('Total Pipeline Time')
  })

  it('should track skipped steps in performance summary', async () => {
    const logFn = jest.fn()

    await stepkit<{ shouldRun: boolean }>({
      log: { stopwatch: true, logFn }
    })
      .step('step-1', () => ({ value: 1 }))
      .step(
        {
          name: 'conditional-step',
          condition: ({ shouldRun }) => shouldRun
        },
        () => ({ conditional: true })
      )
      .step('step-3', () => ({ final: true }))
      .run({ shouldRun: false })

    const logMessages = logFn.mock.calls.map((call) => call[0] as string).join('\n')

    // Should show skipped step in summary
    expect(logMessages).toContain('conditional-step')
    expect(logMessages).toContain('skipped')
  })
})

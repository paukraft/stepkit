import { describe, expect, it, jest } from '@jest/globals'
import { stepkit } from '../src/index'

describe('Logging', () => {
  it('should not log when log is false', async () => {
    const logFn = jest.fn()

    await stepkit<{ input: string }>({ log: false })
      .step('step-1', ({ input }) => ({ output: input + '1' }))
      .run({ input: 'test' })

    expect(logFn).not.toHaveBeenCalled()
  })

  it('should use custom log function when provided', async () => {
    const logFn = jest.fn()
    const errorLogFn = jest.fn()

    await stepkit<{ input: string }>({
      log: {
        logFn,
        errorLogFn
      }
    })
      .step('step-1', ({ input }) => ({ output: input + '1' }))
      .run({ input: 'test' })

    expect(logFn).toHaveBeenCalled()
    // Check that starting pipeline message was logged
    expect(logFn.mock.calls.some((call) => String(call[0]).includes('Starting pipeline'))).toBe(
      true
    )
  })

  it('should respect per-step log override', async () => {
    const logFn = jest.fn()

    await stepkit<{ input: string }>({
      log: { logFn }
    })
      .step('logged-step', ({ input }) => ({ output1: input + '1' }))
      .step({ name: 'silent-step', log: false }, ({ output1 }) => ({ output2: output1 + '2' }))
      .step('another-logged-step', ({ output2 }) => ({ output3: output2 + '3' }))
      .run({ input: 'test' })

    const logMessages = logFn.mock.calls.map((call) => call[0] as string)

    // logged-step should be logged
    expect(logMessages.some((msg) => msg?.includes('logged-step'))).toBe(true)

    // silent-step should NOT be logged
    expect(logMessages.some((msg) => msg?.includes('silent-step'))).toBe(false)

    // another-logged-step should be logged
    expect(logMessages.some((msg) => msg?.includes('another-logged-step'))).toBe(true)
  })

  it('should call onStepComplete callback', async () => {
    const completions: Array<{ name: string; duration: number }> = []

    await stepkit<{ input: string }>({
      onStepComplete: (stepName, _output, duration) => {
        completions.push({ name: stepName, duration })
      }
    })
      .step('step-1', ({ input }) => ({ output1: input + '1' }))
      .step('step-2', ({ output1 }) => ({ output2: output1 + '2' }))
      .run({ input: 'test' })

    expect(completions).toHaveLength(2)
    expect(completions[0].name).toBe('step-1')
    expect(completions[1].name).toBe('step-2')
    expect(completions[0].duration).toBeGreaterThanOrEqual(0)
  })

  it('should call onStepComplete from run options', async () => {
    const completions: string[] = []

    await stepkit<{ input: string }>()
      .step('step-1', ({ input }) => ({ output: input + '1' }))
      .run(
        { input: 'test' },
        {
          onStepComplete: (stepName) => {
            completions.push(stepName)
          }
        }
      )

    expect(completions).toContain('step-1')
  })

  it('should call both config and run options callbacks', async () => {
    const configCompletions: string[] = []
    const runCompletions: string[] = []

    await stepkit<{ input: string }>({
      onStepComplete: (stepName) => {
        configCompletions.push(stepName)
      }
    })
      .step('step-1', ({ input }) => ({ output: input + '1' }))
      .run(
        { input: 'test' },
        {
          onStepComplete: (stepName) => {
            runCompletions.push(stepName)
          }
        }
      )

    expect(configCompletions).toContain('step-1')
    expect(runCompletions).toContain('step-1')
  })
})

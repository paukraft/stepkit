import { describe, expect, it } from '@jest/globals'
import { stepkit } from '../src/index'

describe('Error Handling', () => {
  it('should throw by default when a step fails', async () => {
    await expect(
      stepkit<{ shouldFail: boolean }>()
        .step('step-1', () => ({ value: 'success' }))
        .step('step-2', ({ shouldFail }) => {
          if (shouldFail) {
            throw new Error('Something went wrong!')
          }
          return { status: 'ok' }
        })
        .run({ shouldFail: true })
    ).rejects.toThrow('Something went wrong!')
  })

  it('should continue on error when onError is set to continue', async () => {
    const result = await stepkit<{ shouldFail: boolean }>()
      .step('step-1', () => ({ value: 1 }))
      .step({ name: 'step-2', onError: 'continue' }, ({ shouldFail }) => {
        if (shouldFail) {
          throw new Error('Step 2 failed')
        }
        return { failed: 'no' }
      })
      .step('step-3', ({ value }) => ({ final: value + 1 }))
      .run({ shouldFail: true })

    expect(result.value).toBe(1)
    expect(result.final).toBe(2)
    expect(result.failed).toBeUndefined()
  })

  it('should skip remaining steps when onError is skip-remaining', async () => {
    const executedSteps: string[] = []

    const result = await stepkit<{ shouldFail: boolean }>()
      .step('step-1', () => {
        executedSteps.push('step-1')
        return { value: 1 }
      })
      .step({ name: 'step-2', onError: 'skip-remaining' }, ({ shouldFail }) => {
        executedSteps.push('step-2')
        if (shouldFail) {
          throw new Error('Step 2 failed')
        }
        return { value2: 2 }
      })
      .step('step-3', ({ value }) => {
        executedSteps.push('step-3')
        return { final: value + 1 }
      })
      .run({ shouldFail: true })

    expect(executedSteps).toEqual(['step-1', 'step-2'])
    expect(result.value).toBe(1)
    expect(result.final).toBeUndefined()
  })

  it('should call onError callback when provided in config', async () => {
    const errors: Array<{ stepName: string; message: string }> = []

    await stepkit<{ shouldFail: boolean }>({
      onError: (stepName, error) => {
        errors.push({ stepName, message: error.message })
      }
    })
      .step('step-1', () => ({ value: 1 }))
      .step({ name: 'failing-step', onError: 'continue' }, ({ shouldFail }) => {
        if (shouldFail) {
          throw new Error('Expected error')
        }
        return { status: 'ok' }
      })
      .step('step-3', () => ({ final: 'done' }))
      .run({ shouldFail: true })

    expect(errors).toHaveLength(1)
    expect(errors[0].stepName).toBe('failing-step')
    expect(errors[0].message).toBe('Expected error')
  })

  it('should call onError from run options', async () => {
    const errors: string[] = []

    await stepkit<{ shouldFail: boolean }>()
      .step('step-1', () => ({ value: 1 }))
      .step({ name: 'failing-step', onError: 'continue' }, ({ shouldFail }) => {
        if (shouldFail) {
          throw new Error('Expected error')
        }
        return { status: 'ok' }
      })
      .run(
        { shouldFail: true },
        {
          onError: (stepName) => {
            errors.push(stepName)
          }
        }
      )

    expect(errors).toContain('failing-step')
  })
})


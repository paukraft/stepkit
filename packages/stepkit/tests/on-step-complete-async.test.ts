import { describe, expect, it, jest } from '@jest/globals'
import { stepkit } from '../src/index'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('Async onStepComplete behavior', () => {
  it('awaits async onStepComplete and honors stopPipeline before next step', async () => {
    const send = jest.fn()

    const pipeline = stepkit<{ body: string }>()
      .step('generate', async ({ body }) => {
        await sleep(5)
        return { response: `reply:${body}` }
      })
      .step('send', async ({ response }) => {
        send(response)
        return {}
      })

    const out = await pipeline.run(
      { body: 'hello' },
      {
        onStepComplete: async (e) => {
          if (e.stepName.endsWith('generate')) {
            // simulate async side-effect (e.g., save checkpoint)
            await sleep(15)
            e.stopPipeline()
          }
        }
      }
    )

    expect(out).toEqual({ body: 'hello', response: 'reply:hello' })
    expect(send).not.toHaveBeenCalled()
  })

  it('can resume after async stop and then run remaining steps', async () => {
    const send = jest.fn()

    const pipeline = stepkit<{ body: string }>()
      .step('generate', async ({ body }) => {
        await sleep(5)
        return { response: `reply:${body}` }
      })
      .step('send', async ({ response }) => {
        send(response)
        return {}
      })

    let checkpoint = ''
    await pipeline.run(
      { body: 'world' },
      {
        onStepComplete: async (e) => {
          if (e.stepName.endsWith('generate')) {
            checkpoint = e.checkpoint
            await sleep(10)
            e.stopPipeline()
          }
        }
      }
    )

    expect(send).not.toHaveBeenCalled()

    await pipeline.runCheckpoint({ checkpoint })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('reply:world')
  })
})

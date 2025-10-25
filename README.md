# stepkit

A super minimal, type-safe pipeline builder for TypeScript. Built for AI SDK but works everywhere.

## Installation

```bash
npm install stepkit
# or pnpm, yarn, bun
```

## Core Idea: Pipelines

Build small, named steps that pass a typed context forward. Each step returns a plain object merged into the context. Keep it obvious and composable.

## Examples

### Parallel Execution + Conditional Steps

```typescript
import { openai } from '@ai-sdk/openai'
import { generateText } from 'ai'

const evaluator = stepkit<{ idea: string }>()
  // Run market signals in parallel
  .step(
    'gather-market-signals',
    async ({ idea }) => ({ marketSize: await fetchMarketSize(idea) }),
    async ({ idea }) => ({ competitors: await fetchCompetitors(idea) }),
  )
  // Conditional: only run forecasting when the market is large
  .step(
    { name: 'run-forecast', condition: ({ marketSize }) => marketSize === 'large' },
    async ({ idea }) => ({ forecast: await forecastROI(idea) }),
  )
  .step('evaluate', async ({ idea, marketSize, competitors, forecast }) => {
    const { text } = await generateText({
      model: openai('gpt-4.1'),
      prompt: `Rate this idea (1-10): "${idea}"\nMarket: ${marketSize}\nCompetitors: ${competitors.length}\nForecast: ${forecast ?? 'n/a'}`,
    })
    return { evaluation: text }
  })

await evaluator.run({ idea: 'AI-powered plant waterer' })
```

Tip: Use `{ parallelMode: 'settled' }` on a step to continue merging successful parallel outputs even if some functions fail.

### Logging & Stopwatch

Enable structured logs with per-step durations and a performance summary by passing `{ log: { stopwatch: true } }` at runtime.

```typescript
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const pipeline = stepkit<{ userId: string }>()
  .step('fetch-user', async ({ userId }) => {
    await sleep(150)
    return { user: { id: userId, email: 'user@example.com' } }
  })
  .step(
    'fetch-data',
    async ({ user }) => {
      await sleep(120)
      return { orders: [{ id: 'o1' }, { id: 'o2' }, { id: 'o3' }] }
    },
    async ({ user }) => {
      await sleep(80)
      return { alerts: ['notice'] }
    }
  )
  .step({ name: 'maybe-slow', timeout: 200, onError: 'continue' }, async () => {
    await sleep(300) // will time out and continue
    return { slow: true }
  })
  .step('process', ({ orders }) => ({ orderCount: orders?.length ?? 0 }))
  .branchOn(
    'route',
    {
      name: 'has-orders',
      when: ({ orderCount }) => (orderCount ?? 0) > 0,
      then: (b) => b.step('compute-total', () => ({ total: 99.5 }))
    },
    { name: 'no-orders', default: (b) => b.step('show-empty', () => ({ total: 0 })) }
  )
  .transform('finalize', ({ user, total }) => ({ userId: user.id, total }))

await pipeline.run({ userId: '42' }, { log: { stopwatch: true } })
```

Output:

```text
🚀 Starting pipeline with input: {
  userId: "42",
}

📍 Step: fetch-user
✅ fetch-user completed in 178ms
   Output: user

📍 Step: fetch-data
✅ fetch-data completed in 121ms
   Output: orders, alerts

📍 Step: maybe-slow
❌ maybe-slow failed after 201ms
   Error: ... Step 'maybe-slow' timed out after 200ms

📍 Step: process
✅ process completed in 0ms
   Output: orderCount

🔀 Branch: route
   ↳ Executing: has-orders

📍 Step: has-orders/compute-total
✅ has-orders/compute-total completed in 0ms
   Output: total
✅ route completed in 2ms
   Output: total

🔄 Transform: finalize
✅ finalize completed in 0ms
   Output: userId, total

⏱️  Performance Summary:
┌──────────────────────────────────────────────────────┐
│ ✅ fetch-user                                  178ms │
│ ✅ fetch-data                                  121ms │
│ ❌ maybe-slow                                  201ms │
│ ✅ process                                       0ms │
│ ✅ has-orders/compute-total                      0ms │
│ ✅ route                                         2ms │
│ ✅ finalize                                      0ms │
└──────────────────────────────────────────────────────┘

📊 Statistics:
   Average: 50ms
   Slowest: fetch-user (178ms)
   Fastest: process (0ms)

⏰ Total Pipeline Time: 511ms

✨ Pipeline completed successfully
```

### Branching Logic

```typescript
const moderator = stepkit<{ content: string; userId: string }>()
  .step('classify-content', async ({ content }) => {
    const { text } = await generateText({
      model: openai('gpt-4.1'),
      prompt: `Classify content as safe, suspicious, or dangerous.\n\n${content}`,
    })
    return { riskLevel: text.trim().toLowerCase() as 'safe' | 'suspicious' | 'dangerous' }
  })
  .branchOn(
    'policy-route',
    {
      name: 'safe',
      when: ({ riskLevel }) => riskLevel === 'safe',
      then: (b) =>
        b.step('publish', async () => ({ action: 'published' as const })),
    },
    {
      name: 'suspicious',
      when: ({ riskLevel }) => riskLevel === 'suspicious',
      then: (b) =>
        b
          .step('queue-review', async () => ({ reviewTicketId: await createReviewTicket() }))
          .step('notify-moderators', async ({ reviewTicketId }) => ({
            moderatorNotified: await notifyModerators(reviewTicketId),
          }))
          .step('hold', () => ({ action: 'held-for-review' as const })),
    },
    {
      name: 'dangerous',
      default: (b) =>
        b
          .step('block-user', async ({ userId }) => ({ blocked: await blockUser(userId) }))
          .step('send-user-email', async ({ blocked }) => ({
            userMessaged: blocked ? await sendUserEmail('Your content was blocked') : false,
          }))
          .step('notify-admin', async () => ({ adminNotified: await notifyAdmin() }))
          .step('finalize', () => ({ action: 'blocked' as const })),
    },
  )
  .transform('format', ({ action, reviewTicketId, moderatorNotified, adminNotified }) => ({
    status: action,
    reviewTicketId,
    moderatorNotified,
    adminNotified,
  }))

await moderator.run({ content: 'Check this out!' })
```

### Transform: Replace Context

Clean the context: drop intermediate or sensitive fields and keep only what the next steps need.

```typescript
const cleaner = stepkit<{ token: string }>()
  .step('fetch-user', async ({ token }) => ({
    user: await getUser(token),
    token, // still present for now
    debugInfo: { fetchedAt: Date.now() },
  }))
  .step('fetch-settings', async ({ user }) => ({
    rawSettings: await getSettings(user.id),
    transient: 'will-be-removed',
  }))
  // Replace the entire context to remove clutter and sensitive data
  .transform('clean-context', ({ user, rawSettings }) => ({
    userId: user.id,
    email: user.email,
    theme: rawSettings.theme ?? 'system',
    isPro: rawSettings.plan === 'pro',
  }))
  .step('use-clean', ({ userId, theme, isPro }) => ({
    profileReady: true,
    message: `${isPro ? 'Pro' : 'Free'} user ${userId} prefers ${theme} theme`,
  }))

await cleaner.run({ token: 'secret' })
```

### Composable Pipelines

```typescript
import { StepOutput } from 'stepkit'

// Classify input
const classify = stepkit<{ prompt: string }>()
  .step('classify', async ({ prompt }) => {
    const { text } = await generateText({
      model: openai('gpt-4.1'),
      prompt: `Is this a question or statement? One word.\n\n${prompt}`,
    })
    return { type: text.trim().toLowerCase() }
  })

// Extract type for reusable branches
type Classified = StepOutput<typeof classify, 'classify'>

// Reusable pipelines (can live in separate files)
const handleQuestion = stepkit<Classified>()
  .step('answer', async ({ prompt }) => {
    const { text } = await generateText({
      model: openai('gpt-4.1'),
      prompt: `Answer: ${prompt}`,
    })
    return { response: text }
  })

const handleStatement = stepkit<Classified>()
  .step('acknowledge', () => ({ response: 'Thanks for sharing!' }))

// Compose with full type safety (branch)
const responder = classify
  .branchOn(
    {
      name: 'question',
      when: ({ type }) => type === 'question',
      then: handleQuestion,
    },
    { name: 'statement', default: handleStatement },
  )
  .step('finalize', ({ response }) => ({ done: true, response }))

await responder.run({ prompt: 'What is AI?' })
```

### Nested Pipelines

```typescript
// Session sub-pipeline: load session and permissions
const sessionPipeline = stepkit<{ sessionId: string }>()
  .step('fetch-session', async ({ sessionId }) => ({ session: await getSession(sessionId) }))
  .step('fetch-permissions', async ({ session }) => ({
    permissions: await getPermissions(session.userId),
  }))

// Main pipeline composes the session pipeline and continues
const main = stepkit<{ sessionId: string }>()
  .step('load-session', sessionPipeline)
  .step('use-permissions', ({ permissions }) => ({ canPublish: permissions.includes('publish') }))

await main.run({ sessionId: 'abc123' })
```

Notes:
- Nested pipelines merge outputs using the wrapping step's `mergePolicy` (default: `override`).
- Nested step names are prefixed for typing, e.g. `some-other/sub` appears in `StepNames` and `StepOutput`.

### Error Handling & Retries

Let a step fail without breaking the pipeline, and retry transient errors.

```typescript
const fetchWithRetry = stepkit()
  .step(
    {
      name: 'fetch-resource',
      onError: 'continue',
      retries: 2,
      retryDelayMs: 250,
      shouldRetry: (err) => /429|timeout/i.test(String(err?.message ?? err)),
    },
    async () => {
      // imagine a flaky network call
      const ok = Math.random() > 0.5
      if (!ok) throw new Error('429: too many requests')
      return { data: { id: '42' } }
    },
  )
  .step('continue-anyway', ({ data }) => ({ hasData: !!data }))

await fetchWithRetry.run({})
```

### Timeouts & Abort

Guard slow steps and support cancelling the whole pipeline.

```typescript
const ac = new AbortController()

const guarded = stepkit()
  .step(
    { name: 'third-party-api-request', timeout: 1500, onError: 'continue' },
    async () => {
      // Simulate an external API that may be slow
      await new Promise((r) => setTimeout(r, 2000))
      return { thirdPartyOk: true }
    },
  )
  .step('after', ({ thirdPartyOk }) => ({
    status: thirdPartyOk ? 'used-third-party' : 'skipped-third-party',
  }))

// ac.abort() would cancel; pass the signal at run time
await guarded.run({}, { signal: ac.signal })
```

### Checkpoints & Resume

Resume from any completed step via checkpoints emitted by `onStepComplete`. You can shallowly override fields on resume.

```typescript
import { stepkit } from 'stepkit'

const calc = stepkit<{ a: number; b?: number }>()
  .step('add-one', ({ a }) => ({ a: a + 1 }))
  .step('double', ({ a }) => ({ a: a * 2 }))
  .step('finish', ({ a, b }) => ({ sum: (a ?? 0) + (b ?? 0) }))

let checkpoint = ''
await calc.run(
  { a: 1 },
  {
    onStepComplete: (e) => {
      if (e.stepName === 'double') checkpoint = e.checkpoint
    },
  },
)

// Resume later with an override
const resumed = await calc.runCheckpoint({ checkpoint, overrideData: { b: 10 } })
```

#### Human approval (mock flow)

Pause after generating a draft, store the checkpoint, and resume on approval.

```typescript
import { stepkit } from 'stepkit'

// Mocks
const kv: Record<string, string> = {}
const save = async (id: string, cp: string) => (kv[id] = cp)
const get = async (id: string) => kv[id] ?? null
const del = async (id: string) => { delete kv[id] }
const sendEmail = async ({ to, body }: { to: string; body: string }) => {
  console.log('Sending email to', to, 'with body:', body)
}

const replyFlow = stepkit<{ body: string }>()
  .step('generate', async ({ body }) => ({ reply: `Reply: ${body}` }))
  .step('send', async ({ reply }) => {
    await sendEmail({ to: 'user@example.com', body: reply })
  })

export const start = async (body: string) => {
  let approvalId: string | null = null
  await replyFlow.run(
    { body },
    {
      async onStepComplete(e) {
        if (e.stepName.endsWith('generate')) {
          approvalId = `apr_${Date.now()}`
          await save(approvalId, e.checkpoint)
          e.stopPipeline()
        }
      },
    },
  )
  return { approvalId }
}

export const approve = async (approvalId: string) => {
  const checkpoint = await get(approvalId)
  if (!checkpoint) throw new Error('Not found')
  await replyFlow.runCheckpoint(checkpoint)
  await del(approvalId)
}

export const reject = async (approvalId: string) => {
  await del(approvalId)
}
```

### Stop Pipeline Early

Call `e.stopPipeline()` from `onStepComplete` to end a run after a specific step.

```typescript
await stepkit<{ n: number }>()
  .step('s1', ({ n }) => ({ n: n + 1 }))
  .step('s2', ({ n }) => ({ n: n + 1 }))
  .step('s3', ({ n }) => ({ n: n + 1 }))
  .run(
    { n: 0 },
    {
      onStepComplete: (e) => {
        if (e.stepName === 's2') e.stopPipeline()
      },
    },
  )
// => { n: 2 }
```

### Type Helpers

Infer names, inputs, and outputs anywhere you need them.

```typescript
import { StepNames, StepInput, StepOutput } from 'stepkit'

const simple = stepkit<{ id: string }>()
  .step('fetch-user', ({ id }) => ({ name: 'John', id }))
  .step('process', ({ name }) => ({ result: name.toUpperCase() }))

type Names = StepNames<typeof simple> // 'fetch-user' | 'process'
type ProcessInput = StepInput<typeof simple, 'process'> // { id: string; name: string }
type AfterFetch = StepOutput<typeof simple, 'fetch-user'> // { id: string; name: string }
type FinalOutput = StepOutput<typeof simple> // { id: string; name: string; result: string }
```

## Features

- **Type-safe** — Types flow through each step automatically
- **Parallel execution** — Run steps concurrently when possible
- **Branching** — Conditional logic with reusable pipeline branches
- **Composable** — Import and combine pipelines from separate files
- **Observable** — Opt-in logging with timing and performance tracking
- **Zero dependencies** — Minimal and simple, understand instantly

## Why?

Built as a lightweight alternative to larger frameworks. No ceremony, just compose pipelines with full type safety.

## License

MIT

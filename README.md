# stepkit

A super minimal, type-safe pipeline builder for TypeScript. Built for AI SDK but works everywhere.

## Installation

```bash
npm install stepkit
# or pnpm, yarn, bun
```

## Core Idea: Pipelines

Build small, named steps that pass a typed context forward. Each step returns a plain object merged into the context. Keep it obvious and composable.

```typescript
import { stepkit } from 'stepkit'
import { openai } from '@ai-sdk/openai'
import { generateText } from 'ai'

const signup = stepkit<{ email: string }>()
  .step('normalize-email', ({ email }) => ({ normalizedEmail: email.trim().toLowerCase() }))
  .step('check-email-deliverability', async ({ normalizedEmail }) => ({
    isDeliverable: await verifyEmail(normalizedEmail),
  }))
  .branchOn(
    'delivery-route',
    {
      name: 'deliverable',
      when: ({ isDeliverable }) => isDeliverable,
      then: (b) =>
        b
          .step('draft-welcome', async ({ normalizedEmail }) => {
            const { text } = await generateText({
              model: openai('gpt-4.1'),
              prompt: `Write a friendly one-line welcome for ${normalizedEmail}. Max 12 words.`,
            })
            return { welcomeSubject: 'Welcome to Acme', welcomeBody: text }
          })
          .step(
            'send-welcome-email',
            async ({ normalizedEmail, welcomeSubject, welcomeBody }) => {
              const subject = welcomeSubject ?? 'Welcome!'
              const body = welcomeBody ?? 'Welcome aboard!'
              const id = await sendEmail({ to: normalizedEmail, subject, body })
              return { welcomeEmailId: id }
            },
          ),
    },
    {
      name: 'undeliverable',
      default: (b) =>
        b.step('request-verification', async ({ normalizedEmail }) => ({
          verificationRequestId: await requestVerification(normalizedEmail),
        })),
    },
  )

await signup.run({ email: 'User@Example.com' })
```

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

Replace the entire context when you want to normalize or finalize the shape.

```typescript
const normalizer = stepkit<{ score: number }>()
  .transform('normalize-score', ({ score }) => ({ score: Math.max(0, Math.min(1, score / 100)) }))
  .step('use-score', ({ score }) => ({ isHigh: score >= 0.8 }))

await normalizer.run({ score: 87 })
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

### Logging & Stopwatch

Enable logging with per-step durations and a summary.

```typescript
const observed = stepkit({
  log: {
    logFn: (...args) => console.log(...args),
    stopwatch: { showStepDuration: true, showSummary: true, showTotal: true },
  },
})
  .step('fetch-user', async () => ({ user: await fetchUser('42') }))
  .step('fetch-orders', async ({ user }) => ({ orders: await fetchOrders(user.id) }))

await observed.run({})
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

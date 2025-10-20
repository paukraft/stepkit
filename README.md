# stepkit

A super minimal, type-safe workflow builder for TypeScript. Built for AI SDK but works everywhere.

## Installation

```bash
npm install stepkit
# or pnpm, yarn, bun
```

## Examples

### Parallel Execution + Conditional Steps

```typescript
import { openai } from '@ai-sdk/openai'
import { generateText } from 'ai'

const evaluator = stepkit<{ idea: string }>()
  // Run market research in parallel
  .step(
    'gather-context',
    async ({ idea }) => ({
      marketSize: await webAgent({ task: `${idea} market size` }),
    }),
    async ({ idea }) => ({
      competition: await webAgent({ task: `${idea} competition` }),
    }),
  )
  // Conditional: only run if market is large
  .step(
    {
      name: 'deep-research',
      condition: ({ marketSize }) => marketSize === 'large',
    },
    async ({ idea }) => ({
      successStories: await webAgent({ task: `${idea} success stories` }),
    }),
  )
  .step('evaluate', async ({ idea, marketSize, competition, successStories }) => {
    const { text } = await generateText({
      model: openai('gpt-4'),
      prompt: `Rate this idea (1-10): "${idea}"\nMarket: ${marketSize}, Competition: ${competition}`,
    })
    return { evaluation: text }
  })

await evaluator.run({ idea: 'AI-powered plant waterer' })
```

### Branching Logic

```typescript
const moderator = stepkit<{ content: string }>()
  .step('analyze', async ({ content }) => {
    const { text } = await generateText({
      model: openai('gpt-4'),
      prompt: `Analyze this content. Respond with: "safe", "suspicious", or "dangerous"\n\n${content}`,
    })
    return { riskLevel: text.trim().toLowerCase() }
  })
  .branchOn(
    'route',
    {
      name: 'safe',
      when: ({ riskLevel }) => riskLevel === 'safe',
      then: (builder) =>
        builder.step('approve', () => ({ action: 'approve', review: false })),
    },
    {
      name: 'suspicious',
      when: ({ riskLevel }) => riskLevel === 'suspicious',
      then: (builder) =>
        builder.step('flag', () => ({ action: 'flag', review: true })),
    },
    {
      name: 'dangerous',
      default: (builder) =>
        builder.step('block', () => ({ action: 'block', review: true })),
    },
  )
  .transform('format', ({ action, review }) => ({
    status: action,
    needsReview: review,
  }))

await moderator.run({ content: 'Check this out!' })
```

### Composable Pipelines

```typescript
import { StepOutput } from 'stepkit'

// Classify input
const classify = stepkit<{ prompt: string }>()
  .step('classify', async ({ prompt }) => {
    const { text } = await generateText({
      model: openai('gpt-4'),
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
      model: openai('gpt-4'),
      prompt: `Answer: ${prompt}`,
    })
    return { response: text }
  })

const handleStatement = stepkit<Classified>()
  .step('acknowledge', () => ({ response: 'Thanks for sharing!' }))

// Compose with full type safety
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

## Features

- **Type-safe** — Types flow through each step automatically
- **Parallel execution** — Run steps concurrently when possible
- **Branching** — Conditional logic with reusable pipeline branches
- **Composable** — Import and combine pipelines from separate files
- **Observable** — Opt-in logging with timing and performance tracking
- **Zero dependencies** — Minimal and simple, understand instantly

## Why?

Built as a lightweight alternative to larger frameworks. No ceremony, just compose workflows with full type safety.

## License

MIT

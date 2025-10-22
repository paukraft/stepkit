## stepkit

Type-safe pipeline builder for Node.js/TypeScript with powerful step composition, branching, parallelism, transforms, and timeouts.

### Install

```bash
pnpm add stepkit
```

### Quick start

```ts
import { stepkit } from 'stepkit'

const pipeline = stepkit<{ id: string }>()
  .step('fetch-user', async ({ id }) => ({ user: { id, name: 'John' } }))
  .step('process', ({ user }) => ({ result: user.name.toUpperCase() }))

const result = await pipeline.run({ id: '42' })
```

### Features
- Named steps with strongly-typed `ctx` accumulation
- Branching, parallel steps, conditionals, inserts
- Timeouts, error handling, logging hooks
- First-class type utilities: `StepNames`, `StepInput`, `StepOutput`

### License

MIT © Pau Kraft



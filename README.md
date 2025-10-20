# stepkit

A TypeScript library monorepo built with Turborepo.

## Structure

```
├── apps/
│   └── docs/              # Documentation app (empty for now)
├── packages/
│   └── stepkit/           # Core TypeScript library
```

## Package Manager Compatibility

This monorepo is designed to work with any package manager:

- **npm**: `npm install` → `npm run dev`
- **pnpm**: `pnpm install` → `pnpm run dev`
- **yarn**: `yarn install` → `yarn run dev`
- **bun**: `bun install` → `bun run dev`

The repository includes a `pnpm-workspace.yaml` for pnpm users, but npm/yarn/bun workspaces are also supported via the `workspaces` field in `package.json`.

## Getting Started

### Install dependencies

```bash
npm install
# or pnpm install, yarn, bun install
```

### Development

```bash
npm run dev
```

### Build

```bash
npm run build
```

### Test

```bash
npm run test
```

### Lint & Format

```bash
npm run lint
npm run format
```

### Type Check

```bash
npm run check-types
```

## Library: `stepkit`

Located in `packages/stepkit`.

- **Build**: `tsup` (outputs ESM + CJS + `.d.ts`)
- **Test**: Jest with ts-jest
- **Type**: Strict TypeScript

### Publishing

The library is configured with proper exports for both ESM and CommonJS:

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  }
}
```

## CI/CD

GitHub Actions workflow runs on every push and PR:

- Lint
- Type check
- Test
- Build

The CI uses Node.js 20 and npm, but local development works with any package manager.

## Future Plans

- Add Contentlayer/MDX documentation
- Set up Changesets for automated versioning and publishing
- Add more comprehensive test coverage

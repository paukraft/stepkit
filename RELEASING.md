## Releasing stepkit

This project follows **tsdown’s recommended library build flow**: single-source (`src`) → bundled outputs (`dist`) using **tsdown**.  
See the [tsdown Guide](https://tsdown.dev/guide/) for reference and options.

---

### Prereqs
- **Node ≥ 20.19** (required for tsdown/rolldown build runtime)
- Logged in to npm with publish rights: `npm whoami`
- Clean git status

---

### 1) Verify changes and tests
- Update code and docs
- From repo root:
```bash
  pnpm -C packages/stepkit test
````

---

### 2) Bump version (semver)

* Edit `packages/stepkit/package.json` → `"version": "x.y.z"`
* Commit with a clear message:

  ```bash
  git add -A
  git commit -m "chore(release): x.y.z"
  ```

---

### 3) Build from src with tsdown

```bash
pnpm -C packages/stepkit -s build
```

#### tsdown config expectations

`packages/stepkit/tsdown.config.ts` should look like:

```ts
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  outDir: 'dist',
  dts: { sourcemap: true },
  platform: 'node',
  // target is optional – inferred from package.json "engines.node"
  // target: 'node18',
  // Optional to keep consistent .js/.cjs naming:
  // fixedExtension: true,
  // Optional (experimental): auto-generate exports field
  // exports: true,
})
```

---

### 4) Artifacts and exports

After build, the package should expose:

* **ESM:** `dist/index.js`
* **CJS:** `dist/index.cjs`
* **Types:** `dist/index.d.ts`

*(If tsdown emits `.d.cts` / `.d.mts` files, reflect them in `exports` accordingly.)*

**`packages/stepkit/package.json`**

```json
{
  "type": "module",
  "main": "dist/index.cjs",
  "module": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "engines": { "node": ">=20.19.0" }
}
```

*(Optional)* You may enable `"exports": true` in tsdown config to auto-generate these mappings (experimental).

---

### 5) Smoke test dist (recommended)

Verify that expected symbols are present in outputs:

* `dist/index.js` (ESM) contains `onStepComplete: async` and `await runtime.onStepComplete`
* `dist/index.cjs` (CJS) contains the same

---

### 6) Tag and push

```bash
git tag v{x.y.z}
git push origin master --tags
```

---

### 7) Publish to npm

From `packages/stepkit`:

```bash
npm publish --access public --ignore-scripts
```

---

### Notes

* Do **not** manually edit files in `dist/`.
* Keep `tsdown.config.ts` aligned with the [Guide](https://tsdown.dev/guide/).
* Ensure exports stay stable for consumers; if output paths change, update `package.json`.

---

### Troubleshooting

* If you hit rolldown/tsdown runtime errors (e.g., missing Node APIs), ensure Node ≥ 20.19.
* For debugging only, you can temporarily build with TypeScript:

  ```bash
  pnpm -C packages/stepkit exec tsc -p tsconfig.build.json
  ```

  Then revert to tsdown before publishing to stay aligned with the guide.
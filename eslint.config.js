// CommonJS wrapper that proxies to the ESM config using dynamic import so
// ESLint v9 can load it without requiring "type": "module" at the repo root.
module.exports = (async () => (await import('./eslint.config.mjs')).default)()


export const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

export const deepClone = <T>(value: T): T => {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => deepClone(v)) as unknown as T
  if (value instanceof Date) return new Date(value.getTime()) as unknown as T
  if (!isPlainObject(value)) return value
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) result[k] = deepClone(v)
  return result as unknown as T
}

type MergePolicy = 'override' | 'error' | 'warn' | 'skip'

export const mergeWithPolicy = (
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
  policy: MergePolicy,
  onCollision?: (key: string) => void
): Record<string, unknown> => {
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (Object.prototype.hasOwnProperty.call(base, key)) {
      if (policy === 'error') throw new Error(`Context key collision: '${key}' already exists`)
      if (policy === 'warn') onCollision?.(key)
      if (policy === 'skip') continue
    }
    out[key] = value
  }
  return out
}

export type StopwatchConfig = {
  showStepDuration?: boolean
  showSummary?: boolean
  showTotal?: boolean
}

export type LogConfig = {
  logFn?: (message: string, ...args: unknown[]) => void
  errorLogFn?: (message: string, ...args: unknown[]) => void
  stopwatch?: boolean | StopwatchConfig
}

export type StepTimingInfo = {
  name: string
  duration: number
  status: 'success' | 'failed' | 'skipped'
}

export type InternalRuntime = {
  globalLog: boolean
  logFn: (message: string, ...args: unknown[]) => void
  errorLogFn: (message: string, ...args: unknown[]) => void
  stopwatchEnabled: boolean
  showStepDuration: boolean
  showSummary: boolean
  showTotal: boolean
  stepTimings: StepTimingInfo[]
  pipelineStartTime: number
  onStepComplete?: (stepName: string, output: Record<string, unknown>, duration: number) => void
  onError?: (stepName: string, error: Error) => void
  namePrefix: string[]
  signal?: AbortSignal
}

export const formatDuration = (durationMs: number): string => {
  if (durationMs < 1000) return `${durationMs}ms`
  const seconds = durationMs / 1000
  if (seconds < 60) return `${Number(seconds.toFixed(1))}s`
  const minutes = seconds / 60
  if (minutes < 60) return `${Number(minutes.toFixed(1))}m`
  const hours = minutes / 60
  return `${Number(hours.toFixed(1))}h`
}

export const getDisplayName = (runtime: InternalRuntime, name: string) => {
  if (!runtime.namePrefix.length) return name
  return `${runtime.namePrefix.join('/')}/${name}`
}

export type PipelineConfig = {
  log?: boolean | LogConfig
  onStepComplete?: (stepName: string, output: Record<string, unknown>, duration: number) => void
  onError?: (stepName: string, error: Error) => void
  signal?: AbortSignal
}

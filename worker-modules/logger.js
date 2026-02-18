// Structured JSON logging with runId tracking

let currentRunId = null

export function createLogger(runId) {
  currentRunId = runId
  return { info, warn, error }
}

function fmt(level, message, data) {
  return JSON.stringify({
    level,
    runId: currentRunId,
    timestamp: new Date().toISOString(),
    message,
    ...data,
  })
}

function info(message, data = {}) {
  console.log(fmt('info', message, data))
}

function warn(message, data = {}) {
  console.warn(fmt('warn', message, data))
}

function error(message, data = {}) {
  console.error(fmt('error', message, data))
}

export { info, warn, error }

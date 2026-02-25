interface ImportProgressBarProps {
  done: number
  total: number
  label: string
}

export function ImportProgressBar({ done, total, label }: ImportProgressBarProps) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <div className="py-10 px-4 space-y-6" data-testid="import-progress">
      {/* Spinner with percentage */}
      <div className="text-center space-y-2">
        <div className="relative inline-flex items-center justify-center">
          <div className="w-16 h-16 border-4 border-blue-100 rounded-full" />
          <div className="absolute inset-0 w-16 h-16 border-4 border-transparent border-t-blue-600 rounded-full animate-spin" />
          <span className="absolute text-lg font-semibold text-blue-600">{pct}%</span>
        </div>
        <p className="text-gray-700 font-medium">{label}</p>
      </div>

      {/* Progress bar */}
      <div className="space-y-2">
        <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${pct}%` }}
            role="progressbar"
            aria-valuenow={done}
            aria-valuemin={0}
            aria-valuemax={total}
          />
        </div>
        <p className="text-center text-sm text-gray-500">
          {done} / {total}
        </p>
      </div>
    </div>
  )
}

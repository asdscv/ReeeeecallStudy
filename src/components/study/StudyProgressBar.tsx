interface StudyProgressBarProps {
  current: number
  total: number
}

export function StudyProgressBar({ current, total }: StudyProgressBarProps) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0

  return (
    <div className="flex items-center gap-3 sm:gap-4 flex-1">
      <div className="flex-1 h-1 bg-gray-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-red-500 via-amber-500 to-green-500 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs sm:text-sm font-medium text-gray-700 whitespace-nowrap">
        {current}/{total}
      </span>
    </div>
  )
}

import CalendarHeatmap from 'react-calendar-heatmap'
import 'react-calendar-heatmap/dist/styles.css'
import { useTranslation } from 'react-i18next'

interface StudyHeatmapProps {
  data: { date: string; count: number }[]
}

export function StudyHeatmap({ data }: StudyHeatmapProps) {
  const { t } = useTranslation('dashboard')
  const today = new Date()
  const startDate = new Date(today)
  startDate.setFullYear(startDate.getFullYear() - 1)

  // Determine max count for color scaling
  const maxCount = Math.max(1, ...data.map((d) => d.count))

  const getClassForValue = (value: { date: string; count?: number } | undefined) => {
    if (!value || !value.count || value.count === 0) return 'fill-gray-100'
    const ratio = value.count / maxCount
    if (ratio <= 0.25) return 'fill-green-200'
    if (ratio <= 0.50) return 'fill-green-400'
    if (ratio <= 0.75) return 'fill-green-500'
    return 'fill-green-700'
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5">
      <h3 className="text-sm font-medium text-gray-700 mb-2 sm:mb-3">{t('heatmap.title')}</h3>
      <div className="overflow-x-auto">
        <CalendarHeatmap
          startDate={startDate}
          endDate={today}
          values={data}
          classForValue={getClassForValue}
          showWeekdayLabels
          titleForValue={(value) => {
            if (!value || !value.date) return t('heatmap.noStudy')
            return t('heatmap.studyCount', { date: value.date, count: value.count })
          }}
        />
      </div>
    </div>
  )
}

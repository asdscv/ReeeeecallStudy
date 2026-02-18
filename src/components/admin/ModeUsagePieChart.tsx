import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import type { PieLabelRenderProps } from 'recharts'
import { useTranslation } from 'react-i18next'
import { studyModeLabel } from '../../lib/admin-stats'
import type { ModeUsagePercentage } from '../../lib/admin-stats'

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']

interface ModeUsagePieChartProps {
  data: ModeUsagePercentage[]
}

export function ModeUsagePieChart({ data }: ModeUsagePieChartProps) {
  const { t } = useTranslation('admin')

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5">
      <h3 className="text-sm font-medium text-gray-700 mb-3">{t('study.modeUsage')}</h3>
      {data.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">{t('noData')}</p>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie
              data={data}
              dataKey="session_count"
              nameKey="mode"
              cx="50%"
              cy="50%"
              outerRadius={80}
              label={(props: PieLabelRenderProps) => `${t(studyModeLabel(String(props.mode ?? '')), String(props.mode ?? ''))} (${Math.round((props.percent ?? 0) * 100)}%)`}
            >
              {data.map((_, index) => (
                <Cell key={index} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(value) => [Number(value), t('study.sessions')]} />
            <Legend formatter={(value: string) => t(studyModeLabel(value), value)} />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { todayDateKey } from '../../lib/date-utils'

interface DatePickerProps {
  selectedDate: string
  onSelectDate: (date: string) => void
  datesWithCards: Set<string>
}

export function DatePicker({ selectedDate, onSelectDate, datesWithCards }: DatePickerProps) {
  const [currentMonth, setCurrentMonth] = useState(() => {
    const date = selectedDate ? new Date(selectedDate) : new Date()
    return new Date(date.getFullYear(), date.getMonth(), 1)
  })

  const daysInMonth = new Date(
    currentMonth.getFullYear(),
    currentMonth.getMonth() + 1,
    0
  ).getDate()

  const firstDayOfMonth = new Date(
    currentMonth.getFullYear(),
    currentMonth.getMonth(),
    1
  ).getDay()

  const prevMonth = () => {
    setCurrentMonth(
      new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1)
    )
  }

  const nextMonth = () => {
    setCurrentMonth(
      new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1)
    )
  }

  const handleDateClick = (day: number) => {
    const year = currentMonth.getFullYear()
    const month = String(currentMonth.getMonth() + 1).padStart(2, '0')
    const dayStr = String(day).padStart(2, '0')
    onSelectDate(`${year}-${month}-${dayStr}`)
  }

  const totalCells = Math.ceil((firstDayOfMonth + daysInMonth) / 7) * 7

  const todayStr = todayDateKey()

  return (
    <div className="bg-white border border-gray-300 rounded-lg p-3">
      {/* Month Navigation */}
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={prevMonth}
          className="p-1 hover:bg-gray-100 rounded transition-colors cursor-pointer"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="font-medium text-sm">
          {currentMonth.toLocaleDateString('ko-KR', {
            year: 'numeric',
            month: 'long',
          })}
        </div>
        <button
          type="button"
          onClick={nextMonth}
          className="p-1 hover:bg-gray-100 rounded transition-colors cursor-pointer"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Day Headers */}
      <div className="grid grid-cols-7 gap-1 mb-2">
        {['일', '월', '화', '수', '목', '금', '토'].map((day) => (
          <div
            key={day}
            className="aspect-square flex items-center justify-center text-xs font-medium text-gray-500"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: totalCells }, (_, i) => {
          const day = i - firstDayOfMonth + 1
          const isValidDay = day > 0 && day <= daysInMonth

          if (!isValidDay) {
            return <div key={i} />
          }

          const year = currentMonth.getFullYear()
          const month = String(currentMonth.getMonth() + 1).padStart(2, '0')
          const dayStr = String(day).padStart(2, '0')
          const dateString = `${year}-${month}-${dayStr}`

          const hasCards = datesWithCards.has(dateString)
          const isSelected = dateString === selectedDate
          const isToday = dateString === todayStr

          return (
            <button
              key={i}
              type="button"
              onClick={() => handleDateClick(day)}
              className={`
                aspect-square flex items-center justify-center text-sm rounded-lg transition-colors cursor-pointer
                ${isSelected ? 'bg-blue-600 text-white font-bold' : ''}
                ${!isSelected && hasCards ? 'bg-gray-100 text-gray-900 font-semibold hover:bg-gray-200' : ''}
                ${!isSelected && !hasCards ? 'text-gray-300 hover:bg-gray-50' : ''}
                ${isToday && !isSelected ? 'ring-2 ring-blue-400' : ''}
              `}
            >
              {day}
            </button>
          )
        })}
      </div>
    </div>
  )
}

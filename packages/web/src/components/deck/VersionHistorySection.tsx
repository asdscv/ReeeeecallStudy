import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useVersionStore } from '../../stores/version-store'

interface VersionHistorySectionProps {
  deckId: string
  isOwner: boolean
}

export function VersionHistorySection({ deckId, isOwner }: VersionHistorySectionProps) {
  const { t } = useTranslation(['decks', 'common'])
  const { versions, loading, error, creating, fetchVersions, createVersion } = useVersionStore()
  const [changeSummary, setChangeSummary] = useState('')
  const [showCreateForm, setShowCreateForm] = useState(false)

  useEffect(() => {
    fetchVersions(deckId)
  }, [deckId, fetchVersions])

  const handleCreate = async () => {
    const result = await createVersion(deckId, changeSummary.trim() || undefined)
    if (result) {
      setChangeSummary('')
      setShowCreateForm(false)
    }
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  if (loading && versions.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-5 bg-gray-100 rounded w-40" />
          <div className="h-4 bg-gray-100 rounded w-full" />
          <div className="h-4 bg-gray-100 rounded w-3/4" />
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-700">
          {t('decks:detail.versionHistory', { defaultValue: 'Version History' })}
        </h3>
        {isOwner && (
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="text-xs text-blue-600 hover:text-blue-800 cursor-pointer font-medium"
          >
            {showCreateForm
              ? t('common:cancel', { defaultValue: 'Cancel' })
              : t('decks:detail.createVersion', { defaultValue: '+ New Version' })}
          </button>
        )}
      </div>

      {/* Create form */}
      {showCreateForm && (
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <input
            type="text"
            value={changeSummary}
            onChange={(e) => setChangeSummary(e.target.value)}
            placeholder={t('decks:detail.versionSummaryPlaceholder', { defaultValue: 'What changed? (optional)' })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none mb-2"
          />
          <button
            onClick={handleCreate}
            disabled={creating}
            className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition disabled:opacity-50 cursor-pointer"
          >
            {creating
              ? t('decks:detail.creatingVersion', { defaultValue: 'Creating...' })
              : t('decks:detail.saveVersion', { defaultValue: 'Save Version' })}
          </button>
        </div>
      )}

      {error && (
        <div className="px-4 py-3 text-sm text-red-600">{error}</div>
      )}

      {/* Timeline */}
      {versions.length === 0 ? (
        <div className="p-6 text-center text-gray-500 text-sm">
          {t('decks:detail.noVersions', { defaultValue: 'No versions recorded yet.' })}
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {versions.map((version) => (
            <div key={version.id} className="px-4 py-3 flex items-start gap-3">
              <div className="shrink-0 mt-0.5">
                <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold">
                  v{version.version_number}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-medium text-gray-900">
                    {t('decks:detail.versionLabel', {
                      defaultValue: 'Version {{num}}',
                      num: version.version_number,
                    })}
                  </span>
                  <span className="text-xs text-gray-400 px-2 py-0.5 bg-gray-100 rounded-full">
                    {version.card_count} {t('decks:detail.versionCards', { defaultValue: 'cards' })}
                  </span>
                </div>
                {version.change_summary && (
                  <p className="text-sm text-gray-600 truncate">{version.change_summary}</p>
                )}
                <p className="text-xs text-gray-400 mt-0.5">{formatDate(version.created_at)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

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
      <div className="bg-card rounded-xl border border-border p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-5 bg-accent rounded w-40" />
          <div className="h-4 bg-accent rounded w-full" />
          <div className="h-4 bg-accent rounded w-3/4" />
        </div>
      </div>
    )
  }

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">
          {t('decks:detail.versionHistory', { defaultValue: 'Version History' })}
        </h3>
        {isOwner && (
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="text-xs text-brand hover:text-brand cursor-pointer font-medium"
          >
            {showCreateForm
              ? t('common:cancel', { defaultValue: 'Cancel' })
              : t('decks:detail.createVersion', { defaultValue: '+ New Version' })}
          </button>
        )}
      </div>

      {/* Create form */}
      {showCreateForm && (
        <div className="px-4 py-3 border-b border-border bg-muted">
          <input
            type="text"
            value={changeSummary}
            onChange={(e) => setChangeSummary(e.target.value)}
            placeholder={t('decks:detail.versionSummaryPlaceholder', { defaultValue: 'What changed? (optional)' })}
            className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:border-brand focus:ring-2 focus:ring-brand/20 outline-none mb-2"
          />
          <button
            onClick={handleCreate}
            disabled={creating}
            className="px-4 py-1.5 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand transition disabled:opacity-50 cursor-pointer"
          >
            {creating
              ? t('decks:detail.creatingVersion', { defaultValue: 'Creating...' })
              : t('decks:detail.saveVersion', { defaultValue: 'Save Version' })}
          </button>
        </div>
      )}

      {error && (
        <div className="px-4 py-3 text-sm text-destructive">{error}</div>
      )}

      {/* Timeline */}
      {versions.length === 0 ? (
        <div className="p-6 text-center text-muted-foreground text-sm">
          {t('decks:detail.noVersions', { defaultValue: 'No versions recorded yet.' })}
        </div>
      ) : (
        <div className="divide-y divide-border">
          {versions.map((version) => (
            <div key={version.id} className="px-4 py-3 flex items-start gap-3">
              <div className="shrink-0 mt-0.5">
                <div className="w-7 h-7 rounded-full bg-brand/15 text-brand flex items-center justify-center text-xs font-bold">
                  v{version.version_number}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-medium text-foreground">
                    {t('decks:detail.versionLabel', {
                      defaultValue: 'Version {{num}}',
                      num: version.version_number,
                    })}
                  </span>
                  <span className="text-xs text-content-tertiary px-2 py-0.5 bg-accent rounded-full">
                    {version.card_count} {t('decks:detail.versionCards', { defaultValue: 'cards' })}
                  </span>
                </div>
                {version.change_summary && (
                  <p className="text-sm text-muted-foreground truncate">{version.change_summary}</p>
                )}
                <p className="text-xs text-content-tertiary mt-0.5">{formatDate(version.created_at)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

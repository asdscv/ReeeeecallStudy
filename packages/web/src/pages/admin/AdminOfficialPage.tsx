import { useEffect, useState, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { useOfficialStore } from '@reeeeecall/shared/stores/official-store'
import { OfficialBadge } from '../../components/common/OfficialBadge'
import { AdminErrorState } from '../../components/admin/AdminErrorState'
import { AdminStatCard } from '../../components/admin/AdminStatCard'
import type { BadgeType, OfficialAccount } from '../../types/database'

const BADGE_TYPES: { value: BadgeType; labelKey: string }[] = [
  { value: 'verified', labelKey: 'official.badges.verified' },
  { value: 'official', labelKey: 'official.badges.official' },
  { value: 'educator', labelKey: 'official.badges.educator' },
  { value: 'publisher', labelKey: 'official.badges.publisher' },
  { value: 'partner', labelKey: 'official.badges.partner' },
]

type UserSearchResult = {
  id: string
  display_name: string | null
  is_official: boolean
}

/* ─── User Search with Autocomplete ─────────────────────────── */

function UserSearchInput({
  onSelect,
  disabled,
}: {
  onSelect: (user: UserSearchResult) => void
  disabled?: boolean
}) {
  const { t } = useTranslation('admin')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<UserSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [open, setOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const containerRef = useRef<HTMLDivElement>(null)

  const search = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([])
      return
    }
    setSearching(true)
    try {
      const { data } = await supabase
        .from('profiles')
        .select('id, display_name, is_official')
        .or(`display_name.ilike.%${q}%,id.eq.${isUUID(q) ? q : '00000000-0000-0000-0000-000000000000'}`)
        .order('display_name')
        .limit(10)
      setResults((data ?? []) as UserSearchResult[])
      setOpen(true)
    } catch {
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [])

  const handleChange = (value: string) => {
    setQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(value), 300)
  }

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        disabled={disabled}
        placeholder={t('official.searchUserPlaceholder', 'Search by name or UUID...')}
        className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none w-full"
        data-testid="official-user-search"
      />
      {searching && (
        <div className="absolute right-3 top-2.5">
          <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {open && results.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {results.map((user) => (
            <button
              key={user.id}
              type="button"
              onClick={() => {
                onSelect(user)
                setQuery(user.display_name || user.id)
                setOpen(false)
              }}
              className="w-full px-3 py-2 text-left hover:bg-blue-50 flex items-center justify-between gap-2 cursor-pointer"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {user.display_name || t('users.noName', '(no name)')}
                </p>
                <p className="text-xs text-gray-400 font-mono truncate">{user.id}</p>
              </div>
              {user.is_official && (
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full shrink-0">
                  {t('official.alreadyOfficial', 'Already Official')}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {open && query.length >= 2 && results.length === 0 && !searching && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm text-gray-400 text-center">
          {t('official.noUsersFound', 'No users found')}
        </div>
      )}
    </div>
  )
}

function isUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)
}

/* ─── Main Page ─────────────────────────────────────────────── */

export function AdminOfficialPage() {
  const { t } = useTranslation('admin')
  const {
    officialAccounts,
    loading,
    error,
    fetchOfficialAccounts,
    setOfficialStatus,
    updateOfficialSettings,
  } = useOfficialStore()

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBadgeType, setEditBadgeType] = useState<BadgeType>('verified')
  const [editOrgName, setEditOrgName] = useState('')
  const [editOrgUrl, setEditOrgUrl] = useState('')
  const [editPriority, setEditPriority] = useState(0)
  const [editMaxListings, setEditMaxListings] = useState(100)
  const [editCanFeature, setEditCanFeature] = useState(false)
  const [saving, setSaving] = useState(false)

  // Add new official account
  const [showAddForm, setShowAddForm] = useState(false)
  const [selectedUser, setSelectedUser] = useState<UserSearchResult | null>(null)
  const [addBadgeType, setAddBadgeType] = useState<BadgeType>('verified')
  const [addOrgName, setAddOrgName] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    fetchOfficialAccounts()
  }, [fetchOfficialAccounts])

  const startEdit = (account: OfficialAccount) => {
    setEditingId(account.user_id)
    setEditBadgeType(account.display_badge || 'verified')
    setEditOrgName(account.organization_name || '')
    setEditOrgUrl(account.organization_url || '')
    setEditPriority(account.featured_priority || 0)
    setEditMaxListings(account.max_listings || 100)
    setEditCanFeature(account.can_feature_listings || false)
  }

  const handleSaveEdit = async () => {
    if (!editingId) return
    setSaving(true)
    const result = await updateOfficialSettings(editingId, {
      badgeType: editBadgeType,
      organizationName: editOrgName || undefined,
      organizationUrl: editOrgUrl || undefined,
      featuredPriority: editPriority,
      maxListings: editMaxListings,
      canFeatureListings: editCanFeature,
    })
    setSaving(false)
    if (!result.error) {
      setEditingId(null)
    }
  }

  const handleRevoke = async (userId: string, displayName: string | null) => {
    if (!confirm(t('official.confirmRevoke', { name: displayName || userId }))) return
    await setOfficialStatus(userId, false)
  }

  const handleAddOfficial = async () => {
    setAddError(null)
    if (!selectedUser) {
      setAddError(t('official.selectUserFirst', 'Please select a user first'))
      return
    }
    if (selectedUser.is_official) {
      setAddError(t('official.alreadyOfficial', 'This user is already an official account'))
      return
    }
    setAdding(true)
    const result = await setOfficialStatus(
      selectedUser.id,
      true,
      addBadgeType,
      addOrgName.trim() || undefined,
    )
    setAdding(false)
    if (result.error) {
      setAddError(result.error)
    } else {
      setShowAddForm(false)
      setSelectedUser(null)
      setAddOrgName('')
      setAddBadgeType('verified')
    }
  }

  if (error && officialAccounts.length === 0) {
    return <AdminErrorState error={error} onRetry={fetchOfficialAccounts} />
  }

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <AdminStatCard
          icon="✓"
          label={t('official.totalAccounts', 'Official Accounts')}
          value={officialAccounts.length}
          color="blue"
        />
        <AdminStatCard
          icon="📦"
          label={t('official.totalListings', 'Total Listings')}
          value={officialAccounts.reduce((sum, a) => sum + (a.listing_count || 0), 0)}
          color="green"
        />
        <AdminStatCard
          icon="⭐"
          label={t('official.featured', 'Featured')}
          value={officialAccounts.filter((a) => a.featured_priority > 0).length}
          color="purple"
        />
        <AdminStatCard
          icon="🏢"
          label={t('official.organizations', 'Organizations')}
          value={officialAccounts.filter((a) => a.organization_name).length}
          color="orange"
        />
      </div>

      {/* Add Official Account */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-700">{t('official.title', 'Official Accounts')}</h3>
          <button
            type="button"
            onClick={() => {
              setShowAddForm(!showAddForm)
              setAddError(null)
              setSelectedUser(null)
            }}
            className="text-xs text-blue-600 hover:text-blue-800 cursor-pointer font-medium"
            data-testid="add-official-toggle"
          >
            {showAddForm ? t('official.cancel', 'Cancel') : t('official.addAccount', '+ Add Official Account')}
          </button>
        </div>

        {showAddForm && (
          <div className="px-4 py-4 border-b border-gray-100 bg-gray-50">
            <div className="space-y-4">
              {/* User Search */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  {t('official.selectUser', 'Select User')}
                </label>
                <UserSearchInput
                  onSelect={setSelectedUser}
                  disabled={adding}
                />
                {selectedUser && (
                  <div className="mt-2 flex items-center gap-2 p-2 bg-blue-50 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-blue-900">
                        {selectedUser.display_name || t('users.noName', '(no name)')}
                      </p>
                      <p className="text-xs text-blue-600 font-mono truncate">{selectedUser.id}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedUser(null)}
                      className="text-xs text-blue-500 hover:text-blue-700 cursor-pointer px-2"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>

              {/* Badge & Org */}
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">
                    {t('official.badgeType', 'Badge Type')}
                  </label>
                  <select
                    value={addBadgeType}
                    onChange={(e) => setAddBadgeType(e.target.value as BadgeType)}
                    disabled={adding}
                    className="px-3 py-2 text-sm border border-gray-300 rounded-lg cursor-pointer"
                    data-testid="add-official-badge-type"
                  >
                    {BADGE_TYPES.map((bt) => (
                      <option key={bt.value} value={bt.value}>
                        {t(bt.labelKey, bt.value)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex-1 min-w-[200px]">
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">
                    {t('official.orgName', 'Organization (optional)')}
                  </label>
                  <input
                    type="text"
                    value={addOrgName}
                    onChange={(e) => setAddOrgName(e.target.value)}
                    disabled={adding}
                    placeholder={t('official.orgNamePlaceholder', 'Organization name')}
                    className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none w-full"
                    data-testid="add-official-org-name"
                  />
                </div>
              </div>

              {/* Submit */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleAddOfficial}
                  disabled={adding || !selectedUser}
                  className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 cursor-pointer disabled:opacity-50 disabled:cursor-default"
                  data-testid="add-official-submit"
                >
                  {adding ? t('loading', 'Loading...') : t('official.addSubmit', 'Add Official')}
                </button>
                {addError && (
                  <p className="text-sm text-red-600">{addError}</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div className="space-y-3 p-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-12 bg-gray-100 rounded animate-pulse" />
            ))}
          </div>
        ) : officialAccounts.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-gray-400 text-sm">{t('official.noAccounts', 'No official accounts yet')}</p>
            <p className="text-gray-300 text-xs mt-1">{t('official.noAccountsHint', 'Click "+ Add Official Account" to get started')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500">{t('official.colAccount', 'Account')}</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500">{t('official.colBadge', 'Badge')}</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500">{t('official.colOrg', 'Organization')}</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500">{t('official.colListings', 'Listings')}</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500">{t('official.colPriority', 'Priority')}</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500">{t('official.colActions', 'Actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {officialAccounts.map((account) => (
                  <tr key={account.user_id} className="hover:bg-gray-50" data-testid={`official-row-${account.user_id}`}>
                    <td className="px-4 py-2 text-gray-900">
                      <div className="flex items-center gap-1.5">
                        {account.display_name || t('users.noName', '(no name)')}
                      </div>
                      <div className="text-xs text-gray-400 font-mono truncate max-w-[180px]">{account.user_id}</div>
                    </td>
                    <td className="px-4 py-2">
                      {editingId === account.user_id ? (
                        <select
                          value={editBadgeType}
                          onChange={(e) => setEditBadgeType(e.target.value as BadgeType)}
                          className="px-2 py-1 text-xs border border-gray-300 rounded cursor-pointer"
                        >
                          {BADGE_TYPES.map((bt) => (
                            <option key={bt.value} value={bt.value}>{t(bt.labelKey, bt.value)}</option>
                          ))}
                        </select>
                      ) : (
                        <OfficialBadge badgeType={account.display_badge} size="sm" />
                      )}
                    </td>
                    <td className="px-4 py-2 text-gray-600 text-xs">
                      {editingId === account.user_id ? (
                        <div className="space-y-1">
                          <input
                            type="text"
                            value={editOrgName}
                            onChange={(e) => setEditOrgName(e.target.value)}
                            placeholder={t('official.orgNamePlaceholder', 'Org name')}
                            className="px-2 py-1 text-xs border border-gray-300 rounded w-full"
                          />
                          <input
                            type="url"
                            value={editOrgUrl}
                            onChange={(e) => setEditOrgUrl(e.target.value)}
                            placeholder="https://..."
                            className="px-2 py-1 text-xs border border-gray-300 rounded w-full"
                          />
                        </div>
                      ) : (
                        <>
                          {account.organization_name || '-'}
                          {account.organization_url && (
                            <div className="text-gray-400 truncate max-w-[150px]">{account.organization_url}</div>
                          )}
                        </>
                      )}
                    </td>
                    <td className="px-4 py-2 text-gray-600">
                      {account.listing_count || 0}
                      {editingId === account.user_id && (
                        <div className="mt-1">
                          <label className="text-xs text-gray-400">{t('official.maxListings', 'Max')}:</label>
                          <input
                            type="number"
                            value={editMaxListings}
                            onChange={(e) => setEditMaxListings(Number(e.target.value))}
                            className="px-2 py-1 text-xs border border-gray-300 rounded w-16 ml-1"
                          />
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-gray-600">
                      {editingId === account.user_id ? (
                        <div className="space-y-1">
                          <input
                            type="number"
                            value={editPriority}
                            onChange={(e) => setEditPriority(Number(e.target.value))}
                            className="px-2 py-1 text-xs border border-gray-300 rounded w-16"
                          />
                          <label className="flex items-center gap-1 text-xs text-gray-500">
                            <input
                              type="checkbox"
                              checked={editCanFeature}
                              onChange={(e) => setEditCanFeature(e.target.checked)}
                            />
                            {t('official.canFeature', 'Can feature')}
                          </label>
                        </div>
                      ) : (
                        <span className={account.featured_priority > 0 ? 'text-blue-600 font-medium' : 'text-gray-400'}>
                          {account.featured_priority || '-'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {editingId === account.user_id ? (
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={handleSaveEdit}
                            disabled={saving}
                            className="px-2 py-1 text-xs bg-blue-600 text-white rounded cursor-pointer hover:bg-blue-700 disabled:opacity-50"
                            data-testid={`official-save-${account.user_id}`}
                          >
                            {saving ? '...' : t('official.save', 'Save')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 cursor-pointer"
                          >
                            {t('official.cancel', 'Cancel')}
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => startEdit(account)}
                            className="px-2 py-1 text-xs text-blue-600 hover:text-blue-800 cursor-pointer"
                            data-testid={`official-edit-${account.user_id}`}
                          >
                            {t('official.edit', 'Edit')}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRevoke(account.user_id, account.display_name)}
                            className="px-2 py-1 text-xs text-red-600 hover:text-red-800 cursor-pointer"
                            data-testid={`official-revoke-${account.user_id}`}
                          >
                            {t('official.revoke', 'Revoke')}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

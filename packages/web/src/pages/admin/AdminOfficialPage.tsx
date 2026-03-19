import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useOfficialStore } from '@reeeeecall/shared/stores/official-store'
import { OfficialBadge } from '../../components/common/OfficialBadge'
import { AdminErrorState } from '../../components/admin/AdminErrorState'
import { AdminStatCard } from '../../components/admin/AdminStatCard'
import type { BadgeType, OfficialAccount } from '../../types/database'

const BADGE_TYPES: { value: BadgeType; label: string }[] = [
  { value: 'verified', label: 'Verified' },
  { value: 'official', label: 'Official' },
  { value: 'educator', label: 'Educator' },
  { value: 'publisher', label: 'Publisher' },
  { value: 'partner', label: 'Partner' },
]

export function AdminOfficialPage() {
  const { t: _t } = useTranslation('admin')
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

  // Add new official account form
  const [showAddForm, setShowAddForm] = useState(false)
  const [addUserId, setAddUserId] = useState('')
  const [addBadgeType, setAddBadgeType] = useState<BadgeType>('verified')
  const [addOrgName, setAddOrgName] = useState('')
  const [addError, setAddError] = useState<string | null>(null)

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

  const handleRevoke = async (userId: string) => {
    if (!confirm('Revoke official status for this account?')) return
    await setOfficialStatus(userId, false)
  }

  const handleAddOfficial = async () => {
    setAddError(null)
    if (!addUserId.trim()) {
      setAddError('User ID is required')
      return
    }
    const result = await setOfficialStatus(addUserId.trim(), true, addBadgeType, addOrgName.trim() || undefined)
    if (result.error) {
      setAddError(result.error)
    } else {
      setShowAddForm(false)
      setAddUserId('')
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
          icon={'\u2713'}
          label="Official Accounts"
          value={officialAccounts.length}
          color="blue"
        />
        <AdminStatCard
          icon={'\uD83D\uDCE6'}
          label="Total Listings"
          value={officialAccounts.reduce((sum, a) => sum + (a.listing_count || 0), 0)}
          color="green"
        />
        <AdminStatCard
          icon={'\u2B50'}
          label="Featured"
          value={officialAccounts.filter((a) => a.featured_priority > 0).length}
          color="purple"
        />
        <AdminStatCard
          icon={'\uD83C\uDFE2'}
          label="Organizations"
          value={officialAccounts.filter((a) => a.organization_name).length}
          color="orange"
        />
      </div>

      {/* Add Official Account */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-700">Official Accounts</h3>
          <button
            type="button"
            onClick={() => setShowAddForm(!showAddForm)}
            className="text-xs text-blue-600 hover:text-blue-800 cursor-pointer font-medium"
            data-testid="add-official-toggle"
          >
            {showAddForm ? 'Cancel' : '+ Add Official Account'}
          </button>
        </div>

        {showAddForm && (
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">User ID</label>
                <input
                  type="text"
                  value={addUserId}
                  onChange={(e) => setAddUserId(e.target.value)}
                  placeholder="UUID of the user"
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none w-64"
                  data-testid="add-official-user-id"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Badge Type</label>
                <select
                  value={addBadgeType}
                  onChange={(e) => setAddBadgeType(e.target.value as BadgeType)}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg cursor-pointer"
                  data-testid="add-official-badge-type"
                >
                  {BADGE_TYPES.map((bt) => (
                    <option key={bt.value} value={bt.value}>{bt.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Organization (optional)</label>
                <input
                  type="text"
                  value={addOrgName}
                  onChange={(e) => setAddOrgName(e.target.value)}
                  placeholder="Org name"
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none w-48"
                  data-testid="add-official-org-name"
                />
              </div>
              <button
                type="button"
                onClick={handleAddOfficial}
                className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 cursor-pointer"
                data-testid="add-official-submit"
              >
                Add
              </button>
            </div>
            {addError && (
              <p className="text-sm text-red-600 mt-2">{addError}</p>
            )}
          </div>
        )}

        {/* Table */}
        {loading ? (
          <p className="text-sm text-gray-400 py-8 text-center">Loading...</p>
        ) : officialAccounts.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">No official accounts yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500">Account</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500">Badge</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500">Organization</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500">Listings</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500">Priority</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {officialAccounts.map((account) => (
                  <tr key={account.user_id} className="hover:bg-gray-50" data-testid={`official-row-${account.user_id}`}>
                    <td className="px-4 py-2 text-gray-900">
                      <div className="flex items-center gap-1.5">
                        {account.display_name || 'No name'}
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
                            <option key={bt.value} value={bt.value}>{bt.label}</option>
                          ))}
                        </select>
                      ) : (
                        <OfficialBadge
                          badgeType={account.display_badge}
                          size="sm"
                        />
                      )}
                    </td>
                    <td className="px-4 py-2 text-gray-600 text-xs">
                      {editingId === account.user_id ? (
                        <div className="space-y-1">
                          <input
                            type="text"
                            value={editOrgName}
                            onChange={(e) => setEditOrgName(e.target.value)}
                            placeholder="Org name"
                            className="px-2 py-1 text-xs border border-gray-300 rounded w-full"
                          />
                          <input
                            type="text"
                            value={editOrgUrl}
                            onChange={(e) => setEditOrgUrl(e.target.value)}
                            placeholder="URL"
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
                          <label className="text-xs text-gray-400">Max:</label>
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
                            Can feature
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
                            {saving ? '...' : 'Save'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 cursor-pointer"
                          >
                            Cancel
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
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRevoke(account.user_id)}
                            className="px-2 py-1 text-xs text-red-600 hover:text-red-800 cursor-pointer"
                            data-testid={`official-revoke-${account.user_id}`}
                          >
                            Revoke
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

import { useTranslation } from 'react-i18next'
import { useConfirmStore } from '../../stores/confirm-store'
import { ConfirmDialog } from './ConfirmDialog'

/**
 * Singleton dialog that backs the imperative `confirm()` helper.
 * Mount once at the app root.
 */
export function GlobalConfirmDialog() {
  const { t } = useTranslation('common')
  const { open, options, handleConfirm, handleCancel } = useConfirmStore()
  return (
    <ConfirmDialog
      open={open}
      onClose={handleCancel}
      onConfirm={handleConfirm}
      title={options?.title ?? t('confirmDialog.confirm')}
      message={options?.message ?? ''}
      confirmLabel={options?.confirmLabel}
      danger={options?.danger}
    />
  )
}

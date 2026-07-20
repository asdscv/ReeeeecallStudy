import { useEffect, useState } from 'react'
import { View, Text, Modal, StyleSheet, TouchableOpacity, ScrollView, Pressable } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../theme'
import { useDeckStore } from '@reeeeecall/shared/stores/deck-store'
import { getMySubscription, type MySubscription } from '../../services/billing'
import { CardUsagePanel } from './CardUsagePanel'
import { PlanSelector } from './PlanSelector'

/**
 * Full card-storage detail in a bottom-sheet modal — the mobile mirror of web
 * CardUsageModal. Opened from the Dashboard usage card. Force-refreshes the detailed
 * breakdown on open and includes the upgrade PlanSelector (gated by the IAP flag).
 */
export function CardUsageModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme()
  const { t } = useTranslation('settings')
  const c = theme.colors
  const detail = useDeckStore((s) => s.cardUsageDetail)
  const fetchDetail = useDeckStore((s) => s.fetchCardUsageDetail)
  const [subscription, setSubscription] = useState<MySubscription | null>(null)

  useEffect(() => {
    if (visible) {
      void fetchDetail({ force: true })
      getMySubscription().then(setSubscription)
    }
  }, [visible, fetchDetail])

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, { backgroundColor: c.overlay }]} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: c.surfaceElevated }]} onPress={(e) => e.stopPropagation()}>
          <View style={[styles.handle, { backgroundColor: c.border }]} />
          <View style={styles.header}>
            <Text style={[theme.typography.bodyLarge, { color: c.text, fontWeight: '700' }]}>
              {t('cardUsage.detail.title')}
            </Text>
            <TouchableOpacity onPress={onClose} testID="card-usage-modal-close" hitSlop={12}>
              <Text style={{ color: c.textSecondary, fontSize: 20 }}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ paddingBottom: 24 }}>
            {detail ? (
              <CardUsagePanel detail={detail} />
            ) : (
              <View style={[styles.skeleton, { backgroundColor: c.surface }]} />
            )}
            <View style={[styles.divider, { borderTopColor: c.border }]}>
              <PlanSelector subscription={subscription} />
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 8 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 999, marginBottom: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  skeleton: { height: 96, borderRadius: 12 },
  divider: { marginTop: 20, borderTopWidth: 1, paddingTop: 16 },
})

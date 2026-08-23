import { useEffect, useState } from 'react'
import { View, Text, Modal, StyleSheet, TouchableOpacity, ScrollView, Pressable } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useNavigation } from '@react-navigation/native'
import { useTheme } from '../../theme'
import { useDeckStore } from '@reeeeecall/shared/stores/deck-store'
import { getMySubscription, type MySubscription } from '../../services/billing'
import { CardUsagePanel } from './CardUsagePanel'
import { PlanSelector } from './PlanSelector'

/**
 * Full card-storage detail in a bottom-sheet modal — the mobile mirror of web
 * CardUsageModal. Opened from the Dashboard usage card. Force-refreshes the detailed
 * breakdown on open and includes the upgrade PlanSelector (gated by the IAP flag).
 *
 * 이 모달은 대시보드에서 열린다 — 앱을 켜면 처음 닿는 화면이다. 그래서 여기 뜨는
 * 가격표의 "선택" 버튼은 실제로 결제 화면까지 가야 한다. 예전에는 PlanSelector 에
 * onSelect 를 넘기지 않아 활성 상태로 그려진 버튼이 아무 일도 하지 않았다.
 * Paywall 은 SettingsStack 에 있으므로 드로어를 거쳐 건너간다.
 */
export function CardUsageModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme()
  const { t } = useTranslation('settings')
  const c = theme.colors
  const navigation = useNavigation<any>()
  const detail = useDeckStore((s) => s.cardUsageDetail)
  const fetchDetail = useDeckStore((s) => s.fetchCardUsageDetail)
  const [subscription, setSubscription] = useState<MySubscription | null>(null)

  useEffect(() => {
    if (visible) {
      void fetchDetail({ force: true })
      getMySubscription().then(setSubscription)
    }
  }, [visible, fetchDetail])

  // 모달을 먼저 닫는다 — RN Modal 은 무엇 위에나 뜨므로, 닫지 않고 이동하면 결제
  // 화면이 이 시트에 가린다. getParent() 가 없는 경우(다른 곳에서 재사용될 때)에도
  // 버튼이 죽지 않도록 현재 네비게이터로 떨어뜨린다 — navigate 는 위로 전파된다.
  const goToPaywall = () => {
    onClose()
    const nav = navigation.getParent() ?? navigation
    nav.navigate('SettingsTab', { screen: 'Paywall' })
  }

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
              <PlanSelector subscription={subscription} onSelect={goToPaywall} />
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

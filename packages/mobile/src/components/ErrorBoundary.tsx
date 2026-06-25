import { Component, type ReactNode } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../theme'
import { Button } from './ui'

/**
 * ErrorBoundary — catches render-time crashes and shows a recoverable fallback
 * instead of a blank/native red screen. Wrap the navigation root (and optionally
 * heavy screens) so one screen's error doesn't take down the whole app.
 */
interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: unknown) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.error('[ErrorBoundary]', error)
    }
  }

  reset = () => this.setState({ hasError: false })

  render() {
    if (this.state.hasError) {
      return <ErrorFallback onRetry={this.reset} />
    }
    return this.props.children
  }
}

function ErrorFallback({ onRetry }: { onRetry: () => void }) {
  const theme = useTheme()
  const { t } = useTranslation('common')
  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Text style={styles.icon}>😵</Text>
      <Text style={[theme.typography.h3, { color: theme.colors.text, textAlign: 'center' }]}>
        {t('errorBoundary.title', { defaultValue: 'Something went wrong' })}
      </Text>
      <Text
        style={[
          theme.typography.body,
          { color: theme.colors.textSecondary, textAlign: 'center', marginTop: 8, marginBottom: 20 },
        ]}
      >
        {t('errorBoundary.message', { defaultValue: 'The screen ran into an unexpected error. Please try again.' })}
      </Text>
      <Button
        title={t('errorBoundary.retry', { defaultValue: 'Try again' })}
        onPress={onRetry}
        fullWidth={false}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  icon: { fontSize: 48, marginBottom: 12 },
})

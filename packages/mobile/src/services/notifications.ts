import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

/**
 * Notification service — manages push/local notifications.
 * Enterprise pattern: single service for all notification logic.
 */
class NotificationService {
  private initialized = false

  /**
   * Initialize notification handlers + default channel.
   */
  async init(): Promise<void> {
    if (this.initialized) return

    // Set default handler (show notification even when app is foreground)
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    })

    // Android notification channel
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('study-reminders', {
        name: 'Study Reminders',
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 250, 250, 250],
      })
    }

    this.initialized = true
  }

  /**
   * Request notification permissions.
   */
  async requestPermission(): Promise<boolean> {
    const { status: existing } = await Notifications.getPermissionsAsync()
    if (existing === 'granted') return true

    const { status } = await Notifications.requestPermissionsAsync()
    return status === 'granted'
  }

  /**
   * Check if notifications are enabled.
   */
  async isEnabled(): Promise<boolean> {
    const { status } = await Notifications.getPermissionsAsync()
    return status === 'granted'
  }

  /**
   * Schedule daily study reminder.
   */
  async scheduleDailyReminder(hour: number = 9, minute: number = 0): Promise<string> {
    // Cancel existing reminders first
    await this.cancelDailyReminder()

    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Time to study! 📚',
        body: 'Your cards are waiting. Keep your streak going!',
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour,
        minute,
      },
    })

    return id
  }

  /**
   * Cancel daily reminder.
   */
  async cancelDailyReminder(): Promise<void> {
    await Notifications.cancelAllScheduledNotificationsAsync()
  }

  /**
   * Get all scheduled notifications.
   */
  async getScheduled(): Promise<Notifications.NotificationRequest[]> {
    return Notifications.getAllScheduledNotificationsAsync()
  }

  /**
   * Send immediate local notification (e.g., study complete).
   */
  async sendLocal(title: string, body: string): Promise<void> {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: true },
      trigger: null, // immediate
    })
  }
}

export const notificationService = new NotificationService()

// Study reminder sender — called by cron handler
// Sends daily / streak_risk / comeback reminders based on user preferences

import { getSupabaseConfig } from './config.js'
import { info, error } from './logger.js'

const MESSAGES = {
  en: {
    daily: (name) => `Hi ${name || 'there'}! Time to study! Keep your learning habit strong.`,
    streak_risk: (name, streak) => `${name || 'Hey'}, don't break your ${streak}-day streak! Study now to keep it going.`,
    comeback: (name) => `We miss you, ${name || 'friend'}! Your flashcards are waiting. Come back and study today.`,
    subject_daily: 'Time to study!',
    subject_streak_risk: 'Your streak is at risk!',
    subject_comeback: 'We miss you!',
  },
  ko: {
    daily: (name) => `${name || ''}님, 오늘도 학습할 시간이에요! 꾸준한 학습 습관을 유지하세요.`,
    streak_risk: (name, streak) => `${name || ''}님, ${streak}일 연속 학습이 끊기기 직전이에요! 지금 학습해서 기록을 이어가세요.`,
    comeback: (name) => `${name || ''}님, 플래시카드가 기다리고 있어요. 오늘 다시 학습을 시작해보세요!`,
    subject_daily: '학습할 시간이에요!',
    subject_streak_risk: '연속 학습이 위험해요!',
    subject_comeback: '다시 돌아와 주세요!',
  },
}

function getMessages(locale) {
  return MESSAGES[locale] || MESSAGES.en
}

/**
 * Send email reminder (placeholder — swap with SendGrid/Resend when API key is configured)
 */
async function sendEmail(to, subject, body, env) {
  // TODO: Replace with real email service (SendGrid / Resend)
  // Example with Resend:
  //   await fetch('https://api.resend.com/emails', {
  //     method: 'POST',
  //     headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
  //     body: JSON.stringify({ from: 'ReeeeecallStudy <noreply@reeeeecallstudy.xyz>', to, subject, text: body }),
  //   })
  console.log(`[REMINDER] To: ${to} | Subject: ${subject} | Body: ${body}`)
  return true
}

/**
 * Log a sent reminder to prevent duplicate sends within the same day
 */
async function logReminder(restUrl, serviceKey, userId, reminderType) {
  const res = await fetch(`${restUrl}/reminder_logs`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      user_id: userId,
      reminder_type: reminderType,
      channel: 'email',
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    error('Failed to log reminder', { userId, status: res.status, body })
  }
}

/**
 * Main entry point — fetch targets from DB and send reminders.
 * @param {object} env  Cloudflare Worker env bindings
 * @returns {{ sent: number }}
 */
export async function sendReminders(env) {
  const config = getSupabaseConfig(env)
  const restUrl = `${config.url}/rest/v1`

  // Call the RPC to get reminder targets
  const rpcUrl = `${config.url}/rest/v1/rpc/get_reminder_targets`
  const rpcRes = await fetch(rpcUrl, {
    method: 'POST',
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  })

  if (!rpcRes.ok) {
    const body = await rpcRes.text()
    error('Failed to call get_reminder_targets', { status: rpcRes.status, body })
    return { sent: 0 }
  }

  const targets = await rpcRes.json()

  if (!Array.isArray(targets) || targets.length === 0) {
    info('No reminder targets found')
    return { sent: 0 }
  }

  info('Reminder targets found', { count: targets.length })

  let sent = 0

  for (const target of targets) {
    try {
      const msgs = getMessages(target.locale)
      const type = target.reminder_type
      const subject = msgs[`subject_${type}`] || msgs.subject_daily
      const body = type === 'streak_risk'
        ? msgs.streak_risk(target.display_name, target.streak)
        : type === 'comeback'
          ? msgs.comeback(target.display_name)
          : msgs.daily(target.display_name)

      const ok = await sendEmail(target.email, subject, body, env)
      if (ok) {
        await logReminder(restUrl, config.serviceKey, target.user_id, type)
        sent++
      }
    } catch (err) {
      error('Failed to send reminder', { userId: target.user_id, error: err.message })
    }
  }

  info('Reminders sent', { sent, total: targets.length })
  return { sent }
}

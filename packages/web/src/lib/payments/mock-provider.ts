import { supabase } from '../supabase'
import type { PaymentProvider, PaymentIntent, CheckoutResult } from './provider'

// ⚠️ DEV / TEST ONLY — never select this provider in production.
//
// Simulates a successful checkout by calling admin_confirm_payment(merchant_uid),
// which drives the EXACT same server grant loop the real webhook would:
//   admin_confirm_payment → confirm_payment(merchant_uid, 'admin', …)
//     → add_ai_credits (credit_pack) / grant_subscription (subscription).
// It works ONLY for admins: admin_confirm_payment is is_admin()-guarded, so a
// normal user gets a 42501 and this returns { ok: false }. That is intentional —
// it lets an admin/dev exercise the full paid flow without a real PG, and cannot
// grant anything to a non-admin account.
export class MockProvider implements PaymentProvider {
  readonly id = 'mock'

  async checkout(intent: PaymentIntent): Promise<CheckoutResult> {
    const { error } = await supabase.rpc('admin_confirm_payment', {
      p_merchant_uid: intent.merchantUid,
    })
    if (error) return { ok: false }
    return { ok: true, providerPaymentId: `admin:${intent.merchantUid}` }
  }
}

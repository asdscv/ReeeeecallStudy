// TossPayments server-side API helpers (shared by toss-confirm / toss-billing /
// toss-renew / toss-webhook).
//
// AUTH: every Toss server call is HTTP Basic with the SECRET key as the username and
// an EMPTY password — i.e. base64(secretKey + ":") with a trailing colon. The secret
// key (test_sk_* / live_sk_*) lives ONLY in an edge secret, never in the browser.
// Currency is KRW; amounts are integers (whole won).

const TOSS_API = 'https://api.tosspayments.com'

export function tossAuthHeader(secretKey: string): string {
  // btoa is fine — secret keys are ASCII.
  return 'Basic ' + btoa(secretKey + ':')
}

export interface TossResult {
  ok: boolean
  status: number
  body: Record<string, unknown> | null
}

async function tossPost(
  secretKey: string,
  path: string,
  body: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<TossResult> {
  const headers: Record<string, string> = {
    Authorization: tossAuthHeader(secretKey),
    'Content-Type': 'application/json',
  }
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
  const resp = await fetch(`${TOSS_API}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const json = (await resp.json().catch(() => null)) as Record<string, unknown> | null
  return { ok: resp.ok, status: resp.status, body: json }
}

// One-time payment confirm (승인). Finalizes a payment the buyer authorized in the
// widget. amount MUST equal what was requested (server re-asserts against the intent).
export function tossConfirmPayment(
  secretKey: string,
  paymentKey: string,
  orderId: string,
  amount: number,
  idempotencyKey?: string,
): Promise<TossResult> {
  return tossPost(secretKey, '/v1/payments/confirm', { paymentKey, orderId, amount }, idempotencyKey)
}

// Recurring STEP 2: exchange the one-time authKey (from the billing-auth redirect) for
// a permanent billingKey. Store the billingKey server-side — it can NEVER be re-queried.
export function tossIssueBillingKey(
  secretKey: string,
  authKey: string,
  customerKey: string,
): Promise<TossResult> {
  return tossPost(secretKey, '/v1/billing/authorizations/issue', { authKey, customerKey })
}

// Recurring STEP 3: charge a stored billingKey (first period + every renewal). orderId
// must be unique per charge; the Idempotency-Key makes a retry of the SAME period safe.
export function tossChargeBilling(
  secretKey: string,
  billingKey: string,
  args: { customerKey: string; amount: number; orderId: string; orderName: string; customerEmail?: string | null },
  idempotencyKey?: string,
): Promise<TossResult> {
  const body: Record<string, unknown> = {
    customerKey: args.customerKey,
    amount: args.amount,
    orderId: args.orderId,
    orderName: args.orderName,
  }
  if (args.customerEmail) body.customerEmail = args.customerEmail
  return tossPost(secretKey, `/v1/billing/${billingKey}`, body, idempotencyKey)
}

// Re-fetch a payment (webhook authenticity: legacy payment webhooks are UNSIGNED, so we
// trust only a server-side re-fetch of the payment, never the webhook body).
export async function tossGetPayment(secretKey: string, paymentKey: string): Promise<TossResult> {
  const resp = await fetch(`${TOSS_API}/v1/payments/${paymentKey}`, {
    headers: { Authorization: tossAuthHeader(secretKey) },
  })
  const json = (await resp.json().catch(() => null)) as Record<string, unknown> | null
  return { ok: resp.ok, status: resp.status, body: json }
}

// Cancel / refund a payment (full or partial).
export function tossCancelPayment(
  secretKey: string,
  paymentKey: string,
  cancelReason: string,
  idempotencyKey?: string,
): Promise<TossResult> {
  return tossPost(secretKey, `/v1/payments/${paymentKey}/cancel`, { cancelReason }, idempotencyKey)
}

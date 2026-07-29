// Writes a lightweight "loading" page into a pre-opened blank checkout tab.
//
// Redirect providers (LemonSqueezy) pre-open a blank tab INSIDE the click gesture (so
// the popup isn't blocked), then do async work — create_payment_intent + the
// `lemonsqueezy-checkout` edge fn that mints a live hosted checkout — before navigating
// the tab to the checkout URL (~1s). Without this the user stares at a stark white
// about:blank for that second. This paints a neutral spinner instead.
//
// Best-effort: the tab is a same-origin about:blank we just opened, so document.write is
// allowed; any failure (blocked/closed tab) is swallowed and the tab simply stays blank
// as before. The subsequent `tab.location.href = url` REPLACES this document.
const LOADING_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Loading checkout…</title>
<style>
  html,body{height:100%;margin:0}
  body{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:18px;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
    background:#ffffff;color:#6b7280}
  .spinner{width:34px;height:34px;border:3px solid #e5e7eb;border-top-color:#7c3aed;
    border-radius:50%;animation:spin .7s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  p{margin:0;font-size:14px}
  @media (prefers-color-scheme:dark){body{background:#0f172a;color:#94a3b8}
    .spinner{border-color:#334155;border-top-color:#a78bfa}}
</style></head>
<body><div class="spinner"></div><p>Loading secure checkout…</p></body></html>`

export function writeCheckoutLoadingTab(tab: Window | null | undefined): void {
  if (!tab || tab.closed) return
  try {
    tab.document.open()
    tab.document.write(LOADING_HTML)
    tab.document.close()
  } catch {
    /* cross-origin / closed tab → leave it blank (unchanged old behaviour) */
  }
}

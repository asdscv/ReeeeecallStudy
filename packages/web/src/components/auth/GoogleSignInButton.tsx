import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface GoogleIdentity {
  initialize(options: {
    client_id: string
    nonce: string
    ux_mode: 'popup'
    callback: (response: { credential: string }) => void
  }): void
  renderButton(element: HTMLElement, options: {
    theme: 'outline'
    size: 'large'
    text: 'continue_with'
    width: number
  }): void
}

function getGoogleIdentity() {
  return (window as Window & { google?: { accounts?: { id?: GoogleIdentity } } })
    .google?.accounts?.id
}

let loadPromise: Promise<GoogleIdentity> | undefined

function loadGoogleIdentity(): Promise<GoogleIdentity> {
  const identity = getGoogleIdentity()
  if (identity) return Promise.resolve(identity)

  loadPromise ??= new Promise<GoogleIdentity>((resolve, reject) => {
    const script = document.createElement('script')
    const fail = () => {
      window.clearTimeout(timeout)
      script.remove()
      reject(new Error('Google Identity Services could not load'))
    }
    const timeout = window.setTimeout(fail, 10_000)
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.onerror = fail
    script.onload = () => {
      const loaded = getGoogleIdentity()
      if (loaded) {
        window.clearTimeout(timeout)
        resolve(loaded)
      } else {
        fail()
      }
    }
    document.head.append(script)
  }).catch((error: unknown) => {
    loadPromise = undefined
    throw error
  })

  return loadPromise
}

export function GoogleSignInButton({ clientId, disabled, onCredential }: {
  clientId: string
  disabled: boolean
  onCredential: (token: string, nonce: string) => void
}) {
  const { t } = useTranslation('auth')
  const buttonRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const handleCredential = useEffectEvent((token: string, nonce: string) => {
    if (disabled || !token) return false
    onCredential(token, nonce)
    return true
  })

  useEffect(() => {
    const element = buttonRef.current
    if (!element) return
    let active = true
    let used = false

    async function renderButton(element: HTMLDivElement) {
      const nonce = crypto.randomUUID()
      // Google echoes the hash. Supabase hashes the original value when verifying it.
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(nonce))
      const hashedNonce = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
      const google = await loadGoogleIdentity()
      if (!active) return

      google.initialize({
        client_id: clientId,
        ux_mode: 'popup',
        nonce: hashedNonce,
        callback: ({ credential }) => {
          if (!active || used) return
          used = handleCredential(credential, nonce)
        },
      })
      google.renderButton(element, {
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        width: Math.min(element.clientWidth, 400),
      })
      setStatus('ready')
    }

    void renderButton(element).catch(() => {
      if (active) setStatus('error')
    })
    return () => {
      active = false
      element.replaceChildren()
    }
  }, [clientId])

  return (
    <div aria-busy={status === 'loading'}>
      <div
        ref={buttonRef}
        inert={disabled}
        className={status === 'error' ? 'hidden' : 'flex justify-center min-h-10 inert:opacity-50'}
        data-testid="google-login-button"
      />
      {status === 'error' && <p role="alert" className="text-sm text-destructive">{t('oauthError')}</p>}
    </div>
  )
}

import { useTranslation } from 'react-i18next'

// 앱 스토어 링크 — 단일 출처
export const APP_STORE_URL = 'https://apps.apple.com/kr/app/reeeeecallstudy/id6761741123'
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.reeeeecall.study'

function AppleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.05 12.54c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.48.83-.72 0-1.83-.81-3.01-.79-1.55.02-2.98.9-3.78 2.29-1.61 2.8-.41 6.94 1.16 9.21.77 1.11 1.69 2.36 2.89 2.31 1.16-.05 1.6-.75 3-.75s1.8.75 3.02.72c1.25-.02 2.04-1.13 2.8-2.25.88-1.29 1.25-2.54 1.27-2.6-.03-.01-2.43-.93-2.45-3.71zM14.76 5.6c.64-.78 1.07-1.85.95-2.93-.92.04-2.04.61-2.7 1.39-.59.69-1.11 1.8-.97 2.85 1.03.08 2.08-.52 2.72-1.31z" />
    </svg>
  )
}

function GooglePlayIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M3.6 2.3c-.2.2-.3.5-.3.9v17.6c0 .4.1.7.3.9l.1.1L13.5 12v-.1L3.7 2.2l-.1.1z" fill="#00D2FF" />
      <path d="M16.8 15.3 13.5 12v-.1l3.3-3.3.1.1 3.9 2.2c1.1.6 1.1 1.6 0 2.3l-3.9 2.1z" fill="#FFCE00" />
      <path d="M16.9 15.2 13.5 12 3.6 21.8c.4.4 1 .4 1.7 0l11.6-6.6z" fill="#FF3D00" />
      <path d="M16.9 8.8 5.3 2.2c-.7-.4-1.3-.4-1.7 0L13.5 12l3.4-3.2z" fill="#00F076" />
    </svg>
  )
}

function StoreBadge({ href, icon, line1, line2 }: { href: string; icon: React.ReactNode; line1: string; line2: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2.5 rounded-xl bg-foreground px-4 py-2.5 text-background no-underline transition hover:opacity-90"
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex flex-col leading-tight text-left">
        <span className="text-[10px] opacity-80">{line1}</span>
        <span className="text-sm font-semibold">{line2}</span>
      </span>
    </a>
  )
}

interface AppDownloadProps {
  /** 데스크톱에서 QR 코드 표시 (랜딩 페이지용) */
  showQr?: boolean
}

export function AppDownload({ showQr = false }: AppDownloadProps) {
  const { t } = useTranslation('common')

  const badges = (
    <div className="flex flex-wrap gap-3">
      <StoreBadge
        href={APP_STORE_URL}
        icon={<AppleIcon className="w-6 h-6" />}
        line1={t('appDownload.appStorePrefix', 'Download on the')}
        line2={t('appDownload.appStore', 'App Store')}
      />
      <StoreBadge
        href={PLAY_STORE_URL}
        icon={<GooglePlayIcon className="w-6 h-6" />}
        line1={t('appDownload.playStorePrefix', 'GET IT ON')}
        line2={t('appDownload.playStore', 'Google Play')}
      />
    </div>
  )

  if (!showQr) {
    return (
      <div>
        <h4 className="text-sm font-semibold text-foreground mb-3">
          {t('appDownload.heading', 'Get the app')}
        </h4>
        {badges}
      </div>
    )
  }

  return (
    <div>
      <h4 className="text-sm font-semibold text-foreground mb-3">
        {t('appDownload.heading', 'Get the app')}
      </h4>
      {/* 모바일: 배지만, 데스크톱: QR + 배지 */}
      <div className="md:hidden">{badges}</div>
      <div className="hidden md:flex items-start gap-6">
        <figure className="flex flex-col items-center gap-1.5 m-0">
          <img src="/images/app/qr-ios.svg" alt={t('appDownload.appStore', 'App Store')} className="w-24 h-24 rounded-lg bg-white p-1.5" />
          <figcaption className="text-xs text-muted-foreground">iOS</figcaption>
        </figure>
        <figure className="flex flex-col items-center gap-1.5 m-0">
          <img src="/images/app/qr-android.svg" alt={t('appDownload.playStore', 'Google Play')} className="w-24 h-24 rounded-lg bg-white p-1.5" />
          <figcaption className="text-xs text-muted-foreground">Android</figcaption>
        </figure>
        <div className="flex flex-col gap-2.5">
          <p className="text-sm text-muted-foreground m-0 max-w-[16rem]">
            {t('appDownload.qrHint', 'Scan a QR code with your phone camera to download')}
          </p>
          {badges}
        </div>
      </div>
    </div>
  )
}

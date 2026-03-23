import { Component, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

/* ------------------------------------------------------------------ */
/*  Hook wrapper – class components can't use hooks directly          */
/* ------------------------------------------------------------------ */

interface FallbackProps {
  error: Error
  resetError: () => void
  variant?: 'generic' | 'study'
}

function ErrorFallback({ error, resetError, variant = 'generic' }: FallbackProps) {
  const { t } = useTranslation('common')
  const isDev = import.meta.env.DEV

  const title =
    variant === 'study'
      ? t('error.boundary.studyTitle', 'Study session interrupted')
      : t('error.boundary.title', 'Something went wrong')

  const description =
    variant === 'study'
      ? t('error.boundary.studyDescription', 'An unexpected error occurred during the study session. Your progress has been saved.')
      : t('error.boundary.description', 'An unexpected error occurred. Please try again.')

  return (
    <div role="alert" className="min-h-[50vh] flex items-center justify-center p-6">
      <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-8 text-center max-w-md w-full">
        {/* Error icon */}
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/15">
          <svg
            className="h-7 w-7 text-destructive"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
            />
          </svg>
        </div>

        <h2 className="text-lg font-semibold text-destructive mb-2">{title}</h2>
        <p className="text-sm text-destructive mb-6">{description}</p>

        {/* Collapsible error details – dev only */}
        {isDev && (
          <details className="mb-6 text-left">
            <summary className="cursor-pointer text-xs text-destructive hover:text-destructive">
              {t('error.boundary.details', 'Error details')}
            </summary>
            <pre className="mt-2 max-h-40 overflow-auto rounded bg-destructive/15 p-3 text-xs text-destructive whitespace-pre-wrap break-words">
              {error.message}
              {error.stack && `\n\n${error.stack}`}
            </pre>
          </details>
        )}

        {/* Action buttons */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            type="button"
            onClick={resetError}
            className="px-5 py-2.5 text-sm font-medium bg-destructive text-white rounded-lg hover:bg-destructive transition cursor-pointer"
          >
            {t('error.boundary.tryAgain', 'Try Again')}
          </button>
          <a
            href="/dashboard"
            className="px-5 py-2.5 text-sm font-medium bg-card text-destructive border border-destructive/30 rounded-lg hover:bg-destructive/10 transition"
          >
            {t('error.boundary.goToDashboard', 'Go to Dashboard')}
          </a>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  ErrorBoundary – generic                                           */
/* ------------------------------------------------------------------ */

interface ErrorBoundaryProps {
  children: ReactNode
  variant?: 'generic' | 'study'
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo)
  }

  resetError = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError && this.state.error) {
      return (
        <ErrorFallback
          error={this.state.error}
          resetError={this.resetError}
          variant={this.props.variant ?? 'generic'}
        />
      )
    }
    return this.props.children
  }
}

/* ------------------------------------------------------------------ */
/*  StudyErrorBoundary – study-specific variant                       */
/* ------------------------------------------------------------------ */

export function StudyErrorBoundary({ children }: { children: ReactNode }) {
  return <ErrorBoundary variant="study">{children}</ErrorBoundary>
}

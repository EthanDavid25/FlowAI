import type { CaptureState } from '../../hooks/useScreenCapture'
import styles from './ScreenPanel.module.css'

// ─── Icons ────────────────────────────────────────────────────────────────────

function MonitorIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <rect x="6" y="8" width="36" height="24" rx="3" stroke="currentColor" strokeWidth="1.5" opacity="0.4" />
      <line x1="17" y1="38" x2="31" y2="38" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
      <line x1="24" y1="32" x2="24" y2="38" stroke="currentColor" strokeWidth="1.5" opacity="0.4" />
      <rect x="11" y="13" width="26" height="14" rx="1.5"
        stroke="currentColor" strokeWidth="1"
        strokeDasharray="3 3"
        opacity="0.25"
      />
    </svg>
  )
}

function ErrorIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <circle cx="20" cy="20" r="16" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
      <line x1="20" y1="12" x2="20" y2="22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="20" cy="27" r="1.5" fill="currentColor" />
    </svg>
  )
}

// ─── Sub-panels ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className={styles.emptyState}>
      <div className={styles.emptyIcon}>
        <MonitorIcon />
      </div>
      <p className={styles.emptyTitle}>No screen captured yet</p>
      <p className={styles.emptyHint}>
        Click <strong>Analyze Screen</strong> to capture what's currently
        displayed on your screen.
      </p>
    </div>
  )
}

function LoadingState() {
  return (
    <div className={styles.loadingState}>
      <div className={styles.scanRing} aria-hidden="true">
        <div className={styles.scanLine} />
      </div>
      <p className={styles.loadingTitle}>Capturing screen…</p>
      <p className={styles.loadingHint}>Hold on — grabbing a snapshot of your display.</p>
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className={styles.errorState}>
      <div className={styles.errorIcon}>
        <ErrorIcon />
      </div>
      <p className={styles.errorTitle}>Capture failed</p>
      <p className={styles.errorMessage}>{message}</p>
    </div>
  )
}

function ScreenshotState({ result }: { result: CaptureResult }) {
  const capturedTime = new Date(result.timestamp).toLocaleTimeString()
  return (
    <div className={styles.screenshotWrapper}>
      <img
        src={result.dataUrl}
        alt="Captured screen"
        className={styles.screenshotImg}
        draggable={false}
      />
      <div className={styles.screenshotOverlay}>
        <span className={styles.overlayTag}>
          {result.width} × {result.height} · {capturedTime}
        </span>
      </div>
    </div>
  )
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ScreenPanelProps {
  captureState: CaptureState
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * ScreenPanel — renders one of four states based on captureState:
 *   idle    → empty state ("No screen captured yet")
 *   loading → animated scanning indicator
 *   success → the actual screenshot
 *   error   → error message with icon
 */
export default function ScreenPanel({ captureState }: ScreenPanelProps) {
  const { status, result, errorMessage, capturedAt } = captureState

  // Badge text changes with state
  const badgeLabel =
    status === 'loading' ? 'Capturing…' :
    status === 'success' ? 'Live' :
    status === 'error'   ? 'Error' :
    'Preview'

  const badgeClass =
    status === 'success' ? styles.badgeSuccess :
    status === 'error'   ? styles.badgeError :
    status === 'loading' ? styles.badgeLoading :
    styles.panelBadge

  // Footer metadata
  const footerText =
    status === 'success' && capturedAt
      ? `Captured at ${new Date(capturedAt).toLocaleTimeString()} · ${result?.width ?? 0} × ${result?.height ?? 0} px`
      : 'Capture will appear here · Full resolution'

  return (
    <section className={styles.panel} aria-label="Screenshot preview">
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>Screen Capture</h2>
        <span className={badgeClass}>{badgeLabel}</span>
      </div>

      <div className={styles.preview}>
        {status === 'idle'    && <EmptyState />}
        {status === 'loading' && <LoadingState />}
        {status === 'error'   && <ErrorState message={errorMessage ?? 'Unknown error'} />}
        {status === 'success' && result && <ScreenshotState result={result} />}
      </div>

      <div className={styles.panelFooter}>
        <span className={styles.footerMeta}>{footerText}</span>
      </div>
    </section>
  )
}

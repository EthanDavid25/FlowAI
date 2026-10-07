import type { AiState } from '../../hooks/useAiAnalysis'
import styles from './ResponsePanel.module.css'

/** AI "spark" icon */
function SparkIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path
        d="M24 8 L26.5 20 L38 24 L26.5 28 L24 40 L21.5 28 L10 24 L21.5 20 Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        fill="none"
        opacity="0.45"
      />
      <circle cx="24" cy="24" r="2" fill="currentColor" opacity="0.3" />
    </svg>
  )
}

/** Error alert icon */
function ErrorIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <circle cx="20" cy="20" r="16" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
      <line x1="20" y1="12" x2="20" y2="22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="20" cy="27" r="1.5" fill="currentColor" />
    </svg>
  )
}

/** Circular progress spinner */
function Spinner() {
  return (
    <svg
      className={styles.spinner}
      width="36"
      height="36"
      viewBox="0 0 36 36"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="18"
        cy="18"
        r="14"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="60"
        strokeDashoffset="20"
        opacity="0.85"
      />
    </svg>
  )
}

interface ResponsePanelProps {
  aiState: AiState
  isCapturing?: boolean
}

/**
 * ResponsePanel — displays the AI analysis response from Ollama qwen3-vl:2b.
 *
 * States handled:
 *   - Idle: waiting for user action
 *   - Capturing: screenshot being taken
 *   - Analyzing: local vision model processing
 *   - Success: displays vision analysis output
 *   - Error: displays clear troubleshooting hint (e.g. Ollama offline)
 */
export default function ResponsePanel({ aiState, isCapturing = false }: ResponsePanelProps) {
  const { status, result, errorMessage } = aiState

  // Determine status chip
  let chipText = 'Idle'
  let chipClass = styles.statusChipIdle
  let dotClass = styles.statusDotIdle

  if (isCapturing) {
    chipText = 'Capturing…'
    chipClass = styles.statusChipLoading
    dotClass = styles.statusDotLoading
  } else if (status === 'analyzing') {
    chipText = 'Analyzing…'
    chipClass = styles.statusChipLoading
    dotClass = styles.statusDotLoading
  } else if (status === 'success') {
    chipText = 'Analysis Complete'
    chipClass = styles.statusChipSuccess
    dotClass = styles.statusDotSuccess
  } else if (status === 'error') {
    chipText = 'Error'
    chipClass = styles.statusChipError
    dotClass = styles.statusDotError
  }

  return (
    <section className={styles.panel} aria-label="AI analysis response">
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>AI Analysis</h2>
        <span className={chipClass}>
          <span className={dotClass} aria-hidden="true" />
          {chipText}
        </span>
      </div>

      <div className={styles.body}>
        {/* State 1: Screen Capturing in progress */}
        {isCapturing && (
          <div className={styles.loadingState}>
            <div className={styles.spinnerWrapper}>
              <Spinner />
            </div>
            <p className={styles.loadingTitle}>Capturing screen…</p>
            <p className={styles.loadingHint}>Grabbing primary display for vision analysis.</p>
          </div>
        )}

        {/* State 2: Local AI Vision Analysis in progress */}
        {!isCapturing && status === 'analyzing' && (
          <div className={styles.loadingState}>
            <div className={styles.spinnerWrapper}>
              <Spinner />
            </div>
            <p className={styles.loadingTitle}>Analyzing with local AI…</p>
            <p className={styles.loadingHint}>
              Running <strong>qwen3-vl:2b</strong> via local Ollama. Examining visible UI and content.
            </p>
          </div>
        )}

        {/* State 3: Error */}
        {!isCapturing && status === 'error' && (
          <div className={styles.errorState}>
            <div className={styles.errorIcon}>
              <ErrorIcon />
            </div>
            <p className={styles.errorTitle}>Analysis Unavailable</p>
            <p className={styles.errorMessage}>{errorMessage ?? 'An unexpected error occurred.'}</p>
          </div>
        )}

        {/* State 4: Success - Model Output */}
        {!isCapturing && status === 'success' && result && (
          <div className={`${styles.contentWrapper} selectable`}>
            <div className={styles.analysisText}>
              {result.content}
            </div>
          </div>
        )}

        {/* State 5: Idle - Initial Empty State */}
        {!isCapturing && status === 'idle' && (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>
              <SparkIcon />
            </div>
            <p className={styles.emptyTitle}>Waiting for screen analysis…</p>
            <p className={styles.emptyHint}>
              Click <strong>Analyze Screen</strong> to capture your display and analyze it with local Qwen3-VL.
            </p>
          </div>
        )}
      </div>

      <div className={styles.panelFooter}>
        <div className={styles.footerRow}>
          <span className={styles.footerLabel}>Model</span>
          <span className={styles.footerValue}>
            {result?.model ?? (status === 'analyzing' || isCapturing ? 'qwen3-vl:2b' : 'qwen3-vl:2b')}
          </span>
        </div>
        <div className={styles.footerRow}>
          <span className={styles.footerLabel}>Tokens</span>
          <span className={styles.footerValue}>{result?.totalTokens != null ? result.totalTokens : '—'}</span>
        </div>
        {result?.durationMs != null && (
          <div className={styles.footerRow}>
            <span className={styles.footerLabel}>Time</span>
            <span className={styles.footerValue}>{(result.durationMs / 1000).toFixed(1)}s</span>
          </div>
        )}
      </div>
    </section>
  )
}

import styles from './ActionBar.module.css'

/** Scan / camera frame icon */
function ScanIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      {/* Corner brackets */}
      <path d="M2 6 L2 2 L6 2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 2 L16 2 L16 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 12 L16 16 L12 16" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 16 L2 16 L2 12" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      {/* Scan line */}
      <line x1="4" y1="9" x2="14" y2="9" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" opacity="0.6" />
    </svg>
  )
}

/** Animated spinner shown while operation is in flight */
function Spinner() {
  return (
    <svg
      className={styles.spinner}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="8" cy="8" r="6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="28"
        strokeDashoffset="10"
        opacity="0.9"
      />
    </svg>
  )
}

interface ActionBarProps {
  /** Called when the user clicks "Analyze Screen" */
  onCapture: () => void
  /** True while a capture is in progress */
  isCapturing: boolean
  /** True while AI analysis is in progress */
  isAnalyzing?: boolean
}

/**
 * ActionBar — contains the primary "Analyze Screen" CTA.
 * Foundation 3: button triggers capture → then local AI vision analysis.
 */
export default function ActionBar({
  onCapture,
  isCapturing,
  isAnalyzing = false,
}: ActionBarProps) {
  const isBusy = isCapturing || isAnalyzing

  let hintText = 'Click Analyze Screen to capture and analyze your display.'
  let buttonLabel = 'Analyze Screen'

  if (isCapturing) {
    hintText = 'Capturing your screen…'
    buttonLabel = 'Capturing…'
  } else if (isAnalyzing) {
    hintText = 'Analyzing with local AI (qwen3-vl:2b)…'
    buttonLabel = 'Analyzing…'
  }

  return (
    <div className={styles.bar}>
      <div className={styles.left}>
        <p className={styles.hint}>
          <span className={styles.hintIcon} aria-hidden="true">ℹ</span>
          {hintText}
        </p>
      </div>

      <div className={styles.right}>
        <button
          className={styles.analyzeBtn}
          onClick={onCapture}
          disabled={isBusy}
          aria-disabled={isBusy}
          title={isBusy ? 'Operation in progress…' : 'Capture and analyze the primary display'}
        >
          {isBusy ? <Spinner /> : <ScanIcon />}
          <span>{buttonLabel}</span>
        </button>
      </div>
    </div>
  )
}

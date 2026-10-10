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

/** Target / crosshair icon for cursor analysis */
function TargetIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="9" cy="9" r="2" fill="currentColor" />
      <line x1="9" y1="1" x2="9" y2="4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="9" y1="14" x2="9" y2="17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="1" y1="9" x2="4" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="14" y1="9" x2="17" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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
  /** Called when user clicks "Analyze Screen" */
  onAnalyzeScreen: () => void
  /** Called when user clicks "Analyze Cursor" */
  onAnalyzeCursor: () => void
  /** True while a capture is in progress */
  isCapturing: boolean
  /** True while AI analysis is in progress */
  isAnalyzing: boolean
  /** Active operation mode */
  activeMode?: 'screen' | 'cursor' | null
}

/**
 * ActionBar — contains FlowAI actions:
 *   - "Analyze Cursor": intelligent cursor awareness (Foundation 4A / 4B-1 Ctrl+Shift+F)
 *   - "Analyze Screen": full screen vision analysis (Foundation 3)
 */
export default function ActionBar({
  onAnalyzeScreen,
  onAnalyzeCursor,
  isCapturing,
  isAnalyzing,
  activeMode = null,
}: ActionBarProps) {
  const isBusy = isCapturing || isAnalyzing

  let hintText = 'Press Ctrl + Shift + F anywhere on your screen to identify the element under your cursor.'

  if (isCapturing) {
    hintText = 'Capturing screen and cursor position…'
  } else if (isAnalyzing && activeMode === 'cursor') {
    hintText = 'Identifying UI element at cursor coordinates with local AI (qwen3-vl:2b)…'
  } else if (isAnalyzing && activeMode === 'screen') {
    hintText = 'Analyzing full screen with local AI (qwen3-vl:2b)…'
  }

  // Determine button states
  const isCursorBusy = (isAnalyzing && activeMode === 'cursor') || (isCapturing && activeMode === 'cursor')
  const isScreenBusy = (isAnalyzing && activeMode === 'screen') || (isCapturing && activeMode === 'screen')

  const cursorBtnLabel = isCursorBusy ? (isCapturing ? 'Capturing…' : 'Analyzing…') : 'Analyze Cursor'
  const screenBtnLabel = isScreenBusy ? (isCapturing ? 'Capturing…' : 'Analyzing…') : 'Analyze Screen'

  return (
    <div className={styles.bar}>
      <div className={styles.left}>
        <p className={styles.hint}>
          <span className={styles.hintIcon} aria-hidden="true">ℹ</span>
          {hintText}
        </p>
      </div>

      <div className={styles.right}>
        {/* Primary Action: Analyze Cursor (Foundation 4A & 4B-1) */}
        <button
          className={styles.cursorBtn}
          onClick={onAnalyzeCursor}
          disabled={isBusy}
          aria-disabled={isBusy}
          title={isBusy ? 'Operation in progress…' : 'Identify the UI element under the mouse cursor (Ctrl + Shift + F)'}
        >
          {isCursorBusy ? <Spinner /> : <TargetIcon />}
          <span>{cursorBtnLabel}</span>
          {!isCursorBusy && <span className={styles.kbd}>Ctrl+Shift+F</span>}
        </button>

        {/* Secondary Action: Analyze Screen (Foundation 3) */}
        <button
          className={styles.analyzeBtn}
          onClick={onAnalyzeScreen}
          disabled={isBusy}
          aria-disabled={isBusy}
          title={isBusy ? 'Operation in progress…' : 'Capture and analyze the entire screen'}
        >
          {isScreenBusy ? <Spinner /> : <ScanIcon />}
          <span>{screenBtnLabel}</span>
        </button>
      </div>
    </div>
  )
}

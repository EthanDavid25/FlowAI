import { useState, useEffect } from 'react'
import type { AiState } from '../../hooks/useAiAnalysis'
import ChatPanel from '../ChatPanel/ChatPanel'
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

/** Target crosshair icon for cursor element */
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

/** Grid/scan icon for screen understanding */
function GridIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="10" y="2" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="2" y="10" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="10" y="10" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

/**
 * Returns a human-readable label for a ScreenElementType.
 */
function elementTypeLabel(type: ScreenElementType): string {
  const MAP: Partial<Record<ScreenElementType, string>> = {
    application_window: 'App Window',
    browser_tab: 'Tab',
    browser_tab_close: 'Tab Close',
    new_tab_button: 'New Tab',
    address_bar: 'Address Bar',
    navigation_button: 'Nav Button',
    toolbar_button: 'Toolbar',
    search_input: 'Search',
    text_input: 'Text Input',
    button: 'Button',
    link: 'Link',
    menu: 'Menu',
    menu_item: 'Menu Item',
    sidebar: 'Sidebar',
    navigation_item: 'Nav Item',
    card: 'Card',
    list: 'List',
    list_item: 'Item',
    table: 'Table',
    table_row: 'Row',
    dialog: 'Dialog',
    modal: 'Modal',
    panel: 'Panel',
    video: 'Video',
    image: 'Image',
    thumbnail: 'Thumbnail',
    text_block: 'Text',
    message: 'Message',
    message_bubble: 'Message',
    chat: 'Chat',
    chat_row: 'Chat Row',
    profile: 'Profile',
    icon: 'Icon',
    checkbox: 'Checkbox',
    radio: 'Radio',
    dropdown: 'Dropdown',
    scrollbar: 'Scrollbar',
    terminal: 'Terminal',
    command_line: 'Command',
    code_block: 'Code',
    output_area: 'Output',
    other: 'Element',
  }
  return MAP[type] ?? type
}

interface ResponsePanelProps {
  aiState: AiState
  isCapturing?: boolean
  latestScreenshot?: string | null
  activeVisionProvider?: VisionProviderId
}

/**
 * ResponsePanel — displays the AI analysis response and interactive AI chat.
 *
 * Supports:
 *   - Vision Analysis:
 *       * Foundation 3: Full screen analysis (`mode: 'screen'`) — legacy path
 *       * Foundation 4B-1: Cursor element awareness (`mode: 'cursor'`)
 *       * Foundation 4B-2: Structured screen understanding (`mode: 'screenUnderstanding'`)
 *   - AI Chat (Stage 3):
 *       * Conversational Q&A with Gemini 3.8 Flash
 *       * Optional screenshot context attachment
 *       * Secure DPAPI-encrypted API key management
 */
export default function ResponsePanel({
  aiState,
  isCapturing = false,
  latestScreenshot,
  activeVisionProvider,
}: ResponsePanelProps) {
  const { status, mode, screenResult, cursorResult, screenUnderstandingResult, errorMessage } = aiState

  const [activeTab, setActiveTab] = useState<'vision' | 'chat'>('vision')
  const [shortcutText, setShortcutText] = useState('Ctrl + Shift + F')

  // Automatically switch to vision tab if screen/cursor analysis is initiated
  useEffect(() => {
    if (isCapturing || status === 'analyzing') {
      setActiveTab('vision')
    }
  }, [isCapturing, status])

  useEffect(() => {
    window.flowAI?.getCursorShortcutInfo?.().then((info) => {
      if (info?.displayShortcut) {
        setShortcutText(info.displayShortcut.replace(/\+/g, ' + '))
      }
    }).catch(() => {})
  }, [])

  // Determine status chip text and styles
  let chipText = 'Idle'
  let chipClass = styles.statusChipIdle
  let dotClass = styles.statusDotIdle

  if (isCapturing) {
    chipText = 'Capturing…'
    chipClass = styles.statusChipLoading
    dotClass = styles.statusDotLoading
  } else if (status === 'analyzing') {
    chipText =
      mode === 'cursor' ? 'Analyzing Cursor…' :
      mode === 'screenUnderstanding' ? 'Understanding Screen…' :
      'Analyzing Screen…'
    chipClass = styles.statusChipLoading
    dotClass = styles.statusDotLoading
  } else if (status === 'success') {
    chipText =
      mode === 'cursor' ? 'Cursor Element Detected' :
      mode === 'screenUnderstanding' ? 'Screen Understanding Complete' :
      'Analysis Complete'
    chipClass = styles.statusChipSuccess
    dotClass = styles.statusDotSuccess
  } else if (status === 'error') {
    chipText = 'Error'
    chipClass = styles.statusChipError
    dotClass = styles.statusDotError
  }

  // Active result metadata
  const activeModel =
    screenUnderstandingResult?.model ??
    cursorResult?.model ??
    screenResult?.model ??
    'qwen3-vl:2b'
  const activeTokens =
    screenUnderstandingResult?.totalTokens ??
    cursorResult?.totalTokens ??
    screenResult?.totalTokens ??
    null
  const activeDuration =
    screenUnderstandingResult?.durationMs ??
    cursorResult?.durationMs ??
    screenResult?.durationMs ??
    null

  return (
    <section className={styles.panel} aria-label="AI analysis response">
      <div className={styles.panelHeader}>
        <div className={styles.tabGroup} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'vision'}
            className={`${styles.tabBtn} ${activeTab === 'vision' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('vision')}
          >
            Vision Analysis
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'chat'}
            className={`${styles.tabBtn} ${activeTab === 'chat' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('chat')}
          >
            AI Chat
          </button>
        </div>

        {activeTab === 'vision' && (
          <span className={chipClass}>
            <span className={dotClass} aria-hidden="true" />
            {chipText}
          </span>
        )}
      </div>

      {activeTab === 'chat' ? (
        <ChatPanel latestScreenshot={latestScreenshot} />
      ) : (
        <>

      <div className={styles.body}>
        {/* State 1: Capturing in progress */}
        {isCapturing && (
          <div className={styles.loadingState}>
            <div className={styles.spinnerWrapper}>
              <Spinner />
            </div>
            <p className={styles.loadingTitle}>Capturing screen…</p>
            <p className={styles.loadingHint}>Grabbing primary display for vision analysis.</p>
          </div>
        )}

        {/* State 2: Analyzing in progress */}
        {!isCapturing && status === 'analyzing' && (
          <div className={styles.loadingState}>
            <div className={styles.spinnerWrapper}>
              <Spinner />
            </div>
            <p className={styles.loadingTitle}>
              {mode === 'cursor'
                ? 'Identifying UI element at cursor…'
                : mode === 'screenUnderstanding'
                ? 'Understanding visible screen elements…'
                : 'Analyzing screen with AI…'}
            </p>
            <p className={styles.loadingHint}>
              Running <strong>{activeVisionProvider === 'gemini' ? 'gemini-3.8-flash' : 'qwen3-vl:2b'}</strong> via{' '}
              {activeVisionProvider === 'gemini' ? 'Google Gemini' : 'local Ollama'}.
              {mode === 'cursor'
                ? ' Examining visual coordinates under your mouse.'
                : mode === 'screenUnderstanding'
                ? ' Detecting all visible UI elements and content regions.'
                : ' Examining visible UI elements and text.'}
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

        {/* State 4A: Cursor Element Identification Success (Foundation 4B-1) */}
        {!isCapturing && status === 'success' && mode === 'cursor' && cursorResult && (
          <div className={`${styles.cursorResultWrapper} selectable`}>
            {/* Element Header Card */}
            <div className={styles.elementCard}>
              <div className={styles.elementBadge}>
                <TargetIcon />
                <span>Identified Element</span>
              </div>
              <h3 className={styles.elementName}>{cursorResult.element}</h3>
              {cursorResult.description && (
                <p className={styles.elementDescription}>{cursorResult.description}</p>
              )}
            </div>

            {/* Coordinates and Confidence Metrics */}
            <div className={styles.metricsGrid}>
              <div className={styles.metricCard}>
                <span className={styles.metricLabel}>Element Center (Screen)</span>
                <span className={styles.metricValue}>
                  {cursorResult.centerScreen
                    ? `X: ${cursorResult.centerScreen.x}, Y: ${cursorResult.centerScreen.y}`
                    : cursorResult.element === 'NO_ELEMENT'
                    ? 'None'
                    : `X: ${cursorResult.x}, Y: ${cursorResult.y}`}
                </span>
              </div>

              <div className={styles.metricCard}>
                <span className={styles.metricLabel}>Cursor Position</span>
                <span className={styles.metricValue}>
                  X: {cursorResult.cursorScreen?.x ?? cursorResult.cursorX}, Y: {cursorResult.cursorScreen?.y ?? cursorResult.cursorY}
                </span>
              </div>

              <div className={styles.metricCard}>
                <span className={styles.metricLabel}>Bounding Box (Screen)</span>
                <span className={styles.metricValue}>
                  {cursorResult.bboxScreen
                    ? `X1: ${cursorResult.bboxScreen.x1}, Y1: ${cursorResult.bboxScreen.y1} → X2: ${cursorResult.bboxScreen.x2}, Y2: ${cursorResult.bboxScreen.y2}`
                    : cursorResult.bbox
                    ? `X1: ${cursorResult.bbox.x1}, Y1: ${cursorResult.bbox.y1} → X2: ${cursorResult.bbox.x2}, Y2: ${cursorResult.bbox.y2}`
                    : 'None'}
                </span>
              </div>

              <div className={styles.metricCard}>
                <span className={styles.metricLabel}>Confidence</span>
                <span
                  className={
                    cursorResult.confidence >= 0.75
                      ? styles.confidenceHigh
                      : cursorResult.confidence >= 0.45
                      ? styles.confidenceMedium
                      : styles.confidenceLow
                  }
                >
                  {Math.round(cursorResult.confidence * 100)}%
                </span>
              </div>
            </div>

            {/* Low confidence notice */}
            {cursorResult.confidence < 0.5 && (
              <div className={styles.lowConfidenceAlert}>
                <span className={styles.alertIcon}>⚠️</span>
                <span>
                  {cursorResult.element === 'NO_ELEMENT'
                    ? 'No distinct UI element was found directly under the cursor.'
                    : 'Low confidence reading. The mouse cursor may be over an empty area or ambiguous background.'}
                </span>
              </div>
            )}

            {/* Structured JSON Output */}
            <div className={styles.jsonSection}>
              <div className={styles.jsonHeader}>
                <span>Structured Output (JSON)</span>
              </div>
              <pre className={styles.jsonCode}>
                {JSON.stringify(
                  {
                    element: cursorResult.element,
                    description: cursorResult.description,
                    confidence: cursorResult.confidence,
                    bboxScreen: cursorResult.bboxScreen ?? cursorResult.bbox ?? null,
                    centerScreen:
                      cursorResult.centerScreen ??
                      (cursorResult.element === 'NO_ELEMENT'
                        ? null
                        : { x: cursorResult.x, y: cursorResult.y }),
                    cursorScreen:
                      cursorResult.cursorScreen ?? {
                        x: cursorResult.cursorX,
                        y: cursorResult.cursorY,
                      },
                  },
                  null,
                  2
                )}
              </pre>
            </div>
          </div>
        )}

        {/* State 4B: Screen Understanding Success (Foundation 4B-2) */}
        {/* State 4B: Screen Understanding Success (Foundation 4B-2) */}
        {!isCapturing && status === 'success' && mode === 'screenUnderstanding' && screenUnderstandingResult && (() => {
          const cursorTarget = screenUnderstandingResult.cursorTarget
          const totalCount = screenUnderstandingResult.elements.length

          // Exclude the element already represented in the Cursor Target card to avoid visual duplicates
          const otherElements = screenUnderstandingResult.elements.filter((el) => {
            if (!cursorTarget) return true
            // Match by stable element ID if available
            if (el.id && cursorTarget.id && el.id === cursorTarget.id) return false
            // Fallback: match by identical type, label, and bounding box
            if (
              el.type === cursorTarget.type &&
              el.label === cursorTarget.label &&
              el.bbox?.x1 === cursorTarget.bbox?.x1 &&
              el.bbox?.y1 === cursorTarget.bbox?.y1 &&
              el.bbox?.x2 === cursorTarget.bbox?.x2 &&
              el.bbox?.y2 === cursorTarget.bbox?.y2
            ) {
              return false
            }
            return true
          })

          return (
            <div className={`${styles.screenUnderstandingWrapper} selectable`}>
              {/* Screen metadata header */}
              <div className={styles.suHeader}>
                <div className={styles.suHeaderLeft}>
                  <div className={styles.elementBadge}>
                    <GridIcon />
                    <span>Screen Understanding</span>
                  </div>
                  <h3 className={styles.suApp}>{screenUnderstandingResult.screen.application}</h3>
                  {screenUnderstandingResult.screen.description && (
                    <p className={styles.suDesc}>{screenUnderstandingResult.screen.description}</p>
                  )}
                </div>
                <div className={styles.suStats}>
                  <span className={styles.suStatBadge}>
                    {totalCount} {totalCount === 1 ? 'element' : 'elements'}
                  </span>
                  {screenUnderstandingResult.truncated && (
                    <span
                      className={styles.suTruncatedBadge}
                      title="Response was truncated by token limit; some elements may not be listed"
                    >
                      ⚠️ Partial (token limit)
                    </span>
                  )}
                </div>
              </div>

              {/* Cursor target highlight */}
              {cursorTarget && (
                <div className={styles.cursorTargetCard}>
                  <div className={styles.cursorTargetHeader}>
                    <TargetIcon />
                    <span>Cursor Target</span>
                  </div>
                  <div className={styles.cursorTargetBody}>
                    <span className={styles.suElementType}>
                      {elementTypeLabel(cursorTarget.type)}
                    </span>
                    <span className={styles.suElementLabel}>
                      {cursorTarget.label}
                    </span>
                    {cursorTarget.state && (
                      <span className={styles.suElementState}>
                        {cursorTarget.state}
                      </span>
                    )}
                  </div>
                  {cursorTarget.description && (
                    <p className={styles.suElementDesc}>
                      {cursorTarget.description}
                    </p>
                  )}
                  {cursorTarget.bbox && (
                    <p className={styles.suElementBbox}>
                      bbox: {cursorTarget.bbox.x1},{cursorTarget.bbox.y1} → {cursorTarget.bbox.x2},{cursorTarget.bbox.y2}
                      {cursorTarget.center && (
                        <> · center: {cursorTarget.center.x},{cursorTarget.center.y}</>
                      )}
                    </p>
                  )}
                </div>
              )}

              {/* No elements detected */}
              {totalCount === 0 && (
                <div className={styles.lowConfidenceAlert}>
                  <span className={styles.alertIcon}>ℹ️</span>
                  <span>No distinct UI elements were confidently identified in this screenshot.</span>
                </div>
              )}

              {/* Element list (excluding the element already featured in the cursor target card) */}
              {otherElements.length > 0 && (
                <div className={styles.suElementList}>
                  {otherElements.map((el) => (
                    <div
                      key={el.id}
                      className={`${styles.suElementRow} ${el.containsCursor ? styles.suElementRowCursor : ''}`}
                    >
                      <div className={styles.suElementRowMain}>
                        <span className={styles.suElementType}>
                          {elementTypeLabel(el.type)}
                        </span>
                        <span className={styles.suElementLabel}>{el.label}</span>
                        {el.state && (
                          <span className={styles.suElementState}>{el.state}</span>
                        )}
                        {el.interactive && (
                          <span className={styles.suInteractiveBadge} title="Interactive element">⚡</span>
                        )}
                        {el.containsCursor && (
                          <span className={styles.suCursorBadge} title="Cursor is here">◎</span>
                        )}
                        <span
                          className={
                            el.confidence >= 0.75
                              ? styles.confidenceHigh
                              : el.confidence >= 0.45
                              ? styles.confidenceMedium
                              : styles.confidenceLow
                          }
                        >
                          {Math.round(el.confidence * 100)}%
                        </span>
                      </div>
                      {el.description && (
                        <p className={styles.suElementDesc}>{el.description}</p>
                      )}
                      {el.bbox && (
                        <p className={styles.suElementBbox}>
                          bbox: {el.bbox.x1},{el.bbox.y1} → {el.bbox.x2},{el.bbox.y2}
                          {el.center && (
                            <> · center: {el.center.x},{el.center.y}</>
                          )}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })()}

        {/* State 4C: Full Screen Vision Analysis Success (Foundation 3 — legacy free-text) */}
        {!isCapturing && status === 'success' && mode === 'screen' && screenResult && (
          <div className={`${styles.contentWrapper} selectable`}>
            <div className={styles.analysisText}>
              {screenResult.content}
            </div>
          </div>
        )}

        {/* State 5: Idle */}
        {!isCapturing && status === 'idle' && (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>
              <SparkIcon />
            </div>
            <p className={styles.emptyTitle}>Ready to analyze</p>
            <p className={styles.emptyHint}>
              Press <strong>{shortcutText}</strong> anywhere on your screen to identify the element under your mouse, or click{' '}
              <strong>Analyze Screen</strong> to understand all visible UI elements.
            </p>
          </div>
        )}
      </div>

      <div className={styles.panelFooter}>
        <div className={styles.footerRow}>
          <span className={styles.footerLabel}>Provider</span>
          <span className={styles.footerValue}>
            {activeModel.toLowerCase().includes('gemini') || (!activeModel.toLowerCase().includes('qwen') && activeVisionProvider === 'gemini')
              ? 'Gemini Vision'
              : 'Ollama Vision'}
          </span>
        </div>
        <div className={styles.footerRow}>
          <span className={styles.footerLabel}>Model</span>
          <span className={styles.footerValue}>{activeModel}</span>
        </div>
        <div className={styles.footerRow}>
          <span className={styles.footerLabel}>Tokens</span>
          <span className={styles.footerValue}>{activeTokens != null ? activeTokens : '—'}</span>
        </div>
        {activeDuration != null && (
          <div className={styles.footerRow}>
            <span className={styles.footerLabel}>Time</span>
            <span className={styles.footerValue}>{(activeDuration / 1000).toFixed(1)}s</span>
          </div>
        )}
      </div>
        </>
      )}
    </section>
  )
}

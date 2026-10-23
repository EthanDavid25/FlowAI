import { useState, useEffect, useRef } from 'react'
import { useScreenCapture } from '../hooks/useScreenCapture'
import { useAiAnalysis } from '../hooks/useAiAnalysis'
import { getCursorPoint } from '../services/ai/cursorAnalysis'
import type { VisionProviderId } from '../types/screenUnderstanding'
import Header from '../components/Header/Header'
import ScreenPanel from '../components/ScreenPanel/ScreenPanel'
import ResponsePanel from '../components/ResponsePanel/ResponsePanel'
import ActionBar from '../components/ActionBar/ActionBar'
import styles from './Dashboard.module.css'

/**
 * Dashboard — the primary screen of FlowAI.
 *
 * Coordinates:
 *   1. Screen Capture via useScreenCapture()
 *   2. Vision AI analysis via useAiAnalysis():
 *      - Structured screen understanding (Foundation 4B-2) — Analyze Screen button
 *      - Intelligent cursor element awareness (Foundation 4B-1) — Analyze Cursor / Ctrl+Shift+F
 *      - Full-screen free-text description (Foundation 3) — legacy, still accessible
 */
export default function Dashboard() {
  const { captureState, triggerCapture, setCaptureResult } = useScreenCapture()
  const { aiState, triggerCursorAnalysis, triggerScreenUnderstanding } = useAiAnalysis()

  const [activeMode, setActiveMode] = useState<'screen' | 'cursor' | null>(null)
  const [activeVisionProvider, setActiveVisionProvider] = useState<VisionProviderId>('gemini')

  useEffect(() => {
    window.flowAI?.getVisionProvider?.().then((res) => {
      if (res?.active) {
        setActiveVisionProvider(res.active)
      }
    }).catch(() => {})
  }, [])

  const isCapturing = captureState.status === 'loading'
  const isAnalyzing = aiState.status === 'analyzing'
  const isBusy = isCapturing || isAnalyzing

  // Keep a ref so the shortcut callback always sees the current busy state
  // without needing to be in the useEffect dependency array.
  // This prevents the IPC listener from being torn down and re-subscribed
  // on every render where isBusy changes (which would drop shortcut events
  // that fired between unsubscribe and re-subscribe).
  const isBusyRef = useRef(isBusy)
  isBusyRef.current = isBusy

  /**
   * Foundation 4B-1: Global keyboard trigger (Ctrl + Shift + F)
   * Triggered from anywhere on the desktop via Electron's globalShortcut.
   * Subscribed once on mount; uses isBusyRef to read current busy state
   * without causing the effect to re-run.
   */
  useEffect(() => {
    if (!window.flowAI?.onCursorShortcut) return

    const unsubscribe = window.flowAI.onCursorShortcut(async ({ capture, cursor }) => {
      if (isBusyRef.current) return

      setActiveMode('cursor')
      setCaptureResult(capture)

      if (capture.ok) {
        await triggerCursorAnalysis({
          dataUrl: capture.data.dataUrl,
          cursorX: cursor.x,
          cursorY: cursor.y,
          screenWidth: capture.data.width,
          screenHeight: capture.data.height,
        })
      }
      setActiveMode(null)
    })

    return () => {
      unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setCaptureResult, triggerCursorAnalysis])

  /**
   * Action 1: Analyze Cursor (Fallback Button & Immediate Trigger)
   * 1. Detect current mouse position on the desktop
   * 2. Capture primary screen
   * 3. Identify UI element closest to / underneath cursor via local Qwen3-VL (Foundation 4B-1)
   */
  const handleAnalyzeCursor = async () => {
    if (isBusy) return

    setActiveMode('cursor')

    try {
      // 1. Detect mouse cursor position on desktop
      const point = await getCursorPoint()

      // 2. Capture primary screen
      const captureResult = await triggerCapture()

      // 3. Send screenshot + cursor coordinates to Ollama Qwen3-VL
      if (captureResult) {
        await triggerCursorAnalysis({
          dataUrl: captureResult.dataUrl,
          cursorX: point.x,
          cursorY: point.y,
          screenWidth: captureResult.width,
          screenHeight: captureResult.height,
        })
      }
    } finally {
      setActiveMode(null)
    }
  }

  /**
   * Action 2: Analyze Screen (Foundation 4B-2 — Structured Screen Understanding)
   * 1. Detect current cursor position (for cursor targeting)
   * 2. Capture primary screen
   * 3. Run structured multi-element screen understanding via Ollama
   *
   * Returns a list of detected UI elements, the cursor target, and screen metadata.
   */
  const handleAnalyzeScreen = async () => {
    if (isBusy) return

    setActiveMode('screen')
    try {
      // 1. Get cursor position for cursor-target computation in the result
      const cursorPoint = await getCursorPoint().catch(() => null)

      // 2. Capture primary screen
      const captureResult = await triggerCapture()
      if (captureResult) {
        // 3. Run 4B-2 structured screen understanding
        await triggerScreenUnderstanding({
          dataUrl: captureResult.dataUrl,
          screenWidth: captureResult.width,
          screenHeight: captureResult.height,
          cursorX: cursorPoint?.x,
          cursorY: cursorPoint?.y,
        })
      }
    } finally {
      setActiveMode(null)
    }
  }

  return (
    <div className={styles.dashboard}>
      <Header />
      <div className={styles.content}>
        <ScreenPanel
  captureState={captureState}
  screenUnderstandingResult={aiState.screenUnderstandingResult}
/>
        <ResponsePanel
          aiState={aiState}
          isCapturing={isCapturing}
          latestScreenshot={captureState.result?.dataUrl}
          activeVisionProvider={activeVisionProvider}
        />
      </div>
      <ActionBar
        onAnalyzeScreen={handleAnalyzeScreen}
        onAnalyzeCursor={handleAnalyzeCursor}
        isCapturing={isCapturing}
        isAnalyzing={isAnalyzing}
        activeMode={activeMode}
        activeVisionProvider={activeVisionProvider}
        onVisionProviderChange={(prov) => setActiveVisionProvider(prov)}
      />
    </div>
  )
}

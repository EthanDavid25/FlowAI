import { useScreenCapture } from '../hooks/useScreenCapture'
import { useAiAnalysis } from '../hooks/useAiAnalysis'
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
 *   2. Vision AI analysis via useAiAnalysis()
 *
 * User flow:
 *   Click Analyze Screen
 *     → triggerCapture() captures primary screen
 *     → screenshot is displayed in ScreenPanel
 *     → triggerAnalysis(dataUrl) sends image via IPC to Ollama (qwen3-vl:2b)
 *     → vision analysis is displayed in ResponsePanel
 */
export default function Dashboard() {
  const { captureState, triggerCapture } = useScreenCapture()
  const { aiState, triggerAnalysis } = useAiAnalysis()

  const isCapturing = captureState.status === 'loading'
  const isAnalyzing = aiState.status === 'analyzing'
  const isBusy = isCapturing || isAnalyzing

  const handleAnalyzeScreen = async () => {
    if (isBusy) return

    // Step 1: Capture primary screen
    const captureResult = await triggerCapture()
    if (captureResult) {
      // Step 2: Send captured image to local Ollama vision model (qwen3-vl:2b)
      await triggerAnalysis(captureResult.dataUrl)
    }
  }

  return (
    <div className={styles.dashboard}>
      <Header />
      <div className={styles.content}>
        <ScreenPanel captureState={captureState} />
        <ResponsePanel aiState={aiState} isCapturing={isCapturing} />
      </div>
      <ActionBar
        onCapture={handleAnalyzeScreen}
        isCapturing={isCapturing}
        isAnalyzing={isAnalyzing}
      />
    </div>
  )
}

/**
 * src/hooks/useAiAnalysis.ts
 *
 * React hook that manages vision AI analysis state.
 *
 * States:
 *   idle       — no analysis requested yet (empty state)
 *   analyzing  — analysis in progress with local Ollama qwen3-vl:2b
 *   success    — analysis complete, response text & metadata available
 *   error      — analysis failed (e.g. Ollama offline or error), message available
 */

import { useState, useCallback } from 'react'
import { analyze } from '../services/ai/visionAnalysis'

export type AiStatus = 'idle' | 'analyzing' | 'success' | 'error'

export interface AiState {
  status: AiStatus
  /** Available when status === 'success' */
  result: VisionResult | null
  /** Available when status === 'error' */
  errorMessage: string | null
}

const INITIAL_STATE: AiState = {
  status: 'idle',
  result: null,
  errorMessage: null,
}

export interface UseAiAnalysisReturn {
  aiState: AiState
  /** Send screenshot data URL to local AI provider. Returns result or null on error. */
  triggerAnalysis: (dataUrl: string) => Promise<VisionResult | null>
  /** Reset back to idle state */
  reset: () => void
}

export function useAiAnalysis(): UseAiAnalysisReturn {
  const [aiState, setAiState] = useState<AiState>(INITIAL_STATE)

  const triggerAnalysis = useCallback(async (dataUrl: string): Promise<VisionResult | null> => {
    setAiState({
      status: 'analyzing',
      result: null,
      errorMessage: null,
    })

    const response = await analyze(dataUrl)

    if (response.ok) {
      setAiState({
        status: 'success',
        result: response.data,
        errorMessage: null,
      })
      return response.data
    } else {
      setAiState({
        status: 'error',
        result: null,
        errorMessage: response.error,
      })
      return null
    }
  }, [])

  const reset = useCallback(() => {
    setAiState(INITIAL_STATE)
  }, [])

  return { aiState, triggerAnalysis, reset }
}

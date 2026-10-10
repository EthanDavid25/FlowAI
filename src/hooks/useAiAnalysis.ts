/**
 * src/hooks/useAiAnalysis.ts
 *
 * React hook that manages vision AI analysis state.
 * Supports:
 *   - Foundation 3: Full-screen description (mode: 'screen')
 *   - Foundation 4B-1: Cursor UI element awareness (mode: 'cursor')
 *   - Foundation 4B-2: Structured screen understanding (mode: 'screenUnderstanding')
 */

import { useState, useCallback } from 'react'
import { analyze as analyzeScreenService } from '../services/ai/visionAnalysis'
import { analyzeCursor as analyzeCursorService } from '../services/ai/cursorAnalysis'
import { analyzeScreen as analyzeScreenUnderstandingService } from '../services/ai/screenUnderstanding'

export type AiStatus = 'idle' | 'analyzing' | 'success' | 'error'
export type AnalysisMode = 'screen' | 'cursor' | 'screenUnderstanding'

export interface AiState {
  status: AiStatus
  mode: AnalysisMode | null
  /** Foundation 3: Full-screen free-text vision result */
  screenResult: VisionResult | null
  /** Foundation 4B-1: Cursor UI element result */
  cursorResult: CursorElementResult | null
  /** Foundation 4B-2: Structured screen understanding result */
  screenUnderstandingResult: ScreenUnderstandingResult | null
  /** Error message if status === 'error' */
  errorMessage: string | null
}

const INITIAL_STATE: AiState = {
  status: 'idle',
  mode: null,
  screenResult: null,
  cursorResult: null,
  screenUnderstandingResult: null,
  errorMessage: null,
}

export interface UseAiAnalysisReturn {
  aiState: AiState
  /** Trigger full-screen free-text vision analysis (Foundation 3) */
  triggerScreenAnalysis: (dataUrl: string) => Promise<VisionResult | null>
  /** Trigger cursor UI element identification (Foundation 4B-1) */
  triggerCursorAnalysis: (params: {
    dataUrl: string
    cursorX: number
    cursorY: number
    screenWidth: number
    screenHeight: number
  }) => Promise<CursorElementResult | null>
  /** Trigger structured screen understanding (Foundation 4B-2) */
  triggerScreenUnderstanding: (params: {
    dataUrl: string
    screenWidth: number
    screenHeight: number
    cursorX?: number
    cursorY?: number
  }) => Promise<ScreenUnderstandingResult | null>
  /** Reset back to idle state */
  reset: () => void
}

export function useAiAnalysis(): UseAiAnalysisReturn {
  const [aiState, setAiState] = useState<AiState>(INITIAL_STATE)

  const triggerScreenAnalysis = useCallback(
    async (dataUrl: string): Promise<VisionResult | null> => {
      setAiState({
        status: 'analyzing',
        mode: 'screen',
        screenResult: null,
        cursorResult: null,
        screenUnderstandingResult: null,
        errorMessage: null,
      })

      const response = await analyzeScreenService(dataUrl)

      if (response.ok) {
        setAiState({
          status: 'success',
          mode: 'screen',
          screenResult: response.data,
          cursorResult: null,
          screenUnderstandingResult: null,
          errorMessage: null,
        })
        return response.data
      } else {
        setAiState({
          status: 'error',
          mode: 'screen',
          screenResult: null,
          cursorResult: null,
          screenUnderstandingResult: null,
          errorMessage: response.error,
        })
        return null
      }
    },
    []
  )

  const triggerCursorAnalysis = useCallback(
    async (params: {
      dataUrl: string
      cursorX: number
      cursorY: number
      screenWidth: number
      screenHeight: number
    }): Promise<CursorElementResult | null> => {
      setAiState({
        status: 'analyzing',
        mode: 'cursor',
        screenResult: null,
        cursorResult: null,
        screenUnderstandingResult: null,
        errorMessage: null,
      })

      const response = await analyzeCursorService(params)

      if (response.ok) {
        setAiState({
          status: 'success',
          mode: 'cursor',
          screenResult: null,
          cursorResult: response.data,
          screenUnderstandingResult: null,
          errorMessage: null,
        })
        return response.data
      } else {
        setAiState({
          status: 'error',
          mode: 'cursor',
          screenResult: null,
          cursorResult: null,
          screenUnderstandingResult: null,
          errorMessage: response.error,
        })
        return null
      }
    },
    []
  )

  const triggerScreenUnderstanding = useCallback(
    async (params: {
      dataUrl: string
      screenWidth: number
      screenHeight: number
      cursorX?: number
      cursorY?: number
    }): Promise<ScreenUnderstandingResult | null> => {
      setAiState({
        status: 'analyzing',
        mode: 'screenUnderstanding',
        screenResult: null,
        cursorResult: null,
        screenUnderstandingResult: null,
        errorMessage: null,
      })

      const response = await analyzeScreenUnderstandingService(params)

      if (response.ok) {
        setAiState({
          status: 'success',
          mode: 'screenUnderstanding',
          screenResult: null,
          cursorResult: null,
          screenUnderstandingResult: response.data,
          errorMessage: null,
        })
        return response.data
      } else {
        setAiState({
          status: 'error',
          mode: 'screenUnderstanding',
          screenResult: null,
          cursorResult: null,
          screenUnderstandingResult: null,
          errorMessage: response.error,
        })
        return null
      }
    },
    []
  )

  const reset = useCallback(() => {
    setAiState(INITIAL_STATE)
  }, [])

  return { aiState, triggerScreenAnalysis, triggerCursorAnalysis, triggerScreenUnderstanding, reset }
}

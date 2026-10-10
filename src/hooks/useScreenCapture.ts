/**
 * src/hooks/useScreenCapture.ts
 *
 * React hook that manages screen capture state.
 *
 * States:
 *   idle     — no capture attempted yet (empty state)
 *   loading  — capture in progress
 *   success  — capture succeeded, image available
 *   error    — capture failed, error message available
 */

import { useState, useCallback } from 'react'
import { capture } from '../services/screenCapture'

// ─── State shape ──────────────────────────────────────────────────────────────

export type CaptureStatus = 'idle' | 'loading' | 'success' | 'error'

export interface CaptureState {
  status: CaptureStatus
  /** Available when status === 'success' */
  result: CaptureResult | null
  /** Available when status === 'error' */
  errorMessage: string | null
  /** Unix ms of the last successful capture */
  capturedAt: number | null
}

const INITIAL_STATE: CaptureState = {
  status: 'idle',
  result: null,
  errorMessage: null,
  capturedAt: null,
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseScreenCaptureReturn {
  captureState: CaptureState
  /** Trigger a new screen capture. Returns CaptureResult or null on error / already loading. */
  triggerCapture: () => Promise<CaptureResult | null>
  /** Set capture state directly from an external CaptureResponse (e.g. keyboard shortcut). */
  setCaptureResult: (response: CaptureResponse) => void
  /** Reset back to idle (clear screenshot). */
  reset: () => void
}

export function useScreenCapture(): UseScreenCaptureReturn {
  const [captureState, setCaptureState] = useState<CaptureState>(INITIAL_STATE)

  const setCaptureResult = useCallback((response: CaptureResponse) => {
    if (response.ok) {
      setCaptureState({
        status: 'success',
        result: response.data,
        errorMessage: null,
        capturedAt: response.data.timestamp,
      })
    } else {
      setCaptureState({
        status: 'error',
        result: null,
        errorMessage: response.error,
        capturedAt: null,
      })
    }
  }, [])

  const triggerCapture = useCallback(async (): Promise<CaptureResult | null> => {
    // Guard: don't start a second capture while one is in flight
    if (captureState.status === 'loading') return null

    setCaptureState({
      status: 'loading',
      result: null,
      errorMessage: null,
      capturedAt: null,
    })

    const response = await capture()

    if (response.ok) {
      setCaptureState({
        status: 'success',
        result: response.data,
        errorMessage: null,
        capturedAt: response.data.timestamp,
      })
      return response.data
    } else {
      setCaptureState({
        status: 'error',
        result: null,
        errorMessage: response.error,
        capturedAt: null,
      })
      return null
    }
  }, [captureState.status])

  const reset = useCallback(() => {
    setCaptureState(INITIAL_STATE)
  }, [])

  return { captureState, triggerCapture, setCaptureResult, reset }
}

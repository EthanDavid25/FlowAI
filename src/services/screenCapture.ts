/**
 * src/services/screenCapture.ts
 *
 * Renderer-side Screen Capture Service
 *
 * This is the ONLY place in the renderer that calls window.flowAI.captureScreen().
 * It is a thin wrapper that:
 *  1. Calls the preload bridge
 *  2. Returns the typed CaptureResponse
 *
 * Foundation 3 will add an `analyzeCapture(result: CaptureResult)` function
 * here (or in a sibling `aiVision.ts`) — the capture pipeline stays unchanged.
 *
 * Pipeline:
 *   useScreenCapture hook
 *     → screenCaptureService.capture()   ← this file
 *       → window.flowAI.captureScreen()  ← preload bridge
 *         → ipcMain 'screen:capture'     ← electron/services/screenCapture.ts
 */

/**
 * Request a screenshot of the primary display from the main process.
 * Always resolves — never throws. Errors come back as { ok: false }.
 */
export async function capture(): Promise<CaptureResponse> {
  return window.flowAI.captureScreen()
}

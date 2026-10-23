/**
 * src/services/ai/cursorAnalysis.ts
 *
 * Renderer-side Cursor Analysis Service (Foundation 4A)
 *
 * Wraps window.flowAI cursor APIs via contextBridge IPC.
 */

/**
 * Get current desktop mouse cursor position in screen coordinates.
 */
export async function getCursorPoint(): Promise<{ x: number; y: number }> {
  return window.flowAI.getCursorPoint()
}

/**
 * Send screenshot and cursor coordinates to the local AI provider via IPC.
 * Always resolves — never throws. Errors returned as { ok: false, error: string }.
 */
export async function analyzeCursor(params: {
  dataUrl: string
  cursorX: number
  cursorY: number
  screenWidth: number
  screenHeight: number
  provider?: VisionProviderId
}): Promise<CursorAnalysisResponse> {
  return window.flowAI.analyzeCursor(params)
}

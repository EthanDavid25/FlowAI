/**
 * src/services/ai/screenUnderstanding.ts
 *
 * Renderer-side Screen Understanding Service (Foundation 4B-2)
 *
 * This is the ONLY place in the renderer that calls window.flowAI.analyzeScreenStructured().
 * Sends the captured screenshot + optional cursor coordinates to the main process via IPC.
 *
 * Pipeline:
 *   useAiAnalysis hook
 *     → screenUnderstanding.analyzeScreen(params)  ← this file
 *       → window.flowAI.analyzeScreenStructured()   ← preload bridge
 *         → ipcMain 'ai:analyzeScreen'              ← electron/main.ts
 *           → OllamaVisionProvider.analyzeScreen()  ← electron/services/ai/OllamaVisionProvider.ts
 *             → http://localhost:11434/api/chat (qwen3-vl:2b)
 *
 * Security: never calls Ollama directly. Always goes through the secure IPC bridge.
 */

/**
 * Send a captured screenshot to the structured screen understanding pipeline via Electron IPC.
 * Always resolves — never throws. Errors come back as { ok: false, error: string }.
 */
export async function analyzeScreen(params: {
  dataUrl: string
  screenWidth: number
  screenHeight: number
  cursorX?: number
  cursorY?: number
}): Promise<ScreenUnderstandingResponse> {
  return window.flowAI.analyzeScreenStructured(params)
}

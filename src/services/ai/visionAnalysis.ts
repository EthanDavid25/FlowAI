/**
 * src/services/ai/visionAnalysis.ts
 *
 * Renderer-side Vision Analysis Service
 *
 * This is the ONLY place in the renderer that calls window.flowAI.analyzeScreen().
 * Sends the captured screenshot data URL to the main process via IPC.
 *
 * Pipeline:
 *   useAiAnalysis hook
 *     → visionAnalysis.analyze(dataUrl)  ← this file
 *       → window.flowAI.analyzeScreen()  ← preload bridge
 *         → ipcMain 'ai:analyze'         ← electron/main.ts
 *           → OllamaVisionProvider       ← electron/services/ai/OllamaVisionProvider.ts
 *             → http://localhost:11434/api/chat (qwen3-vl:2b)
 */

/**
 * Send a captured screenshot (as a data URL) to the local AI provider via Electron IPC.
 * Always resolves — never throws. Errors come back as { ok: false, error: string }.
 */
export async function analyze(dataUrl: string): Promise<AnalysisResponse> {
  return window.flowAI.analyzeScreen(dataUrl)
}

/**
 * electron/services/ai/VisionProvider.ts
 *
 * Abstract interface for vision AI providers.
 *
 * Current implementation: OllamaVisionProvider (local, Foundation 3)
 * Future implementations: GeminiVisionProvider, OpenAIVisionProvider, ClaudeVisionProvider
 *
 * Adding a new provider = implement VisionProvider, register in main.ts.
 * The IPC layer, hook, and UI never need to change.
 */

// ─── Result types ─────────────────────────────────────────────────────────────

/** Successful vision analysis result. */
export interface VisionResult {
  /** The model's final response text — internal reasoning is excluded. */
  content: string
  /** Which model produced this result (e.g. "qwen3-vl:2b") */
  model: string
  /** Total tokens used, if reported by the provider. */
  totalTokens: number | null
  /** How long the analysis took in milliseconds. */
  durationMs: number
}

/** Response envelope returned from the IPC handler — never rejects. */
export type AnalysisResponse =
  | { ok: true; data: VisionResult }
  | { ok: false; error: string }

// ─── Provider interface ───────────────────────────────────────────────────────

/**
 * VisionProvider — contract that every AI vision backend must satisfy.
 *
 * imageData: raw base64 PNG (no data URL prefix).
 * prompt: the question to ask about the image.
 */
export interface VisionProvider {
  analyzeImage(imageData: string, prompt: string): Promise<AnalysisResponse>
}

/**
 * electron/services/ai/OllamaVisionProvider.ts
 *
 * Implements VisionProvider using the local Ollama API.
 *
 * API: POST http://localhost:11434/api/chat
 * Model: qwen3-vl:2b
 * Transport: Electron's net.fetch (main-process side, never renderer)
 *
 * qwen3-vl:2b note:
 *   The model may internally emit <think>…</think> blocks when thinking mode
 *   is active. We strip them before returning so the UI shows only the final
 *   response content, not internal reasoning chains.
 */

import { net } from 'electron'
import type { VisionProvider, VisionResult, AnalysisResponse } from './VisionProvider'

// ─── Configuration ────────────────────────────────────────────────────────────

const OLLAMA_BASE_URL = 'http://localhost:11434'
const OLLAMA_CHAT_ENDPOINT = `${OLLAMA_BASE_URL}/api/chat`
const MODEL = 'qwen3-vl:2b'

/** Prompt sent with every screenshot. Keep factual and screen-focused. */
const VISION_PROMPT = `Analyze this computer screenshot.

Identify:
1. The main application or website visible.
2. Important visible UI elements.
3. Readable text that is clearly visible.
4. The general layout and major sections.
5. Any obvious buttons, menus, fields, tabs, or controls.

Focus only on what is visually observable.
Do not invent information that cannot be seen.
If something is uncertain, say that it is uncertain.
Keep the response concise and useful for a desktop AI assistant.`

// ─── Ollama API types ─────────────────────────────────────────────────────────

interface OllamaMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  images?: string[]
}

interface OllamaChatRequest {
  model: string
  messages: OllamaMessage[]
  stream: false
  options?: Record<string, unknown>
}

interface OllamaChatResponse {
  model: string
  message: {
    role: string
    content: string
  }
  done: boolean
  total_duration?: number     // nanoseconds
  prompt_eval_count?: number
  eval_count?: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Strip <think>…</think> blocks that qwen3-vl emits when its built-in
 * reasoning mode is active. We want only the final answer.
 */
function stripThinkingBlocks(text: string): string {
  // Remove <think>…</think> including multiline content
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
}

/**
 * Convert nanoseconds (Ollama's duration unit) to milliseconds.
 * Returns null if the value is absent.
 */
function nanoToMs(ns: number | undefined): number | null {
  return typeof ns === 'number' ? Math.round(ns / 1_000_000) : null
}

// ─── Provider implementation ──────────────────────────────────────────────────

export class OllamaVisionProvider implements VisionProvider {
  /**
   * Send a screenshot to Ollama's qwen3-vl:2b model and return the analysis.
   *
   * @param imageData  Raw base64 PNG — no "data:image/png;base64," prefix.
   * @param prompt     The question to ask (defaults to the built-in vision prompt).
   */
  async analyzeImage(
    imageData: string,
    prompt: string = VISION_PROMPT,
  ): Promise<AnalysisResponse> {
    const startTime = Date.now()

    try {
      const requestBody: OllamaChatRequest = {
        model: MODEL,
        messages: [
          {
            role: 'user',
            content: prompt,
            images: [imageData],
          },
        ],
        stream: false,
      }

      let response: Response
      try {
        response = await net.fetch(OLLAMA_CHAT_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        })
      } catch (networkErr) {
        const msg = networkErr instanceof Error ? networkErr.message : String(networkErr)
        console.error('[OllamaVisionProvider] Network error:', msg)
        return {
          ok: false,
          error:
            'Local AI is unavailable. Make sure Ollama is running with qwen3-vl:2b.\n' +
            `(${msg})`,
        }
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        console.error('[OllamaVisionProvider] HTTP error:', response.status, body)
        return {
          ok: false,
          error: `Ollama returned an error (HTTP ${response.status}). ` +
            'Make sure qwen3-vl:2b is pulled and Ollama is running.',
        }
      }

      let parsed: OllamaChatResponse
      try {
        parsed = (await response.json()) as OllamaChatResponse
      } catch (parseErr) {
        console.error('[OllamaVisionProvider] JSON parse error:', parseErr)
        return {
          ok: false,
          error: 'Ollama returned an unexpected response format.',
        }
      }

      const rawContent = parsed.message?.content
      if (typeof rawContent !== 'string' || rawContent.trim() === '') {
        console.error('[OllamaVisionProvider] Empty content in response:', parsed)
        return {
          ok: false,
          error: 'Ollama returned an empty response. The model may still be loading.',
        }
      }

      // Strip internal reasoning blocks before surfacing to the UI
      const content = stripThinkingBlocks(rawContent)

      const totalTokens =
        typeof parsed.eval_count === 'number' && typeof parsed.prompt_eval_count === 'number'
          ? parsed.eval_count + parsed.prompt_eval_count
          : parsed.eval_count ?? parsed.prompt_eval_count ?? null

      const result: VisionResult = {
        content,
        model: parsed.model ?? MODEL,
        totalTokens,
        durationMs: nanoToMs(parsed.total_duration) ?? (Date.now() - startTime),
      }

      return { ok: true, data: result }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[OllamaVisionProvider] Unexpected error:', err)
      return {
        ok: false,
        error: `Screen analysis failed unexpectedly: ${message}`,
      }
    }
  }
}

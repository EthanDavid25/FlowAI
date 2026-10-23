/**
 * electron/services/ai/GeminiChatProvider.ts
 *
 * Implements ChatProvider using the official Google Gen AI SDK (@google/genai).
 *
 * Transport: Official Google Gen AI SDK in Electron's main process.
 * Security:
 *  - API keys are retrieved from the OS-encrypted credentialStore (or GEMINI_API_KEY env).
 *  - API keys are never logged, never exposed to the renderer, and redacted from error strings.
 *  - Runs strictly in Node.js / Electron main process.
 */

import { GoogleGenAI } from '@google/genai'
import { getCredential } from '../security/credentialStore'
import type {
  ChatProvider,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  ChatResult,
} from './ChatProvider'

const DEFAULT_MODEL = 'gemini-3.8-flash'

/**
 * Removes any potential occurrence of an API key or sensitive token from an error message.
 */
function sanitizeErrorMessage(error: unknown, apiKey?: string): string {
  let message = error instanceof Error ? error.message : String(error)

  if (apiKey && apiKey.length > 6) {
    message = message.split(apiKey).join('[REDACTED_API_KEY]')
  }

  // Also sanitize standard Google API key query parameter patterns if present in URLs
  message = message.replace(/key=[a-zA-Z0-9_\-]+/gi, 'key=[REDACTED]')

  return message
}

export class GeminiChatProvider implements ChatProvider {
  public readonly providerId = 'gemini'

  /**
   * Resolves the Gemini API key from secure credential storage with environment variable fallback.
   */
  private async resolveApiKey(): Promise<string | null> {
    try {
      const stored = await getCredential('gemini')
      if (stored.ok && stored.data && stored.data.trim().length > 0) {
        return stored.data.trim()
      }
    } catch {
      // Fall through to environment variable check
    }

    if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0) {
      return process.env.GEMINI_API_KEY.trim()
    }

    return null
  }

  /**
   * Sends conversation messages to Gemini and returns the assistant's response.
   */
  public async sendMessage(
    messages: ChatMessage[],
    options?: ChatOptions
  ): Promise<ChatResponse> {
    const startTime = Date.now()
    let activeKey: string | null = null

    try {
      if (!messages || messages.length === 0) {
        return { ok: false, error: 'Cannot send an empty message list.' }
      }

      activeKey = await this.resolveApiKey()
      if (!activeKey) {
        return {
          ok: false,
          error:
            'Gemini API key is not configured. Please add your API key in Settings (or set GEMINI_API_KEY).',
        }
      }

      const ai = new GoogleGenAI({ apiKey: activeKey })
      const model = options?.model ?? DEFAULT_MODEL

      // Separate system prompt if provided
      const systemMessages = messages.filter((m) => m.role === 'system')
      const conversationMessages = messages.filter((m) => m.role !== 'system')

      const systemInstruction =
        systemMessages.length > 0
          ? systemMessages.map((m) => m.content).join('\n\n')
          : undefined

      // Map ChatMessage[] to the format expected by @google/genai
      const contents = conversationMessages.map((msg) => {
        const parts: Array<
          | { text: string }
          | { inlineData: { mimeType: string; data: string } }
        > = []

        if (msg.content) {
          parts.push({ text: msg.content })
        }

        // If an image context was attached (e.g. screenshot data URL or raw base64)
        if (msg.imageContext) {
          let mimeType = 'image/png'
          let base64Data = msg.imageContext

          if (msg.imageContext.startsWith('data:')) {
            const matches = msg.imageContext.match(/^data:([^;]+);base64,(.+)$/)
            if (matches && matches[1] && matches[2]) {
              mimeType = matches[1]
              base64Data = matches[2]
            } else if (msg.imageContext.includes(',')) {
              base64Data = msg.imageContext.split(',')[1]
            }
          }

          parts.push({
            inlineData: {
              mimeType,
              data: base64Data,
            },
          })
        }

        return {
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts,
        }
      })

      const response = await ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
          temperature: options?.temperature,
          maxOutputTokens: options?.maxOutputTokens,
        },
      })

      const durationMs = Date.now() - startTime
      const responseText = response.text ?? ''
      const totalTokens = response.usageMetadata?.totalTokenCount ?? null

      const result: ChatResult = {
        content: responseText,
        model,
        provider: this.providerId,
        durationMs,
        totalTokens,
      }

      return { ok: true, data: result }
    } catch (err: unknown) {
      const sanitizedError = sanitizeErrorMessage(err, activeKey ?? undefined)
      console.error('[GeminiChatProvider] Error during message generation:', sanitizedError)
      return { ok: false, error: sanitizedError }
    }
  }
}

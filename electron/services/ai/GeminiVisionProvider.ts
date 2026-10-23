/**
 * electron/services/ai/GeminiVisionProvider.ts
 *
 * Implements VisionProvider using the official Google Gen AI SDK (@google/genai)
 * and the user's securely stored Gemini API key (via DPAPI safeStorage).
 *
 * Model: gemini-3.8-flash (multimodal vision + reasoning model)
 * Security:
 *  - API keys are retrieved from OS-encrypted credentialStore (or GEMINI_API_KEY env).
 *  - API keys are never logged, never exposed to the renderer, and redacted from error strings.
 *  - Runs strictly in Node.js / Electron main process.
 */

import { GoogleGenAI } from '@google/genai'
import { getCredential } from '../security/credentialStore'
import { createCursorCrop } from '../imageCrop'
import type {
  VisionProvider,
  VisionResult,
  AnalysisResponse,
  CursorGroundingResult,
  CursorAnalysisResponse,
  ScreenUnderstandingResponse,
} from './VisionProvider'
import {
  VISION_PROMPT,
  buildCursorGroundingPrompt,
  buildScreenUnderstandingPrompt,
  extractCursorResult,
  extractJSONFromText,
  parseScreenUnderstandingResult,
} from './visionHelpers'

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

export class GeminiVisionProvider implements VisionProvider {
  public readonly providerId = 'gemini'
  public readonly modelName = DEFAULT_MODEL

  /**
   * Resolves the Gemini API key from secure credential storage with environment variable fallback.
   */
  public async resolveApiKey(): Promise<string | null> {
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
   * Checks whether the provider is configured and ready to handle vision requests.
   */
  public async isConfigured(): Promise<boolean> {
    const key = await this.resolveApiKey()
    return key !== null && key.length > 0
  }

  /**
   * Foundation 3: Full-screen vision understanding (free-text description).
   */
  public async analyzeImage(
    imageData: string,
    prompt: string = VISION_PROMPT
  ): Promise<AnalysisResponse> {
    const startTime = Date.now()
    let activeKey: string | null = null

    try {
      activeKey = await this.resolveApiKey()
      if (!activeKey) {
        return {
          ok: false,
          error:
            'Gemini API key is not configured. Please add your API key in Settings (or set GEMINI_API_KEY).',
        }
      }

      // Strip data URL prefix if present to obtain pure base64
      const base64Data = imageData.includes(',') ? imageData.split(',')[1] : imageData

      const ai = new GoogleGenAI({ apiKey: activeKey })
      const response = await ai.models.generateContent({
        model: this.modelName,
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: 'image/png',
                  data: base64Data,
                },
              },
            ],
          },
        ],
        config: {
          temperature: 0.1,
          maxOutputTokens: 1024,
        },
      })

      const durationMs = Date.now() - startTime
      const content = response.text ? response.text.trim() : ''
      const totalTokens = response.usageMetadata?.totalTokenCount ?? null

      if (!content) {
        return {
          ok: false,
          error: 'Gemini Vision returned an empty response. Please try again.',
        }
      }

      const result: VisionResult = {
        content,
        model: this.modelName,
        totalTokens,
        durationMs,
      }

      return { ok: true, data: result }
    } catch (err: unknown) {
      const sanitized = sanitizeErrorMessage(err, activeKey ?? undefined)
      console.error('[GeminiVisionProvider] Error during analyzeImage:', sanitized)
      return { ok: false, error: `Gemini Vision error: ${sanitized}` }
    }
  }

  /**
   * Foundation 4B-1: Cursor-aware UI element detection.
   * Creates a local crop around the cursor and requests precise element grounding.
   */
  public async analyzeCursorElement(
    imageData: string,
    cursorX: number,
    cursorY: number,
    screenWidth: number,
    screenHeight: number
  ): Promise<CursorAnalysisResponse> {
    const startTime = Date.now()
    let activeKey: string | null = null

    try {
      activeKey = await this.resolveApiKey()
      if (!activeKey) {
        return {
          ok: false,
          error:
            'Gemini API key is not configured. Please add your API key in Settings (or set GEMINI_API_KEY).',
        }
      }

      const rawBase64 = imageData.includes(',') ? imageData.split(',')[1] : imageData

      // 1. Create a dynamic local crop centered on the cursor with visual crosshair marker
      const cropResult = createCursorCrop(rawBase64, cursorX, cursorY, 400, 300)
      const cursorNormX = Math.round(
        (cropResult.cropCursor.x / cropResult.cropRect.width) * 1000
      )
      const cursorNormY = Math.round(
        (cropResult.cropCursor.y / cropResult.cropRect.height) * 1000
      )

      console.log(
        `[GeminiVisionProvider] Local crop created: cropRect=(${cropResult.cropRect.x}, ${cropResult.cropRect.y}, ` +
        `${cropResult.cropRect.width}x${cropResult.cropRect.height}), cropCursor=(${cropResult.cropCursor.x}, ${cropResult.cropCursor.y}) -> norm=(${cursorNormX}, ${cursorNormY})`
      )

      const prompt = buildCursorGroundingPrompt(cursorNormX, cursorNormY)

      const ai = new GoogleGenAI({ apiKey: activeKey })
      const response = await ai.models.generateContent({
        model: this.modelName,
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: 'image/png',
                  data: cropResult.cropBase64,
                },
              },
            ],
          },
        ],
        config: {
          responseMimeType: 'application/json',
          temperature: 0.1,
          maxOutputTokens: 2048,
        },
      })

      const durationMs = Date.now() - startTime
      const responseText = response.text ? response.text.trim() : ''
      const totalTokens = response.usageMetadata?.totalTokenCount ?? null

      if (!responseText) {
        return {
          ok: false,
          error: 'Gemini Vision returned an empty response during cursor analysis.',
        }
      }

      const rawObj = extractJSONFromText(responseText)
      if (!rawObj) {
        console.warn('[GeminiVisionProvider] Failed to parse JSON from cursor response:', responseText)
        return {
          ok: false,
          error: 'Gemini Vision returned an unexpected format for cursor analysis.',
        }
      }

      const parsedElement = extractCursorResult(
        rawObj,
        cropResult.cropCursor,
        cropResult.cropRect
      )

      if (!parsedElement) {
        return {
          ok: false,
          error:
            'Gemini Vision analyzed the cursor area but could not identify a distinct UI element. ' +
            'Please position the cursor directly over the target element and try again.',
        }
      }

      const result: CursorGroundingResult = {
        element: parsedElement.element,
        description: parsedElement.description,
        confidence: parsedElement.confidence,
        bboxImage: parsedElement.bboxImage,
        centerImage: parsedElement.centerImage,
        bboxScreen: null, // Populated by main.ts coordinate transformer
        centerScreen: null,
        cursorScreen: { x: cursorX, y: cursorY },
        x: parsedElement.centerImage ? parsedElement.centerImage.x : cursorX,
        y: parsedElement.centerImage ? parsedElement.centerImage.y : cursorY,
        cursorX,
        cursorY,
        bbox: null,
        model: this.modelName,
        durationMs,
        totalTokens,
      }

      return { ok: true, data: result }
    } catch (err: unknown) {
      const sanitized = sanitizeErrorMessage(err, activeKey ?? undefined)
      console.error('[GeminiVisionProvider] Error during analyzeCursorElement:', sanitized)
      return { ok: false, error: `Gemini Vision error: ${sanitized}` }
    }
  }

  /**
   * Foundation 4B-2: Structured multi-element screen understanding.
   * Sends ONE request with the full screenshot and parses structured UI elements.
   */
  public async analyzeScreen(
    imageData: string,
    screenWidth: number,
    screenHeight: number,
    cursorX?: number,
    cursorY?: number
  ): Promise<ScreenUnderstandingResponse> {
    const startTime = Date.now()
    let activeKey: string | null = null

    try {
      activeKey = await this.resolveApiKey()
      if (!activeKey) {
        return {
          ok: false,
          error:
            'Gemini API key is not configured. Please add your API key in Settings (or set GEMINI_API_KEY).',
        }
      }

      const rawBase64 = imageData.includes(',') ? imageData.split(',')[1] : imageData
      const prompt = buildScreenUnderstandingPrompt()

      console.log(
        `[GeminiVisionProvider] Screen understanding request: image=${screenWidth}x${screenHeight}, ` +
        `cursor=${cursorX !== undefined ? `(${cursorX}, ${cursorY})` : 'none'}`
      )

      const ai = new GoogleGenAI({ apiKey: activeKey })
      const response = await ai.models.generateContent({
        model: this.modelName,
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: 'image/png',
                  data: rawBase64,
                },
              },
            ],
          },
        ],
        config: {
          responseMimeType: 'application/json',
          temperature: 0.1,
          maxOutputTokens: 4096,
        },
      })

      const durationMs = Date.now() - startTime
      const responseText = response.text ? response.text.trim() : ''
      const totalTokens = response.usageMetadata?.totalTokenCount ?? null

      if (!responseText) {
        return {
          ok: false,
          error: 'Gemini Vision returned an empty response during screen understanding. Please try again.',
        }
      }

      const rawObj = extractJSONFromText(responseText)
      if (!rawObj) {
        console.warn('[GeminiVisionProvider] Could not extract JSON from screen understanding response:', responseText)
        return {
          ok: false,
          error: 'Gemini Vision could not parse structured UI elements from the screenshot. Please try again.',
        }
      }

      const result = parseScreenUnderstandingResult(
        rawObj,
        screenWidth,
        screenHeight,
        cursorX,
        cursorY,
        this.modelName,
        durationMs,
        totalTokens,
        false
      )

      console.log(
        `[GeminiVisionProvider] Screen understanding complete: ` +
        `app="${result.screen.application}", elements=${result.elements.length}, ` +
        `cursorTarget=${result.cursorTarget?.type ?? 'none'}`
      )

      return { ok: true, data: result }
    } catch (err: unknown) {
      const sanitized = sanitizeErrorMessage(err, activeKey ?? undefined)
      console.error('[GeminiVisionProvider] Error during analyzeScreen:', sanitized)
      return { ok: false, error: `Gemini Vision error: ${sanitized}` }
    }
  }
}

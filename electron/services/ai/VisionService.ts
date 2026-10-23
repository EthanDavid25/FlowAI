/**
 * electron/services/ai/VisionService.ts
 *
 * Central Vision Provider Manager and Router.
 *
 * Coordinates:
 *  - Provider registration (OllamaVisionProvider, GeminiVisionProvider)
 *  - Persistent provider selection (via userData/flowai-vision-settings.json)
 *  - Provider health & readiness inspection (API key checks, local Ollama ping)
 *  - Unified routing for:
 *      * analyzeImage (Foundation 3 — free-text vision analysis)
 *      * analyzeCursorElement (Foundation 4B-1 — cursor element grounding)
 *      * analyzeScreen (Foundation 4B-2 — structured screen understanding)
 */

import { app, net } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { OllamaVisionProvider } from './OllamaVisionProvider'
import { GeminiVisionProvider } from './GeminiVisionProvider'
import type {
  VisionProvider,
  AnalysisResponse,
  CursorAnalysisResponse,
  ScreenUnderstandingResponse,
} from './VisionProvider'

export type VisionProviderId = 'ollama' | 'gemini'

export interface VisionProviderStatus {
  id: VisionProviderId
  name: string
  ready: boolean
  message: string
  model: string
}

interface VisionSettingsSchema {
  activeProvider: VisionProviderId
}

const SETTINGS_FILE_NAME = 'flowai-vision-settings.json'

export class VisionService {
  private ollamaProvider: OllamaVisionProvider
  private geminiProvider: GeminiVisionProvider
  private activeProviderId: VisionProviderId = 'gemini'
  private isInitialized = false

  constructor() {
    this.ollamaProvider = new OllamaVisionProvider()
    this.geminiProvider = new GeminiVisionProvider()
  }

  private getSettingsPath(): string {
    return join(app.getPath('userData'), SETTINGS_FILE_NAME)
  }

  /**
   * Initializes persistent settings and sets the initial active provider.
   */
  public async init(): Promise<void> {
    if (this.isInitialized) return

    try {
      const filePath = this.getSettingsPath()
      const raw = await fs.readFile(filePath, 'utf-8')
      const parsed = JSON.parse(raw) as VisionSettingsSchema
      if (parsed && (parsed.activeProvider === 'ollama' || parsed.activeProvider === 'gemini')) {
        this.activeProviderId = parsed.activeProvider
      }
    } catch {
      // Default to gemini if configured, else ollama
      const hasGemini = await this.geminiProvider.isConfigured()
      this.activeProviderId = hasGemini ? 'gemini' : 'ollama'
    }

    this.isInitialized = true
  }

  public getActiveProviderId(): VisionProviderId {
    return this.activeProviderId
  }

  public async setActiveProviderId(id: VisionProviderId): Promise<void> {
    if (id !== 'ollama' && id !== 'gemini') return
    this.activeProviderId = id

    try {
      const filePath = this.getSettingsPath()
      const data: VisionSettingsSchema = { activeProvider: id }
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')
    } catch (err) {
      console.warn('[VisionService] Failed to persist vision provider setting:', err)
    }
  }

  public getProvider(id?: VisionProviderId): VisionProvider {
    const targetId = id ?? this.activeProviderId
    return targetId === 'gemini' ? this.geminiProvider : this.ollamaProvider
  }

  /**
   * Checks the readiness status of a specific provider.
   */
  public async checkProviderStatus(id: VisionProviderId): Promise<VisionProviderStatus> {
    if (id === 'gemini') {
      const configured = await this.geminiProvider.isConfigured()
      return {
        id: 'gemini',
        name: 'Gemini Vision',
        ready: configured,
        message: configured
          ? 'Gemini 3.8 Flash ready'
          : 'Gemini API key not configured. Add your key in Settings.',
        model: this.geminiProvider.modelName,
      }
    }

    // Ollama status check
    try {
      let res: Response
      try {
        res = await net.fetch('http://localhost:11434/api/tags', {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(4000),
        })
      } catch {
        res = await net.fetch('http://127.0.0.1:11434/api/tags', {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(4000),
        })
      }

      if (!res.ok) {
        return {
          id: 'ollama',
          name: 'Ollama Vision',
          ready: false,
          message: `Ollama returned HTTP ${res.status}.`,
          model: 'qwen3-vl:2b',
        }
      }

      const data = (await res.json()) as { models?: Array<{ name: string }> }
      const models = Array.isArray(data?.models) ? data.models : []
      const hasModel = models.some((m) => m.name.toLowerCase().includes('qwen3-vl'))

      return {
        id: 'ollama',
        name: 'Ollama Vision',
        ready: hasModel,
        message: hasModel
          ? 'qwen3-vl:2b ready'
          : 'qwen3-vl:2b model not found in Ollama. Run `ollama pull qwen3-vl:2b`.',
        model: 'qwen3-vl:2b',
      }
    } catch {
      return {
        id: 'ollama',
        name: 'Ollama Vision',
        ready: false,
        message: 'Ollama service offline. Start Ollama and ensure qwen3-vl:2b is installed.',
        model: 'qwen3-vl:2b',
      }
    }
  }

  /**
   * Checks statuses of both providers.
   */
  public async getAllStatuses(): Promise<Record<VisionProviderId, VisionProviderStatus>> {
    const [geminiStatus, ollamaStatus] = await Promise.all([
      this.checkProviderStatus('gemini'),
      this.checkProviderStatus('ollama'),
    ])

    return {
      gemini: geminiStatus,
      ollama: ollamaStatus,
    }
  }

  // ── Unified Routing ─────────────────────────────────────────────────────────

  public async analyzeImage(
    imageData: string,
    prompt?: string,
    providerId?: VisionProviderId
  ): Promise<AnalysisResponse> {
    const provider = this.getProvider(providerId)
    return provider.analyzeImage(imageData, prompt)
  }

  public async analyzeCursorElement(
    imageData: string,
    cursorX: number,
    cursorY: number,
    screenWidth: number,
    screenHeight: number,
    providerId?: VisionProviderId
  ): Promise<CursorAnalysisResponse> {
    const provider = this.getProvider(providerId)
    return provider.analyzeCursorElement(imageData, cursorX, cursorY, screenWidth, screenHeight)
  }

  public async analyzeScreen(
    imageData: string,
    screenWidth: number,
    screenHeight: number,
    cursorX?: number,
    cursorY?: number,
    providerId?: VisionProviderId
  ): Promise<ScreenUnderstandingResponse> {
    const provider = this.getProvider(providerId)
    return provider.analyzeScreen(imageData, screenWidth, screenHeight, cursorX, cursorY)
  }
}

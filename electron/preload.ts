/**
 * Preload script — the ONLY bridge between the main process and the renderer.
 *
 * Rules:
 *  - contextIsolation is ON  → we use contextBridge to expose an explicit API
 *  - nodeIntegration is OFF  → renderer cannot import Node modules directly
 *  - sandbox is ON           → preload has limited Node access (ipcRenderer only)
 *
 * Extend the `window.flowAI` API here as new features are added in future
 * foundations (screen capture, AI, voice, etc.).
 */

import { contextBridge, ipcRenderer } from 'electron'

// ─── Shared types (mirrored in src/types/global.d.ts for the renderer) ────────

/** Successful screen capture data returned from the main process. */
export interface CaptureResult {
  dataUrl: string
  width: number
  height: number
  timestamp: number
}

/** IPC response envelope from the screen:capture handler. */
export type CaptureResponse =
  | { ok: true; data: CaptureResult }
  | { ok: false; error: string }

/** Successful vision analysis result from the AI provider. */
export interface VisionResult {
  content: string
  model: string
  totalTokens: number | null
  durationMs: number
}

/** IPC response envelope from the ai:analyze handler. */
export type AnalysisResponse =
  | { ok: true; data: VisionResult }
  | { ok: false; error: string }

// ─── Type definitions (also exported for use in renderer via window.flowAI) ──
export interface FlowAIBridge {
  /** App version exposed for display in the UI */
  version: string
  /** Platform string ('win32' | 'darwin' | 'linux') */
  platform: NodeJS.Platform
  /**
   * Capture the primary screen and return a CaptureResponse.
   * Resolves — never rejects; errors are returned as { ok: false }.
   */
  captureScreen: () => Promise<CaptureResponse>
  /**
   * Send a captured screenshot (as a data URL) to the local AI provider.
   * Resolves — never rejects; errors are returned as { ok: false }.
   */
  analyzeScreen: (dataUrl: string) => Promise<AnalysisResponse>
  /**
   * Generic IPC invoke — renderer calls main-process handlers by channel name.
   */
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  /**
   * Subscribe to events pushed from the main process.
   * Returns an unsubscribe function.
   */
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void
}

// ─── Allowed IPC channels (whitelist) ────────────────────────────────────────
const ALLOWED_INVOKE_CHANNELS: string[] = [
  'screen:capture',          // Foundation 2: capture primary display
  'ai:analyze',              // Foundation 3: vision AI analysis
  // Foundation 4+: 'action:execute', 'action:confirm'
]

const ALLOWED_EVENT_CHANNELS: string[] = [
  // Foundation 4+: events
]

// ─── Expose the bridge via contextBridge ─────────────────────────────────────
const api: FlowAIBridge = {
  version: process.env.npm_package_version ?? '0.1.0',
  platform: process.platform,

  captureScreen: () =>
    ipcRenderer.invoke('screen:capture') as Promise<CaptureResponse>,

  analyzeScreen: (dataUrl: string) =>
    ipcRenderer.invoke('ai:analyze', dataUrl) as Promise<AnalysisResponse>,

  invoke: (channel: string, ...args: unknown[]) => {
    if (!ALLOWED_INVOKE_CHANNELS.includes(channel)) {
      return Promise.reject(new Error(`IPC channel "${channel}" is not allowed`))
    }
    return ipcRenderer.invoke(channel, ...args)
  },

  on: (channel: string, callback: (...args: unknown[]) => void) => {
    if (!ALLOWED_EVENT_CHANNELS.includes(channel)) {
      console.warn(`[FlowAI] Event channel "${channel}" is not allowed`)
      return () => {}
    }
    const subscription = (_event: Electron.IpcRendererEvent, ...args: unknown[]) =>
      callback(...args)
    ipcRenderer.on(channel, subscription)
    // Return unsubscribe function
    return () => ipcRenderer.removeListener(channel, subscription)
  },
}

contextBridge.exposeInMainWorld('flowAI', api)

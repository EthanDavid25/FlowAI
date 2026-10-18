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

/** 2D Point in coordinate space. */
export interface Point {
  x: number
  y: number
}

/** Axis-aligned bounding box (x1, y1) to (x2, y2). */
export interface BoundingBox {
  x1: number
  y1: number
  x2: number
  y2: number
}

export type ElementBoundingBox = BoundingBox

/** Structured result for true cursor UI visual grounding (Foundation 4B-1) */
export interface CursorGroundingResult {
  element: string
  description: string
  confidence: number
  bboxImage: BoundingBox | null
  centerImage?: Point | null
  bboxScreen: BoundingBox | null
  centerScreen: Point | null
  cursorScreen: Point
  x: number
  y: number
  cursorX: number
  cursorY: number
  bbox?: BoundingBox | null
  model: string
  durationMs: number
  totalTokens?: number | null
}

export type CursorElementResult = CursorGroundingResult

/** IPC response envelope from the ai:analyzeCursor handler. */
export type CursorAnalysisResponse =
  | { ok: true; data: CursorGroundingResult }
  | { ok: false; error: string }

// ─── Foundation 4B-2: Screen Understanding types ─────────────────────────────

export type ScreenElementType =
  | 'application_window' | 'browser_tab' | 'browser_tab_close' | 'new_tab_button'
  | 'address_bar' | 'navigation_button' | 'toolbar_button' | 'search_input'
  | 'text_input' | 'button' | 'link' | 'menu' | 'menu_item' | 'sidebar'
  | 'navigation_item' | 'card' | 'list' | 'list_item' | 'table' | 'table_row'
  | 'dialog' | 'modal' | 'panel' | 'video' | 'image' | 'thumbnail' | 'text_block'
  | 'message' | 'message_bubble' | 'chat' | 'chat_row' | 'profile' | 'icon'
  | 'checkbox' | 'radio' | 'dropdown' | 'scrollbar' | 'other'

export interface ScreenElement {
  id: string
  type: ScreenElementType
  label: string
  description: string
  bbox: BoundingBox | null
  center: Point | null
  interactive: boolean
  confidence: number
  state?: string
  containsCursor?: boolean
}

export interface ScreenRegion {
  application: string
  description: string
}

export interface ScreenUnderstandingResult {
  screen: ScreenRegion
  elements: ScreenElement[]
  cursorTarget: ScreenElement | null
  model: string
  durationMs: number
  totalTokens: number | null
}

export type ScreenUnderstandingResponse =
  | { ok: true; data: ScreenUnderstandingResult }
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
   * Get current desktop mouse cursor coordinates { x, y } in screen space.
   */
  getCursorPoint: () => Promise<{ x: number; y: number }>
  /**
   * Analyze the UI element under / closest to the cursor (Foundation 4B-1).
   */
  analyzeCursor: (params: {
    dataUrl: string
    cursorX: number
    cursorY: number
    screenWidth: number
    screenHeight: number
  }) => Promise<CursorAnalysisResponse>
  /**
   * Foundation 4B-2: Structured multi-element screen understanding.
   * Returns a validated list of all detected UI/content elements plus cursor targeting.
   */
  analyzeScreenStructured: (params: {
    dataUrl: string
    screenWidth: number
    screenHeight: number
    cursorX?: number
    cursorY?: number
  }) => Promise<ScreenUnderstandingResponse>
  /**
   * Foundation 4B-1: Subscribe to global keyboard shortcut trigger.
   */
  onCursorShortcut: (callback: (payload: CursorShortcutPayload) => void) => () => void
  /**
   * Get registration status and active key combination for the cursor shortcut.
   */
  getCursorShortcutInfo: () => Promise<CursorShortcutInfo>
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

export interface CursorShortcutPayload {
  capture: CaptureResponse
  cursor: { x: number; y: number }
}

export interface CursorShortcutInfo {
  registered: boolean
  shortcut: string
  displayShortcut: string
  isFallback: boolean
  diagnostic?: string
}

// ─── Allowed IPC channels (whitelist) ────────────────────────────────────────
const ALLOWED_INVOKE_CHANNELS: string[] = [
  'screen:capture',          // Foundation 2: capture primary display
  'ai:analyze',              // Foundation 3: vision AI analysis (free-text)
  'cursor:getPoint',         // Foundation 4A: get cursor position
  'ai:analyzeCursor',        // Foundation 4B-1: analyze element at cursor
  'ai:analyzeScreen',        // Foundation 4B-2: structured screen understanding
  'cursor:getShortcutInfo',   // Global shortcut registration status & active key
]

const ALLOWED_EVENT_CHANNELS: string[] = [
  'cursor:shortcutTriggered', // Foundation 4B-1: global keyboard trigger
]

// ─── Expose the bridge via contextBridge ─────────────────────────────────────
const api: FlowAIBridge = {
  version: process.env.npm_package_version ?? '0.1.0',
  platform: process.platform,

  captureScreen: () =>
    ipcRenderer.invoke('screen:capture') as Promise<CaptureResponse>,

  analyzeScreen: (dataUrl: string) =>
    ipcRenderer.invoke('ai:analyze', dataUrl) as Promise<AnalysisResponse>,

  getCursorPoint: () =>
    ipcRenderer.invoke('cursor:getPoint') as Promise<{ x: number; y: number }>,

  analyzeCursor: (params: {
    dataUrl: string
    cursorX: number
    cursorY: number
    screenWidth: number
    screenHeight: number
  }) =>
    ipcRenderer.invoke('ai:analyzeCursor', params) as Promise<CursorAnalysisResponse>,

  analyzeScreenStructured: (params: {
    dataUrl: string
    screenWidth: number
    screenHeight: number
    cursorX?: number
    cursorY?: number
  }) =>
    ipcRenderer.invoke('ai:analyzeScreen', params) as Promise<ScreenUnderstandingResponse>,

  onCursorShortcut: (callback: (payload: CursorShortcutPayload) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      callback(payload as CursorShortcutPayload)
    }
    ipcRenderer.on('cursor:shortcutTriggered', subscription)
    return () => ipcRenderer.removeListener('cursor:shortcutTriggered', subscription)
  },

  getCursorShortcutInfo: () =>
    ipcRenderer.invoke('cursor:getShortcutInfo') as Promise<CursorShortcutInfo>,

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

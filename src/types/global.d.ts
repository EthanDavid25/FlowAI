/**
 * Global type augmentation for the renderer process.
 * The `window.flowAI` bridge is injected by the preload script via contextBridge.
 *
 * Keep in sync with the FlowAIBridge interface in electron/preload.ts.
 */

// ─── Screen capture types ─────────────────────────────────────────────────────

/** Successful screen capture data — ready for use in <img src="…"> */
interface CaptureResult {
  /** PNG image as a base64 data URL */
  dataUrl: string
  /** Captured image width in pixels */
  width: number
  /** Captured image height in pixels */
  height: number
  /** Unix epoch ms when the capture was taken */
  timestamp: number
}

/** IPC response envelope — never rejects, errors returned as { ok: false } */
type CaptureResponse =
  | { ok: true; data: CaptureResult }
  | { ok: false; error: string }

// ─── Vision AI types ──────────────────────────────────────────────────────────

/** Successful vision analysis result from the AI provider. */
interface VisionResult {
  /** Model's output content (reasoning tags stripped) */
  content: string
  /** Model identifier string */
  model: string
  /** Total tokens evaluated / generated */
  totalTokens: number | null
  /** Duration in milliseconds */
  durationMs: number
}

/** IPC response envelope for vision analysis — never rejects */
type AnalysisResponse =
  | { ok: true; data: VisionResult }
  | { ok: false; error: string }

// ─── Cursor Grounding Result Types (Foundation 4B-1) ──────────────────────────

/** 2D Point in coordinate space. */
interface Point {
  x: number
  y: number
}

/** Axis-aligned bounding box (x1, y1) to (x2, y2). */
interface BoundingBox {
  x1: number
  y1: number
  x2: number
  y2: number
}

type ElementBoundingBox = BoundingBox

/** Structured result for true cursor UI visual grounding (Foundation 4B-1) */
interface CursorGroundingResult {
  /** Identified UI element name (e.g. "search field", "browser tab", "NO_ELEMENT") */
  element: string
  /** Brief description of what the element is or does */
  description: string
  /** Confidence score between 0.0 and 1.0 */
  confidence: number
  /** Validated bounding box in screenshot image pixels (null if NO_ELEMENT) */
  bboxImage: BoundingBox | null
  /** Geometrically derived element center in screenshot image pixels (null if NO_ELEMENT) */
  centerImage?: Point | null
  /** Validated bounding box in logical screen coordinates (null if NO_ELEMENT) */
  bboxScreen: BoundingBox | null
  /** Geometrically derived element center in screen coordinates (null if NO_ELEMENT) */
  centerScreen: Point | null
  /** Exact mouse cursor position in logical screen coordinates */
  cursorScreen: Point
  /** Element center X in screen coordinates (from centerScreen, or cursorScreen if NO_ELEMENT) */
  x: number
  /** Element center Y in screen coordinates (from centerScreen, or cursorScreen if NO_ELEMENT) */
  y: number
  /** Screen cursor X */
  cursorX: number
  /** Screen cursor Y */
  cursorY: number
  /** Alias for bboxScreen */
  bbox?: BoundingBox | null
  /** Model identifier */
  model: string
  /** Duration in milliseconds */
  durationMs: number
  /** Total tokens used, if reported by the provider */
  totalTokens?: number | null
}

type CursorElementResult = CursorGroundingResult

/** IPC response envelope from cursor element analysis — never rejects */
type CursorAnalysisResponse =
  | { ok: true; data: CursorGroundingResult }
  | { ok: false; error: string }

// ─── Screen Understanding Types (Foundation 4B-2) ────────────────────────────

type ScreenElementType =
  | 'application_window' | 'browser_tab' | 'browser_tab_close' | 'new_tab_button'
  | 'address_bar' | 'navigation_button' | 'toolbar_button' | 'search_input'
  | 'text_input' | 'button' | 'link' | 'menu' | 'menu_item' | 'sidebar'
  | 'navigation_item' | 'card' | 'list' | 'list_item' | 'table' | 'table_row'
  | 'dialog' | 'modal' | 'panel' | 'video' | 'image' | 'thumbnail' | 'text_block'
  | 'message' | 'message_bubble' | 'chat' | 'chat_row' | 'profile' | 'icon'
  | 'checkbox' | 'radio' | 'dropdown' | 'scrollbar' | 'other'

/** A single detected UI/content element from screen understanding */
interface ScreenElement {
  /** Unique identifier within the result set */
  id: string
  /** Controlled element type */
  type: ScreenElementType
  /** Readable label or generic fallback */
  label: string
  /** Brief human-readable description */
  description: string
  /** Validated bounding box in image pixels (null if model failed to provide one) */
  bbox: BoundingBox | null
  /** Geometrically derived center: (x1+x2)/2, (y1+y2)/2. Never assumed equal to cursor. */
  center: Point | null
  /** Whether this element is likely interactive */
  interactive: boolean
  /** Confidence 0.0-1.0 */
  confidence: number
  /** Optional state (e.g. "active"/"inactive" for browser tabs) */
  state?: string
  /** True if cursor position is geometrically inside this element's bbox */
  containsCursor?: boolean
}

/** Metadata about the overall detected screen */
interface ScreenRegion {
  /** Detected application name, or "Unknown" */
  application: string
  /** Brief overall screen description */
  description: string
}

/** Full result from a Foundation 4B-2 screen understanding analysis */
interface ScreenUnderstandingResult {
  /** Overall screen metadata */
  screen: ScreenRegion
  /** All validated detected elements */
  elements: ScreenElement[]
  /** Smallest bbox element geometrically containing cursor, or null */
  cursorTarget: ScreenElement | null
  /** Model identifier */
  model: string
  /** Duration in milliseconds */
  durationMs: number
  /** Total tokens used */
  totalTokens: number | null
}

/** IPC response envelope for screen understanding — never rejects */
type ScreenUnderstandingResponse =
  | { ok: true; data: ScreenUnderstandingResult }
  | { ok: false; error: string }

// ─── Bridge interface ─────────────────────────────────────────────────────────

interface FlowAIBridge {
  /** App version string (e.g. "0.1.0") */
  version: string
  /** Runtime platform ('win32' | 'darwin' | 'linux') */
  platform: string
  /**
   * Capture the primary screen.
   * Always resolves — errors are returned as { ok: false, error }.
   */
  captureScreen: () => Promise<CaptureResponse>
  /**
   * Send a captured screenshot (as a data URL) to the local AI provider (Foundation 3).
   * Returns free-text vision analysis.
   * Always resolves — errors are returned as { ok: false, error }.
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
   * Foundation 4B-1: Subscribe to global keyboard shortcut (Ctrl + Shift + F) trigger.
   */
  onCursorShortcut: (callback: (payload: CursorShortcutPayload) => void) => () => void
  /** Generic IPC invoke for other channels (channel-whitelisted in preload). */
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  /** Subscribe to main-process push events. Returns unsubscribe fn. */
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void
}

interface CursorShortcutPayload {
  capture: CaptureResponse
  cursor: { x: number; y: number }
}

interface Window {
  flowAI: FlowAIBridge
}

/**
 * electron/services/ai/VisionProvider.ts
 *
 * Abstract interface for vision AI providers.
 *
 * Current implementation: OllamaVisionProvider (local, Foundation 3 & 4A & 4B-2)
 * Future implementations: GeminiVisionProvider, OpenAIVisionProvider, ClaudeVisionProvider
 *
 * Adding a new provider = implement VisionProvider, register in main.ts.
 * The IPC layer, hook, and UI never need to change.
 */

// ─── Screen Analysis Result Types (Foundation 3) ──────────────────────────────

/** Successful vision analysis result for full-screen analysis. */
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

/** Response envelope returned from full-screen IPC handler — never rejects. */
export type AnalysisResponse =
  | { ok: true; data: VisionResult }
  | { ok: false; error: string }

// ─── Cursor Grounding Result Types (Foundation 4B-1) ──────────────────────────

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

/** Backward compatibility alias. */
export type ElementBoundingBox = BoundingBox

/**
 * Structured result for true cursor UI visual grounding.
 */
export interface CursorGroundingResult {
  /** Identified UI element name / label (e.g. "search field", "browser tab", "NO_ELEMENT") */
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
  /** Which model produced this result */
  model: string
  /** How long the analysis took in milliseconds */
  durationMs: number
  /** Total tokens used, if reported by the provider */
  totalTokens?: number | null
}

/** Backward compatibility alias */
export type CursorElementResult = CursorGroundingResult

/** Response envelope returned from cursor analysis IPC handler — never rejects. */
export type CursorAnalysisResponse =
  | { ok: true; data: CursorGroundingResult }
  | { ok: false; error: string }

// ─── Screen Understanding Result Types (Foundation 4B-2) ─────────────────────

/**
 * Controlled set of UI element type strings for 4B-2 screen understanding.
 * Use "other" when no better match is available.
 */
export type ScreenElementType =
  | 'application_window'
  | 'browser_tab'
  | 'browser_tab_close'
  | 'new_tab_button'
  | 'address_bar'
  | 'navigation_button'
  | 'toolbar_button'
  | 'search_input'
  | 'text_input'
  | 'button'
  | 'link'
  | 'menu'
  | 'menu_item'
  | 'sidebar'
  | 'navigation_item'
  | 'card'
  | 'list'
  | 'list_item'
  | 'table'
  | 'table_row'
  | 'dialog'
  | 'modal'
  | 'panel'
  | 'video'
  | 'image'
  | 'thumbnail'
  | 'text_block'
  | 'message'
  | 'message_bubble'
  | 'chat'
  | 'chat_row'
  | 'profile'
  | 'icon'
  | 'checkbox'
  | 'radio'
  | 'dropdown'
  | 'scrollbar'
  | 'terminal'
  | 'command_line'
  | 'code_block'
  | 'output_area'
  | 'other'

/**
 * A single detected UI/content element in the screen understanding result.
 * All bounding boxes are in image pixel coordinates.
 * Center is always derived geometrically: (x1+x2)/2, (y1+y2)/2.
 * Never fabricated: bbox null when model cannot provide a valid one.
 */
export interface ScreenElement {
  /** Unique identifier for this element in the result set */
  id: string
  /** Controlled element type */
  type: ScreenElementType
  /** Visible label / title text (e.g. "YouTube", "Search", "Send") */
  label: string
  /** Brief human-readable description */
  description: string
  /** Bounding box in image pixel space (null if model failed to provide a valid bbox) */
  bbox: BoundingBox | null
  /** Geometrically derived center from bbox. Never assumed equal to cursor. */
  center: Point | null
  /** Whether this element is likely interactive (button, input, link, tab, etc.) */
  interactive: boolean
  /** Confidence 0.0-1.0. Never fabricated. */
  confidence: number
  /** Optional state descriptor (e.g. "active"/"inactive" for browser tabs) */
  state?: string
  /** True if the cursor position is geometrically inside this element's bbox */
  containsCursor?: boolean
}

/** Metadata about the overall screen detected */
export interface ScreenRegion {
  /** Detected application name, or "Unknown" */
  application: string
  /** Brief overall screen description */
  description: string
}

/**
 * Full result from a screen understanding analysis (Foundation 4B-2).
 */
export interface ScreenUnderstandingResult {
  /** Overall screen metadata */
  screen: ScreenRegion
  /** All validated detected elements, ordered by priority */
  elements: ScreenElement[]
  /** The element most directly under the cursor (smallest bbox containing cursor), or null */
  cursorTarget: ScreenElement | null
  /** Model identifier */
  model: string
  /** Duration in milliseconds */
  durationMs: number
  /** Total tokens used */
  totalTokens: number | null
}

/** Response envelope for screen understanding IPC handler — never rejects. */
export type ScreenUnderstandingResponse =
  | { ok: true; data: ScreenUnderstandingResult }
  | { ok: false; error: string }

// ─── Provider Interface ───────────────────────────────────────────────────────

/**
 * VisionProvider — contract that every AI vision backend must satisfy.
 */
export interface VisionProvider {
  /** Full-screen vision understanding (Foundation 3 — free-text description) */
  analyzeImage(imageData: string, prompt?: string): Promise<AnalysisResponse>

  /**
   * Cursor-aware UI element detection (Foundation 4B-1).
   * Identifies the element directly under or closest to (cursorX, cursorY).
   */
  analyzeCursorElement(
    imageData: string,
    cursorX: number,
    cursorY: number,
    screenWidth: number,
    screenHeight: number
  ): Promise<CursorAnalysisResponse>

  /**
   * Structured multi-element screen understanding (Foundation 4B-2).
   * Analyzes the full screen and returns a validated list of detected UI elements,
   * plus cursor targeting when cursor coordinates are provided.
   * ONE model request only — no per-element repeat calls.
   */
  analyzeScreen(
    imageData: string,
    screenWidth: number,
    screenHeight: number,
    cursorX?: number,
    cursorY?: number
  ): Promise<ScreenUnderstandingResponse>
}

/**
 * src/types/screenUnderstanding.ts
 *
 * Types for Foundation 4B-2 Structured Screen Understanding.
 * Mirrors the canonical types declared in electron/services/ai/VisionProvider.ts
 * and src/types/global.d.ts.
 */

export interface Point {
  x: number
  y: number
}

export interface BoundingBox {
  x1: number
  y1: number
  x2: number
  y2: number
}

export type ScreenElementType =
  | 'application_window' | 'browser_tab' | 'browser_tab_close' | 'new_tab_button'
  | 'address_bar' | 'navigation_button' | 'toolbar_button' | 'search_input'
  | 'text_input' | 'button' | 'link' | 'menu' | 'menu_item' | 'sidebar'
  | 'navigation_item' | 'card' | 'list' | 'list_item' | 'table' | 'table_row'
  | 'dialog' | 'modal' | 'panel' | 'video' | 'image' | 'thumbnail' | 'text_block'
  | 'message' | 'message_bubble' | 'chat' | 'chat_row' | 'profile' | 'icon'
  | 'checkbox' | 'radio' | 'dropdown' | 'scrollbar'
  | 'terminal' | 'command_line' | 'code_block' | 'output_area' | 'other'

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

/**
 * electron/services/ai/OllamaVisionProvider.ts
 *
 * Implements VisionProvider using the local Ollama API.
 *
 * API: POST http://localhost:11434/api/chat
 * Model: qwen3-vl:2b
 * Transport: Electron's net.fetch (main-process side, never renderer)
 *
 * Capabilities:
 *  - Foundation 3: Full-screen analysis (analyzeImage)
 *  - Foundation 4B-1: Cursor element identification (analyzeCursorElement)
 *  - Foundation 4B-2: Structured multi-element screen understanding (analyzeScreen)
 *
 * Robustness notes for qwen3-vl:2b (thinking model):
 *  - The model emits internal reasoning in message.thinking or <think> tags.
 *  - If num_predict is too low or thinking is verbose, message.content can be empty.
 *  - We check message.content, and fallback to message.thinking if needed.
 *  - We parse strict JSON first, and fallback to extracting structured UI element
 *    information from explanatory text if JSON formatting was skipped by the model.
 *  - Internal reasoning is never exposed to the UI.
 *  - The raw Ollama response is preserved in `lastRawResponse` for diagnostics.
 */

import { net } from 'electron'
import { createCursorCrop, type CropPoint, type CropRect } from '../imageCrop'
import type {
  VisionProvider,
  VisionResult,
  AnalysisResponse,
  CursorGroundingResult,
  CursorAnalysisResponse,
  BoundingBox,
  Point,
  ScreenUnderstandingResult,
  ScreenUnderstandingResponse,
  ScreenElement,
  ScreenElementType,
} from './VisionProvider'

// ─── Configuration ────────────────────────────────────────────────────────────

const OLLAMA_BASE_URL = 'http://localhost:11434'
const OLLAMA_CHAT_ENDPOINT = `${OLLAMA_BASE_URL}/api/chat`
const MODEL = 'qwen3-vl:2b'

/** Default full-screen vision prompt (Foundation 3 — free text). */
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
    thinking?: string
  }
  done: boolean
  done_reason?: string
  total_duration?: number     // nanoseconds
  prompt_eval_duration?: number // nanoseconds
  eval_duration?: number      // nanoseconds
  prompt_eval_count?: number
  eval_count?: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Strip <think>…</think> blocks that qwen3-vl emits when its built-in
 * reasoning mode is active. We want only the final answer.
 */
function stripThinkingBlocks(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
}

/**
 * Convert nanoseconds (Ollama's duration unit) to milliseconds.
 */
function nanoToMs(ns: number | undefined): number | null {
  return typeof ns === 'number' ? Math.round(ns / 1_000_000) : null
}

// ─── Local crop grounding validation (Foundation 4B-1) ───────────────────────

export interface ValidatedGroundingResult {
  element: string
  description: string
  confidence: number
  bboxImage: BoundingBox | null
  centerImage: Point | null
}

/**
 * Parses bounding box input from varied LLM output formats.
 * Supports:
 *  - Array: [x1, y1, x2, y2]
 *  - Object: { x1, y1, x2, y2 } or { xmin, ymin, xmax, ymax }
 *  - String: "[x1, y1, x2, y2]"
 */
function parseRawBbox(rawBbox: unknown): [number, number, number, number] | null {
  if (Array.isArray(rawBbox) && rawBbox.length === 4) {
    const [x1, y1, x2, y2] = rawBbox.map(Number)
    if (!isNaN(x1) && !isNaN(y1) && !isNaN(x2) && !isNaN(y2)) {
      return [x1, y1, x2, y2]
    }
  }
  if (rawBbox && typeof rawBbox === 'object') {
    const b = rawBbox as Record<string, unknown>
    const x1 = Number(b.x1 ?? b.xmin ?? b.left)
    const y1 = Number(b.y1 ?? b.ymin ?? b.top)
    const x2 = Number(b.x2 ?? b.xmax ?? b.right)
    const y2 = Number(b.y2 ?? b.ymax ?? b.bottom)
    if (!isNaN(x1) && !isNaN(y1) && !isNaN(x2) && !isNaN(y2)) {
      return [x1, y1, x2, y2]
    }
  }
  if (typeof rawBbox === 'string') {
    const m = rawBbox.match(/\[?\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*\]?/)
    if (m) {
      return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]
    }
  }
  return null
}

/**
 * Validates and maps the visual grounding result from the local cursor crop.
 *
 * Rules:
 *  1. Checks for explicit NO_ELEMENT or empty/unidentifiable regions.
 *  2. Expects normalized coordinates [0, 1000] relative to the crop.
 *  3. Verifies that the bounding box contains the marked cursor (with 25-pt tolerance in 1000-scale).
 *  4. Secondary fallback: verifies containment in crop pixel space if the model responded in pixels.
 *  5. IF cursor is NOT inside bbox:
 *     REJECTS the detection completely (returns "NO_ELEMENT", confidence 0, bboxImage null).
 *     NEVER clamps or forces coordinates to equal the cursor.
 *  6. IF cursor IS inside bbox:
 *     Converts normalized crop coordinates to screenshot image pixel coordinates
 *     and geometrically calculates the element center.
 */
function validateGroundingResult(
  rawElement: string | undefined,
  rawDesc: string | undefined,
  rawBbox: unknown,
  rawConf: unknown,
  cropCursor: CropPoint,
  cropRect: CropRect
): ValidatedGroundingResult {
  let element = typeof rawElement === 'string' && rawElement.trim() ? rawElement.trim() : 'NO_ELEMENT'
  let description = typeof rawDesc === 'string' ? rawDesc.trim() : ''

  // Handle explicit NO_ELEMENT or empty/blank regions
  const isNoElement =
    /^(?:no_element|no\s+identifiable\s+element|empty\s+area|none|no\s+element|nothing|wallpaper|background|empty\s+space|blank)$/i.test(
      element
    )
  if (isNoElement) {
    return {
      element: 'NO_ELEMENT',
      description: description || 'No distinct UI element directly under the cursor',
      confidence: 0,
      bboxImage: null,
      centerImage: null,
    }
  }

  const parsedBbox = parseRawBbox(rawBbox)
  if (!parsedBbox) {
    console.warn('[OllamaVisionProvider] Model returned no valid bounding box for element:', element)
    return {
      element: 'NO_ELEMENT',
      description: description || 'No distinct UI element with valid boundary found',
      confidence: 0,
      bboxImage: null,
      centerImage: null,
    }
  }

  let [b1, b2, b3, b4] = parsedBbox

  // Handle [0, 1] normalized float values if returned by model
  if (Math.max(b1, b2, b3, b4) <= 1.0 && Math.max(b1, b2, b3, b4) > 0) {
    b1 *= 1000
    b2 *= 1000
    b3 *= 1000
    b4 *= 1000
  }

  // Cursor in normalized 0-1000 space
  const cursorNormX = (cropCursor.x / cropRect.width) * 1000
  const cursorNormY = (cropCursor.y / cropRect.height) * 1000

  // 1. Primary check: 0-1000 normalized space with 60-point (~18px) tolerance
  const normTolerance = 60

  // Standard orientation [x1, y1, x2, y2]
  const minX_std = Math.min(b1, b3)
  const maxX_std = Math.max(b1, b3)
  const minY_std = Math.min(b2, b4)
  const maxY_std = Math.max(b2, b4)

  const containsNormStd =
    minX_std <= 1000 && maxX_std <= 1000 && minY_std <= 1000 && maxY_std <= 1000 &&
    cursorNormX >= minX_std - normTolerance &&
    cursorNormX <= maxX_std + normTolerance &&
    cursorNormY >= minY_std - normTolerance &&
    cursorNormY <= maxY_std + normTolerance &&
    maxX_std > minX_std && maxY_std > minY_std

  // Inverted orientation [y1, x1, y2, x2] (standard Qwen-VL native grounding format)
  const minX_inv = Math.min(b2, b4)
  const maxX_inv = Math.max(b2, b4)
  const minY_inv = Math.min(b1, b3)
  const maxY_inv = Math.max(b1, b3)

  const containsNormInv =
    minX_inv <= 1000 && maxX_inv <= 1000 && minY_inv <= 1000 && maxY_inv <= 1000 &&
    cursorNormX >= minX_inv - normTolerance &&
    cursorNormX <= maxX_inv + normTolerance &&
    cursorNormY >= minY_inv - normTolerance &&
    cursorNormY <= maxY_inv + normTolerance &&
    maxX_inv > minX_inv && maxY_inv > minY_inv

  // 2. Secondary check: crop pixel space in case model responded in crop pixels (tolerance 18px)
  const pixelTolerance = 18
  const containsPixelsStd =
    !containsNormStd && !containsNormInv &&
    maxX_std <= cropRect.width && maxY_std <= cropRect.height &&
    cropCursor.x >= minX_std - pixelTolerance &&
    cropCursor.x <= maxX_std + pixelTolerance &&
    cropCursor.y >= minY_std - pixelTolerance &&
    cropCursor.y <= maxY_std + pixelTolerance &&
    maxX_std > minX_std && maxY_std > minY_std

  const containsPixelsInv =
    !containsNormStd && !containsNormInv && !containsPixelsStd &&
    maxX_inv <= cropRect.width && maxY_inv <= cropRect.height &&
    cropCursor.x >= minX_inv - pixelTolerance &&
    cropCursor.x <= maxX_inv + pixelTolerance &&
    cropCursor.y >= minY_inv - pixelTolerance &&
    cropCursor.y <= maxY_inv + pixelTolerance &&
    maxX_inv > minX_inv && maxY_inv > minY_inv

  // 3. Wide continuous input controls: address_bar, search_input, text_input
  // Allow model to tightly bound visible text/icons within horizontally continuous input controls
  // as long as the cursor has genuine vertical alignment inside the control's row.
  const isInputControl =
    /address_bar|address\s*bar|omnibox|url|search_input|search\s*input|search|text_input|text\s*input|input/i.test(
      element + ' ' + description
    )

  const verticallyAlignedNormStd =
    isInputControl &&
    minX_std <= 1000 && maxX_std <= 1000 && minY_std <= 1000 && maxY_std <= 1000 &&
    cursorNormY >= minY_std - normTolerance &&
    cursorNormY <= maxY_std + normTolerance &&
    maxX_std > minX_std && maxY_std > minY_std

  const verticallyAlignedNormInv =
    isInputControl &&
    minX_inv <= 1000 && maxX_inv <= 1000 && minY_inv <= 1000 && maxY_inv <= 1000 &&
    cursorNormY >= minY_inv - normTolerance &&
    cursorNormY <= maxY_inv + normTolerance &&
    maxX_inv > minX_inv && maxY_inv > minY_inv

  const verticallyAlignedPixelsStd =
    isInputControl &&
    !containsNormStd && !containsNormInv && !verticallyAlignedNormStd && !verticallyAlignedNormInv &&
    maxX_std <= cropRect.width && maxY_std <= cropRect.height &&
    cropCursor.y >= minY_std - pixelTolerance &&
    cropCursor.y <= maxY_std + pixelTolerance &&
    maxX_std > minX_std && maxY_std > minY_std

  const verticallyAlignedPixelsInv =
    isInputControl &&
    !containsNormStd && !containsNormInv && !verticallyAlignedNormStd && !verticallyAlignedNormInv && !verticallyAlignedPixelsStd &&
    maxX_inv <= cropRect.width && maxY_inv <= cropRect.height &&
    cropCursor.y >= minY_inv - pixelTolerance &&
    cropCursor.y <= maxY_inv + pixelTolerance &&
    maxX_inv > minX_inv && maxY_inv > minY_inv

  const isValid =
    containsNormStd || containsNormInv ||
    containsPixelsStd || containsPixelsInv ||
    verticallyAlignedNormStd || verticallyAlignedNormInv ||
    verticallyAlignedPixelsStd || verticallyAlignedPixelsInv

  if (!isValid) {
    console.warn(
      `[OllamaVisionProvider] Grounding rejection: bbox [${minX_std}, ${minY_std}, ${maxX_std}, ${maxY_std}] ` +
      `does not contain cursor (norm: ${cursorNormX.toFixed(1)}, ${cursorNormY.toFixed(1)}; pixel: ${cropCursor.x}, ${cropCursor.y}). ` +
      `Rejecting detection.`
    )
    return {
      element: 'NO_ELEMENT',
      description: 'Cursor is not within any detected UI element boundary',
      confidence: 0,
      bboxImage: null,
      centerImage: null,
    }
  }

  const isInv = containsNormInv || containsPixelsInv || verticallyAlignedNormInv || verticallyAlignedPixelsInv
  const minX = isInv ? minX_inv : minX_std
  const maxX = isInv ? maxX_inv : maxX_std
  const minY = isInv ? minY_inv : minY_std
  const maxY = isInv ? maxY_inv : maxY_std
  const isNorm = containsNormStd || containsNormInv || verticallyAlignedNormStd || verticallyAlignedNormInv

  // Normalize coordinates to 0-1000
  let normX1: number
  let normY1: number
  let normX2: number
  let normY2: number

  if (isNorm) {
    normX1 = Math.max(0, Math.min(minX, 1000))
    normY1 = Math.max(0, Math.min(minY, 1000))
    normX2 = Math.max(0, Math.min(maxX, 1000))
    normY2 = Math.max(0, Math.min(maxY, 1000))
  } else {
    // Convert from crop pixels to 0-1000
    normX1 = (Math.max(0, Math.min(minX, cropRect.width)) / cropRect.width) * 1000
    normY1 = (Math.max(0, Math.min(minY, cropRect.height)) / cropRect.height) * 1000
    normX2 = (Math.max(0, Math.min(maxX, cropRect.width)) / cropRect.width) * 1000
    normY2 = (Math.max(0, Math.min(maxY, cropRect.height)) / cropRect.height) * 1000
  }

  // Convert normalized crop coordinates to screenshot pixel coordinates
  const cropPixelX1 = (normX1 / 1000) * cropRect.width
  const cropPixelY1 = (normY1 / 1000) * cropRect.height
  const cropPixelX2 = (normX2 / 1000) * cropRect.width
  const cropPixelY2 = (normY2 / 1000) * cropRect.height

  const bboxImageX1 = Math.round(cropRect.x + cropPixelX1)
  const bboxImageY1 = Math.round(cropRect.y + cropPixelY1)
  const bboxImageX2 = Math.round(cropRect.x + cropPixelX2)
  const bboxImageY2 = Math.round(cropRect.y + cropPixelY2)

  const bboxImage: BoundingBox = {
    x1: bboxImageX1,
    y1: bboxImageY1,
    x2: bboxImageX2,
    y2: bboxImageY2,
  }

  const centerImage: Point = {
    x: Math.round((bboxImageX1 + bboxImageX2) / 2),
    y: Math.round((bboxImageY1 + bboxImageY2) / 2),
  }

  let confidence = typeof rawConf === 'number' && !isNaN(rawConf) ? rawConf : 0.85
  if (confidence > 1 && confidence <= 100) confidence = confidence / 100
  confidence = Math.max(0.1, Math.min(1.0, confidence))

  // Clean up generic placeholder names
  if (
    /^(?:cursor\s+element\s+detected|ui\s+element\s+detected|ui\s+element|element|<name.*>|unknown\s+element|screen\s+element|unknown\s+ui)$/i.test(
      element
    )
  ) {
    if (/google\s+search/i.test(description)) {
      element = 'Google search field'
    } else if (/search/i.test(description)) {
      element = 'Search input'
    } else if (/address\s*bar|omnibox|url/i.test(description)) {
      element = 'Browser address bar'
    } else if (/notification/i.test(description)) {
      element = 'Notification button'
    } else if (/video|thumbnail/i.test(description)) {
      element = 'Video thumbnail'
    } else if (/tab/i.test(description)) {
      element = 'Browser tab'
    } else if (/button/i.test(description)) {
      element = 'Button'
    } else if (/message/i.test(description)) {
      element = 'Message'
    } else if (/text/i.test(description)) {
      element = 'Text block'
    } else if (/card/i.test(description)) {
      element = 'Card'
    } else if (/icon/i.test(description)) {
      element = 'Icon'
    } else if (/link/i.test(description)) {
      element = 'Link'
    } else {
      element = 'UI element under cursor'
    }
  }

  return {
    element,
    description: description || 'UI element under cursor',
    confidence: Math.round(confidence * 100) / 100,
    bboxImage,
    centerImage,
  }
}

/**
 * Robust cursor result extractor for the local cursor crop.
 * Inspects both `message.content` and `message.thinking`.
 *
 * 1. Tries to extract strict JSON: { "element": "...", "description": "...", "bbox": [...], "confidence": ... }
 * 2. Validates that the returned bounding box contains the cursor.
 * 3. Fallback: handles explicit NO_ELEMENT natural language in content/thinking.
 */
function extractCursorResult(
  parsed: OllamaChatResponse,
  cropCursor: CropPoint,
  cropRect: CropRect
): ValidatedGroundingResult | null {
  const content = typeof parsed.message?.content === 'string' ? parsed.message.content : ''
  const thinking = typeof parsed.message?.thinking === 'string' ? parsed.message.thinking : ''

  // Prioritize content, then thinking
  const candidates: string[] = []
  if (content.trim()) candidates.push(content.trim())
  if (thinking.trim()) candidates.push(thinking.trim())

  if (candidates.length === 0) {
    return null
  }

  // 1. Try to find a valid JSON object in candidate strings
  for (const src of candidates) {
    const clean = stripThinkingBlocks(src)

    const blocks: string[] = []
    const codeBlockMatch = (clean || src).match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
    if (codeBlockMatch) blocks.push(codeBlockMatch[1])
    if (clean) blocks.push(clean)
    blocks.push(src)

    for (let text of blocks) {
      text = text.trim().replace(/```(?:json)?/gi, '').replace(/```/g, '').trim()

      let firstBrace = text.indexOf('{')
      // If assistant prefill was used and model continued after `{`
      if (firstBrace === -1 && (text.includes('"element"') || text.includes('"description"') || text.includes('"bbox"'))) {
        text = '{\n' + text
        firstBrace = text.indexOf('{')
      }

      const lastBrace = text.lastIndexOf('}')
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        try {
          const p = JSON.parse(text.slice(firstBrace, lastBrace + 1))
          const rawElement = p.element ?? p.name ?? p.label ?? p.ui_element ?? p.target
          if (p && typeof p === 'object' && typeof rawElement === 'string') {
            return validateGroundingResult(
              rawElement,
              p.description,
              p.bbox,
              p.confidence,
              cropCursor,
              cropRect
            )
          }
        } catch {
          // continue looking
        }
      }
    }
  }

  // 2. Fallback: Check if model stated no identifiable element in prose
  const combinedText = candidates.join('\n')
  if (
    /NO_ELEMENT|no identifiable element|empty area|nothing under cursor|blank space|background|wallpaper/i.test(
      combinedText
    )
  ) {
    return {
      element: 'NO_ELEMENT',
      description: 'No distinct UI element directly under the cursor',
      confidence: 0,
      bboxImage: null,
      centerImage: null,
    }
  }

  return null
}

// ─── Foundation 4B-2: Screen Understanding helpers ───────────────────────────

/** All valid ScreenElementType values — used for normalization/validation */
const VALID_ELEMENT_TYPES: ReadonlySet<ScreenElementType> = new Set<ScreenElementType>([
  'application_window', 'browser_tab', 'browser_tab_close', 'new_tab_button',
  'address_bar', 'navigation_button', 'toolbar_button', 'search_input',
  'text_input', 'button', 'link', 'menu', 'menu_item', 'sidebar',
  'navigation_item', 'card', 'list', 'list_item', 'table', 'table_row',
  'dialog', 'modal', 'panel', 'video', 'image', 'thumbnail', 'text_block',
  'message', 'message_bubble', 'chat', 'chat_row', 'profile', 'icon',
  'checkbox', 'radio', 'dropdown', 'scrollbar', 'terminal',
  'command_line', 'code_block', 'output_area', 'other',
])

/** Interactive element types — used to set the interactive flag */
const INTERACTIVE_TYPES: ReadonlySet<ScreenElementType> = new Set<ScreenElementType>([
  'browser_tab', 'browser_tab_close', 'new_tab_button', 'address_bar',
  'navigation_button', 'toolbar_button', 'search_input', 'text_input',
  'button', 'link', 'menu', 'menu_item', 'navigation_item', 'list_item',
  'table_row', 'icon', 'checkbox', 'radio', 'dropdown', 'scrollbar',
  'chat_row', 'profile', 'terminal', 'command_line',
])

/**
 * Normalize a raw type string from the model to a valid ScreenElementType.
 * Applies fuzzy matching for common variants. Falls back to 'other'.
 */
function normalizeElementType(raw: unknown): ScreenElementType {
  if (typeof raw !== 'string') return 'other'
  const s = raw.trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (VALID_ELEMENT_TYPES.has(s as ScreenElementType)) return s as ScreenElementType

  // Fuzzy mapping for common model variants
  if (s.includes('browser_tab') || s === 'tab') return 'browser_tab'
  if (s.includes('tab_close') || s.includes('close_tab')) return 'browser_tab_close'
  if (s.includes('new_tab') || s.includes('newtab')) return 'new_tab_button'
  if (s.includes('address') || s.includes('url') || s.includes('omnibox')) return 'address_bar'
  if (s.includes('search_input') || s.includes('search_box') || s.includes('search_field')) return 'search_input'
  if (s.includes('search')) return 'search_input'
  if (s.includes('text_input') || s.includes('input_field') || s.includes('textfield') || s.includes('text_field')) return 'text_input'
  if (s.includes('input')) return 'text_input'
  if (s.includes('nav_button') || s.includes('navigation_button') || s.includes('back_button') || s.includes('forward_button') || s.includes('reload')) return 'navigation_button'
  if (s.includes('toolbar_button') || s.includes('toolbar')) return 'toolbar_button'
  if (s.includes('sidebar')) return 'sidebar'
  if (s.includes('navigation_item') || s.includes('nav_item')) return 'navigation_item'
  if (s.includes('menu_item')) return 'menu_item'
  if (s.includes('menu')) return 'menu'
  if (s.includes('terminal') || s.includes('cmd') || s.includes('powershell') || s.includes('console_window') || s.includes('command_prompt')) return 'terminal'
  if (s.includes('command_line') || s.includes('cli_command') || s.includes('prompt_line') || s.includes('command')) return 'command_line'
  if (s.includes('code_block') || s.includes('code_editor') || s.includes('code') || s.includes('syntax')) return 'code_block'
  if (s.includes('output_area') || s.includes('terminal_output') || s.includes('console_output') || s.includes('stdout') || s.includes('stderr') || s.includes('output')) return 'output_area'
  if (s.includes('chat_row') || s.includes('conversation_item')) return 'chat_row'
  if (s.includes('chat') || s.includes('conversation_list')) return 'chat'
  if (s.includes('message_bubble') || s.includes('msg_bubble')) return 'message_bubble'
  if (s.includes('message')) return 'message'
  if (s.includes('thumbnail')) return 'thumbnail'
  if (s.includes('video')) return 'video'
  if (s.includes('card')) return 'card'
  if (s.includes('list_item') || s.includes('listitem')) return 'list_item'
  if (s.includes('list')) return 'list'
  if (s.includes('table_row') || s.includes('tablerow')) return 'table_row'
  if (s.includes('table')) return 'table'
  if (s.includes('dialog')) return 'dialog'
  if (s.includes('modal')) return 'modal'
  if (s.includes('panel')) return 'panel'
  if (s.includes('link') || s.includes('hyperlink') || s.includes('anchor')) return 'link'
  if (s.includes('shortcut') || s.includes('bookmark') || s.includes('tile')) return 'button'
  if (s.includes('button') || s.includes('btn')) return 'button'
  if (s.includes('checkbox') || s.includes('check_box')) return 'checkbox'
  if (s.includes('radio')) return 'radio'
  if (s.includes('dropdown') || s.includes('select') || s.includes('combobox')) return 'dropdown'
  if (s.includes('scrollbar') || s.includes('scroll_bar')) return 'scrollbar'
  if (s.includes('profile') || s.includes('avatar')) return 'profile'
  if (s.includes('icon')) return 'icon'
  if (s.includes('image') || s.includes('img')) return 'image'
  if (s.includes('text') || s.includes('heading') || s.includes('label') || s.includes('paragraph')) return 'text_block'
  if (s.includes('window') || s.includes('app')) return 'application_window'

  return 'other'
}

/**
 * Validate a raw element bbox from the screen understanding model response.
 * Coordinates may be in image pixels or normalized [0,1] / [0,1000].
 * Returns a valid BoundingBox in image pixels, or null if invalid.
 *
 * Rules:
 *  - x2 > x1, y2 > y1
 *  - No negative coordinates
 *  - Must stay within image bounds (clamped for minor rounding only)
 *  - Minimum size: 4x4 pixels
 *  - No completely degenerate boxes
 */
function validateScreenElementBbox(
  rawBbox: unknown,
  imageWidth: number,
  imageHeight: number,
  type?: ScreenElementType
): BoundingBox | null {
  const parsed = parseRawBbox(rawBbox)
  if (!parsed) return null

  let [a, b, c, d] = parsed

  // Detect normalized [0,1] coordinates — scale to pixels
  if (Math.max(a, b, c, d) <= 1.01 && Math.max(a, b, c, d) > 0) {
    a = a * imageWidth
    b = b * imageHeight
    c = c * imageWidth
    d = d * imageHeight
  }
  // Detect Qwen-VL style [0,1000] — scale to pixels
  else if (Math.max(a, b, c, d) <= 1001 && Math.max(a, b, c, d) > 1) {
    // Check if wide horizontal control was emitted in [ymin, xmin, ymax, xmax] format
    const isHorizontallyWide = type === 'address_bar' || type === 'browser_tab' || type === 'search_input'
    const standardWidth = Math.abs(c - a)
    const standardHeight = Math.abs(d - b)

    if (isHorizontallyWide && standardHeight > standardWidth * 2) {
      // Swapped format: a=ymin, b=xmin, c=ymax, d=xmax
      const ymin = (Math.min(a, c) / 1000) * imageHeight
      const ymax = (Math.max(a, c) / 1000) * imageHeight
      const xmin = (Math.min(b, d) / 1000) * imageWidth
      const xmax = (Math.max(b, d) / 1000) * imageWidth
      return {
        x1: Math.round(Math.max(0, Math.min(imageWidth, xmin))),
        y1: Math.round(Math.max(0, Math.min(imageHeight, ymin))),
        x2: Math.round(Math.max(0, Math.min(imageWidth, xmax))),
        y2: Math.round(Math.max(0, Math.min(imageHeight, ymax))),
      }
    }

    a = (a / 1000) * imageWidth
    b = (b / 1000) * imageHeight
    c = (c / 1000) * imageWidth
    d = (d / 1000) * imageHeight
  }
  // Otherwise treat as image pixels

  // Determine x1, y1, x2, y2 regardless of order
  let x1 = Math.min(a, c)
  let y1 = Math.min(b, d)
  let x2 = Math.max(a, c)
  let y2 = Math.max(b, d)

  // Clamp to image bounds (minor rounding tolerance only: 2px)
  x1 = Math.max(0, x1)
  y1 = Math.max(0, y1)
  x2 = Math.min(imageWidth, x2)
  y2 = Math.min(imageHeight, y2)

  // Reject invalid: degenerate or too small
  if (x2 <= x1 || y2 <= y1) return null
  if ((x2 - x1) < 4 || (y2 - y1) < 4) return null

  // Reject if outside image entirely
  if (x1 >= imageWidth || y1 >= imageHeight || x2 <= 0 || y2 <= 0) return null

  return {
    x1: Math.round(x1),
    y1: Math.round(y1),
    x2: Math.round(x2),
    y2: Math.round(y2),
  }
}

/**
 * Determine whether the cursor point is geometrically inside a bounding box.
 */
function cursorInsideBbox(cursorX: number, cursorY: number, bbox: BoundingBox): boolean {
  return (
    cursorX >= bbox.x1 &&
    cursorX <= bbox.x2 &&
    cursorY >= bbox.y1 &&
    cursorY <= bbox.y2
  )
}

/**
 * Area of a bounding box.
 */
function bboxArea(bbox: BoundingBox): number {
  return (bbox.x2 - bbox.x1) * (bbox.y2 - bbox.y1)
}

/**
 * Intersection over Union (IoU) of two bounding boxes.
 */
function bboxIoU(b1: BoundingBox, b2: BoundingBox): number {
  const interX1 = Math.max(b1.x1, b2.x1)
  const interY1 = Math.max(b1.y1, b2.y1)
  const interX2 = Math.min(b1.x2, b2.x2)
  const interY2 = Math.min(b1.y2, b2.y2)

  if (interX2 <= interX1 || interY2 <= interY1) return 0

  const interArea = (interX2 - interX1) * (interY2 - interY1)
  const area1 = (b1.x2 - b1.x1) * (b1.y2 - b1.y1)
  const area2 = (b2.x2 - b2.x1) * (b2.y2 - b2.y1)
  const unionArea = area1 + area2 - interArea

  return unionArea > 0 ? interArea / unionArea : 0
}

/**
 * Attempt to salvage truncated JSON when the model runs out of tokens (num_predict limit).
 * If the response has `elements: [ { ... }, { ... ` and cuts off,
 * this function finds the last complete element object and closes the array and object.
 */
function salvageTruncatedJSON(text: string): unknown | null {
  let jsonText = text.trim()
  if (!jsonText.startsWith('{')) {
    jsonText = '{\n' + jsonText
  }

  const elementsIdx = jsonText.indexOf('"elements"')
  if (elementsIdx === -1) return null

  // Find last `}` that closes an element inside `elements`
  const lastElementClose = jsonText.lastIndexOf('}')
  if (lastElementClose > elementsIdx) {
    const candidate = jsonText.slice(0, lastElementClose + 1) + '\n  ]\n}'
    try {
      const obj = JSON.parse(candidate)
      if (obj && typeof obj === 'object') return obj
    } catch {
      // Continue to next recovery attempt
    }
  }

  return null
}

/**
 * Extract a JSON object representing the screen understanding result from Ollama response.
 * Inspects both content and thinking, handles assistant prefill continuations,
 * fenced code blocks, bare JSON, and truncated token limits.
 * Returns null if nothing parseable is found.
 */
function extractScreenUnderstandingJSON(response: OllamaChatResponse): unknown | null {
  const content = typeof response.message?.content === 'string' ? response.message.content : ''
  const thinking = typeof response.message?.thinking === 'string' ? response.message.thinking : ''

  const rawCandidates: string[] = []
  if (content.trim()) {
    rawCandidates.push(content.trim())
    // In case model continued from assistant prefill without leading `{`
    if (!content.trim().startsWith('{')) {
      rawCandidates.push('{\n' + content.trim())
    }
  }
  if (thinking.trim()) {
    rawCandidates.push(thinking.trim())
    if (!thinking.trim().startsWith('{')) {
      rawCandidates.push('{\n' + thinking.trim())
    }
  }

  if (rawCandidates.length === 0) return null

  for (const src of rawCandidates) {
    const clean = stripThinkingBlocks(src)

    const blocks: string[] = []
    const codeBlockMatch = (clean || src).match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
    if (codeBlockMatch) {
      blocks.push(codeBlockMatch[1])
      if (!codeBlockMatch[1].trim().startsWith('{')) {
        blocks.push('{\n' + codeBlockMatch[1].trim())
      }
    }
    if (clean) blocks.push(clean)
    blocks.push(src)

    for (let text of blocks) {
      text = text.trim().replace(/```(?:json)?/gi, '').replace(/```/g, '').trim()

      let firstBrace = text.indexOf('{')
      if (firstBrace === -1 && (text.includes('"screen"') || text.includes('"elements"') || text.includes('"application"'))) {
        text = '{\n' + text
        firstBrace = text.indexOf('{')
      }

      const lastBrace = text.lastIndexOf('}')
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        const slice = text.slice(firstBrace, lastBrace + 1)
        try {
          const obj = JSON.parse(slice)
          if (obj && typeof obj === 'object') return obj
        } catch {
          const salvaged = salvageTruncatedJSON(slice)
          if (salvaged) return salvaged
        }
      } else if (firstBrace !== -1) {
        const salvaged = salvageTruncatedJSON(text.slice(firstBrace))
        if (salvaged) return salvaged
      }
    }
  }

  return null
}

/**
 * Parse and validate the raw JSON object from the model into a ScreenUnderstandingResult.
 *
 * Validation rules:
 *  - Every element must have a valid bbox (invalid bbox = element dropped, not fabricated)
 *  - Centers are always derived geometrically from validated bboxes
 *  - Confidence is clamped to [0.1, 1.0]
 *  - Element type is normalized to controlled vocabulary
 *  - Degenerate/tiny boxes are rejected
 *  - Cursor containment is computed geometrically
 *  - Cursor target = smallest bbox element containing cursor
 */
function parseScreenUnderstandingResult(
  rawObj: unknown,
  imageWidth: number,
  imageHeight: number,
  cursorX: number | undefined,
  cursorY: number | undefined,
  model: string,
  durationMs: number,
  totalTokens: number | null,
  truncated?: boolean
): ScreenUnderstandingResult {
  const EMPTY_RESULT: ScreenUnderstandingResult = {
    screen: { application: 'Unknown', description: 'No meaningful UI elements confidently identified.' },
    elements: [],
    cursorTarget: null,
    model,
    durationMs,
    totalTokens,
    truncated: Boolean(truncated),
  }

  if (!rawObj || typeof rawObj !== 'object') return EMPTY_RESULT

  const raw = rawObj as Record<string, unknown>

  // Parse screen metadata
  const screenRaw = raw.screen as Record<string, unknown> | undefined
  const screenApp = typeof screenRaw?.application === 'string' && screenRaw.application.trim()
    ? screenRaw.application.trim()
    : 'Unknown'
  const screenDesc = typeof screenRaw?.description === 'string' && screenRaw.description.trim()
    ? screenRaw.description.trim()
    : 'Screen analyzed.'

  // Parse elements array
  const rawElements = Array.isArray(raw.elements) ? raw.elements : []
  const validatedElements: ScreenElement[] = []

  let elementIndex = 0
  for (const rawEl of rawElements) {
    if (!rawEl || typeof rawEl !== 'object') continue
    const el = rawEl as Record<string, unknown>

    const type = normalizeElementType(el.type)
    const label = typeof el.label === 'string' && el.label.trim() ? el.label.trim() : 'Element'
    const description = typeof el.description === 'string' ? el.description.trim() : ''

    // Validate bbox — if invalid, skip this element (never fabricate)
    const bbox = validateScreenElementBbox(el.bbox ?? el.bounding_box ?? el.bounds ?? el.box, imageWidth, imageHeight, type)
    if (!bbox) {
      console.log(`[OllamaVisionProvider] Screen element #${elementIndex} "${label}" (${type}) has invalid bbox — skipped`)
      elementIndex++
      continue
    }

    // Derive center geometrically from bbox — NEVER from cursor
    const center: Point = {
      x: Math.round((bbox.x1 + bbox.x2) / 2),
      y: Math.round((bbox.y1 + bbox.y2) / 2),
    }

    // Normalize confidence
    let confidence = typeof el.confidence === 'number' && !isNaN(el.confidence) ? el.confidence : 0.80
    if (confidence > 1 && confidence <= 100) confidence = confidence / 100
    confidence = Math.max(0.1, Math.min(1.0, Math.round(confidence * 100) / 100))

    // Interactive flag: prefer model's value, fall back to type-based
    const interactiveRaw = el.interactive
    const interactive =
      typeof interactiveRaw === 'boolean'
        ? interactiveRaw
        : INTERACTIVE_TYPES.has(type)

    // State (e.g. "active"/"inactive" for tabs)
    const state = typeof el.state === 'string' && el.state.trim() ? el.state.trim() : undefined

    // Cursor containment — computed geometrically only
    const containsCursor =
      cursorX !== undefined && cursorY !== undefined
        ? cursorInsideBbox(cursorX, cursorY, bbox)
        : undefined

    // ID
    const id = typeof el.id === 'string' && el.id.trim()
      ? el.id.trim()
      : `element-${elementIndex + 1}`

    validatedElements.push({
      id,
      type,
      label,
      description,
      bbox,
      center,
      interactive,
      confidence,
      state,
      containsCursor,
    })
    elementIndex++
  }

  // Deduplicate overlapping elements (IoU > 0.85) keeping the higher-confidence detection
  const finalElements: ScreenElement[] = []
  for (const el of validatedElements) {
    if (!el.bbox) continue
    const dupIndex = finalElements.findIndex(
      (existing) => existing.bbox && bboxIoU(existing.bbox, el.bbox!) > 0.85
    )
    if (dupIndex === -1) {
      finalElements.push(el)
    } else if (el.confidence > finalElements[dupIndex].confidence) {
      finalElements[dupIndex] = el
    }
  }

  // Determine cursor target: smallest bbox element that contains cursor
  let cursorTarget: ScreenElement | null = null
  if (cursorX !== undefined && cursorY !== undefined) {
    let smallestArea = Infinity
    for (const el of finalElements) {
      if (el.containsCursor && el.bbox) {
        const area = bboxArea(el.bbox)
        if (area < smallestArea) {
          smallestArea = area
          cursorTarget = el
        }
      }
    }
  }

  return {
    screen: { application: screenApp, description: screenDesc },
    elements: finalElements,
    cursorTarget,
    model,
    durationMs,
    totalTokens,
    truncated: Boolean(truncated),
  }
}

// ─── Screen understanding prompt (Foundation 4B-2) ───────────────────────────

/**
 * Builds the structured screen understanding prompt.
 * Instructs the model to analyze the entire visible screen and return
 * a JSON document with screen metadata and an elements array.
 *
 * Performance notes for qwen3-vl:2b:
 *  - Prompt is intentionally concise to reduce input token overhead.
 *  - num_predict is capped to keep output bounded.
 *  - ONE request only — no per-element follow-up requests.
 */
function buildScreenUnderstandingPrompt(): string {
  return `You are a precision computer vision system for desktop screen and UI understanding.
Perform a systematic scan of this entire computer screenshot, understanding the active applications, visible content, and key controls.

SCAN REGIONS & APPLICATION TYPES TO COVER:
1. Browser Interfaces & Web Content:
   - Window title bar, controls, and browser tabs (type "browser_tab", state "active" or "inactive", label with tab title).
   - Tab controls ("new_tab_button", "browser_tab_close"), navigation buttons ("navigation_button"), address bar ("address_bar").
   - Bookmarks, search fields ("search_input"), text inputs ("text_input"), action buttons ("button"), navigation links ("link").
   - Website shortcuts/tiles or content cards: identify prominent shortcuts or cards individually ("button" or "icon").
2. Terminals, Command Prompts & Consoles (CMD, PowerShell, Bash):
   - Terminal window or container ("terminal").
   - Active command line prompt and any typed/executed commands ("command_line", label with the command text if visible).
   - Command output, compilation logs, execution traces, or status text ("output_area").
   - Distinct error messages, warnings, or failure notices ("output_area" or "text_block", label with error summary).
3. Code Editors & Development Tools:
   - Editor panes and code blocks ("code_block").
   - File trees and sidebars ("sidebar", "navigation_item"), editor tabs ("browser_tab"), status bars ("panel").
4. Media Players & Audio/Video Streaming (e.g. Spotify, music players, streaming apps):
   - Player window, navigation, and library sidebars ("sidebar", "navigation_item").
   - Playback bar and controls: Play/Pause button ("button" or "icon", state "active" or "inactive"), previous/next track buttons ("button" or "icon"), shuffle/repeat buttons ("button" or "icon").
   - Playback timeline or seek bar ("scrollbar" or "panel", description with current progress or duration if visible), volume controls ("button" or "icon").
   - Currently playing track information: track title, artist name, and album text ("text_block"), album artwork ("thumbnail" or "image").
   - Search inputs ("search_input"), playlist items, song list rows, or library links ("navigation_item", "list_item", "link").
5. Other Desktop Applications & Dialogs:
   - Dialogs ("dialog"), message bubbles ("message_bubble"), panels ("panel"), buttons ("button"), and visible content.

RULES:
1. SCREEN SUMMARY: Provide an accurate, factual summary in screen.description of what the user is doing and the observable state of the window (e.g. playing/paused media in a music player, running commands in a terminal, viewing a website, encountering an error, editing a file). Distinguish clearly between visible facts and uncertainty. Never invent commands, playback states, actions, or results not visible in the screenshot.
2. ELEMENT LIMIT: Prioritize the 10 to 12 most important or prominent elements on screen to fit within output limits.
3. BOUNDING BOXES: Normalized [x1, y1, x2, y2] from 0 to 1000 where (0,0) is top-left and (1000,1000) is bottom-right.
   - x1 (left), y1 (top), x2 (right), y2 (bottom) with x1 < x2 and y1 < y2.
   - Keep bounding boxes tight around individual elements or distinct functional sections.
4. LABELS: Use readable visible text for labels. For media controls, use the visible control action or track/artist name (e.g. "Play/Pause", "Next track", "Track: Song Title"). For CLI commands, use the visible command text (e.g. "git status", "npm run build"). For errors, include the error label (e.g. "Error: Cannot find module"). For recognizable apps/icons, use the recognizable name.
5. DESCRIPTIONS: Keep each element's "description" concise (under 15 words), capturing its visible content, role, or execution state (e.g. "Completed with exit code 0", "Active prompt waiting for user input", "Error stack trace").
6. NO FABRICATION & NO DUPLICATES: Only detect genuinely visible elements. Do not duplicate elements for the same visual control. Do not return mouse cursor or crosshair.
7. VALID JSON ONLY: Return strictly valid JSON following the schema below with no text outside the JSON.

ELEMENT TYPES (use exactly one):
application_window, browser_tab, browser_tab_close, new_tab_button,
address_bar, navigation_button, toolbar_button, search_input, text_input,
terminal, command_line, code_block, output_area,
button, link, menu, menu_item, sidebar, navigation_item, card, list, list_item,
table, table_row, dialog, modal, panel, video, image, thumbnail, text_block,
message, message_bubble, chat, chat_row, profile, icon, checkbox, radio,
dropdown, scrollbar, other

Return ONLY this JSON structure:
{
  "screen": {
    "application": "<app name or Unknown>",
    "description": "<factual summary of visible screen state and context>"
  },
  "elements": [
    {
      "id": "element-1",
      "type": "<element_type>",
      "label": "<visible label or command>",
      "description": "<brief description under 15 words>",
      "bbox": [x1, y1, x2, y2],
      "interactive": true,
      "confidence": 0.90,
      "state": "active"
    }
  ]
}`
}

// ─── Provider implementation ──────────────────────────────────────────────────

export class OllamaVisionProvider implements VisionProvider {
  /** Preserved raw response from the most recent Ollama request for diagnostics. */
  public lastRawResponse: unknown = null

  /**
   * Send a screenshot to Ollama's qwen3-vl:2b model for full-screen analysis (Foundation 3).
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
        options: {
          num_predict: 1024,
          temperature: 0.1,
        },
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
        this.lastRawResponse = parsed
      } catch (parseErr) {
        console.error('[OllamaVisionProvider] JSON parse error:', parseErr)
        return {
          ok: false,
          error: 'Ollama returned an unexpected response format.',
        }
      }

      console.log(
        `[OllamaVisionProvider] Diagnostic (Screen): status=${response.status}, ` +
        `content_len=${parsed.message?.content?.length || 0}, ` +
        `thinking_len=${parsed.message?.thinking?.length || 0}, ` +
        `done_reason=${parsed.done_reason}, tokens=${parsed.eval_count}`
      )

      // Check content first, fallback to thinking if content is empty
      const rawContent = parsed.message?.content || parsed.message?.thinking || ''
      if (!rawContent || rawContent.trim() === '') {
        console.error('[OllamaVisionProvider] Empty content and thinking in response:', parsed)
        return {
          ok: false,
          error: 'Ollama returned an empty response. The model may still be loading.',
        }
      }

      const content = stripThinkingBlocks(rawContent) || rawContent.trim()

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

  /**
   * Foundation 4B-1: Identifies the UI element directly under or closest to the mouse cursor.
   *
   * @param imageData     Raw base64 PNG
   * @param cursorX       Cursor X position in screen coordinates
   * @param cursorY       Cursor Y position in screen coordinates
   * @param screenWidth   Screen width in pixels
   * @param screenHeight  Screen height in pixels
   */
  async analyzeCursorElement(
    imageData: string,
    cursorX: number,
    cursorY: number,
    screenWidth: number,
    screenHeight: number
  ): Promise<CursorAnalysisResponse> {
    const startTime = Date.now()

    // 1. Create a dynamic local crop centered on the cursor with an analysis-only cursor marker
    const cropResult = createCursorCrop(imageData, cursorX, cursorY, 400, 300)
    const cursorNormX = Math.round(
      (cropResult.cropCursor.x / cropResult.cropRect.width) * 1000
    )
    const cursorNormY = Math.round(
      (cropResult.cropCursor.y / cropResult.cropRect.height) * 1000
    )

    console.log(
      `[OllamaVisionProvider] Local crop created: cropRect=(${cropResult.cropRect.x}, ${cropResult.cropRect.y}, ` +
      `${cropResult.cropRect.width}x${cropResult.cropRect.height}), cropCursor=(${cropResult.cropCursor.x}, ${cropResult.cropCursor.y}) -> norm=(${cursorNormX}, ${cursorNormY})`
    )

    const cursorPrompt = `You are a UI visual grounding system.
This image is a small crop from a computer screen centered on the current mouse position.
The mouse cursor is located at normalized coordinate: [${cursorNormX}, ${cursorNormY}] (where [0,0] is top-left and [1000,1000] is bottom-right).
A red reticle/crosshair marker in the image visually frames and marks this exact position.
Treat the numerical coordinate [${cursorNormX}, ${cursorNormY}] as your primary grounding anchor.

TASK:
Identify and localize the UI element directly under or interacting with the cursor at [${cursorNormX}, ${cursorNormY}].

SUPPORTED ELEMENT TYPES:
- browser_tab (active or inactive browser tab)
- address_bar (browser URL bar / omnibox)
- search_input (search field or search bar)
- text_input (text field, message input, or form input)
- button (clickable button)
- link (hyperlink)
- icon (clickable icon or indicator)
- text_block (paragraph, heading, or readable page content)
- message (chat message or message bubble)
- message_bubble (chat bubble)
- card (content card or preview card)
- navigation_item (sidebar or menu navigation item)
- toolbar (toolbar control or toolbar area)
- other (any other distinct UI element)

CRITICAL RULES:
1. Ground specifically to the element at coordinate [${cursorNormX}, ${cursorNormY}].
2. The bbox uses normalized coordinates from 0 to 1000 relative to this crop image:
   [x1, y1, x2, y2] where (0,0) is top-left and (1000,1000) is bottom-right.
3. The returned bounding box should surround or cover the element at the cursor position.
4. Do NOT identify ordinary webpage text, chat messages, or document content as a browser_tab. Only use browser_tab if the cursor is actually over a browser tab strip.
5. If the cursor is over webpage text or conversation content, use text_block, message, card, or other as appropriate.
6. Do NOT treat the red reticle or crosshair marker itself as a UI element.
7. Only return NO_ELEMENT if the cursor is genuinely over empty wallpaper, blank background, or empty margin.

If no UI element is present:
{
  "element": "NO_ELEMENT",
  "description": "No distinct UI element under the cursor",
  "bbox": null,
  "confidence": 0
}

Return ONLY valid JSON:
{
  "element": "<element_type>",
  "description": "<brief description>",
  "bbox": [x1, y1, x2, y2],
  "confidence": <0.0 to 1.0>
}`

    try {
      const requestBody: OllamaChatRequest = {
        model: MODEL,
        messages: [
          {
            role: 'user',
            content: cursorPrompt,
            images: [cropResult.cropBase64],
          },
          {
            role: 'assistant',
            content: '```json\n{',
          },
        ],
        stream: false,
        options: {
          num_predict: 512,
          temperature: 0.1,
        },
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
        console.error('[OllamaVisionProvider] Network error during cursor analysis:', msg)
        return {
          ok: false,
          error:
            'Local AI is unavailable. Make sure Ollama is running with qwen3-vl:2b.\n' +
            `(${msg})`,
        }
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        console.error('[OllamaVisionProvider] HTTP error during cursor analysis:', response.status, body)
        return {
          ok: false,
          error: `Ollama returned an error (HTTP ${response.status}). ` +
            'Make sure qwen3-vl:2b is available and Ollama is running.',
        }
      }

      let parsed: OllamaChatResponse
      try {
        parsed = (await response.json()) as OllamaChatResponse
        this.lastRawResponse = parsed
      } catch (parseErr) {
        console.error('[OllamaVisionProvider] JSON parse error during cursor analysis:', parseErr)
        return {
          ok: false,
          error: 'Ollama returned an unexpected response format.',
        }
      }

      console.log(
        `[OllamaVisionProvider] Diagnostic (Cursor Crop): status=${response.status}, ` +
        `content_len=${parsed.message?.content?.length || 0}, ` +
        `thinking_len=${parsed.message?.thinking?.length || 0}, ` +
        `done_reason=${parsed.done_reason}, tokens=${parsed.eval_count}`
      )

      // Robust visual grounding extraction: checks content, thinking, strict JSON, and bbox containment
      const parsedElement = extractCursorResult(
        parsed,
        cropResult.cropCursor,
        cropResult.cropRect
      )

      if (!parsedElement) {
        console.warn(
          '[OllamaVisionProvider] Failed to extract UI element from crop response:',
          JSON.stringify({
            content: parsed.message?.content?.slice(0, 300),
            thinking: parsed.message?.thinking?.slice(0, 300),
            done_reason: parsed.done_reason,
          })
        )
        return {
          ok: false,
          error:
            'The local AI analyzed the cursor area but could not identify a distinct UI element. ' +
            'Please try positioning the cursor directly over the target element and analyze again.',
        }
      }

      const totalTokens =
        typeof parsed.eval_count === 'number' && typeof parsed.prompt_eval_count === 'number'
          ? parsed.eval_count + parsed.prompt_eval_count
          : parsed.eval_count ?? parsed.prompt_eval_count ?? null

      const result: CursorGroundingResult = {
        element: parsedElement.element,
        description: parsedElement.description,
        confidence: parsedElement.confidence,
        bboxImage: parsedElement.bboxImage,
        centerImage: parsedElement.centerImage,
        bboxScreen: null,
        centerScreen: null,
        cursorScreen: { x: cursorX, y: cursorY },
        x: parsedElement.centerImage ? parsedElement.centerImage.x : cursorX,
        y: parsedElement.centerImage ? parsedElement.centerImage.y : cursorY,
        cursorX,
        cursorY,
        bbox: null,
        model: parsed.model ?? MODEL,
        durationMs: nanoToMs(parsed.total_duration) ?? (Date.now() - startTime),
        totalTokens,
      }

      return { ok: true, data: result }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[OllamaVisionProvider] Unexpected error during cursor analysis:', err)
      return {
        ok: false,
        error: `Cursor analysis failed: ${message}`,
      }
    }
  }

  /**
   * Foundation 4B-2: Structured multi-element screen understanding.
   *
   * Sends ONE vision request with the full screenshot.
   * Returns a validated list of detected UI elements plus cursor targeting.
   *
   * @param imageData    Raw base64 PNG (full screenshot)
   * @param screenWidth  Screenshot width in pixels
   * @param screenHeight Screenshot height in pixels
   * @param cursorX      Optional cursor X in image pixels (for cursor targeting)
   * @param cursorY      Optional cursor Y in image pixels (for cursor targeting)
   */
  async analyzeScreen(
    imageData: string,
    screenWidth: number,
    screenHeight: number,
    cursorX?: number,
    cursorY?: number
  ): Promise<ScreenUnderstandingResponse> {
    const startTime = Date.now()

    const prompt = buildScreenUnderstandingPrompt()

    try {
      const requestBody: OllamaChatRequest = {
        model: MODEL,
        messages: [
          {
            role: 'user',
            content: prompt,
            images: [imageData],
          },
          // Prefill with JSON code fence start; do not truncate reasoning with </think>
          {
            role: 'assistant',
            content: '```json\n{',
          },
        ],
        stream: false,
        options: {
          num_predict: 2048,  // enough for complete element list
          temperature: 0.1,
        },
      }

      console.log(
        `[OllamaVisionProvider] Screen understanding request: ` +
        `image=${screenWidth}x${screenHeight}, ` +
        `cursor=${cursorX !== undefined ? `(${cursorX}, ${cursorY})` : 'none'}`
      )

      let response: Response
      try {
        response = await net.fetch(OLLAMA_CHAT_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        })
      } catch (networkErr) {
        const msg = networkErr instanceof Error ? networkErr.message : String(networkErr)
        console.error('[OllamaVisionProvider] Network error during screen understanding:', msg)
        return {
          ok: false,
          error:
            'Local AI is unavailable. Make sure Ollama is running with qwen3-vl:2b.\n' +
            `(${msg})`,
        }
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        console.error('[OllamaVisionProvider] HTTP error during screen understanding:', response.status, body)
        return {
          ok: false,
          error: `Ollama returned an error (HTTP ${response.status}). ` +
            'Make sure qwen3-vl:2b is pulled and Ollama is running.',
        }
      }

      let parsed: OllamaChatResponse
      try {
        parsed = (await response.json()) as OllamaChatResponse
        this.lastRawResponse = parsed
      } catch (parseErr) {
        console.error('[OllamaVisionProvider] JSON parse error during screen understanding:', parseErr)
        return {
          ok: false,
          error: 'Ollama returned an unexpected response format.',
        }
      }

      const promptEvalMs = nanoToMs(parsed.prompt_eval_duration)
      const evalMs = nanoToMs(parsed.eval_duration)
      const totalOllamaMs = nanoToMs(parsed.total_duration)
      const totalWallMs = Date.now() - startTime

      console.log(
        `[OllamaVisionProvider] Diagnostic (Screen Understanding): status=${response.status}, ` +
        `content_len=${parsed.message?.content?.length || 0}, ` +
        `thinking_len=${parsed.message?.thinking?.length || 0}, ` +
        `done_reason=${parsed.done_reason}, ` +
        `timing: vision_prompt_eval=${promptEvalMs != null ? promptEvalMs + 'ms' : 'n/a'} (${parsed.prompt_eval_count ?? 0} tokens), ` +
        `generation=${evalMs != null ? evalMs + 'ms' : 'n/a'} (${parsed.eval_count ?? 0} tokens), ` +
        `ollama_total=${totalOllamaMs != null ? totalOllamaMs + 'ms' : 'n/a'}, ` +
        `wall_time=${totalWallMs}ms`
      )

      const isTruncated = parsed.done_reason === 'length'
      if (isTruncated) {
        console.warn(
          `[OllamaVisionProvider] Warning: Model output was truncated by token limit (done_reason=length). ` +
          `Generated tokens=${parsed.eval_count}. Salvaging partial element list...`
        )
      }

      const totalTokens =
        typeof parsed.eval_count === 'number' && typeof parsed.prompt_eval_count === 'number'
          ? parsed.eval_count + parsed.prompt_eval_count
          : parsed.eval_count ?? parsed.prompt_eval_count ?? null

      const durationMs = nanoToMs(parsed.total_duration) ?? (Date.now() - startTime)
      const modelName = parsed.model ?? MODEL

      const rawObj = extractScreenUnderstandingJSON(parsed)

      console.log(
        `[OllamaVisionProvider] Screen understanding parsed: rawObj=${rawObj ? 'found' : 'null'}`
      )

      // If parsing failed entirely, return safe empty result
      if (!rawObj) {
        console.warn(
          '[OllamaVisionProvider] Could not extract JSON from screen understanding response (done_reason=' +
          parsed.done_reason + ')'
        )
        return {
          ok: true,
          data: {
            screen: { application: 'Unknown', description: 'No meaningful UI elements confidently identified.' },
            elements: [],
            cursorTarget: null,
            model: modelName,
            durationMs,
            totalTokens,
            truncated: isTruncated,
          },
        }
      }

      const result = parseScreenUnderstandingResult(
        rawObj,
        screenWidth,
        screenHeight,
        cursorX,
        cursorY,
        modelName,
        durationMs,
        totalTokens,
        isTruncated
      )

      console.log(
        `[OllamaVisionProvider] Screen understanding complete: ` +
        `app="${result.screen.application}", elements=${result.elements.length}, ` +
        `cursorTarget=${result.cursorTarget?.type ?? 'none'}`
      )

      return { ok: true, data: result }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[OllamaVisionProvider] Unexpected error during screen understanding:', err)
      return {
        ok: false,
        error: `Screen understanding failed: ${message}`,
      }
    }
  }
}

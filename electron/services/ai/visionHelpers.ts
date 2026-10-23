/**
 * electron/services/ai/visionHelpers.ts
 *
 * Shared helper functions and validation routines for VisionProviders
 * (OllamaVisionProvider, GeminiVisionProvider, etc.).
 *
 * Provides:
 *  - Standard element type normalization
 *  - Bounding box parsing and geometric validation
 *  - Coordinate scaling from [0..1000] normalized space to screenshot image pixel coordinates
 *  - Cursor containment and IoU geometric calculations
 *  - JSON extraction and truncation salvaging
 *  - Screen understanding prompt and cursor grounding prompt builders
 */

import type {
  BoundingBox,
  Point,
  ScreenElement,
  ScreenElementType,
  ScreenUnderstandingResult,
  CursorGroundingResult,
} from './VisionProvider'
import type { CropPoint, CropRect } from '../imageCrop'

// ─── Constants ────────────────────────────────────────────────────────────────

export const INTERACTIVE_TYPES = new Set<ScreenElementType>([
  'browser_tab',
  'browser_tab_close',
  'new_tab_button',
  'address_bar',
  'navigation_button',
  'toolbar_button',
  'search_input',
  'text_input',
  'button',
  'link',
  'menu',
  'menu_item',
  'navigation_item',
  'checkbox',
  'radio',
  'dropdown',
  'card',
  'thumbnail',
  'command_line',
])

export const VALID_ELEMENT_TYPES = new Set<string>([
  'application_window',
  'browser_tab',
  'browser_tab_close',
  'new_tab_button',
  'address_bar',
  'navigation_button',
  'toolbar_button',
  'search_input',
  'text_input',
  'button',
  'link',
  'menu',
  'menu_item',
  'sidebar',
  'navigation_item',
  'card',
  'list',
  'list_item',
  'table',
  'table_row',
  'dialog',
  'modal',
  'panel',
  'video',
  'image',
  'thumbnail',
  'text_block',
  'message',
  'message_bubble',
  'chat',
  'chat_row',
  'profile',
  'icon',
  'checkbox',
  'radio',
  'dropdown',
  'scrollbar',
  'terminal',
  'command_line',
  'code_block',
  'output_area',
  'other',
])

export const VISION_PROMPT = `Analyze this computer screenshot.

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

// ─── Normalization & Parsing ──────────────────────────────────────────────────

export function normalizeElementType(rawType: unknown): ScreenElementType {
  if (typeof rawType !== 'string') return 'other'
  const s = rawType.toLowerCase().trim().replace(/[-\s]+/g, '_')
  if (VALID_ELEMENT_TYPES.has(s)) return s as ScreenElementType

  // Fuzzy mappings
  if (s.includes('tab') && s.includes('close')) return 'browser_tab_close'
  if (s.includes('new') && s.includes('tab')) return 'new_tab_button'
  if (s.includes('tab')) return 'browser_tab'
  if (s.includes('address') || s.includes('url') || s.includes('omnibox')) return 'address_bar'
  if (s.includes('search')) return 'search_input'
  if (s.includes('input') || s.includes('field') || s.includes('textbox')) return 'text_input'
  if (s.includes('btn') || s.includes('button')) return 'button'
  if (s.includes('link') || s.includes('href') || s.includes('anchor')) return 'link'
  if (s.includes('icon')) return 'icon'
  if (s.includes('item') && s.includes('nav')) return 'navigation_item'
  if (s.includes('nav')) return 'navigation_button'
  if (s.includes('toolbar')) return 'toolbar_button'
  if (s.includes('menu') && s.includes('item')) return 'menu_item'
  if (s.includes('menu')) return 'menu'
  if (s.includes('sidebar') || s.includes('drawer')) return 'sidebar'
  if (s.includes('card')) return 'card'
  if (s.includes('list') && s.includes('item')) return 'list_item'
  if (s.includes('list')) return 'list'
  if (s.includes('table') && s.includes('row')) return 'table_row'
  if (s.includes('table')) return 'table'
  if (s.includes('dialog') || s.includes('alert') || s.includes('popup')) return 'dialog'
  if (s.includes('modal')) return 'modal'
  if (s.includes('panel') || s.includes('section') || s.includes('container')) return 'panel'
  if (s.includes('video') || s.includes('player')) return 'video'
  if (s.includes('thumbnail')) return 'thumbnail'
  if (s.includes('img') || s.includes('image') || s.includes('photo')) return 'image'
  if (s.includes('bubble')) return 'message_bubble'
  if (s.includes('chat') && s.includes('row')) return 'chat_row'
  if (s.includes('chat') || s.includes('message')) return 'message'
  if (s.includes('text') || s.includes('paragraph') || s.includes('heading') || s.includes('label')) return 'text_block'
  if (s.includes('check')) return 'checkbox'
  if (s.includes('radio')) return 'radio'
  if (s.includes('dropdown') || s.includes('select') || s.includes('combobox')) return 'dropdown'
  if (s.includes('scroll')) return 'scrollbar'
  if (s.includes('terminal') || s.includes('console') || s.includes('prompt')) return 'terminal'
  if (s.includes('command')) return 'command_line'
  if (s.includes('code')) return 'code_block'
  if (s.includes('output') || s.includes('log')) return 'output_area'
  if (s.includes('window')) return 'application_window'
  if (s.includes('avatar') || s.includes('profile')) return 'profile'

  return 'other'
}

export function parseRawBbox(rawBbox: unknown): [number, number, number, number] | null {
  if (!rawBbox) return null

  // Array format: [x1, y1, x2, y2]
  if (Array.isArray(rawBbox) && rawBbox.length === 4) {
    const nums = rawBbox.map(Number)
    if (nums.every((n) => typeof n === 'number' && !isNaN(n))) {
      return [nums[0], nums[1], nums[2], nums[3]]
    }
  }

  // Object format: { x1, y1, x2, y2 } or { left, top, right, bottom } or { x, y, width, height }
  // or Gemini-style { ymin, xmin, ymax, xmax }
  if (typeof rawBbox === 'object' && rawBbox !== null) {
    const obj = rawBbox as Record<string, unknown>

    if (obj.x1 !== undefined && obj.y1 !== undefined && obj.x2 !== undefined && obj.y2 !== undefined) {
      const x1 = Number(obj.x1)
      const y1 = Number(obj.y1)
      const x2 = Number(obj.x2)
      const y2 = Number(obj.y2)
      if (!isNaN(x1) && !isNaN(y1) && !isNaN(x2) && !isNaN(y2)) return [x1, y1, x2, y2]
    }

    if (obj.xmin !== undefined && obj.ymin !== undefined && obj.xmax !== undefined && obj.ymax !== undefined) {
      const x1 = Number(obj.xmin)
      const y1 = Number(obj.ymin)
      const x2 = Number(obj.xmax)
      const y2 = Number(obj.ymax)
      if (!isNaN(x1) && !isNaN(y1) && !isNaN(x2) && !isNaN(y2)) return [x1, y1, x2, y2]
    }

    if (obj.min_x !== undefined && obj.min_y !== undefined && obj.max_x !== undefined && obj.max_y !== undefined) {
      const x1 = Number(obj.min_x)
      const y1 = Number(obj.min_y)
      const x2 = Number(obj.max_x)
      const y2 = Number(obj.max_y)
      if (!isNaN(x1) && !isNaN(y1) && !isNaN(x2) && !isNaN(y2)) return [x1, y1, x2, y2]
    }

    if (obj.left !== undefined && obj.top !== undefined && obj.right !== undefined && obj.bottom !== undefined) {
      const x1 = Number(obj.left)
      const y1 = Number(obj.top)
      const x2 = Number(obj.right)
      const y2 = Number(obj.bottom)
      if (!isNaN(x1) && !isNaN(y1) && !isNaN(x2) && !isNaN(y2)) return [x1, y1, x2, y2]
    }

    if (obj.x !== undefined && obj.y !== undefined && obj.width !== undefined && obj.height !== undefined) {
      const x = Number(obj.x)
      const y = Number(obj.y)
      const w = Number(obj.width)
      const h = Number(obj.height)
      if (!isNaN(x) && !isNaN(y) && !isNaN(w) && !isNaN(h)) return [x, y, x + w, y + h]
    }

    if (obj.box_2d && Array.isArray(obj.box_2d) && obj.box_2d.length === 4) {
      const nums = (obj.box_2d as unknown[]).map(Number)
      if (nums.every((n) => typeof n === 'number' && !isNaN(n))) {
        // Gemini box_2d is [ymin, xmin, ymax, xmax] -> convert to [x1, y1, x2, y2]
        return [nums[1], nums[0], nums[3], nums[2]]
      }
    }
  }

  return null
}

export function validateScreenElementBbox(
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
  // Detect [0,1000] normalized space — scale to pixels
  else if (Math.max(a, b, c, d) <= 1001 && Math.max(a, b, c, d) > 1) {
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

  // Determine x1, y1, x2, y2 regardless of order
  let x1 = Math.min(a, c)
  let y1 = Math.min(b, d)
  let x2 = Math.max(a, c)
  let y2 = Math.max(b, d)

  // Clamp to image bounds
  x1 = Math.max(0, x1)
  y1 = Math.max(0, y1)
  x2 = Math.min(imageWidth, x2)
  y2 = Math.min(imageHeight, y2)

  // Reject invalid
  if (x2 <= x1 || y2 <= y1) return null
  if (x2 - x1 < 4 || y2 - y1 < 4) return null
  if (x1 >= imageWidth || y1 >= imageHeight || x2 <= 0 || y2 <= 0) return null

  return {
    x1: Math.round(x1),
    y1: Math.round(y1),
    x2: Math.round(x2),
    y2: Math.round(y2),
  }
}

export function cursorInsideBbox(cursorX: number, cursorY: number, bbox: BoundingBox): boolean {
  return (
    cursorX >= bbox.x1 &&
    cursorX <= bbox.x2 &&
    cursorY >= bbox.y1 &&
    cursorY <= bbox.y2
  )
}

export function bboxArea(bbox: BoundingBox): number {
  return (bbox.x2 - bbox.x1) * (bbox.y2 - bbox.y1)
}

export function bboxIoU(b1: BoundingBox, b2: BoundingBox): number {
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

export function salvageTruncatedJSON(text: string): unknown | null {
  let jsonText = text.trim()
  if (!jsonText.startsWith('{')) {
    const firstBrace = jsonText.indexOf('{')
    if (firstBrace !== -1) {
      jsonText = jsonText.slice(firstBrace)
    } else {
      jsonText = '{\n' + jsonText
    }
  }

  // 1. Check for single-element / cursor grounding JSON with "element" or "description"
  if (jsonText.includes('"element"') || jsonText.includes('"description"')) {
    let candidate = jsonText
    candidate = candidate.replace(/,\s*"[^"]*"?\s*:\s*[^,}]*$/, '')
    candidate = candidate.replace(/,\s*$/, '')
    const openBraces = (candidate.match(/\{/g) || []).length
    const closeBraces = (candidate.match(/\}/g) || []).length
    for (let i = 0; i < openBraces - closeBraces; i++) {
      candidate += '\n}'
    }
    try {
      const obj = JSON.parse(candidate)
      if (obj && typeof obj === 'object') return obj
    } catch {
      // Continue to next recovery attempt
    }
  }

  // 2. Check for multi-element screen understanding JSON with "elements" array
  const elementsIdx = jsonText.indexOf('"elements"')
  if (elementsIdx !== -1) {
    const lastElementClose = jsonText.lastIndexOf('}')
    if (lastElementClose > elementsIdx) {
      const candidate = jsonText.slice(0, lastElementClose + 1) + '\n  ]\n}'
      try {
        const obj = JSON.parse(candidate)
        if (obj && typeof obj === 'object') return obj
      } catch {
        // Continue
      }
    }
  }

  return null
}

export function extractJSONFromText(text: string): unknown | null {
  if (!text || !text.trim()) return null

  const clean = text.trim()
  const codeBlockMatch = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  const candidate = codeBlockMatch ? codeBlockMatch[1].trim() : clean

  const firstBrace = candidate.indexOf('{')
  const lastBrace = candidate.lastIndexOf('}')

  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const slice = candidate.slice(firstBrace, lastBrace + 1)
    try {
      return JSON.parse(slice)
    } catch {
      const salvaged = salvageTruncatedJSON(slice)
      if (salvaged) return salvaged
    }
  } else if (firstBrace !== -1) {
    const salvaged = salvageTruncatedJSON(candidate.slice(firstBrace))
    if (salvaged) return salvaged
  }

  return null
}

export function parseScreenUnderstandingResult(
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

    let rawBbox = el.bbox ?? el.bounding_box ?? el.bounds ?? el.box
    if (!rawBbox && (el.box_2d || el.box2d)) {
      const b2d = (el.box_2d ?? el.box2d) as unknown
      if (Array.isArray(b2d) && b2d.length === 4) {
        rawBbox = [b2d[1], b2d[0], b2d[3], b2d[2]] // swap [ymin, xmin, ymax, xmax] -> [x1, y1, x2, y2]
      } else {
        rawBbox = b2d
      }
    }

    const bbox = validateScreenElementBbox(
      rawBbox,
      imageWidth,
      imageHeight,
      type
    )
    if (!bbox) {
      elementIndex++
      continue
    }

    const center: Point = {
      x: Math.round((bbox.x1 + bbox.x2) / 2),
      y: Math.round((bbox.y1 + bbox.y2) / 2),
    }

    let confidence = typeof el.confidence === 'number' && !isNaN(el.confidence) ? el.confidence : 0.85
    if (confidence > 1 && confidence <= 100) confidence = confidence / 100
    confidence = Math.max(0.1, Math.min(1.0, Math.round(confidence * 100) / 100))

    const interactiveRaw = el.interactive
    const interactive =
      typeof interactiveRaw === 'boolean'
        ? interactiveRaw
        : INTERACTIVE_TYPES.has(type)

    const state = typeof el.state === 'string' && el.state.trim() ? el.state.trim() : undefined

    const containsCursor =
      cursorX !== undefined && cursorY !== undefined
        ? cursorInsideBbox(cursorX, cursorY, bbox)
        : undefined

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

  // Deduplicate overlapping boxes
  const deduplicated: ScreenElement[] = []
  for (const el of validatedElements) {
    if (!el.bbox) continue
    const duplicate = deduplicated.find(
      (existing) => existing.bbox && bboxIoU(el.bbox!, existing.bbox) > 0.85 && el.type === existing.type
    )
    if (!duplicate) {
      deduplicated.push(el)
    }
  }

  // Find cursor target element (smallest bbox containing cursor)
  let cursorTarget: ScreenElement | null = null
  if (cursorX !== undefined && cursorY !== undefined) {
    const containing = deduplicated.filter(
      (el) => el.bbox && cursorInsideBbox(cursorX, cursorY, el.bbox)
    )
    if (containing.length > 0) {
      containing.sort((a, b) => bboxArea(a.bbox!) - bboxArea(b.bbox!))
      cursorTarget = containing[0]
    }
  }

  return {
    screen: {
      application: screenApp,
      description: screenDesc,
    },
    elements: deduplicated,
    cursorTarget,
    model,
    durationMs,
    totalTokens,
    truncated: Boolean(truncated),
  }
}

export function extractCursorResult(
  rawObj: unknown,
  cropCursor: CropPoint,
  cropRect: CropRect
): {
  element: string
  description: string
  confidence: number
  bboxImage: BoundingBox | null
  centerImage: Point | null
} | null {
  if (!rawObj || typeof rawObj !== 'object') return null
  const obj = rawObj as Record<string, unknown>

  const rawElement = obj.element ?? obj.name ?? obj.label ?? obj.target ?? obj.ui_element ?? obj.type
  let element = typeof rawElement === 'string' ? rawElement.trim() : ''
  let description = typeof obj.description === 'string' ? obj.description.trim() : ''
  const rawConf = typeof obj.confidence === 'number' ? obj.confidence : 0.85

  if (!element && !description && !obj.bbox && !obj.box_2d && !obj.box2d && !obj.bounding_box && !obj.bounds) return null

  let rawBboxToParse = obj.bbox ?? obj.bounding_box ?? obj.bounds ?? obj.box
  if (!rawBboxToParse && (obj.box_2d || obj.box2d)) {
    const b2d = (obj.box_2d ?? obj.box2d) as unknown
    if (Array.isArray(b2d) && b2d.length === 4) {
      rawBboxToParse = [b2d[1], b2d[0], b2d[3], b2d[2]] // swap [ymin, xmin, ymax, xmax] -> [x1, y1, x2, y2]
    } else {
      rawBboxToParse = b2d
    }
  }

  const parsedBbox = parseRawBbox(rawBboxToParse)
  if (!parsedBbox) {
    if (/NO_ELEMENT|no identifiable element|empty area|nothing under cursor|blank space|background|wallpaper/i.test(element + ' ' + description)) {
      return {
        element: 'NO_ELEMENT',
        description: description || 'No distinct UI element under the cursor',
        confidence: 0,
        bboxImage: null,
        centerImage: null,
      }
    }
    return {
      element: element || 'UI element under cursor',
      description: description || 'Detected element under mouse cursor',
      confidence: 0.5,
      bboxImage: null,
      centerImage: null,
    }
  }

  let [b1, b2, b3, b4] = parsedBbox

  // Handle [0, 1] normalized float values
  if (Math.max(b1, b2, b3, b4) <= 1.0 && Math.max(b1, b2, b3, b4) > 0) {
    b1 *= 1000
    b2 *= 1000
    b3 *= 1000
    b4 *= 1000
  }

  const cursorNormX = (cropCursor.x / cropRect.width) * 1000
  const cursorNormY = (cropCursor.y / cropRect.height) * 1000

  const normTolerance = 60
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

  const isValid =
    containsNormStd || containsNormInv ||
    containsPixelsStd || containsPixelsInv ||
    verticallyAlignedNormStd || verticallyAlignedNormInv

  if (!isValid) {
    return {
      element: 'NO_ELEMENT',
      description: 'Cursor is not within any detected UI element boundary',
      confidence: 0,
      bboxImage: null,
      centerImage: null,
    }
  }

  const isInv = containsNormInv || verticallyAlignedNormInv
  const minX = isInv ? minX_inv : minX_std
  const maxX = isInv ? maxX_inv : maxX_std
  const minY = isInv ? minY_inv : minY_std
  const maxY = isInv ? maxY_inv : maxY_std
  const isNorm = containsNormStd || containsNormInv || verticallyAlignedNormStd || verticallyAlignedNormInv

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
    normX1 = (Math.max(0, Math.min(minX, cropRect.width)) / cropRect.width) * 1000
    normY1 = (Math.max(0, Math.min(minY, cropRect.height)) / cropRect.height) * 1000
    normX2 = (Math.max(0, Math.min(maxX, cropRect.width)) / cropRect.width) * 1000
    normY2 = (Math.max(0, Math.min(maxY, cropRect.height)) / cropRect.height) * 1000
  }

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
    confidence,
    bboxImage,
    centerImage,
  }
}

export function buildCursorGroundingPrompt(cursorNormX: number, cursorNormY: number): string {
  return `You are a UI visual grounding system.
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
- toolbar_button (toolbar control)
- other (any other distinct UI element)

CRITICAL RULES:
1. Ground specifically to the element at coordinate [${cursorNormX}, ${cursorNormY}].
2. The bbox uses normalized coordinates from 0 to 1000 relative to this crop image:
   [x1, y1, x2, y2] where (0,0) is top-left and (1000,1000) is bottom-right.
3. The returned bounding box should surround or cover the element at the cursor position.
4. Do NOT identify ordinary webpage text, chat messages, or document content as a browser_tab.
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
}

export function buildScreenUnderstandingPrompt(): string {
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
4. Media Players & Audio/Video Streaming:
   - Player window, navigation, and library sidebars ("sidebar", "navigation_item").
   - Playback bar and controls: Play/Pause button ("button" or "icon", state "active" or "inactive"), previous/next track buttons ("button" or "icon").
   - Playback timeline or seek bar ("scrollbar" or "panel"), volume controls ("button" or "icon").
   - Track information: title, artist name ("text_block"), album artwork ("thumbnail" or "image").
   - Search inputs ("search_input"), playlist items, song list rows, or library links ("navigation_item", "list_item", "link").
5. Other Desktop Applications & Dialogs:
   - Dialogs ("dialog"), message bubbles ("message_bubble"), panels ("panel"), buttons ("button"), and visible content.

RULES:
1. SCREEN SUMMARY: Provide an accurate, factual summary in screen.description of what the user is doing and the observable state of the window. Never invent commands, playback states, actions, or results not visible in the screenshot.
2. ELEMENT LIMIT: Prioritize the 10 to 15 most important or prominent elements on screen.
3. BOUNDING BOXES: Normalized [x1, y1, x2, y2] from 0 to 1000 where (0,0) is top-left and (1000,1000) is bottom-right.
   - x1 (left), y1 (top), x2 (right), y2 (bottom) with x1 < x2 and y1 < y2.
4. LABELS: Use readable visible text for labels.
5. DESCRIPTIONS: Keep each element's "description" concise (under 15 words).
6. NO FABRICATION & NO DUPLICATES: Only detect genuinely visible elements.
7. VALID JSON ONLY: Return strictly valid JSON following the schema below.

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

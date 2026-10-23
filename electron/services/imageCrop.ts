/**
 * electron/services/imageCrop.ts
 *
 * Local cursor crop creation with visual cursor marker for AI analysis.
 *
 * Rules:
 *  - Calculates crop dimensions dynamically from screenshot dimensions.
 *  - Clamps to screen boundaries (top, bottom, left, right edges/corners).
 *  - Preserves exact relative cursor coordinates inside the crop.
 *  - Draws an analysis-only high-contrast crosshair marker on the crop.
 *  - Leaves the original full screenshot completely untouched.
 */

import { nativeImage } from 'electron'

export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

export interface CropPoint {
  x: number
  y: number
}

export interface CursorCropResult {
  /** PNG base64 of the marked local crop (no data URL prefix) */
  cropBase64: string
  /** Rectangle of the crop in full screenshot pixel space */
  cropRect: CropRect
  /** Position of the cursor in local crop coordinates */
  cropCursor: CropPoint
}

/**
 * Creates a local crop around the cursor in screenshot pixel space,
 * clamped to screenshot boundaries, and draws an analysis-only cursor marker.
 *
 * @param fullBase64         Raw base64 of the full screenshot (PNG)
 * @param screenshotCursorX  Cursor X in screenshot pixel space
 * @param screenshotCursorY  Cursor Y in screenshot pixel space
 * @param targetWidth        Target crop width (default: 400)
 * @param targetHeight       Target crop height (default: 300)
 */
export function createCursorCrop(
  fullBase64: string,
  screenshotCursorX: number,
  screenshotCursorY: number,
  targetWidth: number = 400,
  targetHeight: number = 300
): CursorCropResult {
  const fullBuffer = Buffer.from(fullBase64, 'base64')
  const fullImage = nativeImage.createFromBuffer(fullBuffer)
  const size = fullImage.getSize()

  const cropWidth = Math.min(targetWidth, size.width)
  const cropHeight = Math.min(targetHeight, size.height)

  // Ideal top-left to center the crop on the cursor
  const idealLeft = Math.round(screenshotCursorX - cropWidth / 2)
  const idealTop = Math.round(screenshotCursorY - cropHeight / 2)

  // Clamp crop rectangle to stay strictly within screenshot boundaries
  const cropX = Math.max(0, Math.min(idealLeft, size.width - cropWidth))
  const cropY = Math.max(0, Math.min(idealTop, size.height - cropHeight))

  // Relative cursor coordinates within the crop
  const cropCursorX = Math.max(0, Math.min(screenshotCursorX - cropX, cropWidth - 1))
  const cropCursorY = Math.max(0, Math.min(screenshotCursorY - cropY, cropHeight - 1))

  // Perform crop on the nativeImage
  const cropped = fullImage.crop({
    x: cropX,
    y: cropY,
    width: cropWidth,
    height: cropHeight,
  })

  const cropSize = cropped.getSize()
  const rawBitmap = cropped.toBitmap()

  // Draw a high-contrast open-center precision reticle at (cropCursorX, cropCursorY).
  // The center aperture (radius < 5.2 px) is left 100% untouched so small icon glyphs
  // (e.g. Pause, Play, tiny buttons) remain completely visible and unobstructed.
  function setPixel(x: number, y: number, r: number, g: number, b: number, a: number = 255): void {
    if (x < 0 || x >= cropSize.width || y < 0 || y >= cropSize.height) return
    const idx = (y * cropSize.width + x) * 4
    // Chromium bitmap format on Windows is BGRA
    rawBitmap[idx + 0] = b
    rawBitmap[idx + 1] = g
    rawBitmap[idx + 2] = r
    rawBitmap[idx + 3] = a
  }

  // 1. Circular reticle ring framing the cursor with open center
  //    Inner radius < 5.2px is untouched; ring is drawn at r ~ 6.4..7.8 with black borders
  for (let dy = -9; dy <= 9; dy++) {
    for (let dx = -9; dx <= 9; dx++) {
      const d = Math.hypot(dx, dy)
      // Inner black outline
      if (d >= 5.2 && d < 6.4) {
        setPixel(cropCursorX + dx, cropCursorY + dy, 0, 0, 0)
      }
      // Main vibrant red reticle ring
      else if (d >= 6.4 && d <= 7.8) {
        setPixel(cropCursorX + dx, cropCursorY + dy, 255, 35, 35)
      }
      // Outer black outline
      else if (d > 7.8 && d <= 8.8) {
        setPixel(cropCursorX + dx, cropCursorY + dy, 0, 0, 0)
      }
    }
  }

  // 2. Directional pointer ticks pointing toward center from outside the ring (distance 9 to 13 px)
  const tickStart = 9
  const tickEnd = 13

  // Horizontal ticks (left and right)
  for (const sign of [-1, 1]) {
    for (let i = tickStart; i <= tickEnd; i++) {
      const dx = sign * i
      setPixel(cropCursorX + dx, cropCursorY - 1, 0, 0, 0)
      setPixel(cropCursorX + dx, cropCursorY + 1, 0, 0, 0)
      setPixel(cropCursorX + dx, cropCursorY, 255, 35, 35)
    }
  }

  // Vertical ticks (top and bottom)
  for (const sign of [-1, 1]) {
    for (let i = tickStart; i <= tickEnd; i++) {
      const dy = sign * i
      setPixel(cropCursorX - 1, cropCursorY + dy, 0, 0, 0)
      setPixel(cropCursorX + 1, cropCursorY + dy, 0, 0, 0)
      setPixel(cropCursorX, cropCursorY + dy, 255, 35, 35)
    }
  }

  const markedImage = nativeImage.createFromBitmap(rawBitmap, {
    width: cropSize.width,
    height: cropSize.height,
  })

  const markedBase64 = markedImage.toPNG().toString('base64')

  return {
    cropBase64: markedBase64,
    cropRect: { x: cropX, y: cropY, width: cropWidth, height: cropHeight },
    cropCursor: { x: cropCursorX, y: cropCursorY },
  }
}

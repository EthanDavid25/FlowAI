/**
 * electron/services/screenCapture.ts
 *
 * Screen Capture Service — Main Process
 *
 * Encapsulates all screen-capture logic in one place so that:
 *  - The IPC handler in main.ts stays thin.
 *  - Foundation 3 can import `CaptureResult` and pipe it straight to the AI
 *    service without touching the capture logic.
 *
 * Capture pipeline (Foundation 2):
 *   desktopCapturer.getSources() → primary screen source
 *   → NativeImage thumbnail → PNG buffer → base64 data URL
 *
 * Future pipeline (Foundation 3):
 *   CaptureResult.dataUrl  ──→  AI Vision Service
 */

import { desktopCapturer, screen } from 'electron'

// ─── Public types ─────────────────────────────────────────────────────────────

/** Successful capture result — passed back to renderer via IPC. */
export interface CaptureResult {
  /** PNG image as a base64 data URL safe for use in <img src="…"> */
  dataUrl: string
  /** Captured image width in physical pixels (matches the PNG dimensions) */
  width: number
  /** Captured image height in physical pixels (matches the PNG dimensions) */
  height: number
  /** Epoch ms when the capture was taken */
  timestamp: number
}

/** What the IPC handler returns: either a result or an error message. */
export type CaptureResponse =
  | { ok: true; data: CaptureResult }
  | { ok: false; error: string }

// ─── Capture dimensions ────────────────────────────────────────────────────────
// desktopCapturer.getSources thumbnailSize controls the resolution of the
// returned NativeImage. We request the primary display's *physical* pixel size
// (display.size × display.scaleFactor) so the capture is not downsampled on
// high-DPI displays (e.g. 1920×1080 physical at 125% Windows scaling instead of
// the 1536×864 logical size). This gives the AI model a sharper, full-resolution
// image to reason about.
// Cap at 3840 wide to keep data URLs manageable even on 4K/HiDPI screens.
const MAX_CAPTURE_WIDTH = 3840

function getPrimaryDisplaySize(): { width: number; height: number } {
  const primary = screen.getPrimaryDisplay()
  const { width, height } = primary.size         // logical DIP dimensions
  const scale = primary.scaleFactor ?? 1         // e.g. 1.25 at 125% Windows DPI setting
  // Convert to physical pixels — this is what desktopCapturer needs for a
  // full-resolution capture that exactly matches the hardware framebuffer.
  const physicalWidth = Math.round(width * scale)
  const physicalHeight = Math.round(height * scale)
  const clampedWidth = Math.min(physicalWidth, MAX_CAPTURE_WIDTH)
  // Maintain aspect ratio if we had to clamp
  const clampedHeight = Math.round(physicalHeight * (clampedWidth / physicalWidth))
  return { width: clampedWidth, height: clampedHeight }
}

// ─── Core capture function ────────────────────────────────────────────────────

/**
 * Captures the primary screen and returns a CaptureResponse.
 * Never throws — all errors are returned as `{ ok: false, error }`.
 */
export async function captureScreen(): Promise<CaptureResponse> {
  try {
    const { width, height } = getPrimaryDisplaySize()

    // Get all screen sources. We only want 'screen' type (not windows).
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width, height },
    })

    if (sources.length === 0) {
      return {
        ok: false,
        error:
          'No screen source found. The display may not be available or permission was denied.',
      }
    }

    // Pick the primary display source.
    // `screen:0:0` is the primary display ID on most platforms.
    // Fall back to the first source if we can't match by ID.
    const primaryDisplay = screen.getPrimaryDisplay()
    const primarySource =
      sources.find((s) => s.display_id === String(primaryDisplay.id)) ??
      sources[0]

    // Convert NativeImage thumbnail to a PNG data URL.
    const thumbnail = primarySource.thumbnail
    const pngBuffer = thumbnail.toPNG()

    if (pngBuffer.length === 0) {
      return {
        ok: false,
        error:
          'Screen capture returned an empty image. Try again or check display permissions.',
      }
    }

    const base64 = pngBuffer.toString('base64')
    const dataUrl = `data:image/png;base64,${base64}`

    // Use the actual thumbnail size (may differ from requested size)
    const size = thumbnail.getSize()

    return {
      ok: true,
      data: {
        dataUrl,
        width: size.width,
        height: size.height,
        timestamp: Date.now(),
      },
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      error: `Screen capture failed: ${message}`,
    }
  }
}

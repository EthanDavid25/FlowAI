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
   * Send a captured screenshot (as a data URL) to the local AI provider.
   * Always resolves — errors are returned as { ok: false, error }.
   */
  analyzeScreen: (dataUrl: string) => Promise<AnalysisResponse>
  /** Generic IPC invoke for other channels (channel-whitelisted in preload). */
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  /** Subscribe to main-process push events. Returns unsubscribe fn. */
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void
}

interface Window {
  flowAI: FlowAIBridge
}

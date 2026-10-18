import { app, BrowserWindow, globalShortcut, ipcMain, screen, shell } from 'electron'
import { join } from 'path'
import { captureScreen } from './services/screenCapture'
import { OllamaVisionProvider } from './services/ai/OllamaVisionProvider'
import type { BoundingBox, Point } from './services/ai/VisionProvider'

// ─── AI providers ─────────────────────────────────────────────────────────────
// Instantiated once — stateless, safe to reuse across requests.
const ollamaProvider = new OllamaVisionProvider()

// ─── Environment detection ───────────────────────────────────────────────────
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

// ─── Single instance lock ─────────────────────────────────────────────────────
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  console.log('[main] Another FlowAI instance is already running. Quitting duplicate instance.')
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

export interface CursorShortcutInfo {
  registered: boolean
  shortcut: string
  displayShortcut: string
  isFallback: boolean
  diagnostic?: string
}

let cursorShortcutInfo: CursorShortcutInfo = {
  registered: false,
  shortcut: '',
  displayShortcut: 'Ctrl+Shift+F',
  isFallback: false,
}

// ─── Window management ───────────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'FlowAI',
    backgroundColor: '#0f1117',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0f1117',
      symbolColor: '#e2e8f0',
      height: 36,
    },
    webPreferences: {
      // ── Security: contextIsolation + no Node in renderer ──────────────────
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(__dirname, 'preload.js'),
      // Disable potentially dangerous features
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
    show: false, // show after ready-to-show to avoid white flash
  })

  // Show window once content is ready
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    if (isDev) {
      mainWindow?.webContents.openDevTools({ mode: 'detach' })
    }
  })

  // Open external links in the system browser, not inside Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  // Load the app
  if (isDev && process.env['VITE_DEV_SERVER_URL']) {
    mainWindow.loadURL(process.env['VITE_DEV_SERVER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }
}

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  // ── IPC handlers ──────────────────────────────────────────────────────────
  // Foundation 2: screen capture
  // Hide FlowAI before capturing so the screenshot shows the application behind
  // it rather than the FlowAI window itself. A 200 ms delay lets the window
  // compositor remove the FlowAI frame before the screenshot is taken.
  // try/finally guarantees the window is always restored, even on capture error.
  //
  // NOTE: The Ctrl+Shift+F shortcut path calls captureScreen() directly (not via
  // this IPC handler) and is unaffected by this change.
  ipcMain.handle('screen:capture', async () => {
    const win = mainWindow
    const wasVisible = win != null && !win.isDestroyed() && win.isVisible()

    if (wasVisible) {
      win!.hide()
      // Allow the window compositor to settle before the screenshot is taken.
      await new Promise<void>((resolve) => setTimeout(resolve, 200))
    }

    try {
      return await captureScreen()
    } finally {
      if (wasVisible && win != null && !win.isDestroyed()) {
        win.show()
      }
    }
  })

  // Foundation 3: vision AI analysis
  // Receives the data URL from the renderer, strips the prefix, sends base64
  // to Ollama via OllamaVisionProvider, returns AnalysisResponse.
  ipcMain.handle('ai:analyze', (_event, dataUrl: string) => {
    // dataUrl format: "data:image/png;base64,<base64data>"
    // Ollama expects only the raw base64 portion.
    const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl
    return ollamaProvider.analyzeImage(base64)
  })

  // Foundation 4A: intelligent cursor awareness
  // 1. Get current mouse cursor desktop coordinates
  ipcMain.handle('cursor:getPoint', () => {
    const point = screen.getCursorScreenPoint()
    return { x: Math.round(point.x), y: Math.round(point.y) }
  })

  // Get active cursor shortcut registration info and status
  ipcMain.handle('cursor:getShortcutInfo', () => cursorShortcutInfo)

  // 2. Identify UI element at / under the cursor position
  ipcMain.handle(
    'ai:analyzeCursor',
    async (
      _event,
      params: {
        dataUrl: string
        cursorX: number
        cursorY: number
        screenWidth: number
        screenHeight: number
      }
    ) => {
      if (isCursorAnalysisInProgress) {
        console.warn('[main] Rejected concurrent cursor analysis: already in progress')
        return { ok: false, error: 'Cursor analysis is already in progress' }
      }

      isCursorAnalysisInProgress = true
      try {
        const base64 = params.dataUrl.includes(',')
          ? params.dataUrl.split(',')[1]
          : params.dataUrl

        const primary = screen.getPrimaryDisplay()
        const logicalWidth = primary.size.width || params.screenWidth
        const logicalHeight = primary.size.height || params.screenHeight

        // Scale cursor to image resolution if thumbnail dimensions differ from logical screen
        const scaleX = params.screenWidth / logicalWidth
        const scaleY = params.screenHeight / logicalHeight

        const imageCursorX = Math.round(params.cursorX * (scaleX > 0 ? scaleX : 1))
        const imageCursorY = Math.round(params.cursorY * (scaleY > 0 ? scaleY : 1))

        console.log(
          `[main] Cursor analysis: screen=(${params.screenWidth}x${params.screenHeight}), ` +
          `logical=(${logicalWidth}x${logicalHeight}), cursor=(${params.cursorX}, ${params.cursorY}) -> image=(${imageCursorX}, ${imageCursorY})`
        )

        const result = await ollamaProvider.analyzeCursorElement(
          base64,
          imageCursorX,
          imageCursorY,
          params.screenWidth,
          params.screenHeight
        )

        if (result.ok) {
          let bboxScreen: BoundingBox | null = null
          let centerScreen: Point | null = null

          if (result.data.bboxImage) {
            bboxScreen = {
              x1: scaleX > 0 ? Math.round(result.data.bboxImage.x1 / scaleX) : result.data.bboxImage.x1,
              y1: scaleY > 0 ? Math.round(result.data.bboxImage.y1 / scaleY) : result.data.bboxImage.y1,
              x2: scaleX > 0 ? Math.round(result.data.bboxImage.x2 / scaleX) : result.data.bboxImage.x2,
              y2: scaleY > 0 ? Math.round(result.data.bboxImage.y2 / scaleY) : result.data.bboxImage.y2,
            }
          }

          if (result.data.centerImage) {
            centerScreen = {
              x: scaleX > 0 ? Math.round(result.data.centerImage.x / scaleX) : result.data.centerImage.x,
              y: scaleY > 0 ? Math.round(result.data.centerImage.y / scaleY) : result.data.centerImage.y,
            }
          } else if (bboxScreen) {
            centerScreen = {
              x: Math.round((bboxScreen.x1 + bboxScreen.x2) / 2),
              y: Math.round((bboxScreen.y1 + bboxScreen.y2) / 2),
            }
          }

          const cursorScreen: Point = {
            x: params.cursorX,
            y: params.cursorY,
          }

          const finalX = centerScreen ? centerScreen.x : params.cursorX
          const finalY = centerScreen ? centerScreen.y : params.cursorY

          return {
            ok: true,
            data: {
              ...result.data,
              x: finalX,
              y: finalY,
              bbox: bboxScreen,
              bboxScreen,
              centerScreen,
              cursorScreen,
              cursorX: params.cursorX,
              cursorY: params.cursorY,
            },
          }
        }

        return result
      } finally {
        isCursorAnalysisInProgress = false
      }
    }
  )

  // Foundation 4B-2: Structured screen understanding
  // Captures the full screen and returns a structured list of detected UI elements.
  ipcMain.handle(
    'ai:analyzeScreen',
    async (
      _event,
      params: {
        dataUrl: string
        screenWidth: number
        screenHeight: number
        cursorX?: number
        cursorY?: number
      }
    ) => {
      if (isScreenUnderstandingInProgress) {
        console.warn('[main] Rejected concurrent screen understanding: already in progress')
        return { ok: false, error: 'Screen understanding is already in progress' }
      }

      isScreenUnderstandingInProgress = true
      try {
        const base64 = params.dataUrl.includes(',')
          ? params.dataUrl.split(',')[1]
          : params.dataUrl

        const primary = screen.getPrimaryDisplay()
        const logicalWidth = primary.size.width || params.screenWidth
        const logicalHeight = primary.size.height || params.screenHeight

        // Scale cursor to image resolution if needed
        let imageCursorX: number | undefined
        let imageCursorY: number | undefined
        if (params.cursorX !== undefined && params.cursorY !== undefined) {
          const scaleX = params.screenWidth / logicalWidth
          const scaleY = params.screenHeight / logicalHeight
          imageCursorX = Math.round(params.cursorX * (scaleX > 0 ? scaleX : 1))
          imageCursorY = Math.round(params.cursorY * (scaleY > 0 ? scaleY : 1))
        }

        console.log(
          `[main] Screen understanding: image=${params.screenWidth}x${params.screenHeight}, ` +
          `cursor=${imageCursorX !== undefined ? `(${imageCursorX}, ${imageCursorY})` : 'none'}`
        )

        return await ollamaProvider.analyzeScreen(
          base64,
          params.screenWidth,
          params.screenHeight,
          imageCursorX,
          imageCursorY
        )
      } finally {
        isScreenUnderstandingInProgress = false
      }
    }
  )

  createWindow()

  // Foundation 4B-1: Global keyboard trigger for cursor analysis (Ctrl + Shift + F)
  registerGlobalShortcuts()

  app.on('activate', () => {
    // macOS: re-create window when dock icon is clicked and no windows open
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

let isShortcutBusy = false
let isCursorAnalysisInProgress = false
let isScreenUnderstandingInProgress = false

function registerGlobalShortcuts(): void {
  // Candidate shortcuts in order of preference:
  // Primary is the intended Ctrl+Shift+F.
  // Fallbacks are tried ONLY if the OS reports a registration failure (e.g. another app has claimed it).
  const candidates: Array<{ shortcut: string; displayShortcut: string; isFallback: boolean }> = [
    { shortcut: 'CommandOrControl+Shift+F', displayShortcut: 'Ctrl+Shift+F', isFallback: false },
    { shortcut: 'Alt+Shift+F', displayShortcut: 'Alt+Shift+F', isFallback: true },
    { shortcut: 'CommandOrControl+Alt+F', displayShortcut: 'Ctrl+Alt+F', isFallback: true },
  ]

  // Unregister existing shortcuts if any were previously registered
  globalShortcut.unregisterAll()

  const triggerAnalysis = async (displayKey: string) => {
    if (isShortcutBusy || isCursorAnalysisInProgress) {
      console.log(`[main] Shortcut (${displayKey}) ignored: previous analysis still in progress`)
      return
    }

    if (!mainWindow || mainWindow.isDestroyed()) {
      return
    }

    isShortcutBusy = true
    console.log(`[main] Global shortcut ${displayKey} triggered`)

    try {
      // 1. Capture cursor position immediately — do NOT move cursor,
      //    do NOT bring FlowAI to the foreground before capture.
      const point = screen.getCursorScreenPoint()
      const cursorPoint = { x: Math.round(point.x), y: Math.round(point.y) }
      console.log('[main] Shortcut captured cursor coordinates:', cursorPoint)

      // 2. Capture primary screen while the target app is still on screen.
      const captureResponse = await captureScreen()

      // 3. Now bring FlowAI into view so the user can see the result.
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) {
          mainWindow.restore()
        }
        mainWindow.show()

        // 4. Send captured data to the renderer to run Ollama analysis.
        mainWindow.webContents.send('cursor:shortcutTriggered', {
          capture: captureResponse,
          cursor: cursorPoint,
        })
      }
    } catch (err) {
      console.error(`[main] Error handling ${displayKey} shortcut:`, err)
    } finally {
      // 500 ms cooldown prevents rapid repeated triggers from stacking.
      setTimeout(() => {
        isShortcutBusy = false
      }, 500)
    }
  }

  let registeredSuccessfully = false

  for (const candidate of candidates) {
    const registered = globalShortcut.register(candidate.shortcut, () => triggerAnalysis(candidate.displayShortcut))
    if (registered) {
      cursorShortcutInfo = {
        registered: true,
        shortcut: candidate.shortcut,
        displayShortcut: candidate.displayShortcut,
        isFallback: candidate.isFallback,
        diagnostic: candidate.isFallback
          ? `Primary shortcut Ctrl+Shift+F is occupied by another application. Using fallback shortcut: ${candidate.displayShortcut}.`
          : undefined,
      }
      registeredSuccessfully = true

      if (candidate.isFallback) {
        console.warn(
          `[main] Primary shortcut Ctrl+Shift+F is occupied by another system application. ` +
          `Successfully registered fallback shortcut: ${candidate.displayShortcut}`
        )
      } else {
        console.log(`[main] Global shortcut registered successfully: ${candidate.displayShortcut}`)
      }
      break
    } else {
      console.warn(`[main] Failed to register global shortcut: ${candidate.shortcut} (occupied by another process or unavailable)`)
    }
  }

  if (!registeredSuccessfully) {
    cursorShortcutInfo = {
      registered: false,
      shortcut: '',
      displayShortcut: 'Ctrl+Shift+F',
      isFallback: false,
      diagnostic: 'All global shortcuts failed to register due to system-level conflicts. Use the "Analyze Cursor" button directly.',
    }
    console.warn('[main] All global shortcut candidates failed to register. Cursor analysis remains available via the Analyze Cursor button in the UI.')
  }
}

app.on('will-quit', () => {
  // Clean up global shortcuts when app exits
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  // On macOS, keep the app running without windows
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// ─── Security: block navigation away from the app ────────────────────────────
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl)
    // In dev, allow localhost; in production, deny all navigation
    if (!isDev || parsedUrl.host !== 'localhost') {
      event.preventDefault()
    }
  })
})

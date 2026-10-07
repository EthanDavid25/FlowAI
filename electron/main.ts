import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { captureScreen } from './services/screenCapture'
import { OllamaVisionProvider } from './services/ai/OllamaVisionProvider'

// ─── AI providers ─────────────────────────────────────────────────────────────
// Instantiated once — stateless, safe to reuse across requests.
const ollamaProvider = new OllamaVisionProvider()

// ─── Environment detection ───────────────────────────────────────────────────
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

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
  ipcMain.handle('screen:capture', () => captureScreen())

  // Foundation 3: vision AI analysis
  // Receives the data URL from the renderer, strips the prefix, sends base64
  // to Ollama via OllamaVisionProvider, returns AnalysisResponse.
  ipcMain.handle('ai:analyze', (_event, dataUrl: string) => {
    // dataUrl format: "data:image/png;base64,<base64data>"
    // Ollama expects only the raw base64 portion.
    const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl
    return ollamaProvider.analyzeImage(base64)
  })

  createWindow()

  app.on('activate', () => {
    // macOS: re-create window when dock icon is clicked and no windows open
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
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

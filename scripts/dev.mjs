/**
 * scripts/dev.mjs
 *
 * Development launcher — starts Vite dev server first, waits for it to be
 * ready, then launches Electron pointing at the Vite server URL.
 *
 * This avoids the race condition of Electron opening before Vite is listening.
 */

import { spawn } from 'child_process'
import { createServer } from 'vite'

const VITE_PORT = 5173

async function main() {
  // 1. Start Vite dev server
  const server = await createServer({
    configFile: 'vite.config.ts',
    mode: 'development',
  })
  await server.listen(VITE_PORT)
  server.printUrls()

  const url = `http://localhost:${VITE_PORT}`

  // 2. Launch Electron with env vars
  const electron = spawn(
    process.platform === 'win32' ? 'node_modules\\.bin\\electron.cmd' : 'node_modules/.bin/electron',
    ['.'],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: 'development',
        VITE_DEV_SERVER_URL: url,
      },
      shell: false,
    }
  )

  electron.on('close', () => {
    server.close()
    process.exit(0)
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

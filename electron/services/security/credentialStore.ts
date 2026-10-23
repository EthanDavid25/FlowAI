/**
 * electron/services/security/credentialStore.ts
 *
 * Secure Credential Storage Service (Main Process)
 *
 * Encapsulates encrypted storage of API keys and tokens for AI providers
 * (e.g. Gemini, OpenAI, Claude) using Electron's native `safeStorage` API.
 *
 * Security properties:
 *  - Encryption at rest: Uses OS-level hardware/user keychain:
 *      * Windows: DPAPI (Data Protection API)
 *      * macOS: Keychain
 *      * Linux: Secret Service API / libsecret / KWallet
 *  - Storage path: Stored strictly within the application's `userData` folder.
 *  - No plaintext fallback: If `safeStorage.isEncryptionAvailable()` is false,
 *    operations fail explicitly. Plaintext credentials are NEVER written to disk.
 *  - Zero credential leakage: Credentials are never logged or exposed in error messages.
 *  - Main-process only: Never exposed directly to the renderer.
 */

import { app, safeStorage } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'

// ─── Response envelope pattern (FlowAI standard) ──────────────────────────────

export type CredentialStoreResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

// ─── File Storage Types ───────────────────────────────────────────────────────

/**
 * Persisted storage schema.
 * Maps provider IDs (e.g. "gemini", "openai") to base64-encoded encrypted buffers.
 */
type EncryptedCredentialMap = Record<string, string>

const CREDENTIAL_FILE_NAME = 'flowai-credentials.enc'

/**
 * Returns the absolute path to the credentials file in the app's userData directory.
 */
function getStorageFilePath(): string {
  return join(app.getPath('userData'), CREDENTIAL_FILE_NAME)
}

/**
 * Internal helper to read and parse the encrypted credential map from disk.
 * Returns an empty map if the file does not exist yet.
 */
async function readStore(): Promise<EncryptedCredentialMap> {
  const filePath = getStorageFilePath()
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    if (!raw.trim()) {
      return {}
    }
    const parsed = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as EncryptedCredentialMap
    }
    return {}
  } catch (err: unknown) {
    // If the file does not exist, return an empty map
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'ENOENT') {
      return {}
    }
    // For corrupted JSON or unexpected read errors, log the code/message (never data)
    console.warn('[credentialStore] Warning: could not read existing credentials file; starting fresh.')
    return {}
  }
}

/**
 * Internal helper to write the encrypted credential map to disk atomically.
 */
async function writeStore(store: EncryptedCredentialMap): Promise<void> {
  const filePath = getStorageFilePath()
  const payload = JSON.stringify(store, null, 2)
  await fs.writeFile(filePath, payload, { encoding: 'utf-8', mode: 0o600 })
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Checks whether OS-level credential encryption is supported and ready.
 * Note: Must be called after app 'ready' event.
 */
export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

/**
 * Securely encrypts and saves an API key or secret token for a specific provider.
 *
 * @param provider - Unique provider identifier (e.g. "gemini", "openai", "claude")
 * @param secret   - Plaintext API key / token to encrypt and store
 */
export async function saveCredential(
  provider: string,
  secret: string
): Promise<CredentialStoreResponse<void>> {
  if (!provider || typeof provider !== 'string') {
    return { ok: false, error: 'Invalid provider identifier' }
  }
  if (!secret || typeof secret !== 'string') {
    return { ok: false, error: 'Credential secret cannot be empty' }
  }

  if (!safeStorage.isEncryptionAvailable()) {
    return {
      ok: false,
      error: 'OS-level credential encryption is unavailable. Refusing to store credential in plaintext.',
    }
  }

  try {
    const trimmedSecret = secret.trim()
    const encryptedBuffer = safeStorage.encryptString(trimmedSecret)
    const base64Encrypted = encryptedBuffer.toString('base64')

    const store = await readStore()
    store[provider.toLowerCase()] = base64Encrypted
    await writeStore(store)

    return { ok: true, data: undefined }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown storage error'
    return { ok: false, error: `Failed to securely save credential: ${msg}` }
  }
}

/**
 * Retrieves and decrypts the stored credential for a provider.
 * Returns null if no credential has been stored for the given provider.
 *
 * @param provider - Unique provider identifier
 */
export async function getCredential(
  provider: string
): Promise<CredentialStoreResponse<string | null>> {
  if (!provider || typeof provider !== 'string') {
    return { ok: false, error: 'Invalid provider identifier' }
  }

  if (!safeStorage.isEncryptionAvailable()) {
    return {
      ok: false,
      error: 'OS-level credential encryption is unavailable. Cannot decrypt credentials.',
    }
  }

  try {
    const store = await readStore()
    const base64Encrypted = store[provider.toLowerCase()]

    if (!base64Encrypted) {
      return { ok: true, data: null }
    }

    const encryptedBuffer = Buffer.from(base64Encrypted, 'base64')
    const decryptedSecret = safeStorage.decryptString(encryptedBuffer)

    return { ok: true, data: decryptedSecret }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown decryption error'
    return { ok: false, error: `Failed to decrypt credential: ${msg}` }
  }
}

/**
 * Checks whether a credential exists for the given provider without decrypting it.
 *
 * @param provider - Unique provider identifier
 */
export async function hasCredential(
  provider: string
): Promise<CredentialStoreResponse<boolean>> {
  if (!provider || typeof provider !== 'string') {
    return { ok: false, error: 'Invalid provider identifier' }
  }

  try {
    const store = await readStore()
    const exists = Boolean(store[provider.toLowerCase()])
    return { ok: true, data: exists }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown storage error'
    return { ok: false, error: `Failed to inspect credential store: ${msg}` }
  }
}

/**
 * Deletes the stored credential for a provider.
 *
 * @param provider - Unique provider identifier
 */
export async function deleteCredential(
  provider: string
): Promise<CredentialStoreResponse<void>> {
  if (!provider || typeof provider !== 'string') {
    return { ok: false, error: 'Invalid provider identifier' }
  }

  try {
    const store = await readStore()
    const key = provider.toLowerCase()

    if (key in store) {
      delete store[key]
      await writeStore(store)
    }

    return { ok: true, data: undefined }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown storage error'
    return { ok: false, error: `Failed to delete credential: ${msg}` }
  }
}

/**
 * Lists all provider identifiers that currently have credentials stored.
 */
export async function listConfiguredProviders(): Promise<CredentialStoreResponse<string[]>> {
  try {
    const store = await readStore()
    return { ok: true, data: Object.keys(store) }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown storage error'
    return { ok: false, error: `Failed to list configured providers: ${msg}` }
  }
}

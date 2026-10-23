import { useState, useEffect, useCallback } from 'react'
import type { VisionProviderId, VisionProviderStatus } from '../../types/screenUnderstanding'
import styles from './VisionProviderSelector.module.css'

interface VisionProviderSelectorProps {
  disabled?: boolean
  onProviderChange?: (provider: VisionProviderId, status?: VisionProviderStatus) => void
}

function KeyIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 2l-2 2m-1.5 1.5L14 9l-1.5-1.5L10 10l-1.5-1.5L6 11l-4 4v5h5l4-4 2.5-2.5 1.5 1.5 2.5-2.5-1.5-1.5 3.5-3.5z" />
      <circle cx="7.5" cy="16.5" r="1.5" />
    </svg>
  )
}

export default function VisionProviderSelector({
  disabled = false,
  onProviderChange,
}: VisionProviderSelectorProps) {
  const [activeProvider, setActiveProvider] = useState<VisionProviderId>('gemini')
  const [statuses, setStatuses] = useState<Record<VisionProviderId, VisionProviderStatus>>({
    gemini: {
      id: 'gemini',
      name: 'Gemini Vision',
      ready: false,
      message: 'Checking status...',
      model: 'gemini-3.8-flash',
    },
    ollama: {
      id: 'ollama',
      name: 'Ollama Vision',
      ready: false,
      message: 'Checking status...',
      model: 'qwen3-vl:2b',
    },
  })

  const [showKeyModal, setShowKeyModal] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [keyFeedback, setKeyFeedback] = useState<{ error?: string; success?: string } | null>(null)
  const [isSavingKey, setIsSavingKey] = useState(false)

  const refreshStatuses = useCallback(async () => {
    if (!window.flowAI?.getVisionProvider) return
    try {
      const data = await window.flowAI.getVisionProvider()
      if (data) {
        if (data.active) {
          setActiveProvider(data.active)
          onProviderChange?.(data.active, data.statuses?.[data.active])
        }
        if (data.statuses) {
          setStatuses(data.statuses)
        }
      }
    } catch (err) {
      console.warn('[VisionProviderSelector] Error querying vision provider status:', err)
    }
  }, [onProviderChange])

  useEffect(() => {
    refreshStatuses()
  }, [refreshStatuses])

  const handleSelectProvider = async (id: VisionProviderId) => {
    if (disabled || id === activeProvider) return

    try {
      const res = await window.flowAI.setVisionProvider(id)
      if (res && res.ok && res.active) {
        setActiveProvider(res.active)
        const updatedStatus = statuses[res.active]
        onProviderChange?.(res.active, updatedStatus)
      }
    } catch (err) {
      console.error('[VisionProviderSelector] Failed to set vision provider:', err)
    }
  }

  const handleSaveGeminiKey = async () => {
    const trimmed = keyInput.trim()
    if (!trimmed) {
      setKeyFeedback({ error: 'Please enter a valid Gemini API key.' })
      return
    }

    setIsSavingKey(true)
    setKeyFeedback(null)

    try {
      const res = await window.flowAI.setApiKey('gemini', trimmed)
      if (res.ok) {
        setKeyFeedback({ success: 'Gemini API key encrypted and saved securely!' })
        setKeyInput('')
        await refreshStatuses()
        setTimeout(() => {
          setShowKeyModal(false)
          setKeyFeedback(null)
        }, 1000)
      } else {
        setKeyFeedback({ error: res.error ?? 'Failed to save key.' })
      }
    } catch (err) {
      setKeyFeedback({ error: 'Failed to communicate with secure credential store.' })
    } finally {
      setIsSavingKey(false)
    }
  }

  const geminiStatus = statuses.gemini
  const ollamaStatus = statuses.ollama

  return (
    <div className={styles.selectorContainer}>
      <div className={styles.selectorWrapper} role="radiogroup" aria-label="Vision AI Provider">
        {/* Gemini Vision Option */}
        <button
          type="button"
          role="radio"
          aria-checked={activeProvider === 'gemini'}
          disabled={disabled}
          className={`${styles.providerBtn} ${
            activeProvider === 'gemini' ? styles.providerBtnActive : ''
          }`}
          onClick={() => handleSelectProvider('gemini')}
          title={`Gemini Vision (${geminiStatus.model}): ${geminiStatus.message}`}
        >
          <span
            className={`${styles.statusDot} ${
              geminiStatus.ready ? styles.statusReady : styles.statusNotReady
            }`}
            aria-hidden="true"
          />
          <span>Gemini Vision</span>
          <span className={styles.modelBadge}>3.8 Flash</span>
        </button>

        {/* Ollama Vision Option */}
        <button
          type="button"
          role="radio"
          aria-checked={activeProvider === 'ollama'}
          disabled={disabled}
          className={`${styles.providerBtn} ${
            activeProvider === 'ollama' ? styles.providerBtnActive : ''
          }`}
          onClick={() => handleSelectProvider('ollama')}
          title={`Ollama Vision (${ollamaStatus.model}): ${ollamaStatus.message}`}
        >
          <span
            className={`${styles.statusDot} ${
              ollamaStatus.ready ? styles.statusReady : styles.statusNotReady
            }`}
            aria-hidden="true"
          />
          <span>Ollama Vision</span>
          <span className={styles.modelBadge}>Qwen3-VL</span>
        </button>

        {/* Key configuration button for Gemini */}
        <button
          type="button"
          className={styles.keyConfigBtn}
          onClick={() => {
            setKeyFeedback(null)
            setShowKeyModal(true)
          }}
          disabled={disabled}
          title="Configure Gemini API Key"
          aria-label="Configure Gemini API Key"
        >
          <KeyIcon />
        </button>
      </div>

      {/* Key Setup Modal */}
      {showKeyModal && (
        <div
          className={styles.modalOverlay}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowKeyModal(false)
          }}
        >
          <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <div className={styles.modalHeader}>
              <h2 id="modal-title" className={styles.modalTitle}>
                <KeyIcon />
                <span>Configure Gemini API Key</span>
              </h2>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={() => setShowKeyModal(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <p className={styles.modalDesc}>
              Enter your Google Gemini API key to enable Gemini Vision and Chat. Keys are
              encrypted at rest using OS-level DPAPI protection and never exposed to the UI.
            </p>

            <div className={styles.inputGroup}>
              <input
                type="password"
                className={styles.keyInput}
                placeholder="AIzaSy..."
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveGeminiKey()
                }}
                autoFocus
              />
              {keyFeedback?.error && <p className={styles.feedbackError}>{keyFeedback.error}</p>}
              {keyFeedback?.success && (
                <p className={styles.feedbackSuccess}>{keyFeedback.success}</p>
              )}
            </div>

            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.cancelBtn}
                onClick={() => setShowKeyModal(false)}
                disabled={isSavingKey}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.saveBtn}
                onClick={handleSaveGeminiKey}
                disabled={isSavingKey || !keyInput.trim()}
              >
                {isSavingKey ? 'Saving…' : 'Save Key'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

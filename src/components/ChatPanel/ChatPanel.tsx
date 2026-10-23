import { useState, useEffect, useRef } from 'react'
import styles from './ChatPanel.module.css'

interface DisplayMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  imageContext?: string
  timestamp: number
  model?: string
  durationMs?: number
  totalTokens?: number | null
  isError?: boolean
}

interface ChatPanelProps {
  latestScreenshot?: string | null
}

function SparkleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z"
        fill="currentColor"
      />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2.01 21L23 12L2.01 3L2 10L17 12L2 14L2.01 21Z"
        fill="currentColor"
      />
    </svg>
  )
}

function KeyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 2l-2 2m-1.5 1.5L14 9l-1.5-1.5L10 10l-1.5-1.5L6 11l-4 4v5h5l4-4 2.5-2.5 1.5 1.5 2.5-2.5-1.5-1.5 3.5-3.5z" />
      <circle cx="7.5" cy="16.5" r="1.5" />
    </svg>
  )
}

function ScreenContextIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  )
}

export default function ChatPanel({ latestScreenshot }: ChatPanelProps) {
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [inputText, setInputText] = useState('')
  const [attachScreen, setAttachScreen] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [showKeyModal, setShowKeyModal] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [keyFeedback, setKeyFeedback] = useState<{ error?: string; success?: string } | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Query API key status on mount
  useEffect(() => {
    checkApiKeyStatus()
  }, [])

  // Auto-scroll when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isSending])

  const checkApiKeyStatus = async () => {
    try {
      const configured = await window.flowAI?.hasApiKey?.('gemini')
      setHasKey(Boolean(configured))
    } catch {
      setHasKey(false)
    }
  }

  const handleSendMessage = async () => {
    const text = inputText.trim()
    if (!text || isSending) return

    // If API key is not configured, open the modal
    if (hasKey === false) {
      setShowKeyModal(true)
      return
    }

    const imageToAttach = attachScreen && latestScreenshot ? latestScreenshot : undefined

    const userMessage: DisplayMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      imageContext: imageToAttach,
      timestamp: Date.now(),
    }

    const updatedMessages = [...messages, userMessage]
    setMessages(updatedMessages)
    setInputText('')
    setIsSending(true)

    // Build the payload history for the AI provider
    const payloadHistory: ChatMessage[] = updatedMessages
      .filter((m) => !m.isError)
      .map((m) => ({
        role: m.role,
        content: m.content,
        imageContext: m.imageContext,
      }))

    try {
      const response = await window.flowAI.sendChatMessage(payloadHistory, {
        model: 'gemini-3.8-flash',
      })

      if (response.ok) {
        const assistantMessage: DisplayMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: response.data.content,
          model: response.data.model,
          durationMs: response.data.durationMs,
          totalTokens: response.data.totalTokens,
          timestamp: Date.now(),
        }
        setMessages((prev) => [...prev, assistantMessage])
      } else {
        const errorMessage: DisplayMessage = {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: `Error: ${response.error}`,
          isError: true,
          timestamp: Date.now(),
        }
        setMessages((prev) => [...prev, errorMessage])
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      const errorMessage: DisplayMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `Request failed: ${msg}`,
        isError: true,
        timestamp: Date.now(),
      }
      setMessages((prev) => [...prev, errorMessage])
    } finally {
      setIsSending(false)
      // Reset attach screen after sending to avoid inadvertent repeated screen transmission
      if (attachScreen) {
        setAttachScreen(false)
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  const handleSaveKey = async () => {
    const trimmed = keyInput.trim()
    if (!trimmed) {
      setKeyFeedback({ error: 'Please enter a valid Gemini API key.' })
      return
    }

    try {
      const res = await window.flowAI.setApiKey('gemini', trimmed)
      if (res.ok) {
        setKeyFeedback({ success: 'Gemini API key encrypted and saved securely!' })
        setKeyInput('') // Wipe from memory
        setHasKey(true)
        setTimeout(() => {
          setShowKeyModal(false)
          setKeyFeedback(null)
        }, 1200)
      } else {
        setKeyFeedback({ error: res.error ?? 'Failed to save key.' })
      }
    } catch (err) {
      setKeyFeedback({ error: 'Failed to communicate with secure credential store.' })
    }
  }

  const handleDeleteKey = async () => {
    try {
      const res = await window.flowAI.deleteApiKey('gemini')
      if (res.ok) {
        setHasKey(false)
        setKeyFeedback({ success: 'API key removed from secure storage.' })
        setTimeout(() => {
          setShowKeyModal(false)
          setKeyFeedback(null)
        }, 1000)
      }
    } catch {
      setKeyFeedback({ error: 'Failed to remove API key.' })
    }
  }

  return (
    <div className={styles.chatContainer}>
      {/* Top Bar */}
      <div className={styles.topBar}>
        <div className={styles.topBarLeft}>
          <span className={styles.modelBadge}>
            <SparkleIcon />
            gemini-3.8-flash
          </span>
        </div>

        <div className={styles.topBarRight}>
          <button
            className={styles.keyButton}
            onClick={() => {
              setKeyFeedback(null)
              setShowKeyModal(true)
            }}
            title="Configure Gemini API Key"
          >
            <span
              className={hasKey ? styles.keyDotConfigured : styles.keyDotMissing}
              aria-hidden="true"
            />
            <KeyIcon />
            <span>{hasKey ? 'Key Configured' : 'Configure Key'}</span>
          </button>

          {messages.length > 0 && (
            <button
              className={styles.clearButton}
              onClick={() => setMessages([])}
              title="Clear conversation"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Warning banner if key is not configured */}
      {hasKey === false && (
        <div className={styles.keyNoticeBanner}>
          <span>⚠️ Gemini API key is required to start chatting.</span>
          <button
            className={styles.keyNoticeAction}
            onClick={() => setShowKeyModal(true)}
          >
            Add Key
          </button>
        </div>
      )}

      {/* Messages Scroll Area */}
      <div className={styles.messagesList}>
        {messages.length === 0 ? (
          <div className={styles.emptyChat}>
            <div className={styles.emptyIcon}>
              <SparkleIcon />
            </div>
            <p className={styles.emptyTitle}>Chat with FlowAI</p>
            <p className={styles.emptyHint}>
              Ask questions, get coding help, or check <strong>Attach screen</strong> to analyze active windows and errors with Gemini 3.8 Flash.
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`${styles.messageRow} ${
                msg.role === 'user' ? styles.userRow : styles.assistantRow
              }`}
            >
              <div className={styles.messageMeta}>
                <span>{msg.role === 'user' ? 'You' : 'FlowAI (Gemini)'}</span>
                <span>
                  {new Date(msg.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>

              <div
                className={`${
                  msg.role === 'user'
                    ? styles.userBubble
                    : msg.isError
                    ? `${styles.assistantBubble} ${styles.errorBubble}`
                    : styles.assistantBubble
                } selectable`}
              >
                {msg.imageContext && (
                  <div className={styles.screenBadge}>
                    <ScreenContextIcon />
                    <span>Screenshot Attached</span>
                  </div>
                )}
                <div>{msg.content}</div>

                {msg.role === 'assistant' && !msg.isError && (
                  <div className={styles.bubbleFooter}>
                    {msg.durationMs != null && (
                      <span className={styles.bubbleStat}>
                        {(msg.durationMs / 1000).toFixed(1)}s
                      </span>
                    )}
                    {msg.totalTokens != null && (
                      <span className={styles.bubbleStat}>
                        {msg.totalTokens} tokens
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))
        )}

        {isSending && (
          <div className={`${styles.messageRow} ${styles.assistantRow}`}>
            <div className={styles.thinkingBubble}>
              <div className={styles.dotFlashing} />
              <span>Thinking…</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Bottom Input Area */}
      <div className={styles.inputArea}>
        <div className={styles.inputControlsRow}>
          <label className={styles.attachScreenLabel} title="Send the latest captured screenshot along with your question">
            <input
              type="checkbox"
              className={styles.attachCheckbox}
              checked={attachScreen}
              onChange={(e) => setAttachScreen(e.target.checked)}
              disabled={!latestScreenshot || isSending}
            />
            <ScreenContextIcon />
            <span>
              {latestScreenshot ? 'Attach current screen' : 'Attach screen (capture screen first)'}
            </span>
          </label>

          <span className={styles.inputHint}>Enter ↵ to send · Shift+Enter for new line</span>
        </div>

        <div className={styles.inputWrapper}>
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              hasKey === false
                ? 'Configure your Gemini API key above to start chatting…'
                : 'Ask FlowAI anything…'
            }
            rows={2}
            disabled={isSending}
          />

          <button
            className={styles.sendButton}
            onClick={handleSendMessage}
            disabled={!inputText.trim() || isSending}
            title="Send message"
            aria-label="Send message"
          >
            <SendIcon />
          </button>
        </div>
      </div>

      {/* API Key Modal */}
      {showKeyModal && (
        <div className={styles.modalBackdrop} onClick={() => setShowKeyModal(false)}>
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Gemini API Key</h3>
              <button
                className={styles.modalCloseBtn}
                onClick={() => setShowKeyModal(false)}
                aria-label="Close dialog"
              >
                ✕
              </button>
            </div>

            <p className={styles.modalDesc}>
              Enter your Google AI Studio API key. FlowAI encrypts credentials using Windows DPAPI (via Electron safeStorage) before saving to disk. Plaintext keys are never stored.
            </p>

            <div className={keyInputGroupClass()}>
              <label className={styles.keyInputLabel} htmlFor="gemini-key-input">
                API Key
              </label>
              <input
                id="gemini-key-input"
                type="password"
                className={styles.keyInput}
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder="AIzaSy..."
                autoFocus
              />
            </div>

            {keyFeedback?.error && (
              <p className={styles.modalFeedbackError}>{keyFeedback.error}</p>
            )}
            {keyFeedback?.success && (
              <p className={styles.modalFeedbackSuccess}>{keyFeedback.success}</p>
            )}

            <div className={styles.modalActions}>
              {hasKey && (
                <button
                  type="button"
                  className={styles.removeKeyBtn}
                  onClick={handleDeleteKey}
                >
                  Delete Key
                </button>
              )}
              <button
                type="button"
                className={styles.saveKeyBtn}
                onClick={handleSaveKey}
              >
                Save Encrypted Key
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  function keyInputGroupClass() {
    return styles.keyInputGroup
  }
}

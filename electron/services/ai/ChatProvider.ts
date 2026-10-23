/**
 * electron/services/ai/ChatProvider.ts
 *
 * Abstract contract and data models for conversational AI providers in FlowAI.
 *
 * Design goals:
 *  - Provider-agnostic interface for general-purpose user Q&A.
 *  - Accommodates text-only queries as well as optional screenshot/visual context.
 *  - Implementable by cloud providers (e.g. Gemini, OpenAI, Claude) and local providers (e.g. Ollama).
 *  - Follows FlowAI's discriminated response envelope pattern ({ ok: true; data } | { ok: false; error }).
 */

// ─── Chat Message Types ───────────────────────────────────────────────────────

export type ChatRole = 'user' | 'assistant' | 'system'

/**
 * A single message in a conversation thread.
 */
export interface ChatMessage {
  /** The author role of the message */
  role: ChatRole
  /** The text content of the message */
  content: string
  /**
   * Optional base64-encoded image data URL or raw base64 string
   * representing a captured screenshot used as visual grounding context.
   */
  imageContext?: string
}

// ─── Chat Result & Response Types ─────────────────────────────────────────────

/**
 * Successful response payload from a conversational AI provider.
 */
export interface ChatResult {
  /** The text content returned by the model */
  content: string
  /** Identifier of the model that generated the response (e.g. "gemini-3.8-flash") */
  model: string
  /** Identifier of the provider (e.g. "gemini", "ollama") */
  provider: string
  /** How long the request took in milliseconds */
  durationMs: number
  /** Total tokens consumed (prompt + completion), if reported by the provider */
  totalTokens: number | null
}

/**
 * Response envelope returned by chat operations — never rejects.
 */
export type ChatResponse =
  | { ok: true; data: ChatResult }
  | { ok: false; error: string }

// ─── Chat Options ─────────────────────────────────────────────────────────────

/**
 * Optional execution parameters passed to a chat provider.
 */
export interface ChatOptions {
  /** Override the provider's default model */
  model?: string
  /** Sampling temperature (typically 0.0 to 2.0) */
  temperature?: number
  /** Maximum number of tokens to generate in the response */
  maxOutputTokens?: number
}

// ─── Provider Interface ───────────────────────────────────────────────────────

/**
 * Contract that every conversational AI backend must satisfy.
 */
export interface ChatProvider {
  /** Unique identifier for the provider (e.g. "gemini", "ollama") */
  readonly providerId: string

  /**
   * Sends a sequence of conversation messages to the provider and returns
   * the assistant's response.
   *
   * @param messages - Full or truncated conversation history up to the latest user message.
   * @param options  - Optional generation settings.
   */
  sendMessage(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>
}

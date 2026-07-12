import "server-only";
import { z } from "zod";
import {
  buildMarinaBookApiUrl,
  getMarinaBookApiKey,
  getMarinaBookErrorMessage,
} from "@/lib/marinabook-api";
import {
  isMarinaBookUrl,
  type MarinaBookSource,
  sanitizeSources,
} from "@/lib/marinabook-metadata";

// Server-side client for the MarinaBook backend orchestrator endpoint
// POST {MARINABOOK_API_URL}/api/assistant/ai-search.
//
// Verified contract:
//   - S2S profile: the request is authenticated with the server-only header
//     `x-marinabook-assistant-key`, whose value comes exclusively from the
//     MARINABOOK_ASSISTANT_API_KEY server env var (same key as the
//     search-availability / prepare-booking tools). The key is never exposed
//     through NEXT_PUBLIC_*, never sent to the browser and never logged.
//     A missing/empty key fails cleanly BEFORE any network call
//     (reason: "not_configured") — there is no keyless fallback.
//   - Request body: { message (required), sessionId (required, 1..128),
//     locale? }. Unknown keys are ignored by the backend.
//   - Success 200: { reply, detectedLanguage?, intent?, searchParams?,
//     results?, sources?, assistantMode, requestId }.
//   - 429 is a controlled technical failure (reason: "rate_limited"); the
//     Retry-After header is surfaced as retryAfterSeconds when parseable —
//     the current mechanism is single-shot, so no retry is attempted.
//   - Any other non-2xx / non-JSON / network / timeout is a technical failure
//     (ok: false) so the caller shows a neutral message and NEVER falls back
//     to a local LLM.
//
// This client only calls the backend once and never invokes any LLM.

const AI_SEARCH_TIMEOUT_MS = 45_000;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_SESSION_ID_LENGTH = 128;

const aiSearchResultSchema = z
  .object({
    available: z.boolean().optional(),
    bookingUrl: z.string().optional(),
    currency: z.string().optional(),
    placeType: z.string().optional(),
    portName: z.string().optional(),
    price: z.number().optional(),
  })
  .loose();

const aiSearchResponseSchema = z
  .object({
    assistantMode: z.string().optional(),
    detectedLanguage: z.string().optional(),
    intent: z.string().optional(),
    reply: z.string().optional(),
    requestId: z.string().optional(),
    results: z.array(aiSearchResultSchema).optional(),
    searchParams: z.unknown().optional(),
    sources: z.array(z.unknown()).optional(),
  })
  .loose();

export type MarinaBookAvailabilityResult = {
  available?: boolean;
  bookingUrl?: string;
  currency?: string;
  placeType?: string;
  portName?: string;
  price?: number;
};

export type MarinaBookAiSearchAnswer = {
  assistantMode?: string;
  detectedLanguage?: string;
  intent?: string;
  reply: string;
  requestId?: string;
  results: MarinaBookAvailabilityResult[];
  searchParams?: Record<string, unknown>;
  sources: MarinaBookSource[];
};

// Failure reasons stay coarse and never carry backend/user data: they exist so
// tests and telemetry can tell a server misconfiguration or a rate limit apart
// from a generic technical failure. The user-facing handling is identical
// (neutral technical message, no LLM fallback).
export type MarinaBookAiSearchFailureReason =
  | "not_configured"
  | "rate_limited"
  | "technical";

export type MarinaBookAiSearchResult =
  | { ok: true; data: MarinaBookAiSearchAnswer }
  | {
      ok: false;
      reason?: MarinaBookAiSearchFailureReason;
      retryAfterSeconds?: number;
    };

export type MarinaBookAiSearchInput = {
  locale?: string;
  message: string;
  sessionId: string;
};

// Neutral, non-documentary failure messages. A technical failure must never be
// turned into an invented answer; it just tells the user to retry.
const NEUTRAL_TECHNICAL_MESSAGES: Record<string, string> = {
  ar: "خدمة المساعد غير متوفرة مؤقتًا. يرجى المحاولة مرة أخرى بعد قليل.",
  de: "Der Assistent ist vorübergehend nicht verfügbar. Bitte versuchen Sie es in Kürze erneut.",
  en: "The assistant is temporarily unavailable. Please try again shortly.",
  es: "El asistente no está disponible temporalmente. Vuelva a intentarlo en unos instantes.",
  fr: "L’assistant est temporairement indisponible. Merci de réessayer dans quelques instants.",
  it: "L’assistente è temporaneamente non disponibile. Riprovi tra qualche istante.",
  pt: "O assistente está temporariamente indisponível. Tente novamente dentro de alguns instantes.",
};

export function getNeutralTechnicalMessage(locale?: string): string {
  const base = locale?.trim().slice(0, 2).toLowerCase();
  return (
    (base && NEUTRAL_TECHNICAL_MESSAGES[base]) ?? NEUTRAL_TECHNICAL_MESSAGES.fr
  );
}

function sanitizeResults(
  results: z.infer<typeof aiSearchResultSchema>[] | undefined
): MarinaBookAvailabilityResult[] {
  if (!results) {
    return [];
  }

  return results.map((result) => {
    const sanitized: MarinaBookAvailabilityResult = {};

    if (typeof result.portName === "string") {
      sanitized.portName = result.portName;
    }
    if (typeof result.placeType === "string") {
      sanitized.placeType = result.placeType;
    }
    if (typeof result.currency === "string") {
      sanitized.currency = result.currency;
    }
    if (typeof result.price === "number") {
      sanitized.price = result.price;
    }
    if (typeof result.available === "boolean") {
      sanitized.available = result.available;
    }
    // bookingUrl is only kept when it is a safe HTTPS MarinaBook link.
    if (isMarinaBookUrl(result.bookingUrl)) {
      sanitized.bookingUrl = result.bookingUrl.trim();
    }

    return sanitized;
  });
}

// Parses a Retry-After header expressed in seconds. HTTP-date variants (or any
// unparseable value) are ignored: the caller has no retry loop anyway.
function parseRetryAfterSeconds(response: Response): number | undefined {
  const rawValue = response.headers.get("retry-after");

  if (!rawValue) {
    return;
  }

  const seconds = Number.parseInt(rawValue.trim(), 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

export async function callMarinaBookAiSearch(
  input: MarinaBookAiSearchInput
): Promise<MarinaBookAiSearchResult> {
  const endpoint = buildMarinaBookApiUrl("/assistant/ai-search");
  const apiKey = getMarinaBookApiKey();

  // Server configuration error: fail cleanly BEFORE any network call, without
  // any keyless fallback. Only the variable NAMES are logged — never a value.
  if (!(endpoint && apiKey)) {
    console.error(
      "[ai-search] Missing server configuration (MARINABOOK_API_URL/BACKEND_URL or MARINABOOK_ASSISTANT_API_KEY)."
    );
    return { ok: false, reason: "not_configured" };
  }

  const message = input.message.trim().slice(0, MAX_MESSAGE_LENGTH);
  const sessionId = input.sessionId.trim().slice(0, MAX_SESSION_ID_LENGTH);

  if (!(message && sessionId)) {
    return { ok: false, reason: "technical" };
  }

  const locale = input.locale?.trim();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_SEARCH_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      body: JSON.stringify({
        message,
        sessionId,
        ...(locale && { locale }),
      }),
      // Server-to-server profile: the assistant key is added server-side only.
      headers: {
        "content-type": "application/json",
        "x-marinabook-assistant-key": apiKey,
      },
      method: "POST",
      signal: controller.signal,
    });

    if (response.status === 429) {
      // Controlled technical failure: surface Retry-After when parseable, but
      // never retry (single-shot mechanism) and never fall back to a local LLM.
      await getMarinaBookErrorMessage(response);
      const retryAfterSeconds = parseRetryAfterSeconds(response);
      return {
        ok: false,
        reason: "rate_limited",
        ...(retryAfterSeconds !== undefined && { retryAfterSeconds }),
      };
    }

    if (!response.ok) {
      // Consume the body so the connection is released; the message is not
      // surfaced (neutral failure handling happens in the caller).
      await getMarinaBookErrorMessage(response);
      return { ok: false, reason: "technical" };
    }

    const raw = await response.json();
    const parsed = aiSearchResponseSchema.safeParse(raw);
    const payload = parsed.success ? parsed.data : {};
    const reply = typeof payload.reply === "string" ? payload.reply.trim() : "";

    if (!reply) {
      return { ok: false, reason: "technical" };
    }

    const searchParams =
      payload.searchParams && typeof payload.searchParams === "object"
        ? (payload.searchParams as Record<string, unknown>)
        : undefined;

    return {
      data: {
        reply,
        results: sanitizeResults(payload.results),
        sources: sanitizeSources(payload.sources),
        ...(typeof payload.assistantMode === "string" && {
          assistantMode: payload.assistantMode,
        }),
        ...(typeof payload.requestId === "string" && {
          requestId: payload.requestId,
        }),
        ...(typeof payload.detectedLanguage === "string" && {
          detectedLanguage: payload.detectedLanguage,
        }),
        ...(typeof payload.intent === "string" && { intent: payload.intent }),
        ...(searchParams !== undefined && { searchParams }),
      },
      ok: true,
    };
  } catch {
    // Network error, timeout/abort or invalid JSON: technical failure. The
    // caught error is intentionally not logged (it could echo request data);
    // nothing containing the key is ever thrown by this function anyway.
    return { ok: false, reason: "technical" };
  } finally {
    clearTimeout(timeout);
  }
}

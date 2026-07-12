import { z } from "zod";

// Optional metadata that the MarinaBook backend MAY add to any assistant
// response (search-availability / prepare-booking). Every field is optional and
// must never be treated as required: the chatbot stays fully compatible with an
// older backend that returns none of them.
//
//   - assistantMode: how the backend answered (validated answer, RAG, Groq
//     fallback, …). The chatbot NEVER derives business logic from it; it is only
//     forwarded to the trusted MarinaBook frontend for analytics/telemetry.
//   - requestId: backend correlation id, forwarded for support/log correlation.
//   - sources: documentary sources (RAG / knowledge base) to display to the
//     user. Sanitized here so only safe absolute HTTPS links ever reach the UI.

const MAX_SOURCES = 8;
const MAX_TITLE_LENGTH = 200;
const MAX_SNIPPET_LENGTH = 400;
const MAX_ASSISTANT_MODE_LENGTH = 64;
const MAX_REQUEST_ID_LENGTH = 128;

export const marinaBookSourceSchema = z.object({
  snippet: z.string().optional(),
  title: z.string().optional(),
  url: z.string(),
});

export type MarinaBookSource = z.infer<typeof marinaBookSourceSchema>;

export type MarinaBookAssistantMetadata = {
  assistantMode?: string;
  requestId?: string;
  sources?: MarinaBookSource[];
};

// Only absolute HTTPS URLs are allowed. javascript:, data:, file:, http: and
// any other scheme are rejected. This is the single source of truth for "is a
// source link safe to render", used both server-side (before persisting) and
// client-side (defense in depth, before rendering an <a href>).
export function isSafeSourceUrl(rawUrl: unknown): rawUrl is string {
  if (typeof rawUrl !== "string") {
    return false;
  }

  const trimmed = rawUrl.trim();

  if (!trimmed) {
    return false;
  }

  try {
    return new URL(trimmed).protocol === "https:";
  } catch {
    return false;
  }
}

function isMarinaBookHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host === "marinabook.app" || host.endsWith(".marinabook.app");
}

// A source/booking link is only displayable when it is a safe HTTPS URL AND
// points at an official MarinaBook host. This keeps the assistant from ever
// surfacing a third-party or unsafe link.
export function isMarinaBookUrl(rawUrl: unknown): rawUrl is string {
  if (!isSafeSourceUrl(rawUrl)) {
    return false;
  }

  try {
    return isMarinaBookHost(new URL(rawUrl.trim()).hostname);
  } catch {
    return false;
  }
}

function firstSafeUrl(
  candidate: Record<string, unknown>,
  keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = candidate[key];

    if (isMarinaBookUrl(value)) {
      return value.trim();
    }
  }
}

function firstString(
  candidate: Record<string, unknown>,
  keys: string[],
  maxLength: number
): string | undefined {
  for (const key of keys) {
    const value = candidate[key];

    if (typeof value === "string") {
      const trimmed = value.trim();

      if (trimmed) {
        return trimmed.slice(0, maxLength);
      }
    }
  }
}

function normalizeSource(raw: unknown): MarinaBookSource | null {
  if (typeof raw === "string") {
    return isMarinaBookUrl(raw) ? { url: raw.trim() } : null;
  }

  if (!raw || typeof raw !== "object") {
    return null;
  }

  const candidate = raw as Record<string, unknown>;
  const url = firstSafeUrl(candidate, ["url", "href", "link", "source"]);

  if (!url) {
    return null;
  }

  const source: MarinaBookSource = { url };
  const title = firstString(
    candidate,
    ["title", "label", "name", "heading"],
    MAX_TITLE_LENGTH
  );
  const snippet = firstString(
    candidate,
    ["snippet", "description", "text", "excerpt", "content"],
    MAX_SNIPPET_LENGTH
  );

  if (title) {
    source.title = title;
  }

  if (snippet) {
    source.snippet = snippet;
  }

  return source;
}

// Normalizes an arbitrary backend `sources` value into a safe, de-duplicated,
// capped list. Returns an empty array for anything that is not a well-formed
// list of HTTPS-linked sources.
export function sanitizeSources(raw: unknown): MarinaBookSource[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const seen = new Set<string>();
  const sources: MarinaBookSource[] = [];

  for (const item of raw) {
    const source = normalizeSource(item);

    if (!source || seen.has(source.url)) {
      continue;
    }

    seen.add(source.url);
    sources.push(source);

    if (sources.length >= MAX_SOURCES) {
      break;
    }
  }

  return sources;
}

// Extracts the optional metadata from a raw backend response. Only present,
// valid fields are returned, so `{}` means "old backend / nothing to forward".
export function extractAssistantMetadata(
  raw: unknown
): MarinaBookAssistantMetadata {
  if (!raw || typeof raw !== "object") {
    return {};
  }

  const candidate = raw as Record<string, unknown>;
  const metadata: MarinaBookAssistantMetadata = {};

  if (typeof candidate.assistantMode === "string") {
    const assistantMode = candidate.assistantMode
      .trim()
      .slice(0, MAX_ASSISTANT_MODE_LENGTH);

    if (assistantMode) {
      metadata.assistantMode = assistantMode;
    }
  }

  if (typeof candidate.requestId === "string") {
    const requestId = candidate.requestId
      .trim()
      .slice(0, MAX_REQUEST_ID_LENGTH);

    if (requestId) {
      metadata.requestId = requestId;
    }
  }

  const sources = sanitizeSources(candidate.sources);

  if (sources.length > 0) {
    metadata.sources = sources;
  }

  return metadata;
}

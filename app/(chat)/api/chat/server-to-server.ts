import { timingSafeEqual } from "node:crypto";
import { generateText } from "ai";
import { z } from "zod";
import { DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import { getLanguageModel } from "@/lib/ai/providers";
import { searchAvailability } from "@/lib/ai/tools/search-availability";
import {
  detectLanguage,
  type ReplyLanguage,
  resolveReplyLanguage,
} from "./language";
import {
  createAvailabilityErrorReply,
  createAvailabilityResultsReply,
  createGeneralReply,
  createMissingInformationReply,
  createUnsupportedReply,
  listMissingFields,
} from "./replies";

const SERVER_TO_SERVER_SOURCE = "marinabook_frontend";

const supportedIntentSchema = z.enum([
  "availability_search",
  "general_question",
  "missing_information",
  "unsupported",
  "error",
]);

export const MAX_SERVER_TO_SERVER_MESSAGE_LENGTH = 2000;

export const serverToServerChatRequestSchema = z.object({
  context: z
    .object({
      currency: z.string().trim().min(1).max(12).optional(),
      currentUrl: z.string().trim().url().optional(),
      userId: z.string().trim().min(1).max(128).optional(),
    })
    .loose()
    .default({}),
  locale: z.string().trim().min(2).max(10).default("fr"),
  message: z.string().trim().min(1).max(MAX_SERVER_TO_SERVER_MESSAGE_LENGTH),
  sessionId: z.string().trim().uuid(),
  source: z.literal(SERVER_TO_SERVER_SOURCE),
});

const searchParamsSchema = z
  .object({
    arrivalDate: z.string().optional(),
    boatLength: z.number().positive().finite().optional(),
    boatWidth: z.number().positive().finite().optional(),
    departureDate: z.string().optional(),
    destination: z.string().optional(),
    draft: z.number().positive().finite().optional(),
  })
  .strict();

const resultSchema = z.object({
  available: z.boolean(),
  bookingUrl: z.string(),
  currency: z.string(),
  placeType: z.string(),
  portName: z.string(),
  price: z.number(),
});

export const serverToServerChatResponseSchema = z.object({
  detectedLanguage: z.string().min(2).max(10),
  intent: supportedIntentSchema,
  reply: z.string().min(1),
  results: z.array(resultSchema),
  searchParams: searchParamsSchema,
});

export type ServerToServerChatRequest = z.infer<
  typeof serverToServerChatRequestSchema
>;
export type ServerToServerChatResponse = z.infer<
  typeof serverToServerChatResponseSchema
>;

type AvailabilitySearchToolResult = {
  error?: string;
  results?: unknown[];
};

const availabilityToolExecutor = searchAvailability.execute;

if (!availabilityToolExecutor) {
  throw new Error("searchAvailability.execute is not defined");
}

const availabilityToolOptions = {
  context: undefined,
  messages: [],
  toolCallId: "server-to-server-chat",
} as unknown as Parameters<typeof availabilityToolExecutor>[1];

const availabilityKeywords = [
  "availability",
  "available",
  "berth",
  "boat",
  "draft",
  "largeur",
  "length",
  "longueur",
  "marina",
  "moor",
  "mouillage",
  "place",
  "place de port",
  "port",
  "prix",
  "reservation",
  "réservation",
  "search",
  "tirant d'eau",
  "tirant d’eau",
];

const monthNumbers = new Map<string, number>([
  ["janvier", 1],
  ["january", 1],
  ["fevrier", 2],
  ["février", 2],
  ["february", 2],
  ["mars", 3],
  ["march", 3],
  ["avril", 4],
  ["april", 4],
  ["mai", 5],
  ["may", 5],
  ["juin", 6],
  ["june", 6],
  ["juillet", 7],
  ["july", 7],
  ["aout", 8],
  ["août", 8],
  ["august", 8],
  ["septembre", 9],
  ["september", 9],
  ["octobre", 10],
  ["october", 10],
  ["novembre", 11],
  ["november", 11],
  ["decembre", 12],
  ["décembre", 12],
  ["december", 12],
]);

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function removeDiacritics(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function toComparableText(value: string) {
  return removeDiacritics(value).toLowerCase();
}

function parseNumber(raw: string | undefined) {
  if (!raw) {
    return;
  }

  const value = Number.parseFloat(raw.replace(",", "."));
  return Number.isFinite(value) ? value : undefined;
}

function formatDate(year: number, month: number, day: number) {
  const candidate = new Date(Date.UTC(year, month - 1, day));

  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return;
  }

  return `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function getMonthNumber(rawMonth: string | undefined) {
  if (!rawMonth) {
    return;
  }

  return monthNumbers.get(toComparableText(rawMonth));
}

function cleanDestination(destination: string | undefined) {
  if (!destination) {
    return;
  }

  const cleaned = destination
    .replace(/^(?:le|la|les)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[,.!?;:]+$/g, "");

  return cleaned.length > 1 ? cleaned : undefined;
}

function extractDateRange(text: string) {
  const normalized = normalizeText(text);

  const directRangeMatch = normalized.match(
    /\b(?:du|from)\s+(\d{4}-\d{2}-\d{2})\s+(?:au|to)\s+(\d{4}-\d{2}-\d{2})\b/i
  );

  if (directRangeMatch) {
    return {
      arrivalDate: directRangeMatch[1],
      departureDate: directRangeMatch[2],
    };
  }

  const sharedMonthRangeMatch = normalized.match(
    /\b(?:du|from)\s+(\d{1,2})(?:er)?\s+(?:au|to)\s+(\d{1,2})(?:er)?\s+([A-Za-zÀ-ÖØ-öø-ÿ]+)\s+(\d{4})\b/i
  );

  if (sharedMonthRangeMatch) {
    const month = getMonthNumber(sharedMonthRangeMatch[3]);
    const year = Number.parseInt(sharedMonthRangeMatch[4], 10);
    const arrivalDay = Number.parseInt(sharedMonthRangeMatch[1], 10);
    const departureDay = Number.parseInt(sharedMonthRangeMatch[2], 10);

    if (month) {
      const arrivalDate = formatDate(year, month, arrivalDay);
      const departureDate = formatDate(year, month, departureDay);

      if (arrivalDate && departureDate) {
        return { arrivalDate, departureDate };
      }
    }
  }

  const explicitMonthRangeMatch = normalized.match(
    /\b(?:du|from)\s+(\d{1,2})(?:er)?\s+([A-Za-zÀ-ÖØ-öø-ÿ]+)\s+(\d{4})\s+(?:au|to)\s+(\d{1,2})(?:er)?\s+([A-Za-zÀ-ÖØ-öø-ÿ]+)\s+(\d{4})\b/i
  );

  if (explicitMonthRangeMatch) {
    const arrivalMonth = getMonthNumber(explicitMonthRangeMatch[2]);
    const departureMonth = getMonthNumber(explicitMonthRangeMatch[5]);
    const arrivalYear = Number.parseInt(explicitMonthRangeMatch[3], 10);
    const departureYear = Number.parseInt(explicitMonthRangeMatch[6], 10);
    const arrivalDay = Number.parseInt(explicitMonthRangeMatch[1], 10);
    const departureDay = Number.parseInt(explicitMonthRangeMatch[4], 10);

    if (arrivalMonth && departureMonth) {
      const arrivalDate = formatDate(arrivalYear, arrivalMonth, arrivalDay);
      const departureDate = formatDate(
        departureYear,
        departureMonth,
        departureDay
      );

      if (arrivalDate && departureDate) {
        return { arrivalDate, departureDate };
      }
    }
  }

  const slashRangeMatch = normalized.match(
    /\b(?:du|from)\s+(\d{1,2})[/-](\d{1,2})[/-](\d{4})\s+(?:au|to)\s+(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/i
  );

  if (slashRangeMatch) {
    const arrivalDate = formatDate(
      Number.parseInt(slashRangeMatch[3], 10),
      Number.parseInt(slashRangeMatch[2], 10),
      Number.parseInt(slashRangeMatch[1], 10)
    );
    const departureDate = formatDate(
      Number.parseInt(slashRangeMatch[6], 10),
      Number.parseInt(slashRangeMatch[5], 10),
      Number.parseInt(slashRangeMatch[4], 10)
    );

    if (arrivalDate && departureDate) {
      return { arrivalDate, departureDate };
    }
  }

  return {};
}

function extractDestination(text: string) {
  const patterns = [
    /(?:^|\s)(?:à|a|vers|to)\s+([A-Za-zÀ-ÖØ-öø-ÿ' -]{2,}?)(?=(?:\s+(?:du|de|from|avec|with|pour|for))|[,.!?;:]|$)/i,
    /(?:^|\s)(?:destination|port de|marina de)\s+([A-Za-zÀ-ÖØ-öø-ÿ' -]{2,}?)(?=(?:\s+(?:du|de|from|avec|with|pour|for))|[,.!?;:]|$)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const destination = cleanDestination(match?.[1]);

    if (destination) {
      return destination;
    }
  }
}

function extractSearchParams(message: string) {
  const normalized = normalizeText(message);
  const { arrivalDate, departureDate } = extractDateRange(normalized);

  const parsed = searchParamsSchema.parse({
    arrivalDate,
    boatLength:
      parseNumber(
        normalized.match(
          /\bbateau\s+de\s+(\d+(?:[.,]\d+)?)\s*m(?:[eè]tres?)?\b/i
        )?.[1]
      ) ??
      parseNumber(
        normalized.match(
          /\b(?:long(?:ueur)?|length|loa)\s*(?:de|of|:)?\s*(\d+(?:[.,]\d+)?)\s*m(?:[eè]tres?)?\b/i
        )?.[1]
      ) ??
      parseNumber(
        normalized.match(
          /\b(\d+(?:[.,]\d+)?)\s*m(?:[eè]tres?)?\s*(?:de\s*)?(?:long|longueur)\b/i
        )?.[1]
      ),
    boatWidth:
      parseNumber(
        normalized.match(
          /\b(?:large(?:ur)?|beam|width)\s*(?:de|of|:)?\s*(\d+(?:[.,]\d+)?)\s*m(?:[eè]tres?)?\b/i
        )?.[1]
      ) ??
      parseNumber(
        normalized.match(
          /\b(\d+(?:[.,]\d+)?)\s*m(?:[eè]tres?)?\s*(?:de\s*)?(?:large|largeur)\b/i
        )?.[1]
      ),
    departureDate,
    destination: extractDestination(normalized),
    draft: parseNumber(
      normalized.match(
        /\b(?:tirant d['’]eau|draft)\s*(?:de|of|:)?\s*(\d+(?:[.,]\d+)?)\s*m(?:[eè]tres?)?\b/i
      )?.[1]
    ),
  });

  return Object.fromEntries(
    Object.entries(parsed).filter(([, value]) => value !== undefined)
  ) as SearchParams;
}

function detectAvailabilityIntent(message: string, searchParams: SearchParams) {
  const comparableMessage = toComparableText(message);

  return (
    availabilityKeywords.some((keyword) =>
      comparableMessage.includes(toComparableText(keyword))
    ) || Object.keys(searchParams).length > 0
  );
}

function mapAvailabilityResults(results: unknown[]) {
  return results
    .map((result) => {
      if (!result || typeof result !== "object") {
        return null;
      }

      const candidate = result as Record<string, unknown>;
      const parsed = resultSchema.safeParse({
        available:
          typeof candidate.available === "boolean" ? candidate.available : true,
        bookingUrl:
          typeof candidate.bookingUrl === "string" ? candidate.bookingUrl : "",
        currency:
          typeof candidate.currency === "string" ? candidate.currency : "",
        placeType:
          typeof candidate.placeType === "string" ? candidate.placeType : "",
        portName:
          typeof candidate.portName === "string" ? candidate.portName : "",
        price:
          typeof candidate.price === "number"
            ? candidate.price
            : Number(candidate.price),
      });

      return parsed.success ? parsed.data : null;
    })
    .filter((result): result is Result => result !== null);
}

export function looksLikeServerToServerChatPayload(
  value: unknown
): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.message === "string" &&
    typeof candidate.sessionId === "string" &&
    candidate.source === SERVER_TO_SERVER_SOURCE
  );
}

export function extractBearerToken(authorizationHeader: string | null) {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authorizationHeader.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

export function isValidServerToServerBearerToken(
  authorizationHeader: string | null,
  expectedSecret: string | undefined
) {
  const token = extractBearerToken(authorizationHeader);

  if (!token || !expectedSecret) {
    return false;
  }

  const providedBuffer = Buffer.from(token);
  const expectedBuffer = Buffer.from(expectedSecret);

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

type SearchParams = z.infer<typeof searchParamsSchema>;
type Result = z.infer<typeof resultSchema>;

async function runAvailabilitySearch(searchParams: SearchParams) {
  const response = (await availabilityToolExecutor(
    {
      arrivalDate: searchParams.arrivalDate as string,
      boatDraft: searchParams.draft,
      boatLength: searchParams.boatLength as number,
      boatWidth: searchParams.boatWidth,
      departureDate: searchParams.departureDate as string,
      destination: searchParams.destination as string,
    },
    availabilityToolOptions
  )) as AvailabilitySearchToolResult;

  return {
    error: response.error,
    results: Array.isArray(response.results) ? response.results : [],
  };
}

const EXTRACTION_MODEL = DEFAULT_CHAT_MODEL;

const DATE_ISO_REGEX = /^\d{4}-\d{2}-\d{2}$/;

type ServerToServerIntent =
  | "availability_search"
  | "general_question"
  | "unsupported";

const llmExtractionSchema = z.object({
  arrivalDate: z.string().nullish(),
  boatLength: z.union([z.number(), z.string()]).nullish(),
  boatWidth: z.union([z.number(), z.string()]).nullish(),
  departureDate: z.string().nullish(),
  destination: z.string().nullish(),
  detectedLanguage: z.string().nullish(),
  draft: z.union([z.number(), z.string()]).nullish(),
  intent: z
    .enum(["availability_search", "general_question", "unsupported"])
    .catch("availability_search"),
});

function buildExtractionSystemPrompt(today: string) {
  return [
    "You extract structured search intent for a marina berth booking assistant.",
    `Today's date is ${today} (UTC).`,
    "Return ONLY a JSON object, with no prose and no markdown code fences.",
    "Shape:",
    '{ "intent": "availability_search" | "general_question" | "unsupported",',
    '  "detectedLanguage": string,',
    '  "destination": string | null,',
    '  "arrivalDate": "YYYY-MM-DD" | null,',
    '  "departureDate": "YYYY-MM-DD" | null,',
    '  "boatLength": number | null,',
    '  "boatWidth": number | null,',
    '  "draft": number | null }',
    "Rules:",
    '- Use intent "availability_search" for ANY message about finding, checking or booking a berth, slip, mooring or port place, even when it is incomplete or imperfectly phrased. When a boating/port request is plausible, prefer availability_search.',
    '- Use intent "general_question" for greetings or general questions that are clearly not a berth search.',
    '- Use intent "unsupported" ONLY for messages that are clearly off-topic, nonsensical or absurd.',
    '- "detectedLanguage" is the dominant language of the user message as a short ISO 639-1 code (e.g. "fr", "en", "ar", "es", "it", "pt", "de"). Use the dominant language for multilingual messages.',
    "- Dates must be absolute in YYYY-MM-DD, resolving relative dates from today. Use null when a date is not given.",
    "- boatLength, boatWidth and draft are in meters, as plain numbers. Use null when not given.",
    "- Never invent destinations, dates or dimensions. Use null when unsure.",
    "The user message may be written in any language.",
  ].join("\n");
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  if (!text) {
    return null;
  }

  const withoutFences = text.replace(/```(?:json)?/gi, "").trim();
  const start = withoutFences.indexOf("{");
  const end = withoutFences.lastIndexOf("}");

  if (start === -1 || end === -1 || end < start) {
    return null;
  }

  try {
    const parsed = JSON.parse(withoutFences.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function toPositiveNumber(value: unknown) {
  if (value === null || value === undefined) {
    return;
  }

  const parsed =
    typeof value === "number"
      ? value
      : Number.parseFloat(String(value).replace(",", "."));

  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function toIsoDate(value: unknown) {
  if (typeof value !== "string") {
    return;
  }

  const trimmed = value.trim();
  return DATE_ISO_REGEX.test(trimmed) ? trimmed : undefined;
}

function toDestinationValue(value: unknown) {
  if (typeof value !== "string") {
    return;
  }

  const trimmed = value.trim();
  return trimmed.length > 1 ? trimmed : undefined;
}

function buildSearchParamsFromLlm(
  raw: z.infer<typeof llmExtractionSchema>
): SearchParams {
  const parsed = searchParamsSchema.parse({
    arrivalDate: toIsoDate(raw.arrivalDate),
    boatLength: toPositiveNumber(raw.boatLength),
    boatWidth: toPositiveNumber(raw.boatWidth),
    departureDate: toIsoDate(raw.departureDate),
    destination: toDestinationValue(raw.destination),
    draft: toPositiveNumber(raw.draft),
  });

  return Object.fromEntries(
    Object.entries(parsed).filter(([, value]) => value !== undefined)
  ) as SearchParams;
}

function toDetectedLanguage(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return;
  }

  const trimmed = value.trim();
  return trimmed.length >= 2 ? trimmed : undefined;
}

// LLM-first extraction via Groq. Falls back (returns null) whenever the LLM is
// unavailable, unauthenticated (e.g. unit tests without LLM_API_KEY) or returns
// invalid JSON, so the deterministic regex parser stays as a safety net.
async function extractIntentWithLlm(message: string): Promise<{
  detectedLanguage?: string;
  intent: ServerToServerIntent;
  searchParams: SearchParams;
} | null> {
  if (!process.env.LLM_API_KEY) {
    return null;
  }

  try {
    const today = new Date().toISOString().slice(0, 10);
    // Temporary [S2S] log to confirm Groq consumption in server-to-server mode.
    console.log(`[S2S] S2S Groq mode active — model=${EXTRACTION_MODEL}`);

    const { text } = await generateText({
      model: getLanguageModel(EXTRACTION_MODEL),
      prompt: message,
      providerOptions: {
        openai: { reasoningEffort: "low" },
      },
      system: buildExtractionSystemPrompt(today),
    });

    const json = extractJsonObject(text);

    if (!json) {
      return null;
    }

    const raw = llmExtractionSchema.parse(json);

    return {
      detectedLanguage: toDetectedLanguage(raw.detectedLanguage),
      intent: raw.intent,
      searchParams: buildSearchParamsFromLlm(raw),
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    // Temporary [S2S] log for the regex fallback path.
    console.log(
      `[S2S] LLM extraction failed, falling back to regex: ${reason}`
    );
    return null;
  }
}

// Deterministic regex fallback used whenever the Groq extraction is unavailable.
function resolveWithRegex(message: string): {
  intent: ServerToServerIntent;
  searchParams: SearchParams;
} {
  const searchParams = extractSearchParams(message);

  return {
    intent: detectAvailabilityIntent(message, searchParams)
      ? "availability_search"
      : "general_question",
    searchParams,
  };
}

export async function handleServerToServerChat(
  request: ServerToServerChatRequest
): Promise<ServerToServerChatResponse> {
  const llmResult = await extractIntentWithLlm(request.message);
  const { intent, searchParams } =
    llmResult ?? resolveWithRegex(request.message);

  // Reply in the language of the user's message: the LLM detection wins when
  // available, then the deterministic detector, then the frontend locale, then
  // French. See language.ts.
  const language: ReplyLanguage = resolveReplyLanguage(
    llmResult?.detectedLanguage ?? detectLanguage(request.message),
    request.locale
  );

  // Temporary [S2S] log of the resolved intent and extracted search params.
  console.log(
    `[S2S] intent=${intent} language=${language} searchParams=${JSON.stringify(
      searchParams
    )}`
  );

  if (intent === "unsupported") {
    return serverToServerChatResponseSchema.parse({
      detectedLanguage: language,
      intent: "unsupported",
      reply: createUnsupportedReply(language),
      results: [],
      searchParams,
    });
  }

  if (intent === "general_question") {
    return serverToServerChatResponseSchema.parse({
      detectedLanguage: language,
      intent: "general_question",
      reply: createGeneralReply(language),
      results: [],
      searchParams,
    });
  }

  const missingFields = listMissingFields(searchParams, language);

  if (missingFields.length > 0) {
    return serverToServerChatResponseSchema.parse({
      detectedLanguage: language,
      intent: "missing_information",
      reply: createMissingInformationReply(missingFields, language),
      results: [],
      searchParams,
    });
  }

  try {
    const { error, results } = await runAvailabilitySearch(searchParams);
    const mappedResults = mapAvailabilityResults(results);

    if (error) {
      return serverToServerChatResponseSchema.parse({
        detectedLanguage: language,
        intent: "error",
        reply: createAvailabilityErrorReply(error, language),
        results: [],
        searchParams,
      });
    }

    return serverToServerChatResponseSchema.parse({
      detectedLanguage: language,
      intent: "availability_search",
      reply: createAvailabilityResultsReply(
        mappedResults,
        searchParams,
        language
      ),
      results: mappedResults,
      searchParams,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";

    return serverToServerChatResponseSchema.parse({
      detectedLanguage: language,
      intent: "error",
      reply: createAvailabilityErrorReply(message, language),
      results: [],
      searchParams,
    });
  }
}

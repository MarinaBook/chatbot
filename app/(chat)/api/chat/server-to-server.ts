import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { searchAvailability } from "@/lib/ai/tools/search-availability";

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

function normalizeLocale(locale: string) {
  return locale.toLowerCase().startsWith("fr") ? "fr" : "en";
}

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

function listMissingFields(searchParams: SearchParams, locale: "fr" | "en") {
  const labels =
    locale === "fr"
      ? {
          arrivalDate: "la date d’arrivée",
          boatLength: "la longueur du bateau",
          departureDate: "la date de départ",
          destination: "la destination",
        }
      : {
          arrivalDate: "the arrival date",
          boatLength: "the boat length",
          departureDate: "the departure date",
          destination: "the destination",
        };

  const requiredFields = [
    "destination",
    "arrivalDate",
    "departureDate",
    "boatLength",
  ] as const;

  return requiredFields
    .filter((field) => searchParams[field] === undefined)
    .map((field) => labels[field]);
}

function createMissingInformationReply(
  missingFields: string[],
  locale: "fr" | "en"
) {
  if (missingFields.length === 1) {
    if (locale === "fr") {
      return `Il me manque ${missingFields[0]} pour lancer la recherche.`;
    }

    return `I still need ${missingFields[0]} to run the search.`;
  }

  if (locale === "fr") {
    return `Il me manque encore ${missingFields.join(
      ", "
    )} pour lancer la recherche.`;
  }

  return `I still need ${missingFields.join(", ")} to run the search.`;
}

function createGeneralReply(locale: "fr" | "en") {
  if (locale === "fr") {
    return "J’ai bien reçu votre message. Cette API JSON est actuellement optimisée pour les recherches de disponibilités MarinaBook.";
  }

  return "I received your message. This JSON API is currently optimized for MarinaBook availability requests.";
}

function formatDateForReply(date: string, locale: "fr" | "en") {
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-US", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00.000Z`));
}

function createNoAvailabilityReply(locale: "fr" | "en") {
  return locale === "fr"
    ? "Je n’ai pas trouvé de disponibilité correspondant à ces critères. Vous pouvez modifier les dates, la destination ou les dimensions du bateau."
    : "I could not find any availability matching these criteria. You can adjust the dates, destination, or boat dimensions.";
}

function createAvailabilityResultsReply(
  results: Result[],
  searchParams: SearchParams,
  locale: "fr" | "en"
) {
  if (results.length === 0) {
    return createNoAvailabilityReply(locale);
  }

  const [firstResult] = results;
  const formattedArrivalDate = formatDateForReply(
    searchParams.arrivalDate as string,
    locale
  );
  const formattedDepartureDate = formatDateForReply(
    searchParams.departureDate as string,
    locale
  );

  return locale === "fr"
    ? `J’ai trouvé une disponibilité au ${firstResult.portName}, place ${firstResult.placeType}, du ${formattedArrivalDate} au ${formattedDepartureDate}, pour ${firstResult.price} ${firstResult.currency}. Vous pouvez finaliser la réservation avec le bouton ci-dessous.`
    : `I found availability at ${firstResult.portName}, ${firstResult.placeType}, from ${formattedArrivalDate} to ${formattedDepartureDate}, for ${firstResult.price} ${firstResult.currency}. You can complete the booking with the button below.`;
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

function createAvailabilityErrorReply(error: string, locale: "fr" | "en") {
  const comparableError = toComparableText(error);

  if (
    comparableError.includes("boatlength") &&
    comparableError.includes("required")
  ) {
    return locale === "fr"
      ? "Il me manque la longueur du bateau pour lancer la recherche."
      : "I still need the boat length to run the search.";
  }

  if (
    comparableError.includes("destination") &&
    comparableError.includes("required")
  ) {
    return locale === "fr"
      ? "Il me manque la destination pour lancer la recherche."
      : "I still need the destination to run the search.";
  }

  if (
    comparableError.includes("arrivaldate") &&
    comparableError.includes("required")
  ) {
    return locale === "fr"
      ? "Il me manque la date d’arrivée pour lancer la recherche."
      : "I still need the arrival date to run the search.";
  }

  if (
    comparableError.includes("departuredate") &&
    comparableError.includes("required")
  ) {
    return locale === "fr"
      ? "Il me manque la date de départ pour lancer la recherche."
      : "I still need the departure date to run the search.";
  }

  if (
    comparableError.includes("boatwidth") &&
    comparableError.includes("required")
  ) {
    return locale === "fr"
      ? "Il me manque la largeur du bateau pour lancer la recherche."
      : "I still need the boat width to run the search.";
  }

  if (
    comparableError.includes("unrecognized key") &&
    (comparableError.includes("draft") || comparableError.includes("boatdraft"))
  ) {
    return locale === "fr"
      ? "Je garde le tirant d’eau dans le contexte, mais je ne l’envoie pas à MarinaBook pour cette recherche."
      : "I keep the draft in context, but I do not send it to MarinaBook for this search.";
  }

  if (comparableError.includes("not configured")) {
    return locale === "fr"
      ? "Le service MarinaBook n’est pas configuré côté serveur."
      : "The MarinaBook service is not configured on the server.";
  }

  if (
    comparableError.includes("could not reach") ||
    comparableError.includes("temporarily unavailable")
  ) {
    return locale === "fr"
      ? "Le service MarinaBook est temporairement indisponible. Merci de réessayer dans quelques instants."
      : "The MarinaBook service is temporarily unavailable. Please try again shortly.";
  }

  return locale === "fr"
    ? "La recherche MarinaBook a rencontré une erreur côté serveur. Merci de réessayer dans quelques instants."
    : "The MarinaBook search hit a server-side error. Please try again shortly.";
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

export async function handleServerToServerChat(
  request: ServerToServerChatRequest
): Promise<ServerToServerChatResponse> {
  const locale = normalizeLocale(request.locale);
  const searchParams = extractSearchParams(request.message);
  const isAvailabilitySearch = detectAvailabilityIntent(
    request.message,
    searchParams
  );

  if (!isAvailabilitySearch) {
    return serverToServerChatResponseSchema.parse({
      intent: "general_question",
      reply: createGeneralReply(locale),
      results: [],
      searchParams,
    });
  }

  const missingFields = listMissingFields(searchParams, locale);

  if (missingFields.length > 0) {
    return serverToServerChatResponseSchema.parse({
      intent: "missing_information",
      reply: createMissingInformationReply(missingFields, locale),
      results: [],
      searchParams,
    });
  }

  try {
    const { error, results } = await runAvailabilitySearch(searchParams);
    const mappedResults = mapAvailabilityResults(results);

    if (error) {
      return serverToServerChatResponseSchema.parse({
        intent: "error",
        reply: createAvailabilityErrorReply(error, locale),
        results: [],
        searchParams,
      });
    }

    return serverToServerChatResponseSchema.parse({
      intent: "availability_search",
      reply: createAvailabilityResultsReply(
        mappedResults,
        searchParams,
        locale
      ),
      results: mappedResults,
      searchParams,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";

    return serverToServerChatResponseSchema.parse({
      intent: "error",
      reply: createAvailabilityErrorReply(message, locale),
      results: [],
      searchParams,
    });
  }
}

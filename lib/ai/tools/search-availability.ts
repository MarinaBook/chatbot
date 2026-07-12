import "server-only";
import { tool } from "ai";
import { z } from "zod";
import {
  buildMarinaBookApiUrl,
  getMarinaBookApiKey,
  getMarinaBookErrorMessage,
} from "@/lib/marinabook-api";
import {
  extractAssistantMetadata,
  marinaBookSourceSchema,
} from "@/lib/marinabook-metadata";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// Lenient schema for a single availability result. Every field is optional and
// free-form on purpose: the backend is the source of truth and may add fields
// or use any currency/place type. This must never reject real, non-empty
// results (that is what previously surfaced "An error occurred").
const availabilityResultSchema = z
  .object({
    available: z.boolean().optional(),
    bookingUrl: z.string().optional(),
    city: z.string().optional(),
    country: z.string().optional(),
    currency: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    maxBoatDraft: z.number().optional(),
    maxBoatLength: z.number().optional(),
    maxBoatWidth: z.number().optional(),
    placeId: z.string().optional(),
    placeType: z.string().optional(),
    portId: z.string().optional(),
    portName: z.string().optional(),
    portSlug: z.string().optional(),
    price: z.number().optional(),
    services: z.array(z.unknown()).optional().default([]),
  })
  .loose();

// Lenient envelope. Accepts both the backend success payload and our own
// { error } fallbacks. `.loose()` + all-optional fields means a well-formed
// object never fails validation. `assistantMode`, `requestId` and `sources` are
// optional metadata a newer backend MAY add; they are never required.
const searchAvailabilityOutputSchema = z
  .object({
    assistantMode: z.string().optional(),
    count: z.number().optional(),
    error: z.string().optional(),
    query: z.unknown().optional(),
    requestId: z.string().optional(),
    results: z.array(availabilityResultSchema).optional(),
    sources: z.array(marinaBookSourceSchema).optional(),
    success: z.boolean().optional(),
  })
  .loose();

export const searchAvailability = tool({
  description:
    "Search real berth/mooring availability and port pricing in the MarinaBook network. Call this whenever the user asks about a berth, a slip, availability, or a port price. Only call it once destination, arrivalDate, departureDate and boatLength are known; ask the user for any missing value first. Never invent availability, prices, ports or contact details.",
  execute: async ({
    destination,
    arrivalDate,
    departureDate,
    boatLength,
    boatWidth,
  }) => {
    const endpoint = buildMarinaBookApiUrl("/assistant/search-availability");
    const apiKey = getMarinaBookApiKey();

    if (!(endpoint && apiKey)) {
      return {
        error:
          "The MarinaBook availability service is not configured. Do not invent any result.",
      };
    }

    try {
      const response = await fetch(endpoint, {
        body: JSON.stringify({
          arrivalDate,
          boatLength,
          departureDate,
          destination,
          ...(boatWidth !== undefined && { boatWidth }),
        }),
        headers: {
          "content-type": "application/json",
          "x-marinabook-assistant-key": apiKey,
        },
        method: "POST",
      });

      if (!response.ok) {
        const errorMessage = await getMarinaBookErrorMessage(response);

        return {
          error: errorMessage
            ? `MarinaBook availability search failed: ${errorMessage}`
            : `MarinaBook availability search failed (status ${response.status}). Do not invent any result.`,
        };
      }

      const raw = await response.json();

      // Normalize through the lenient schema. On the (unlikely) parse failure we
      // still return the raw payload rather than throwing, so a valid non-empty
      // result can never break the chat stream.
      const parsed = searchAvailabilityOutputSchema.safeParse(raw);
      const output = parsed.success ? parsed.data : raw;

      // Overlay sanitized optional metadata. `sources` is always replaced with
      // the safe (HTTPS-only) list so no unsafe link from the backend can ever
      // reach the client/UI. Absent fields stay absent (old-backend compatible).
      const { assistantMode, requestId, sources } =
        extractAssistantMetadata(raw);

      return {
        ...output,
        ...(assistantMode && { assistantMode }),
        ...(requestId && { requestId }),
        sources: sources ?? [],
      };
    } catch {
      return {
        error:
          "Could not reach the MarinaBook availability service. Do not invent any result.",
      };
    }
  },
  inputSchema: z.object({
    arrivalDate: z
      .string()
      .regex(DATE_REGEX, "Expected format: YYYY-MM-DD")
      .describe("Arrival date in YYYY-MM-DD format"),
    boatDraft: z.number().describe("Boat draft in meters").optional(),
    boatLength: z.number().describe("Boat length overall in meters"),
    boatWidth: z.number().describe("Boat beam/width in meters").optional(),
    departureDate: z
      .string()
      .regex(DATE_REGEX, "Expected format: YYYY-MM-DD")
      .describe("Departure date in YYYY-MM-DD format"),
    destination: z
      .string()
      .describe("Destination port, marina or city requested by the user"),
  }),
});

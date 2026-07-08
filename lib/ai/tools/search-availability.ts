import "server-only";
import { tool } from "ai";
import { z } from "zod";

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
// object never fails validation.
const searchAvailabilityOutputSchema = z
  .object({
    count: z.number().optional(),
    error: z.string().optional(),
    query: z.unknown().optional(),
    results: z.array(availabilityResultSchema).optional(),
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
    boatDraft,
  }) => {
    const backendUrl = process.env.BACKEND_URL;
    const apiKey = process.env.MARINABOOK_ASSISTANT_API_KEY;

    if (!(backendUrl && apiKey)) {
      return {
        error:
          "The MarinaBook availability service is not configured. Do not invent any result.",
      };
    }

    const endpoint = `${backendUrl.replace(/\/$/, "")}/assistant/search-availability`;

    try {
      const response = await fetch(endpoint, {
        body: JSON.stringify({
          arrivalDate,
          boatLength,
          departureDate,
          destination,
          ...(boatWidth !== undefined && { boatWidth }),
          ...(boatDraft !== undefined && { boatDraft }),
        }),
        headers: {
          "content-type": "application/json",
          "x-marinabook-assistant-key": apiKey,
        },
        method: "POST",
      });

      if (!response.ok) {
        return {
          error: `MarinaBook availability search failed (status ${response.status}). Do not invent any result.`,
        };
      }

      const raw = await response.json();

      // Normalize through the lenient schema. On the (unlikely) parse failure we
      // still return the raw payload rather than throwing, so a valid non-empty
      // result can never break the chat stream.
      const parsed = searchAvailabilityOutputSchema.safeParse(raw);
      return parsed.success ? parsed.data : raw;
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

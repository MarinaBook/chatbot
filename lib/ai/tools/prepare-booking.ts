import "server-only";
import { tool } from "ai";
import { z } from "zod";
import {
  buildMarinaBookApiUrl,
  getMarinaBookApiKey,
  getMarinaBookErrorMessage,
} from "@/lib/marinabook-api";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// Lenient schema for the prepared-booking details. Every field is optional and
// free-form on purpose: the backend is the source of truth and may add fields
// or use any currency/place type. This must never reject a real, valid
// response (mirrors the searchAvailability approach).
const bookingSchema = z
  .object({
    arrivalDate: z.string().optional(),
    bookingUrl: z.string().optional(),
    currency: z.string().optional(),
    departureDate: z.string().optional(),
    placeType: z.string().optional(),
    portName: z.string().optional(),
    price: z.number().optional(),
  })
  .loose();

// Lenient envelope. Accepts the backend success payload ({ success, booking }),
// the business-error payload ({ success: false, code }) and our own { error }
// fallbacks. `.loose()` + all-optional fields means a well-formed object never
// fails validation.
const prepareBookingOutputSchema = z
  .object({
    booking: bookingSchema.optional(),
    code: z.string().optional(),
    error: z.string().optional(),
    success: z.boolean().optional(),
  })
  .loose();

export const prepareBooking = tool({
  description:
    "Prepare a berth/mooring booking in the MarinaBook network for a place that was previously found with searchAvailability. This ONLY prepares the booking: it never confirms it, never takes payment and never creates a reservation. Call it only when the user asks to book a specific place and placeId, arrivalDate, departureDate and boatLength are known; ask the user for any missing value first. Never invent prices, availability, ports or contact details, and never tell the user the booking is confirmed.",
  execute: async ({
    placeId,
    arrivalDate,
    departureDate,
    boatLength,
    boatWidth,
    boatDraft,
  }) => {
    const endpoint = buildMarinaBookApiUrl("/assistant/prepare-booking");
    const apiKey = getMarinaBookApiKey();

    if (!(endpoint && apiKey)) {
      return {
        error:
          "The MarinaBook booking service is not configured. Do not invent any result.",
      };
    }

    try {
      const response = await fetch(endpoint, {
        body: JSON.stringify({
          arrivalDate,
          boatLength,
          departureDate,
          placeId,
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
        const errorMessage = await getMarinaBookErrorMessage(response);

        return {
          error: errorMessage
            ? `MarinaBook booking preparation failed: ${errorMessage}`
            : `MarinaBook booking preparation failed (status ${response.status}). Do not invent any result.`,
        };
      }

      const raw = await response.json();

      // Normalize through the lenient schema. On the (unlikely) parse failure we
      // still return the raw payload rather than throwing, so a valid response
      // can never break the chat stream.
      const parsed = prepareBookingOutputSchema.safeParse(raw);
      return parsed.success ? parsed.data : raw;
    } catch {
      return {
        error:
          "Could not reach the MarinaBook booking service. Do not invent any result.",
      };
    }
  },
  inputSchema: z.object({
    arrivalDate: z
      .string()
      .regex(DATE_REGEX, "Expected format: YYYY-MM-DD")
      .describe("Arrival date in YYYY-MM-DD format"),
    boatDraft: z
      .number()
      .positive()
      .describe("Boat draft in meters")
      .optional(),
    boatLength: z.number().positive().describe("Boat length overall in meters"),
    boatWidth: z
      .number()
      .positive()
      .describe("Boat beam/width in meters")
      .optional(),
    departureDate: z
      .string()
      .regex(DATE_REGEX, "Expected format: YYYY-MM-DD")
      .describe("Departure date in YYYY-MM-DD format"),
    placeId: z
      .string()
      .min(1)
      .describe(
        "Identifier of the place to book, as returned by searchAvailability"
      ),
  }),
});

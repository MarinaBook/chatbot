import "server-only";
import { tool } from "ai";
import { z } from "zod";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

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

      return await response.json();
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

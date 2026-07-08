import assert from "node:assert/strict";
import { test } from "node:test";
import {
  convertToModelMessages,
  createUIMessageStream,
  isStepCount,
  streamText,
  toUIMessageStream,
} from "ai";
import { prepareBooking } from "./prepare-booking";
import { searchAvailability } from "./search-availability";

const PLACE_ID = "cmr37zmiz00cv88rg9lqpy3r4";

const BOOKING_JSON = {
  booking: {
    arrivalDate: "2026-09-15",
    bookingUrl: "https://www.marinabook.app/place/xyz",
    currency: "USD",
    departureDate: "2026-09-18",
    placeType: "ANNEAU",
    portName: "PORT SIDI BOU SAID",
    price: 135,
  },
  success: true,
};

const usage = {
  inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 10, total: 10 },
  outputTokens: { reasoning: 0, text: 20, total: 20 },
};

// Conversation on the second turn, after the searchAvailability result was
// saved and reloaded from the DB. The result carries the placeId that the model
// must reuse when the user says "prepare this place".
function buildConversation() {
  return [
    {
      id: "m1",
      parts: [
        {
          text: "Une place à Sidi Bou Saïd du 15 au 18 septembre pour un bateau de 1m",
          type: "text" as const,
        },
      ],
      role: "user" as const,
    },
    {
      id: "m2",
      parts: [
        {
          input: {
            arrivalDate: "2026-09-15",
            boatLength: 1,
            boatWidth: 1,
            departureDate: "2026-09-18",
            destination: "Sidi Bou Saïd",
          },
          output: {
            count: 1,
            results: [
              {
                available: true,
                bookingUrl: "https://www.marinabook.app/place/xyz",
                currency: "USD",
                placeId: PLACE_ID,
                placeType: "ANNEAU",
                portName: "PORT SIDI BOU SAID",
                price: 135,
                services: [],
              },
            ],
            success: true,
          },
          state: "output-available" as const,
          toolCallId: "call-search",
          type: "tool-searchAvailability" as const,
        },
        {
          text: "J'ai trouvé une disponibilité : PORT SIDI BOU SAID, place ANNEAU, 135 USD.",
          type: "text" as const,
        },
      ],
      role: "assistant" as const,
    },
    {
      id: "m3",
      parts: [
        {
          text: "Prépare la réservation pour cette place.",
          type: "text" as const,
        },
      ],
      role: "user" as const,
    },
  ];
}

// Mock model that extracts the placeId from the model context (the previous
// searchAvailability tool output) and calls prepareBooking with it — this is
// exactly the "reuse the placeId" behaviour under test. If the placeId is not
// present in the context, it would not be able to book (asserting the reuse).
function buildModel() {
  let call = 0;
  return {
    defaultObjectGenerationMode: "tool",
    doStream: ({ prompt }: { prompt: unknown }) => {
      call += 1;
      const isFirst = call === 1;
      const promptStr = JSON.stringify(prompt);
      const placeId = promptStr.match(/"placeId":"([^"]+)"/)?.[1];
      return {
        stream: new ReadableStream({
          start(controller) {
            if (isFirst && placeId) {
              controller.enqueue({
                input: JSON.stringify({
                  arrivalDate: "2026-09-15",
                  boatLength: 1,
                  boatWidth: 1,
                  departureDate: "2026-09-18",
                  placeId,
                }),
                toolCallId: "call-prepare",
                toolName: "prepareBooking",
                type: "tool-call",
              });
              controller.enqueue({
                finishReason: "tool-calls",
                type: "finish",
                usage,
              });
            } else {
              controller.enqueue({ id: "t1", type: "text-start" });
              controller.enqueue({
                delta:
                  "J'ai préparé votre réservation pour PORT SIDI BOU SAID. Cette réservation n'est pas encore confirmée.",
                id: "t1",
                type: "text-delta",
              });
              controller.enqueue({ id: "t1", type: "text-end" });
              controller.enqueue({
                finishReason: "stop",
                type: "finish",
                usage,
              });
            }
            controller.close();
          },
        }),
      };
    },
    modelId: "mock-model",
    provider: "mock",
    specificationVersion: "v3",
    supportedUrls: {},
  } as unknown as Parameters<typeof streamText>[0]["model"];
}

test("search -> 'prepare this place' reuses the placeId and returns text with no error", async () => {
  process.env.BACKEND_URL = "https://api.marinabook.app/api";
  process.env.MARINABOOK_ASSISTANT_API_KEY = "test-secret-key";

  let sentBody: Record<string, unknown> | null = null;
  globalThis.fetch = ((_url: string, init: RequestInit) => {
    sentBody = JSON.parse(init.body as string);
    return Promise.resolve(
      new Response(JSON.stringify(BOOKING_JSON), {
        headers: { "content-type": "application/json" },
        status: 200,
      })
    );
  }) as unknown as typeof fetch;

  const modelMessages = await convertToModelMessages(
    buildConversation() as never
  );

  let capturedError: unknown;
  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      const result = streamText({
        messages: modelMessages as never,
        model: buildModel(),
        onError({ error }) {
          capturedError = error;
        },
        stopWhen: isStepCount(5),
        tools: { prepareBooking, searchAvailability },
      });
      writer.merge(toUIMessageStream({ stream: result.stream }));
    },
    generateId: () => `id-${Math.random()}`,
    onError: (error) => {
      capturedError = error;
      return "Oops, an error occurred!";
    },
  });

  const partTypes: string[] = [];
  const textDeltas: string[] = [];
  for await (const part of stream as unknown as AsyncIterable<{
    type: string;
    delta?: string;
  }>) {
    partTypes.push(part.type);
    if (part.type === "text-delta" && part.delta) {
      textDeltas.push(part.delta);
    }
  }

  // No hard error surfaced ("An error occurred").
  assert.equal(capturedError, undefined, "no stream error expected");
  // prepareBooking actually ran and produced an output.
  assert.ok(
    partTypes.includes("tool-output-available"),
    "prepareBooking should have produced an output"
  );
  // The backend received exactly the placeId from the previous search result.
  assert.ok(sentBody, "backend should have been called");
  assert.equal((sentBody as { placeId: string }).placeId, PLACE_ID);
  assert.equal((sentBody as { arrivalDate: string }).arrivalDate, "2026-09-15");
  assert.equal(
    (sentBody as { departureDate: string }).departureDate,
    "2026-09-18"
  );
  // A final natural-language answer was produced.
  assert.ok(textDeltas.join("").includes("PORT SIDI BOU SAID"));
  assert.ok(textDeltas.join("").includes("pas encore confirmée"));
});

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  handleServerToServerChat,
  isValidServerToServerBearerToken,
  looksLikeServerToServerChatPayload,
  serverToServerChatRequestSchema,
} from "./server-to-server";

const TEST_SESSION_ID = "5a5581ec-5219-4d0d-8b31-6b1739c8f7a1";
const originalBackendUrl = process.env.BACKEND_URL;
const originalMarinaBookApiUrl = process.env.MARINABOOK_API_URL;
const originalAssistantApiKey = process.env.MARINABOOK_ASSISTANT_API_KEY;
const originalFetch = globalThis.fetch;

afterEach(() => {
  process.env.BACKEND_URL = originalBackendUrl;
  process.env.MARINABOOK_API_URL = originalMarinaBookApiUrl;
  process.env.MARINABOOK_ASSISTANT_API_KEY = originalAssistantApiKey;
  globalThis.fetch = originalFetch;
});

test("recognizes MarinaBook server-to-server payloads", () => {
  assert.equal(
    looksLikeServerToServerChatPayload({
      message: "Bonjour",
      sessionId: TEST_SESSION_ID,
      source: "marinabook_frontend",
    }),
    true
  );

  assert.equal(
    looksLikeServerToServerChatPayload({
      id: "123",
      selectedChatModel: "moonshotai/kimi-k2.5",
    }),
    false
  );
});

test("validates bearer tokens with constant-time comparison", () => {
  assert.equal(
    isValidServerToServerBearerToken(
      "Bearer top-secret-value",
      "top-secret-value"
    ),
    true
  );

  assert.equal(
    isValidServerToServerBearerToken("Bearer wrong", "top-secret-value"),
    false
  );

  assert.equal(
    isValidServerToServerBearerToken(null, "top-secret-value"),
    false
  );
});

test("returns missing_information when required search fields are absent", async () => {
  const payload = serverToServerChatRequestSchema.parse({
    locale: "fr",
    message: "Je cherche une place à Marseille.",
    sessionId: TEST_SESSION_ID,
    source: "marinabook_frontend",
  });

  const response = await handleServerToServerChat(payload);

  assert.equal(response.intent, "missing_information");
  assert.deepEqual(response.results, []);
  assert.deepEqual(response.searchParams, {
    destination: "Marseille",
  });
  assert.match(response.reply, /date d’arrivée/i);
});

test("returns a clear error when MarinaBook search is not configured", async () => {
  delete process.env.BACKEND_URL;
  delete process.env.MARINABOOK_API_URL;
  delete process.env.MARINABOOK_ASSISTANT_API_KEY;

  const payload = serverToServerChatRequestSchema.parse({
    locale: "fr",
    message:
      "Je vais à Marseille du 8 au 14 juillet 2026. Je cherche une place pour un bateau de 12 m de long, largeur de 4 m, avec un tirant d’eau de 2 m.",
    sessionId: TEST_SESSION_ID,
    source: "marinabook_frontend",
  });

  const response = await handleServerToServerChat(payload);

  assert.equal(response.intent, "error");
  assert.deepEqual(response.results, []);
  assert.deepEqual(response.searchParams, {
    arrivalDate: "2026-07-08",
    boatLength: 12,
    boatWidth: 4,
    departureDate: "2026-07-14",
    destination: "Marseille",
    draft: 2,
  });
  assert.match(response.reply, /service marinabook n’est pas configuré/i);
});

test("returns mapped availability results when the MarinaBook backend responds", async () => {
  process.env.MARINABOOK_API_URL = "https://api.marinabook.app";
  process.env.MARINABOOK_ASSISTANT_API_KEY = "assistant-secret";
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        count: 1,
        results: [
          {
            available: true,
            bookingUrl: "https://www.marinabook.app/place/demo",
            currency: "EUR",
            placeType: "ANNEAU",
            portName: "VIEUX-PORT DE MARSEILLE",
            price: 120,
          },
        ],
        success: true,
      }),
      {
        headers: { "content-type": "application/json" },
        status: 200,
      }
    )) as typeof fetch;

  const payload = serverToServerChatRequestSchema.parse({
    locale: "fr",
    message:
      "Je vais à Marseille du 8 au 14 juillet 2026. Je cherche une place pour un bateau de 12 m de long, largeur de 4 m, avec un tirant d’eau de 2 m.",
    sessionId: TEST_SESSION_ID,
    source: "marinabook_frontend",
  });

  const response = await handleServerToServerChat(payload);

  assert.equal(response.intent, "availability_search");
  assert.equal(response.results.length, 1);
  assert.equal(
    response.results[0].bookingUrl,
    "https://www.marinabook.app/place/demo"
  );
  assert.equal(response.searchParams.draft, 2);
  assert.match(response.reply, /VIEUX-PORT DE MARSEILLE/i);
});

test("does not send draft to MarinaBook search-availability", async () => {
  process.env.MARINABOOK_API_URL = "https://api.marinabook.app";
  process.env.MARINABOOK_ASSISTANT_API_KEY = "assistant-secret";

  let requestBody: unknown;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(
      input,
      "https://api.marinabook.app/api/assistant/search-availability"
    );
    requestBody = JSON.parse(String(init?.body ?? "{}"));

    return Promise.resolve(
      new Response(
        JSON.stringify({
          count: 1,
          results: [
            {
              available: true,
              bookingUrl: "https://www.marinabook.app/place/demo",
              currency: "USD",
              placeType: "ANNEAU",
              portName: "PORT SIDI BOU SAID",
              price: 135,
            },
          ],
          success: true,
        }),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        }
      )
    );
  }) as typeof fetch;

  const payload = serverToServerChatRequestSchema.parse({
    locale: "fr",
    message:
      "Je vais à Sidi Bou Saïd du 15 au 18 septembre 2026. Je cherche une place pour un bateau de 12 m de long, 4 m de large, avec un tirant d’eau de 2 m.",
    sessionId: TEST_SESSION_ID,
    source: "marinabook_frontend",
  });

  const response = await handleServerToServerChat(payload);

  assert.equal(response.intent, "availability_search");
  assert.deepEqual(requestBody, {
    arrivalDate: "2026-09-15",
    boatLength: 12,
    boatWidth: 4,
    departureDate: "2026-09-18",
    destination: "Sidi Bou Saïd",
  });
  assert.equal(response.searchParams.draft, 2);
});

test("returns general_question for non-search messages", async () => {
  const payload = serverToServerChatRequestSchema.parse({
    locale: "fr",
    message: "Bonjour, qui es-tu ?",
    sessionId: TEST_SESSION_ID,
    source: "marinabook_frontend",
  });

  const response = await handleServerToServerChat(payload);

  assert.equal(response.intent, "general_question");
  assert.deepEqual(response.results, []);
  assert.deepEqual(response.searchParams, {});
});

test("asks for boat length before calling MarinaBook for incomplete messages", async () => {
  let fetchCalled = false;
  globalThis.fetch = (() => {
    fetchCalled = true;
    throw new Error("fetch should not be called");
  }) as typeof fetch;

  const payload = serverToServerChatRequestSchema.parse({
    locale: "fr",
    message: "Je vais à Sidi Bou Saïd du 15 au 18 septembre 2026.",
    sessionId: TEST_SESSION_ID,
    source: "marinabook_frontend",
  });

  const response = await handleServerToServerChat(payload);

  assert.equal(fetchCalled, false);
  assert.equal(response.intent, "missing_information");
  assert.match(response.reply, /longueur du bateau/i);
});

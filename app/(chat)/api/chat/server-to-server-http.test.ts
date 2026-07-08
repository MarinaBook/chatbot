import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  isBearerAuthorizationHeader,
  maybeHandleServerToServerChatRequest,
  parseChatRequestJson,
  SERVER_TO_SERVER_MODE_HEADER,
  SERVER_TO_SERVER_MODE_VALUE,
} from "./server-to-server-http";

const TEST_SESSION_ID = "5a5581ec-5219-4d0d-8b31-6b1739c8f7a1";
const originalApiSecret = process.env.CHATBOT_API_SECRET;
const originalApiUrl = process.env.MARINABOOK_API_URL;
const originalAssistantApiKey = process.env.MARINABOOK_ASSISTANT_API_KEY;
const originalFetch = globalThis.fetch;

afterEach(() => {
  process.env.CHATBOT_API_SECRET = originalApiSecret;
  process.env.MARINABOOK_API_URL = originalApiUrl;
  process.env.MARINABOOK_ASSISTANT_API_KEY = originalAssistantApiKey;
  globalThis.fetch = originalFetch;
});

test("recognizes bearer authorization headers", () => {
  assert.equal(isBearerAuthorizationHeader("Bearer secret"), true);
  assert.equal(isBearerAuthorizationHeader("Basic demo"), false);
  assert.equal(isBearerAuthorizationHeader(null), false);
});

test("returns 401 JSON instead of redirect for an invalid bearer token", async () => {
  process.env.CHATBOT_API_SECRET = "expected-secret";

  const response = await maybeHandleServerToServerChatRequest({
    authorizationHeader: "Bearer wrong-secret",
    json: {
      locale: "fr",
      message: "Je vais à Sidi Bou Saïd du 15 au 18 septembre 2026.",
      sessionId: TEST_SESSION_ID,
      source: "marinabook_frontend",
    },
  });

  assert.ok(response);
  assert.equal(response.status, 401);
  assert.equal(
    response.headers.get(SERVER_TO_SERVER_MODE_HEADER),
    SERVER_TO_SERVER_MODE_VALUE
  );

  const json = await response.json();
  assert.equal(json.error.code, "unauthorized");
});

test("returns 200 JSON for a valid bearer token", async () => {
  process.env.CHATBOT_API_SECRET = "expected-secret";
  process.env.MARINABOOK_API_URL = "https://api.marinabook.app";
  process.env.MARINABOOK_ASSISTANT_API_KEY = "assistant-secret";

  globalThis.fetch = (() =>
    Promise.resolve(
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
    )) as typeof fetch;

  const response = await maybeHandleServerToServerChatRequest({
    authorizationHeader: "Bearer expected-secret",
    json: {
      context: {
        currency: "USD",
        currentUrl: "https://www.marinabook.app/search",
      },
      locale: "fr",
      message:
        "Je vais à Sidi Bou Saïd du 15 au 18 septembre 2026. Je cherche une place pour un bateau de 1 m de long et 1 m de large.",
      sessionId: TEST_SESSION_ID,
      source: "marinabook_frontend",
    },
  });

  assert.ok(response);
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get(SERVER_TO_SERVER_MODE_HEADER),
    SERVER_TO_SERVER_MODE_VALUE
  );

  const json = await response.json();
  assert.equal(json.intent, "availability_search");
  assert.equal(json.results[0].portName, "PORT SIDI BOU SAID");
});

test("returns 400 JSON for invalid bearer request bodies", async () => {
  const request = new Request("http://localhost/api/chat", {
    body: "{",
    headers: {
      authorization: "Bearer expected-secret",
      "content-type": "application/json",
    },
    method: "POST",
  });

  const parsed = await parseChatRequestJson(request, true);

  assert.equal(parsed.ok, false);
  assert.ok(parsed.response);
  assert.equal(parsed.response.status, 400);
  assert.equal(
    parsed.response.headers.get(SERVER_TO_SERVER_MODE_HEADER),
    SERVER_TO_SERVER_MODE_VALUE
  );
});

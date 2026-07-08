import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { searchAvailability } from "./search-availability";

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

// Exactly the real backend payload provided by the MarinaBook API for a
// non-empty search (200 OK). This is the case that previously surfaced
// "An error occurred" in the UI.
const REAL_JSON = {
  count: 1,
  query: {
    arrivalDate: "2026-09-15",
    boatLength: 1,
    boatWidth: 1,
    departureDate: "2026-09-18",
    destination: "Sidi Bou Saïd",
  },
  results: [
    {
      available: true,
      bookingUrl:
        "https://www.marinabook.app/place/place-de-port-sidi-bou-said-tunisia-cmr37zmiz00cv88rg9lqpy3r4?dateArrivee=2026-09-15&dateDepart=2026-09-18",
      city: "SIDI BOU SAID",
      country: "TUNISIA",
      currency: "USD",
      latitude: 36.866_821_7,
      longitude: 10.351_607,
      maxBoatDraft: 2.5,
      maxBoatLength: 12,
      maxBoatWidth: 4,
      placeId: "cmr37zmiz00cv88rg9lqpy3r4",
      placeType: "ANNEAU",
      portId: "cmilszrmo025fuub8y9c41glk",
      portName: "PORT SIDI BOU SAID",
      portSlug: "port-sidi-bou-said",
      price: 135,
      services: [],
    },
  ],
  success: true,
};

const runTool = searchAvailability.execute;
if (!runTool) {
  throw new Error("searchAvailability.execute is not defined");
}

const toolOptions = {
  messages: [],
  toolCallId: "test-call",
} as unknown as Parameters<typeof runTool>[1];

function mockBackend(response: unknown, status = 200) {
  process.env.MARINABOOK_API_URL = "https://api.marinabook.app";
  process.env.MARINABOOK_ASSISTANT_API_KEY = "test-secret-key";
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(response), {
      headers: { "content-type": "application/json" },
      status,
    })) as unknown as typeof fetch;
}

test("non-empty results pass through without error (exact backend JSON)", async () => {
  mockBackend(REAL_JSON);

  const out = await runTool(
    {
      arrivalDate: "2026-09-15",
      boatLength: 1,
      boatWidth: 1,
      departureDate: "2026-09-18",
      destination: "Sidi Bou Saïd",
    },
    toolOptions
  );

  assert.ok(
    !(out && typeof out === "object" && "error" in out),
    "must not return an error for a valid non-empty result"
  );
  assert.equal(out.results.length, 1, "one result expected");

  const [result] = out.results;
  // Free-form values must be accepted as-is (this is what used to break).
  assert.equal(result.currency, "USD");
  assert.equal(result.placeType, "ANNEAU");
  assert.deepEqual(result.services, []);
  assert.equal(typeof result.bookingUrl, "string");
  assert.equal(typeof result.latitude, "number");
  assert.equal(typeof result.longitude, "number");
  assert.equal(result.price, 135);
  assert.equal(result.portName, "PORT SIDI BOU SAID");
  assert.equal(out.count, 1);
});

test("empty results still work (no availability)", async () => {
  mockBackend({ count: 0, query: {}, results: [], success: true });

  const out = await runTool(
    {
      arrivalDate: "2026-09-15",
      boatLength: 10,
      departureDate: "2026-09-18",
      destination: "Nowhere",
    },
    toolOptions
  );

  assert.ok(!(out && typeof out === "object" && "error" in out));
  assert.deepEqual(out.results, []);
});

test("non-ok backend response returns an error object, never throws", async () => {
  mockBackend("nope", 500);

  const out = await runTool(
    {
      arrivalDate: "2026-09-15",
      boatLength: 11,
      departureDate: "2026-09-18",
      destination: "Cannes",
    },
    toolOptions
  );

  assert.ok(out.error && String(out.error).includes("nope"));
});

test("does not send draft to MarinaBook search-availability", async () => {
  process.env.MARINABOOK_API_URL = "https://api.marinabook.app";
  process.env.MARINABOOK_ASSISTANT_API_KEY = "test-secret-key";

  let requestBody: unknown;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(
      input,
      "https://api.marinabook.app/api/assistant/search-availability"
    );
    requestBody = JSON.parse(String(init?.body ?? "{}"));

    return Promise.resolve(
      new Response(JSON.stringify(REAL_JSON), {
        headers: { "content-type": "application/json" },
        status: 200,
      })
    );
  }) as unknown as typeof fetch;

  await runTool(
    {
      arrivalDate: "2026-09-15",
      boatDraft: 2,
      boatLength: 12,
      boatWidth: 4,
      departureDate: "2026-09-18",
      destination: "Sidi Bou Saïd",
    },
    toolOptions
  );

  assert.deepEqual(requestBody, {
    arrivalDate: "2026-09-15",
    boatLength: 12,
    boatWidth: 4,
    departureDate: "2026-09-18",
    destination: "Sidi Bou Saïd",
  });
});

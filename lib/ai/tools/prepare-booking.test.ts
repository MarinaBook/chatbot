import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { prepareBooking } from "./prepare-booking";

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

// Backend payload for a successfully prepared booking (200 OK, success: true).
// The booking details live under `booking`, as returned by the production
// /assistant/prepare-booking endpoint.
const SUCCESS_JSON = {
  booking: {
    arrivalDate: "2026-09-15",
    bookingUrl:
      "https://www.marinabook.app/place/place-de-port-sidi-bou-said-tunisia-cmr37zmiz00cv88rg9lqpy3r4?dateArrivee=2026-09-15&dateDepart=2026-09-18",
    currency: "USD",
    departureDate: "2026-09-18",
    placeType: "ANNEAU",
    portName: "PORT SIDI BOU SAID",
    price: 135,
  },
  success: true,
};

const VALID_INPUT = {
  arrivalDate: "2026-09-15",
  boatDraft: 1.2,
  boatLength: 1,
  boatWidth: 1,
  departureDate: "2026-09-18",
  placeId: "cmr37zmiz00cv88rg9lqpy3r4",
};

const runTool = prepareBooking.execute;
if (!runTool) {
  throw new Error("prepareBooking.execute is not defined");
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

test("success:true returns the prepared booking without error", async () => {
  mockBackend(SUCCESS_JSON);

  const out = await runTool(VALID_INPUT, toolOptions);

  assert.ok(
    !(out && typeof out === "object" && "error" in out),
    "must not return an error for a valid prepared booking"
  );
  assert.equal(out.success, true);
  // Free-form booking values must be accepted and passed through as-is.
  assert.equal(out.booking.portName, "PORT SIDI BOU SAID");
  assert.equal(out.booking.placeType, "ANNEAU");
  assert.equal(out.booking.price, 135);
  assert.equal(out.booking.currency, "USD");
  assert.equal(typeof out.booking.bookingUrl, "string");
});

test("success:false PLACE_NOT_AVAILABLE passes the business code through", async () => {
  mockBackend({ code: "PLACE_NOT_AVAILABLE", success: false });

  const out = await runTool(VALID_INPUT, toolOptions);

  // A business error is not a transport error: no `error` field, but the code
  // must reach the model so it can explain it.
  assert.ok(!(out && typeof out === "object" && "error" in out));
  assert.equal(out.success, false);
  assert.equal(out.code, "PLACE_NOT_AVAILABLE");
  assert.equal(out.booking, undefined);
});

test("success:false PLACE_NOT_COMPATIBLE passes the business code through", async () => {
  mockBackend({ code: "PLACE_NOT_COMPATIBLE", success: false });

  const out = await runTool(VALID_INPUT, toolOptions);

  assert.equal(out.success, false);
  assert.equal(out.code, "PLACE_NOT_COMPATIBLE");
});

test("backend 401 returns an error object, never throws", async () => {
  mockBackend({ message: "Unauthorized" }, 401);

  const out = await runTool(VALID_INPUT, toolOptions);

  assert.ok(out.error && String(out.error).includes("Unauthorized"));
});

test("backend 500 returns an error object, never throws", async () => {
  mockBackend("boom", 500);

  const out = await runTool(VALID_INPUT, toolOptions);

  assert.ok(out.error && String(out.error).includes("boom"));
});

test("missing configuration returns an error and never calls the backend", async () => {
  // Node coerces `process.env.X = undefined` to the string "undefined" (truthy),
  // so delete the keys to genuinely simulate a missing configuration.
  delete process.env.BACKEND_URL;
  delete process.env.MARINABOOK_ASSISTANT_API_KEY;
  let backendCalled = false;
  globalThis.fetch = (() => {
    backendCalled = true;
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as typeof fetch;

  const out = await runTool(VALID_INPUT, toolOptions);

  assert.equal(
    backendCalled,
    false,
    "backend must not be called when configuration is missing"
  );
  assert.ok(out.error && String(out.error).includes("not configured"));
});

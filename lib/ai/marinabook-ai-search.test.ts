import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  callMarinaBookAiSearch,
  getNeutralTechnicalMessage,
} from "./marinabook-ai-search";

// Distinctive value so leak assertions are meaningful. Comes from the same env
// var the production code reads: MARINABOOK_ASSISTANT_API_KEY.
const TEST_ASSISTANT_KEY = "test-assistant-key-a1b2c3-SECRET";

const originalBackendUrl = process.env.BACKEND_URL;
const originalMarinaBookApiUrl = process.env.MARINABOOK_API_URL;
const originalAssistantApiKey = process.env.MARINABOOK_ASSISTANT_API_KEY;
const originalFetch = globalThis.fetch;
const originalConsoleError = console.error;
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;

afterEach(() => {
  process.env.BACKEND_URL = originalBackendUrl;
  process.env.MARINABOOK_API_URL = originalMarinaBookApiUrl;
  process.env.MARINABOOK_ASSISTANT_API_KEY = originalAssistantApiKey;
  globalThis.fetch = originalFetch;
  console.error = originalConsoleError;
  console.log = originalConsoleLog;
  console.warn = originalConsoleWarn;
});

function configureBackend() {
  process.env.MARINABOOK_API_URL = "https://api.marinabook.app";
  process.env.MARINABOOK_ASSISTANT_API_KEY = TEST_ASSISTANT_KEY;
}

// Captures every console.log/error/warn argument so tests can prove the key
// value never reaches the logs.
function captureConsole() {
  const lines: string[] = [];
  const capture =
    () =>
    (...args: unknown[]) => {
      lines.push(args.map((arg) => String(arg)).join(" "));
    };
  console.error = capture();
  console.log = capture();
  console.warn = capture();
  return lines;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

test("FAQ question calls ai-search once with the S2S key header from the env var", async () => {
  configureBackend();

  let calls = 0;
  let capturedUrl: unknown;
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = ((url: unknown, init?: RequestInit) => {
    calls += 1;
    capturedUrl = url;
    capturedInit = init;
    return Promise.resolve(
      jsonResponse({ assistantMode: "knowledge_base", reply: "Réponse." })
    );
  }) as unknown as typeof fetch;

  const result = await callMarinaBookAiSearch({
    locale: "fr",
    message: "Quelle est la politique de confidentialité de MarinaBook ?",
    sessionId: "session-abc-123",
  });

  // Exactly one backend call (no double orchestration, no local LLM).
  assert.equal(calls, 1);
  assert.equal(
    capturedUrl,
    "https://api.marinabook.app/api/assistant/ai-search"
  );

  const headers = capturedInit?.headers as Record<string, string>;
  // The S2S header value comes exclusively from MARINABOOK_ASSISTANT_API_KEY.
  assert.equal(
    headers["x-marinabook-assistant-key"],
    process.env.MARINABOOK_ASSISTANT_API_KEY
  );
  assert.equal(headers["x-marinabook-assistant-key"], TEST_ASSISTANT_KEY);
  // Exactly these two headers: no Authorization bearer, no NEXT_PUBLIC_*-based
  // header, nothing else.
  assert.deepEqual(Object.keys(headers).sort(), [
    "content-type",
    "x-marinabook-assistant-key",
  ]);
  assert.equal(headers["content-type"], "application/json");

  // The JSON body is unchanged by the S2S profile.
  assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
    locale: "fr",
    message: "Quelle est la politique de confidentialité de MarinaBook ?",
    sessionId: "session-abc-123",
  });

  assert.ok(result.ok);
  assert.equal(result.data.reply, "Réponse.");
  assert.equal(result.data.assistantMode, "knowledge_base");
});

test("omits locale from the body when not provided", async () => {
  configureBackend();
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = ((_url: unknown, init?: RequestInit) => {
    capturedInit = init;
    return Promise.resolve(jsonResponse({ reply: "Bonjour." }));
  }) as unknown as typeof fetch;

  await callMarinaBookAiSearch({ message: "Bonjour", sessionId: "s1" });

  assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
    message: "Bonjour",
    sessionId: "s1",
  });
});

test("CGV question calls ai-search (single call, correct endpoint)", async () => {
  configureBackend();

  let calls = 0;
  let capturedUrl: unknown;
  globalThis.fetch = ((url: unknown) => {
    calls += 1;
    capturedUrl = url;
    return Promise.resolve(
      jsonResponse({
        assistantMode: "knowledge_base",
        reply: "Les CGV de MarinaBook sont disponibles en ligne.",
        sources: [{ title: "CGV", url: "https://www.marinabook.app/cgv" }],
      })
    );
  }) as unknown as typeof fetch;

  const result = await callMarinaBookAiSearch({
    locale: "fr",
    message: "Où puis-je consulter les CGV de MarinaBook ?",
    sessionId: "session-cgv",
  });

  assert.equal(calls, 1);
  assert.equal(
    capturedUrl,
    "https://api.marinabook.app/api/assistant/ai-search"
  );
  assert.ok(result.ok);
  assert.equal(result.data.assistantMode, "knowledge_base");
  assert.deepEqual(result.data.sources, [
    { title: "CGV", url: "https://www.marinabook.app/cgv" },
  ]);
});

test("KNOWLEDGE_RAG (rag) reply is returned as-is with its sources, single call", async () => {
  configureBackend();

  let calls = 0;
  globalThis.fetch = (() => {
    calls += 1;
    return Promise.resolve(
      jsonResponse({
        assistantMode: "rag",
        detectedLanguage: "fr",
        reply: "Passage 1.\n\nPassage 2.",
        requestId: "req_rag",
        sources: [{ title: "FAQ", url: "https://www.marinabook.app/faq" }],
      })
    );
  }) as unknown as typeof fetch;

  const result = await callMarinaBookAiSearch({
    message: "Comment fonctionne MarinaBook ?",
    sessionId: "s1",
  });

  // Exactly one HTTP call: the backend answer is used verbatim, no local LLM
  // (Groq also goes through fetch, so calls === 1 proves no second LLM call).
  assert.equal(calls, 1);
  assert.ok(result.ok);
  assert.equal(result.data.reply, "Passage 1.\n\nPassage 2.");
  assert.equal(result.data.assistantMode, "rag");
  assert.deepEqual(result.data.sources, [
    { title: "FAQ", url: "https://www.marinabook.app/faq" },
  ]);
});

test("GROQ_FALLBACK backend (chatbot_fallback) triggers no second call", async () => {
  configureBackend();

  let calls = 0;
  globalThis.fetch = (() => {
    calls += 1;
    return Promise.resolve(
      jsonResponse({
        assistantMode: "chatbot_fallback",
        reply: "Réponse produite par le fallback backend.",
      })
    );
  }) as unknown as typeof fetch;

  const result = await callMarinaBookAiSearch({
    message: "Question inconnue",
    sessionId: "s1",
  });

  assert.equal(calls, 1);
  assert.ok(result.ok);
  assert.equal(result.data.reply, "Réponse produite par le fallback backend.");
  assert.equal(result.data.assistantMode, "chatbot_fallback");
});

test("APPROVED_ANSWER (knowledge_base) returns reply + only MarinaBook sources", async () => {
  configureBackend();
  globalThis.fetch = (async () =>
    jsonResponse({
      assistantMode: "knowledge_base",
      detectedLanguage: "fr",
      reply: "Réponse officielle MarinaBook.",
      requestId: "req_1",
      sources: [
        { title: "FAQ MarinaBook", url: "https://www.marinabook.app/faq" },
        { title: "Evil", url: "javascript:alert(1)" },
        { title: "Third party", url: "https://example.com/faq" },
      ],
    })) as unknown as typeof fetch;

  const result = await callMarinaBookAiSearch({
    message: "FAQ",
    sessionId: "s1",
  });

  assert.ok(result.ok);
  assert.equal(result.data.assistantMode, "knowledge_base");
  assert.equal(result.data.requestId, "req_1");
  assert.deepEqual(result.data.sources, [
    { title: "FAQ MarinaBook", url: "https://www.marinabook.app/faq" },
  ]);
  assert.deepEqual(result.data.results, []);
});

test("availability keeps MarinaBook bookingUrl and drops foreign ones", async () => {
  configureBackend();

  const calledUrls: unknown[] = [];
  globalThis.fetch = ((url: unknown) => {
    calledUrls.push(url);
    return Promise.resolve(availabilityBackendResponse());
  }) as unknown as typeof fetch;

  const result = await callMarinaBookAiSearch({
    message: "place à Marseille",
    sessionId: "s1",
  });

  // A single ai-search call; the chatbot never also calls /search-availability
  // for the same question (the backend already orchestrated it).
  assert.deepEqual(calledUrls, [
    "https://api.marinabook.app/api/assistant/ai-search",
  ]);

  assert.ok(result.ok);
  assert.equal(result.data.results.length, 2);
  assert.equal(
    result.data.results[0].bookingUrl,
    "https://www.marinabook.app/p/1"
  );
  assert.equal(result.data.results[0].portName, "VIEUX PORT");
  // Non-MarinaBook booking link is stripped, the rest of the result survives.
  assert.equal(result.data.results[1].bookingUrl, undefined);
  assert.equal(result.data.results[1].portName, "FAKE PORT");
});

function availabilityBackendResponse() {
  return jsonResponse({
    assistantMode: "availability",
    intent: "availability_search",
    reply: "Voici des places disponibles.",
    results: [
      {
        available: true,
        bookingUrl: "https://www.marinabook.app/p/1",
        currency: "EUR",
        placeType: "ANNEAU",
        portName: "VIEUX PORT",
        price: 120,
      },
      {
        bookingUrl: "https://evil.com/p/2",
        portName: "FAKE PORT",
        price: 99,
      },
    ],
  });
}

test("optional metadata absent stays compatible", async () => {
  configureBackend();
  globalThis.fetch = (async () =>
    jsonResponse({ reply: "Bonjour." })) as unknown as typeof fetch;

  const result = await callMarinaBookAiSearch({
    message: "Bonjour",
    sessionId: "s1",
  });

  assert.ok(result.ok);
  assert.equal(result.data.reply, "Bonjour.");
  assert.equal(result.data.assistantMode, undefined);
  assert.equal(result.data.requestId, undefined);
  assert.deepEqual(result.data.sources, []);
  assert.deepEqual(result.data.results, []);
});

test("backend 500 is a technical failure with no local Groq retry and no key leak", async () => {
  configureBackend();
  const logs = captureConsole();

  let calls = 0;
  globalThis.fetch = (() => {
    calls += 1;
    return Promise.resolve(jsonResponse({ error: "boom" }, 500));
  }) as unknown as typeof fetch;

  const result = await callMarinaBookAiSearch({
    message: "FAQ",
    sessionId: "s1",
  });

  assert.equal(result.ok, false);
  // Exactly one HTTP call happened: the failure is not followed by any local
  // LLM/Groq attempt (any Groq call would also go through fetch).
  assert.equal(calls, 1);
  // The key value never appears in the returned object or in any log line.
  assert.ok(!JSON.stringify(result).includes(TEST_ASSISTANT_KEY));
  assert.ok(logs.every((line) => !line.includes(TEST_ASSISTANT_KEY)));
});

test("429 is a controlled technical failure with Retry-After surfaced, no fallback", async () => {
  configureBackend();
  const logs = captureConsole();

  let calls = 0;
  globalThis.fetch = (() => {
    calls += 1;
    return Promise.resolve(
      new Response(
        JSON.stringify({ error: "RATE_LIMIT_EXCEEDED", retryAfter: 17 }),
        {
          headers: {
            "content-type": "application/json",
            "retry-after": "17",
          },
          status: 429,
        }
      )
    );
  }) as unknown as typeof fetch;

  const result = await callMarinaBookAiSearch({
    message: "FAQ",
    sessionId: "s1",
  });

  // Single call: a 429 never triggers a retry loop nor a local LLM fallback.
  assert.equal(calls, 1);
  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("unreachable");
  }
  assert.equal(result.reason, "rate_limited");
  assert.equal(result.retryAfterSeconds, 17);
  // Nothing sensitive leaks: no key, no backend error text in the result.
  assert.ok(!JSON.stringify(result).includes(TEST_ASSISTANT_KEY));
  assert.ok(!JSON.stringify(result).includes("RATE_LIMIT_EXCEEDED"));
  assert.ok(logs.every((line) => !line.includes(TEST_ASSISTANT_KEY)));
  // The user-facing handling stays the neutral technical message.
  assert.match(getNeutralTechnicalMessage("fr"), /indisponible/i);
});

test("429 without a parseable Retry-After still fails as rate_limited", async () => {
  configureBackend();
  globalThis.fetch = (async () =>
    jsonResponse({ error: "rate" }, 429)) as unknown as typeof fetch;

  const result = await callMarinaBookAiSearch({
    message: "FAQ",
    sessionId: "s1",
  });

  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("unreachable");
  }
  assert.equal(result.reason, "rate_limited");
  assert.equal(result.retryAfterSeconds, undefined);
});

test("network error is a technical failure (ok: false)", async () => {
  configureBackend();
  globalThis.fetch = (() =>
    Promise.reject(new Error("network"))) as unknown as typeof fetch;

  const result = await callMarinaBookAiSearch({
    message: "FAQ",
    sessionId: "s1",
  });
  assert.equal(result.ok, false);
});

test("invalid JSON is a technical failure (ok: false)", async () => {
  configureBackend();
  globalThis.fetch = (async () =>
    new Response("not json", {
      headers: { "content-type": "application/json" },
      status: 200,
    })) as unknown as typeof fetch;

  const result = await callMarinaBookAiSearch({
    message: "FAQ",
    sessionId: "s1",
  });
  assert.equal(result.ok, false);
});

test("a 200 without a reply is treated as failure", async () => {
  configureBackend();
  globalThis.fetch = (async () =>
    jsonResponse({ assistantMode: "rag" })) as unknown as typeof fetch;

  const result = await callMarinaBookAiSearch({
    message: "FAQ",
    sessionId: "s1",
  });
  assert.equal(result.ok, false);
});

test("missing MARINABOOK_ASSISTANT_API_KEY blocks the call before any network I/O", async () => {
  process.env.MARINABOOK_API_URL = "https://api.marinabook.app";
  delete process.env.MARINABOOK_ASSISTANT_API_KEY;
  const logs = captureConsole();

  let called = false;
  globalThis.fetch = (() => {
    called = true;
    throw new Error("fetch should not be called");
  }) as unknown as typeof fetch;

  const result = await callMarinaBookAiSearch({
    message: "FAQ",
    sessionId: "s1",
  });

  assert.equal(called, false);
  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("unreachable");
  }
  assert.equal(result.reason, "not_configured");
  // The config error mentions variable NAMES only — never a key value.
  assert.ok(logs.some((line) => line.includes("MARINABOOK_ASSISTANT_API_KEY")));
  assert.ok(logs.every((line) => !line.includes(TEST_ASSISTANT_KEY)));
});

test("empty MARINABOOK_ASSISTANT_API_KEY blocks the call before any network I/O", async () => {
  process.env.MARINABOOK_API_URL = "https://api.marinabook.app";
  process.env.MARINABOOK_ASSISTANT_API_KEY = "";
  captureConsole();

  let called = false;
  globalThis.fetch = (() => {
    called = true;
    throw new Error("fetch should not be called");
  }) as unknown as typeof fetch;

  const result = await callMarinaBookAiSearch({
    message: "FAQ",
    sessionId: "s1",
  });

  assert.equal(called, false);
  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("unreachable");
  }
  assert.equal(result.reason, "not_configured");
});

test("missing backend URL returns not_configured and never calls fetch", async () => {
  delete process.env.BACKEND_URL;
  delete process.env.MARINABOOK_API_URL;
  process.env.MARINABOOK_ASSISTANT_API_KEY = TEST_ASSISTANT_KEY;
  const logs = captureConsole();

  let called = false;
  globalThis.fetch = (() => {
    called = true;
    throw new Error("fetch should not be called");
  }) as unknown as typeof fetch;

  const result = await callMarinaBookAiSearch({
    message: "FAQ",
    sessionId: "s1",
  });

  assert.equal(result.ok, false);
  assert.equal(called, false);
  // Even here, the key value never leaks into the logs.
  assert.ok(logs.every((line) => !line.includes(TEST_ASSISTANT_KEY)));
});

test("getNeutralTechnicalMessage is localized with a French default", () => {
  assert.match(getNeutralTechnicalMessage("en"), /temporarily unavailable/i);
  assert.match(getNeutralTechnicalMessage("fr"), /indisponible/i);
  assert.match(getNeutralTechnicalMessage("de-DE"), /nicht verfügbar/i);
  // Unknown/absent locale falls back to French.
  assert.match(getNeutralTechnicalMessage("xx"), /indisponible/i);
  assert.match(getNeutralTechnicalMessage(undefined), /indisponible/i);
});

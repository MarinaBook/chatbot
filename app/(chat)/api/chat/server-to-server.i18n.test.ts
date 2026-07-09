import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  handleServerToServerChat,
  serverToServerChatRequestSchema,
} from "./server-to-server";

const TEST_SESSION_ID = "5a5581ec-5219-4d0d-8b31-6b1739c8f7a1";
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function build(message: string, locale = "fr") {
  return serverToServerChatRequestSchema.parse({
    locale,
    message,
    sessionId: TEST_SESSION_ID,
    source: "marinabook_frontend",
  });
}

const GENERAL_CASES: { lang: string; message: string; marker: RegExp }[] = [
  {
    lang: "fr",
    marker: /reçu votre message/,
    message: "Bonjour, pouvez-vous m’aider ?",
  },
  {
    lang: "en",
    marker: /received your message/,
    message: "Hello, can you help me?",
  },
  {
    lang: "ar",
    marker: /استلمت رسالتك/,
    message: "مرحبا، هل يمكنك مساعدتي؟",
  },
  {
    lang: "es",
    marker: /He recibido su mensaje/,
    message: "Hola, ¿puede ayudarme?",
  },
  {
    lang: "it",
    marker: /Ho ricevuto il suo messaggio/,
    message: "Ciao, puoi aiutarmi?",
  },
  {
    lang: "de",
    marker: /Ich habe Ihre Nachricht erhalten/,
    message: "Hallo, können Sie mir helfen?",
  },
  {
    lang: "pt",
    marker: /Recebi a sua mensagem/,
    message: "Olá, pode ajudar-me?",
  },
];

for (const { lang, message, marker } of GENERAL_CASES) {
  test(`replies in ${lang} and reports detectedLanguage for a ${lang} message`, async () => {
    const response = await handleServerToServerChat(build(message));
    assert.equal(response.detectedLanguage, lang);
    assert.match(response.reply, marker);
  });
}

test("uses the dominant language of a multilingual message", async () => {
  const response = await handleServerToServerChat(
    build("Je cherche une place pour mon bateau, please help")
  );
  assert.equal(response.detectedLanguage, "fr");
});

test("falls back to the frontend locale when detection fails", async () => {
  const response = await handleServerToServerChat(build("?? 12 34 ??", "es"));
  assert.equal(response.detectedLanguage, "es");
  assert.match(response.reply, /He recibido su mensaje/);
});

test("returns detectedLanguage on the availability path", async () => {
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
      { headers: { "content-type": "application/json" }, status: 200 }
    )) as typeof fetch;

  const response = await handleServerToServerChat(
    build(
      "Je vais à Marseille du 8 au 14 juillet 2026 pour un bateau de 12 m de long, 4 m de large."
    )
  );

  assert.equal(response.intent, "availability_search");
  assert.equal(response.detectedLanguage, "fr");
  assert.match(response.reply, /VIEUX-PORT DE MARSEILLE/);
});

// A full-month expression must be normalized deterministically to the first and
// last day of that month, before the missing-information validation runs, so the
// dates are never reported as missing. Independent of language.

test("normalizes a French full-month expression to arrival/departure dates", async () => {
  const response = await handleServerToServerChat(
    build("Je cherche une place pour le mois de septembre.")
  );

  assert.equal(response.detectedLanguage, "fr");
  assert.match(response.searchParams.arrivalDate ?? "", /^\d{4}-09-01$/);
  assert.match(response.searchParams.departureDate ?? "", /^\d{4}-09-30$/);
});

test("normalizes an Italian full-month expression to arrival/departure dates", async () => {
  const response = await handleServerToServerChat(
    build("Vorrei un posto in marina per il mese di settembre.", "it")
  );

  assert.equal(response.detectedLanguage, "it");
  assert.match(response.searchParams.arrivalDate ?? "", /^\d{4}-09-01$/);
  assert.match(response.searchParams.departureDate ?? "", /^\d{4}-09-30$/);
});

test("normalizes an Arabic full-month expression to arrival/departure dates", async () => {
  const response = await handleServerToServerChat(
    build("أبحث عن مكان في المارينا خلال شهر سبتمبر.", "ar")
  );

  assert.equal(response.detectedLanguage, "ar");
  assert.match(response.searchParams.arrivalDate ?? "", /^\d{4}-09-01$/);
  assert.match(response.searchParams.departureDate ?? "", /^\d{4}-09-30$/);
});

test("produces identical searchParams for two identical requests", async () => {
  const message =
    "Vorrei un posto barca in Tunisia per il mese di settembre, per un'imbarcazione di 1 m x 1 m con un pescaggio di 1 m.";

  const first = await handleServerToServerChat(build(message, "it"));
  const second = await handleServerToServerChat(build(message, "it"));

  assert.deepEqual(first.searchParams, second.searchParams);
  assert.equal(first.detectedLanguage, second.detectedLanguage);
  assert.equal(first.intent, second.intent);
  assert.match(first.searchParams.arrivalDate ?? "", /^\d{4}-09-01$/);
  assert.match(first.searchParams.departureDate ?? "", /^\d{4}-09-30$/);
});

test("a standalone message does not inherit language or params from a previous one", async () => {
  await handleServerToServerChat(
    build("أبحث عن مكان في المارينا خلال شهر سبتمبر لقارب طوله ١٢ مترًا.", "ar")
  );

  const second = await handleServerToServerChat(
    build("Bonjour, pouvez-vous m’aider ?")
  );

  assert.equal(second.detectedLanguage, "fr");
  assert.deepEqual(second.searchParams, {});
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createAvailabilityErrorReply,
  createAvailabilityResultsReply,
  createGeneralReply,
  createMissingInformationReply,
  createNoAvailabilityReply,
  createUnsupportedReply,
  formatDateForReply,
  listMissingFields,
} from "./replies";

const GENERAL_MARKERS: Record<string, RegExp> = {
  ar: /استلمت رسالتك/,
  de: /Ich habe Ihre Nachricht erhalten/,
  en: /received your message/,
  es: /He recibido su mensaje/,
  fr: /reçu votre message/,
  it: /Ho ricevuto il suo messaggio/,
  pt: /Recebi a sua mensagem/,
};

for (const [lang, marker] of Object.entries(GENERAL_MARKERS)) {
  test(`general reply is written in ${lang}`, () => {
    const reply = createGeneralReply(lang as never);
    assert.match(reply, marker);
    assert.ok(reply.length > 0);
  });
}

const RESULT = {
  currency: "USD",
  placeType: "ANNEAU",
  portName: "PORT SIDI BOU SAID",
  price: 135,
};

const SEARCH = {
  arrivalDate: "2026-09-15",
  departureDate: "2026-09-18",
};

for (const lang of ["fr", "en", "ar", "es", "it", "pt", "de"] as const) {
  test(`availability reply preserves port, place, price and currency in ${lang}`, () => {
    const reply = createAvailabilityResultsReply([RESULT], SEARCH, lang);
    assert.match(reply, /PORT SIDI BOU SAID/);
    assert.match(reply, /ANNEAU/);
    assert.match(reply, /135/);
    assert.match(reply, /USD/);
  });
}

test("availability reply falls back to the no-availability message on empty results", () => {
  const reply = createAvailabilityResultsReply([], SEARCH, "es");
  assert.equal(reply, createNoAvailabilityReply("es"));
});

test("French strings are preserved verbatim (backward compatibility)", () => {
  assert.match(
    createMissingInformationReply(["la date d’arrivée"], "fr"),
    /Il me manque la date d’arrivée pour lancer la recherche\./
  );
  assert.match(
    createAvailabilityErrorReply("MarinaBook is not configured", "fr"),
    /Le service MarinaBook n’est pas configuré côté serveur\./
  );
});

test("missing-information reply is localized per language", () => {
  const fields = listMissingFields({ destination: "Napoli" }, "it");
  // destination present, so arrival/departure/length remain missing
  assert.deepEqual(fields, [
    "la data di arrivo",
    "la data di partenza",
    "la lunghezza della barca",
  ]);
  const reply = createMissingInformationReply(fields, "it");
  assert.match(reply, /Mi manca ancora/);
  assert.match(reply, /avviare la ricerca/);
});

test("error reply maps a required-field error into the right language", () => {
  assert.match(
    createAvailabilityErrorReply("boatLength is required", "de"),
    /Bootslänge/
  );
  assert.match(
    createAvailabilityErrorReply("destination is required", "pt"),
    /o destino/
  );
});

test("unsupported and no-availability replies are non-empty in every language", () => {
  for (const lang of ["fr", "en", "ar", "es", "it", "pt", "de"] as const) {
    assert.ok(createUnsupportedReply(lang).length > 0);
    assert.ok(createNoAvailabilityReply(lang).length > 0);
  }
});

test("dates are formatted with Latin digits, even in Arabic", () => {
  const formatted = formatDateForReply("2026-09-15", "ar");
  assert.match(formatted, /2026/);
  assert.match(formatted, /15/);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  detectLanguage,
  resolveReplyLanguage,
  SUPPORTED_REPLY_LANGUAGES,
} from "./language";

test("detects French from a berth-search message", () => {
  assert.equal(
    detectLanguage(
      "Je cherche une place à Marseille du 8 au 14 juillet pour un bateau de 12 mètres"
    ),
    "fr"
  );
});

test("detects English from a berth-search message", () => {
  assert.equal(
    detectLanguage(
      "I am looking for a berth in Marseille from July 8 to 14 for a 12 meter boat"
    ),
    "en"
  );
});

test("detects Arabic from its script", () => {
  assert.equal(detectLanguage("أبحث عن مكان لرسو قارب في مرسيليا"), "ar");
});

test("detects Spanish from a berth-search message", () => {
  assert.equal(
    detectLanguage(
      "Busco un amarre en Barcelona del 8 al 14 de julio para un barco de 12 metros"
    ),
    "es"
  );
});

test("detects Italian from a berth-search message", () => {
  assert.equal(
    detectLanguage(
      "Cerco un posto barca a Napoli dal 8 al 14 luglio per una barca di 12 metri"
    ),
    "it"
  );
});

test("detects German from a berth-search message", () => {
  assert.equal(
    detectLanguage(
      "Ich suche einen Liegeplatz in Hamburg für ein Boot von 12 Metern"
    ),
    "de"
  );
});

test("detects Portuguese from a berth-search message", () => {
  assert.equal(
    detectLanguage(
      "Procuro uma vaga em Lisboa de 8 a 14 de julho para um barco de 12 metros"
    ),
    "pt"
  );
});

test("uses the dominant language of a multilingual message", () => {
  assert.equal(
    detectLanguage(
      "Je voudrais réserver une place à Marseille pour mon bateau, please"
    ),
    "fr"
  );
});

test("returns undefined when there is no language signal", () => {
  assert.equal(detectLanguage("12m 4m 2026-07-08"), undefined);
  assert.equal(detectLanguage(""), undefined);
});

test("resolveReplyLanguage returns the detected language when supported", () => {
  assert.equal(resolveReplyLanguage("es", "fr"), "es");
});

test("resolveReplyLanguage falls back to the frontend locale when detection failed", () => {
  assert.equal(resolveReplyLanguage(undefined, "it"), "it");
});

test("resolveReplyLanguage falls back to French as a last resort", () => {
  assert.equal(resolveReplyLanguage(undefined, "zz"), "fr");
  assert.equal(resolveReplyLanguage(undefined, ""), "fr");
});

test("resolveReplyLanguage ignores an unsupported detected code", () => {
  // Detected Dutch, no Dutch translations: fall back to the frontend locale.
  assert.equal(resolveReplyLanguage("nl", "pt"), "pt");
  // ...then to French when the locale is unusable too.
  assert.equal(resolveReplyLanguage("nl", "zz"), "fr");
});

test("normalizes locale prefixes such as fr-FR", () => {
  assert.equal(resolveReplyLanguage(undefined, "fr-FR"), "fr");
  assert.equal(resolveReplyLanguage(undefined, "en-US"), "en");
});

test("exposes the supported reply languages", () => {
  assert.deepEqual([...SUPPORTED_REPLY_LANGUAGES].sort(), [
    "ar",
    "de",
    "en",
    "es",
    "fr",
    "it",
    "pt",
  ]);
});

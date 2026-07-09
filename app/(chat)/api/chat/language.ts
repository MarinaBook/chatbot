// Deterministic language detection for the MarinaBook server-to-server chat.
//
// The server-to-server unit tests run WITHOUT an LLM (no LLM_API_KEY), so
// language detection must be deterministic. In production the LLM extraction
// step may also return a `detectedLanguage`; when it does, it takes precedence
// (see server-to-server.ts). This module is the always-available safety net and
// the source of truth for which languages we can actually reply in.

export const SUPPORTED_REPLY_LANGUAGES = [
  "fr",
  "en",
  "ar",
  "es",
  "it",
  "pt",
  "de",
] as const;

export type ReplyLanguage = (typeof SUPPORTED_REPLY_LANGUAGES)[number];

const SUPPORTED_SET = new Set<string>(SUPPORTED_REPLY_LANGUAGES);

// Arabic (and Arabic Supplement) script: a strong, unambiguous signal.
const ARABIC_SCRIPT = /[؀-ۿݐ-ݿ]/;

// Distinctive function words / domain markers per Latin-script language. Only
// reasonably distinctive tokens are listed to keep cross-language noise low.
// Tokens keep their diacritics (é, ü, ç, ã, ñ, ß) because those are signals.
const LATIN_MARKERS: Record<Exclude<ReplyLanguage, "ar">, string[]> = {
  de: [
    "ich",
    "suche",
    "einen",
    "ein",
    "für",
    "fur",
    "boot",
    "metern",
    "liegeplatz",
    "hallo",
    "danke",
    "möchte",
    "mochte",
    "reservieren",
    "verfügbarkeit",
    "mit",
    "und",
    "von",
    "hamburg",
  ],
  en: [
    "i",
    "looking",
    "for",
    "from",
    "to",
    "boat",
    "meter",
    "meters",
    "berth",
    "need",
    "want",
    "hello",
    "my",
    "with",
    "please",
    "available",
    "availability",
  ],
  es: [
    "busco",
    "un",
    "en",
    "del",
    "al",
    "para",
    "barco",
    "metros",
    "una",
    "el",
    "los",
    "las",
    "hola",
    "gracias",
    "quiero",
    "reservar",
    "disponibilidad",
    "amarre",
    "con",
  ],
  fr: [
    "je",
    "cherche",
    "une",
    "place",
    "pour",
    "bateau",
    "mètres",
    "metres",
    "au",
    "du",
    "avec",
    "voudrais",
    "réserver",
    "reserver",
    "disponibilité",
    "bonjour",
    "mon",
    "dans",
    "à",
  ],
  it: [
    "cerco",
    "posto",
    "barca",
    "per",
    "una",
    "di",
    "metri",
    "il",
    "sono",
    "vorrei",
    "ciao",
    "grazie",
    "prenotare",
    "disponibilità",
    "dal",
    "con",
    "luglio",
  ],
  pt: [
    "procuro",
    "uma",
    "vaga",
    "em",
    "para",
    "um",
    "barco",
    "metros",
    "não",
    "nao",
    "obrigado",
    "você",
    "voce",
    "quero",
    "reservar",
    "disponibilidade",
    "olá",
    "ola",
    "com",
    "julho",
  ],
};

const LATIN_MARKER_SETS = Object.fromEntries(
  Object.entries(LATIN_MARKERS).map(([lang, words]) => [lang, new Set(words)])
) as Record<Exclude<ReplyLanguage, "ar">, Set<string>>;

const LATIN_LANGUAGES = Object.keys(LATIN_MARKERS) as Exclude<
  ReplyLanguage,
  "ar"
>[];

/** Normalizes a BCP-47/locale string to a supported reply language, if any. */
function normalizeLocaleCode(locale: string | undefined): ReplyLanguage | null {
  if (!locale) {
    return null;
  }

  const [base] = locale.trim().toLowerCase().split(/[-_]/);
  return SUPPORTED_SET.has(base) ? (base as ReplyLanguage) : null;
}

/**
 * Detects the dominant language of a user message. Returns undefined when there
 * is no reliable signal (empty, numeric-only, or a tie between languages), so
 * the caller can fall back to the frontend locale and then French.
 */
export function detectLanguage(message: string): ReplyLanguage | undefined {
  if (ARABIC_SCRIPT.test(message)) {
    return "ar";
  }

  const tokens = message.toLowerCase().match(/[\p{L}]+/gu);
  if (!tokens) {
    return;
  }

  const scores = new Map<Exclude<ReplyLanguage, "ar">, number>();
  for (const token of tokens) {
    for (const lang of LATIN_LANGUAGES) {
      if (LATIN_MARKER_SETS[lang].has(token)) {
        scores.set(lang, (scores.get(lang) ?? 0) + 1);
      }
    }
  }

  let best: Exclude<ReplyLanguage, "ar"> | undefined;
  let bestScore = 0;
  let tie = false;
  for (const [lang, score] of scores) {
    if (score > bestScore) {
      best = lang;
      bestScore = score;
      tie = false;
    } else if (score === bestScore) {
      tie = true;
    }
  }

  return bestScore > 0 && !tie ? best : undefined;
}

/**
 * Resolves the language used to build a reply. Precedence:
 *   1. the detected language, when it is one we can reply in;
 *   2. the frontend-provided locale, when supported;
 *   3. French as the last resort.
 */
export function resolveReplyLanguage(
  detected: string | undefined,
  frontendLocale: string
): ReplyLanguage {
  return (
    normalizeLocaleCode(detected) ?? normalizeLocaleCode(frontendLocale) ?? "fr"
  );
}

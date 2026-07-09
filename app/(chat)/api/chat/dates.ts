// Deterministic normalization of "full month" expressions for the MarinaBook
// server-to-server chat (e.g. "pour le mois de septembre", "per il mese di
// settembre", "خلال شهر سبتمبر"). A full-month expression is normalized to the
// first and last day of that month.
//
// This is intentionally independent of the LLM: the LLM is non-deterministic and
// sometimes resolves such an expression to a date range and sometimes not, which
// produced inconsistent "missing dates" replies for identical requests. Running
// this deterministic step (with an injectable reference date) guarantees that two
// identical messages always yield the same arrival/departure dates.

type MonthRange = { arrivalDate: string; departureDate: string };

// Month names across the languages we support, mapped to their 1-based number.
// French / Italian / English / Arabic (transliterated European names, standard
// in the MarinaBook markets). Keys are normalized at build time (see
// `normalizeMonthToken`) so lookups are diacritic- and case-insensitive.
const RAW_MONTH_NAMES: [string, number][] = [
  // French
  ["janvier", 1],
  ["février", 2],
  ["mars", 3],
  ["avril", 4],
  ["mai", 5],
  ["juin", 6],
  ["juillet", 7],
  ["août", 8],
  ["septembre", 9],
  ["octobre", 10],
  ["novembre", 11],
  ["décembre", 12],
  // Italian
  ["gennaio", 1],
  ["febbraio", 2],
  ["marzo", 3],
  ["aprile", 4],
  ["maggio", 5],
  ["giugno", 6],
  ["luglio", 7],
  ["agosto", 8],
  ["settembre", 9],
  ["ottobre", 10],
  ["dicembre", 12],
  // English
  ["january", 1],
  ["february", 2],
  ["march", 3],
  ["april", 4],
  ["may", 5],
  ["june", 6],
  ["july", 7],
  ["august", 8],
  ["september", 9],
  ["october", 10],
  ["november", 11],
  ["december", 12],
  // Arabic (transliterated European month names)
  ["يناير", 1],
  ["فبراير", 2],
  ["مارس", 3],
  ["أبريل", 4],
  ["مايو", 5],
  ["يونيو", 6],
  ["يوليو", 7],
  ["أغسطس", 8],
  ["سبتمبر", 9],
  ["أكتوبر", 10],
  ["نوفمبر", 11],
  ["ديسمبر", 12],
];

// Normalizes a value for matching: NFD + strip combining marks (Latin accents
// AND Arabic harakat, including the hamza that NFD splits off أ/إ/آ), remove the
// Arabic tatweel (ـ U+0640), collapse whitespace and lowercase. Applied to both
// the message and the month table so lookups are script-, diacritic-, tatweel-
// and case-insensitive. It never mutates the original message used for the reply.
function normalizeForMatching(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/ـ/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

const MONTH_NAME_TO_NUMBER = new Map<string, number>(
  RAW_MONTH_NAMES.map(([name, number]) => [normalizeForMatching(name), number])
);

// Normalized Arabic month names, used to build the Arabic detection regex.
const ARABIC_MONTH_NAMES = RAW_MONTH_NAMES.filter(([name]) =>
  /[؀-ۿ]/.test(name)
).map(([name]) => normalizeForMatching(name));

// "mois de/d'…" (French) and "mese di/d'…" (Italian) followed by a month name and
// an optional explicit 4-digit year.
const LATIN_MONTH_EXPRESSION =
  /\b(?:mois|mese)\s+d(?:e|i)?['’]?\s*([A-Za-zÀ-ÖØ-öø-ÿ]+)(?:\s+(\d{4}))?/i;

// Arabic full-month expressions. The month name may be introduced by "شهر"
// ("month of …", with an optional attached prefix ل/ب/و/ف/ك) or stand on its own
// (e.g. "في سبتمبر", "سبتمبر 2026"). Arabic word boundaries are unreliable in JS,
// so we anchor on non-letter lookarounds instead of \b. An optional explicit
// 4-digit year may follow the month name.
const ARABIC_MONTH_EXPRESSION = new RegExp(
  `(?:^|[^\\p{L}])(?:[لبوفك]?شهر\\s+)?(${ARABIC_MONTH_NAMES.join(
    "|"
  )})(?![\\p{L}])(?:\\s+(\\d{4}))?`,
  "u"
);

type MonthExpression = { monthName: string; explicitYear?: number };

function matchMonthExpression(text: string): MonthExpression | undefined {
  const match =
    text.match(LATIN_MONTH_EXPRESSION) ?? text.match(ARABIC_MONTH_EXPRESSION);

  if (!match) {
    return;
  }

  return {
    explicitYear: match[2] ? Number.parseInt(match[2], 10) : undefined,
    monthName: match[1],
  };
}

// Same "relative to today" rule the project already applies for undated months:
// keep the current year while the month is still ahead (or ongoing), otherwise
// roll to next year. Deterministic for a given reference date.
function resolveYear(month: number, referenceDate: Date) {
  const referenceYear = referenceDate.getUTCFullYear();
  const referenceMonth = referenceDate.getUTCMonth() + 1;
  return month >= referenceMonth ? referenceYear : referenceYear + 1;
}

function lastDayOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function toIsoDate(year: number, month: number, day: number) {
  const yyyy = year.toString().padStart(4, "0");
  const mm = month.toString().padStart(2, "0");
  const dd = day.toString().padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Detects a "full month" expression in the message and returns the first and
 * last day of that month as ISO dates, or `undefined` when no such expression is
 * present. The result depends only on the message and the reference date, never
 * on the LLM, the regex fallback, or conversation history.
 */
export function resolveFullMonthRange(
  message: string,
  referenceDate: Date
): MonthRange | undefined {
  const normalized = normalizeForMatching(message);
  const expression = matchMonthExpression(normalized);

  if (!expression) {
    return;
  }

  const month = MONTH_NAME_TO_NUMBER.get(
    normalizeForMatching(expression.monthName)
  );

  if (!month) {
    return;
  }

  const year = expression.explicitYear ?? resolveYear(month, referenceDate);

  return {
    arrivalDate: toIsoDate(year, month, 1),
    departureDate: toIsoDate(year, month, lastDayOfMonth(year, month)),
  };
}

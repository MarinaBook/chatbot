import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveFullMonthRange } from "./dates";

// Fixed reference "today" so the year rule is deterministic in tests.
const REF = new Date("2026-07-09T00:00:00.000Z");

test("normalizes a French full-month expression to first and last day", () => {
  assert.deepEqual(resolveFullMonthRange("pour le mois de septembre", REF), {
    arrivalDate: "2026-09-01",
    departureDate: "2026-09-30",
  });
});

test("normalizes an Italian full-month expression to first and last day", () => {
  assert.deepEqual(resolveFullMonthRange("per il mese di settembre", REF), {
    arrivalDate: "2026-09-01",
    departureDate: "2026-09-30",
  });
});

test("normalizes an Arabic full-month expression to first and last day", () => {
  assert.deepEqual(resolveFullMonthRange("خلال شهر سبتمبر", REF), {
    arrivalDate: "2026-09-01",
    departureDate: "2026-09-30",
  });
});

test('handles the French elision "mois d\'août"', () => {
  assert.deepEqual(
    resolveFullMonthRange("une place pour le mois d'août", REF),
    {
      arrivalDate: "2026-08-01",
      departureDate: "2026-08-31",
    }
  );
});

test("uses the current year when the month is not yet past", () => {
  // Reference July 2026, September is ahead -> current year 2026.
  assert.equal(
    resolveFullMonthRange("mese di settembre", REF)?.arrivalDate,
    "2026-09-01"
  );
});

test("rolls to next year when the month has already passed", () => {
  const ref = new Date("2026-11-15T00:00:00.000Z");
  assert.deepEqual(resolveFullMonthRange("pour le mois de septembre", ref), {
    arrivalDate: "2027-09-01",
    departureDate: "2027-09-30",
  });
});

test("respects an explicit year written in the expression", () => {
  assert.deepEqual(
    resolveFullMonthRange("per il mese di settembre 2028", REF),
    {
      arrivalDate: "2028-09-01",
      departureDate: "2028-09-30",
    }
  );
});

test("computes the correct last day for February (non-leap and leap)", () => {
  assert.equal(
    resolveFullMonthRange(
      "mois de février",
      new Date("2026-01-01T00:00:00.000Z")
    )?.departureDate,
    "2026-02-28"
  );
  assert.equal(
    resolveFullMonthRange(
      "mois de février",
      new Date("2028-01-01T00:00:00.000Z")
    )?.departureDate,
    "2028-02-29"
  );
});

test("returns undefined when there is no full-month expression", () => {
  assert.equal(
    resolveFullMonthRange("Je vais à Marseille du 8 au 14 juillet 2026", REF),
    undefined
  );
});

test("is deterministic for two identical inputs", () => {
  const first = resolveFullMonthRange("per il mese di settembre", REF);
  const second = resolveFullMonthRange("per il mese di settembre", REF);
  assert.deepEqual(first, second);
});

const AR_SEPTEMBER = { arrivalDate: "2026-09-01", departureDate: "2026-09-30" };

// Every Arabic "full month" phrasing listed in the bug report, plus the attached
// prefixes ل/ب/و/ف on شهر, and the bare month name with/without a year.
const ARABIC_VARIANTS = [
  "لشهر سبتمبر",
  "في شهر سبتمبر",
  "خلال شهر سبتمبر",
  "طوال شهر سبتمبر",
  "شهر سبتمبر",
  "لشهر سبتمبر 2026",
  "في سبتمبر",
  "سبتمبر 2026",
  "بشهر سبتمبر",
  "وشهر سبتمبر",
  "فشهر سبتمبر",
];

for (const variant of ARABIC_VARIANTS) {
  test(`normalizes the Arabic full-month expression "${variant}"`, () => {
    assert.deepEqual(resolveFullMonthRange(variant, REF), AR_SEPTEMBER);
  });
}

test("normalizes the exact reproduction message (trailing Arabic comma)", () => {
  assert.deepEqual(
    resolveFullMonthRange(
      "أرغب في الحصول على مرسى في تونس لشهر سبتمبر، لقارب أبعاده متر واحد × متر واحد وغاطسه متر واحد.",
      REF
    ),
    AR_SEPTEMBER
  );
});

test("ignores Arabic diacritics and tatweel when matching a month", () => {
  // "في شهر سَبـتمبر" — a fatha after س and a tatweel (ـ) before ت.
  const withMarks = "في شهر سَبـتمبر";
  assert.deepEqual(resolveFullMonthRange(withMarks, REF), AR_SEPTEMBER);
});

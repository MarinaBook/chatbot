import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractAssistantMetadata,
  isMarinaBookUrl,
  isSafeSourceUrl,
  sanitizeSources,
} from "./marinabook-metadata";

test("isSafeSourceUrl accepts only absolute HTTPS URLs", () => {
  assert.equal(isSafeSourceUrl("https://www.marinabook.app/docs"), true);
  assert.equal(isSafeSourceUrl("  https://www.marinabook.app  "), true);

  assert.equal(isSafeSourceUrl("http://www.marinabook.app"), false);
  assert.equal(isSafeSourceUrl("javascript:alert(1)"), false);
  assert.equal(isSafeSourceUrl("JAVASCRIPT:alert(1)"), false);
  assert.equal(isSafeSourceUrl("data:text/html,<script>"), false);
  assert.equal(isSafeSourceUrl("file:///etc/passwd"), false);
  assert.equal(isSafeSourceUrl("/relative/path"), false);
  assert.equal(isSafeSourceUrl(""), false);
  assert.equal(isSafeSourceUrl(null), false);
  assert.equal(isSafeSourceUrl(42), false);
});

test("isMarinaBookUrl only accepts HTTPS official MarinaBook hosts", () => {
  assert.equal(isMarinaBookUrl("https://www.marinabook.app/faq"), true);
  assert.equal(isMarinaBookUrl("https://marinabook.app/cgv"), true);
  assert.equal(isMarinaBookUrl("https://api.marinabook.app/x"), true);

  assert.equal(isMarinaBookUrl("http://www.marinabook.app/faq"), false);
  assert.equal(isMarinaBookUrl("https://example.com/faq"), false);
  assert.equal(isMarinaBookUrl("https://marinabook.app.evil.com/faq"), false);
  assert.equal(isMarinaBookUrl("https://notmarinabook.app/faq"), false);
  assert.equal(isMarinaBookUrl("javascript:alert(1)"), false);
});

test("sanitizeSources keeps only MarinaBook HTTPS sources", () => {
  const sources = sanitizeSources([
    { title: "FAQ", url: "https://www.marinabook.app/faq" },
    { title: "Third party", url: "https://example.com/faq" },
    { title: "Insecure", url: "http://www.marinabook.app/faq" },
  ]);

  assert.deepEqual(sources, [
    { title: "FAQ", url: "https://www.marinabook.app/faq" },
  ]);
});

test("sanitizeSources normalizes objects and drops unsafe links", () => {
  const sources = sanitizeSources([
    {
      snippet: "How berth pricing works.",
      title: "Pricing",
      url: "https://www.marinabook.app/pricing",
    },
    { href: "https://www.marinabook.app/faq", name: "FAQ" },
    "https://www.marinabook.app/terms",
    { title: "Evil", url: "javascript:alert(1)" },
    { title: "Insecure", url: "http://www.marinabook.app" },
    { title: "No url" },
    null,
    "not-a-url",
  ]);

  assert.deepEqual(sources, [
    {
      snippet: "How berth pricing works.",
      title: "Pricing",
      url: "https://www.marinabook.app/pricing",
    },
    { title: "FAQ", url: "https://www.marinabook.app/faq" },
    { url: "https://www.marinabook.app/terms" },
  ]);
});

test("sanitizeSources de-duplicates by URL and caps the list", () => {
  const duplicated = sanitizeSources([
    { url: "https://www.marinabook.app/a" },
    { title: "Again", url: "https://www.marinabook.app/a" },
  ]);
  assert.equal(duplicated.length, 1);

  const many = Array.from({ length: 20 }, (_, index) => ({
    url: `https://www.marinabook.app/doc-${index}`,
  }));
  assert.equal(sanitizeSources(many).length, 8);
});

test("sanitizeSources returns [] for non-array input", () => {
  assert.deepEqual(sanitizeSources(undefined), []);
  assert.deepEqual(sanitizeSources("https://www.marinabook.app"), []);
  assert.deepEqual(sanitizeSources({ url: "https://www.marinabook.app" }), []);
});

test("extractAssistantMetadata keeps only present, valid optional fields", () => {
  assert.deepEqual(
    extractAssistantMetadata({
      assistantMode: "validated_answer",
      requestId: "req_123",
      results: [],
      sources: [{ url: "https://www.marinabook.app/kb" }],
      success: true,
    }),
    {
      assistantMode: "validated_answer",
      requestId: "req_123",
      sources: [{ url: "https://www.marinabook.app/kb" }],
    }
  );
});

test("extractAssistantMetadata returns {} for an old-backend response", () => {
  assert.deepEqual(
    extractAssistantMetadata({ count: 0, results: [], success: true }),
    {}
  );
  assert.deepEqual(extractAssistantMetadata(null), {});
  assert.deepEqual(extractAssistantMetadata("nope"), {});
});

test("extractAssistantMetadata ignores blank/invalid optional fields", () => {
  assert.deepEqual(
    extractAssistantMetadata({
      assistantMode: "   ",
      requestId: 123,
      sources: "not-an-array",
    }),
    {}
  );
});

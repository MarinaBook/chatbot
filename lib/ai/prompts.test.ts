import assert from "node:assert/strict";
import { test } from "node:test";
import { systemPrompt } from "./prompts";

const requestHints = {
  city: "Marseille",
  country: "FR",
  latitude: "43.3",
  longitude: "5.4",
} as const;

test("instructs the assistant to reply in the user's language (with tools)", () => {
  const prompt = systemPrompt({ requestHints, supportsTools: true });
  assert.match(prompt, /same language/i);
});

test("instructs the assistant to reply in the user's language (without tools)", () => {
  const prompt = systemPrompt({ requestHints, supportsTools: false });
  assert.match(prompt, /same language/i);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { isChatApiPath, shouldBypassGuestRedirect } from "./proxy";

test("recognizes the exact chat API path", () => {
  assert.equal(isChatApiPath("/api/chat"), true);
  assert.equal(isChatApiPath("/api/chat/"), true);
  assert.equal(isChatApiPath("/api/chat/123"), false);
  assert.equal(isChatApiPath("/api/messages"), false);
});

test("bypasses guest redirect for auth routes and the chat API", () => {
  assert.equal(shouldBypassGuestRedirect("/api/auth/guest"), true);
  assert.equal(shouldBypassGuestRedirect("/api/chat"), true);
  assert.equal(shouldBypassGuestRedirect("/api/chat/"), true);
  assert.equal(shouldBypassGuestRedirect("/"), false);
  assert.equal(shouldBypassGuestRedirect("/chat/demo"), false);
});

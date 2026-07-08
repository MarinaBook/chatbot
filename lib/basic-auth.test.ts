import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BASIC_AUTH_REALM,
  isBasicAuthExemptPath,
  validateBasicAuth,
} from "./basic-auth";

test("exempts Next internals, api routes, metadata files, and ping", () => {
  assert.equal(isBasicAuthExemptPath("/_next/static/chunks/app.js"), true);
  assert.equal(isBasicAuthExemptPath("/api/chat"), true);
  assert.equal(isBasicAuthExemptPath("/favicon.ico"), true);
  assert.equal(isBasicAuthExemptPath("/robots.txt"), true);
  assert.equal(isBasicAuthExemptPath("/sitemap.xml"), true);
  assert.equal(isBasicAuthExemptPath("/ping"), true);
  assert.equal(isBasicAuthExemptPath("/"), false);
  assert.equal(isBasicAuthExemptPath("/chat/123"), false);
});

test("returns a clear 500 when credentials are not configured", () => {
  assert.deepEqual(
    validateBasicAuth({
      authHeader: null,
    }),
    {
      message: "Basic auth is not configured",
      ok: false,
      status: 500,
    }
  );
});

test("returns 401 with the MarinaBook realm when authentication is missing or invalid", () => {
  const expected = {
    headers: {
      "WWW-Authenticate": BASIC_AUTH_REALM,
    },
    message: "Authentication required",
    ok: false,
    status: 401,
  };

  assert.deepEqual(
    validateBasicAuth({
      authHeader: null,
      password: "secret",
      username: "marina",
    }),
    expected
  );

  assert.deepEqual(
    validateBasicAuth({
      authHeader: "Basic not-base64!",
      password: "secret",
      username: "marina",
    }),
    expected
  );

  assert.deepEqual(
    validateBasicAuth({
      authHeader: `Basic ${Buffer.from("marina").toString("base64")}`,
      password: "secret",
      username: "marina",
    }),
    expected
  );

  assert.deepEqual(
    validateBasicAuth({
      authHeader: `Basic ${Buffer.from("marina:wrong").toString("base64")}`,
      password: "secret",
      username: "marina",
    }),
    expected
  );
});

test("accepts valid credentials", () => {
  assert.deepEqual(
    validateBasicAuth({
      authHeader: `Basic ${Buffer.from("marina:secret").toString("base64")}`,
      password: "secret",
      username: "marina",
    }),
    {
      ok: true,
    }
  );
});

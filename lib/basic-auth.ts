export const BASIC_AUTH_REALM = 'Basic realm="MarinaBook Chatbot"';

type BasicAuthSuccess = {
  ok: true;
};

type BasicAuthFailure = {
  headers?: Record<string, string>;
  message: string;
  ok: false;
  status: 401 | 500;
};

export type BasicAuthResult = BasicAuthSuccess | BasicAuthFailure;

export function isBasicAuthExemptPath(pathname: string) {
  return (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/ping") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml"
  );
}

export function validateBasicAuth({
  authHeader,
  password,
  username,
}: {
  authHeader: string | null;
  password?: string;
  username?: string;
}): BasicAuthResult {
  if (!username || !password) {
    return {
      message: "Basic auth is not configured",
      ok: false,
      status: 500,
    };
  }

  if (!authHeader?.startsWith("Basic ")) {
    return unauthorized();
  }

  const encoded = authHeader.slice("Basic ".length);
  let decoded = "";

  try {
    decoded = atob(encoded);
  } catch {
    return unauthorized();
  }

  const separatorIndex = decoded.indexOf(":");

  if (separatorIndex === -1) {
    return unauthorized();
  }

  const user = decoded.slice(0, separatorIndex);
  const pass = decoded.slice(separatorIndex + 1);

  if (user !== username || pass !== password) {
    return unauthorized();
  }

  return { ok: true };
}

function unauthorized(): BasicAuthFailure {
  return {
    headers: {
      "WWW-Authenticate": BASIC_AUTH_REALM,
    },
    message: "Authentication required",
    ok: false,
    status: 401,
  };
}

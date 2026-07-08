function normalizeBaseUrl(rawBaseUrl: string) {
  return rawBaseUrl.replace(/\/$/, "");
}

export function getMarinaBookApiBaseUrl() {
  const configuredBaseUrl =
    process.env.MARINABOOK_API_URL ?? process.env.BACKEND_URL;

  if (!configuredBaseUrl) {
    return null;
  }

  const normalizedBaseUrl = normalizeBaseUrl(configuredBaseUrl);

  return normalizedBaseUrl.endsWith("/api")
    ? normalizedBaseUrl
    : `${normalizedBaseUrl}/api`;
}

export function getMarinaBookApiKey() {
  return process.env.MARINABOOK_ASSISTANT_API_KEY ?? null;
}

export function buildMarinaBookApiUrl(pathname: string) {
  const baseUrl = getMarinaBookApiBaseUrl();

  if (!baseUrl) {
    return null;
  }

  const normalizedPathname = pathname.startsWith("/")
    ? pathname
    : `/${pathname}`;

  return `${baseUrl}${normalizedPathname}`;
}

function extractErrorMessage(value: unknown): string | null {
  if (typeof value === "string") {
    const message = value.trim();
    return message.length > 0 ? message : null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const message = extractErrorMessage(item);

      if (message) {
        return message;
      }
    }

    return null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;

  for (const key of ["message", "error", "details", "detail", "code"]) {
    const message = extractErrorMessage(candidate[key]);

    if (message) {
      return message;
    }
  }

  return null;
}

export async function getMarinaBookErrorMessage(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("application/json")) {
      return extractErrorMessage(await response.json());
    }

    return extractErrorMessage(await response.text());
  } catch {
    return null;
  }
}

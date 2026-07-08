import {
  handleServerToServerChat,
  isValidServerToServerBearerToken,
  looksLikeServerToServerChatPayload,
  serverToServerChatRequestSchema,
} from "./server-to-server";

export const SERVER_TO_SERVER_MODE_HEADER = "x-marinabook-api-mode";
export const SERVER_TO_SERVER_MODE_VALUE = "server-to-server";

export function isBearerAuthorizationHeader(
  authorizationHeader: string | null
) {
  return authorizationHeader?.startsWith("Bearer ") ?? false;
}

export function createServerToServerJsonResponse(
  body: unknown,
  status: number
) {
  return Response.json(body, {
    headers: {
      [SERVER_TO_SERVER_MODE_HEADER]: SERVER_TO_SERVER_MODE_VALUE,
    },
    status,
  });
}

export async function parseChatRequestJson(
  request: Request,
  isBearerRequest: boolean
) {
  try {
    return {
      json: await request.json(),
      ok: true as const,
    };
  } catch {
    return {
      ok: false as const,
      response: isBearerRequest
        ? createServerToServerJsonResponse(
            {
              error: {
                code: "bad_request",
                message: "The request body must be valid JSON.",
              },
            },
            400
          )
        : null,
    };
  }
}

export async function maybeHandleServerToServerChatRequest({
  authorizationHeader,
  json,
}: {
  authorizationHeader: string | null;
  json: unknown;
}) {
  if (
    !isBearerAuthorizationHeader(authorizationHeader) &&
    !looksLikeServerToServerChatPayload(json)
  ) {
    return null;
  }

  if (
    !isValidServerToServerBearerToken(
      authorizationHeader,
      process.env.CHATBOT_API_SECRET
    )
  ) {
    return createServerToServerJsonResponse(
      {
        error: {
          code: "unauthorized",
          message:
            "A valid Bearer token is required for server-to-server access.",
        },
      },
      401
    );
  }

  try {
    const requestBody = serverToServerChatRequestSchema.parse(json);
    const response = await handleServerToServerChat(requestBody);

    return createServerToServerJsonResponse(response, 200);
  } catch {
    return createServerToServerJsonResponse(
      {
        error: {
          code: "bad_request",
          message: "The request payload is invalid.",
        },
      },
      400
    );
  }
}

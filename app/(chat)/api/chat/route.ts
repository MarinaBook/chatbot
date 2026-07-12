import { ipAddress } from "@vercel/functions";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
} from "ai";
import { checkBotId } from "botid/server";
import { after } from "next/server";
import { createResumableStreamContext } from "resumable-stream";
import { auth, type UserType } from "@/app/(auth)/auth";
import { entitlementsByUserType } from "@/lib/ai/entitlements";
import {
  callMarinaBookAiSearch,
  getNeutralTechnicalMessage,
} from "@/lib/ai/marinabook-ai-search";
import {
  allowedModelIds,
  chatModels,
  DEFAULT_CHAT_MODEL,
} from "@/lib/ai/models";
import {
  createStreamId,
  deleteChatById,
  getChatById,
  getMessageCountByUserId,
  getMessagesByChatId,
  saveChat,
  saveMessages,
  updateChatTitleById,
  updateMessage,
} from "@/lib/db/queries";
import type { DBMessage } from "@/lib/db/schema";
import { ChatbotError } from "@/lib/errors";
import { checkIpRateLimit } from "@/lib/ratelimit";
import type { ChatMessage } from "@/lib/types";
import { convertToUIMessages, generateUUID } from "@/lib/utils";
import { generateTitleFromUserMessage } from "../../actions";
import { detectLanguage } from "./language";
import { type PostRequestBody, postRequestBodySchema } from "./schema";
import {
  isBearerAuthorizationHeader,
  maybeHandleServerToServerChatRequest,
  parseChatRequestJson,
} from "./server-to-server-http";

export const maxDuration = 60;

// Joins the text parts of the most recent user message. This is what we forward
// to the MarinaBook backend orchestrator.
function extractLatestUserText(messages: ChatMessage[]): string {
  const lastUserMessage = [...messages]
    .reverse()
    .find((candidate) => candidate.role === "user");

  if (!lastUserMessage) {
    return "";
  }

  return lastUserMessage.parts
    .filter(
      (part): part is { type: "text"; text: string } =>
        part.type === "text" &&
        typeof (part as { text?: unknown }).text === "string"
    )
    .map((part) => part.text)
    .join(" ")
    .trim();
}

function getStreamContext() {
  try {
    return createResumableStreamContext({ waitUntil: after });
  } catch {
    return null;
  }
}

export { getStreamContext };

export async function POST(request: Request) {
  const authorizationHeader = request.headers.get("authorization");
  const isBearerRequest = isBearerAuthorizationHeader(authorizationHeader);
  const parsedRequest = await parseChatRequestJson(request, isBearerRequest);

  if (!parsedRequest.ok) {
    if (parsedRequest.response) {
      return parsedRequest.response;
    }

    return new ChatbotError("bad_request:api").toResponse();
  }

  const { json } = parsedRequest;
  const serverToServerResponse = await maybeHandleServerToServerChatRequest({
    authorizationHeader,
    json,
  });

  if (serverToServerResponse) {
    return serverToServerResponse;
  }

  let requestBody: PostRequestBody;

  try {
    requestBody = postRequestBodySchema.parse(json);
  } catch {
    return new ChatbotError("bad_request:api").toResponse();
  }

  try {
    const { id, message, messages, selectedChatModel, selectedVisibilityType } =
      requestBody;

    const [, session] = await Promise.all([
      checkBotId().catch(() => null),
      auth(),
    ]);

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const chatModel = allowedModelIds.has(selectedChatModel)
      ? selectedChatModel
      : DEFAULT_CHAT_MODEL;

    await checkIpRateLimit(ipAddress(request));

    const userType: UserType = session.user.type;

    const messageCount = await getMessageCountByUserId({
      differenceInHours: 1,
      id: session.user.id,
    });

    if (messageCount > entitlementsByUserType[userType].maxMessagesPerHour) {
      return new ChatbotError("rate_limit:chat").toResponse();
    }

    const isToolApprovalFlow = Boolean(messages);

    const chat = await getChatById({ id });
    let messagesFromDb: DBMessage[] = [];
    let titlePromise: Promise<string> | null = null;

    if (chat) {
      if (chat.userId !== session.user.id) {
        return new ChatbotError("forbidden:chat").toResponse();
      }
      messagesFromDb = await getMessagesByChatId({ id });
    } else if (message?.role === "user") {
      await saveChat({
        id,
        title: "New chat",
        userId: session.user.id,
        visibility: selectedVisibilityType,
      });
      titlePromise = generateTitleFromUserMessage({ message });
    }

    let uiMessages: ChatMessage[];

    if (isToolApprovalFlow && messages) {
      const dbMessages = convertToUIMessages(messagesFromDb);
      const approvalStates = new Map(
        messages.flatMap(
          (m) =>
            m.parts
              ?.filter(
                (p: Record<string, unknown>) =>
                  p.state === "approval-responded" ||
                  p.state === "output-denied"
              )
              .map((p: Record<string, unknown>) => [
                String(p.toolCallId ?? ""),
                p,
              ]) ?? []
        )
      );
      uiMessages = dbMessages.map((msg) => ({
        ...msg,
        parts: msg.parts.map((part) => {
          if (
            "toolCallId" in part &&
            approvalStates.has(String(part.toolCallId))
          ) {
            return { ...part, ...approvalStates.get(String(part.toolCallId)) };
          }
          return part;
        }),
      })) as ChatMessage[];
    } else {
      uiMessages = [
        ...convertToUIMessages(messagesFromDb),
        message as ChatMessage,
      ];
    }

    if (message?.role === "user") {
      await saveMessages({
        messages: [
          {
            attachments: [],
            chatId: id,
            createdAt: new Date(),
            id: message.id,
            parts: message.parts,
            role: "user",
          },
        ],
      });
    }

    const modelConfig = chatModels.find((m) => m.id === chatModel);

    // MarinaBook Flux A: the conversational answer is produced by the backend
    // orchestrator (POST /api/assistant/ai-search) — validated answers,
    // Knowledge Base, RAG, cache, then Groq strictly on the backend as a last
    // resort. No local LLM ever produces a MarinaBook answer here. Deterministic
    // language detection (no LLM) only picks the reply language.
    const userMessageText = extractLatestUserText(uiMessages);
    const aiSearchLocale = detectLanguage(userMessageText);

    const stream = createUIMessageStream({
      execute: async ({ writer: dataStream }) => {
        const modelName = modelConfig?.name ?? chatModel;

        // The server-generated message id is injected into this chunk, so the
        // client adopts the same id that onEnd persists (votes, resume).
        dataStream.write({ type: "start" });

        dataStream.write({
          data: {
            message: "Waiting...",
            modelId: chatModel,
            modelName,
            phase: "waiting",
          },
          transient: true,
          type: "data-waiting-status",
        });

        const answer = userMessageText
          ? await callMarinaBookAiSearch({
              locale: aiSearchLocale,
              message: userMessageText,
              sessionId: id,
            })
          : ({ ok: false } as const);

        // On a technical failure we show a neutral message. We never fall back
        // to a local LLM and never fabricate a documentary answer.
        const replyText = answer.ok
          ? answer.data.reply
          : getNeutralTechnicalMessage(aiSearchLocale);

        const answerId = generateUUID();
        dataStream.write({ id: answerId, type: "text-start" });
        dataStream.write({
          delta: replyText,
          id: answerId,
          type: "text-delta",
        });
        dataStream.write({ id: answerId, type: "text-end" });

        // Structured extras (sanitized sources + availability results) travel as
        // a dedicated data part so the reply text is displayed verbatim.
        if (
          answer.ok &&
          (answer.data.sources.length > 0 || answer.data.results.length > 0)
        ) {
          dataStream.write({
            data: {
              ...(answer.data.sources.length > 0 && {
                sources: answer.data.sources,
              }),
              ...(answer.data.results.length > 0 && {
                results: answer.data.results,
              }),
              ...(answer.data.searchParams && {
                searchParams: answer.data.searchParams,
              }),
            },
            type: "data-marinabook-answer",
          });
        }

        if (titlePromise) {
          try {
            const title = await titlePromise;
            dataStream.write({ data: title, type: "data-chat-title" });
            updateChatTitleById({ chatId: id, title });
          } catch {
            /* non-fatal */
          }
        }

        dataStream.write({ type: "finish" });
      },
      generateId: generateUUID,
      onEnd: async ({ messages: finishedMessages }) => {
        if (isToolApprovalFlow) {
          await Promise.all(
            finishedMessages.map(async (finishedMsg) => {
              const existingMsg = uiMessages.find(
                (m) => m.id === finishedMsg.id
              );
              if (existingMsg) {
                await updateMessage({
                  id: finishedMsg.id,
                  parts: finishedMsg.parts,
                });
                return;
              }

              await saveMessages({
                messages: [
                  {
                    attachments: [],
                    chatId: id,
                    createdAt: new Date(),
                    id: finishedMsg.id,
                    parts: finishedMsg.parts,
                    role: finishedMsg.role,
                  },
                ],
              });
            })
          );
        } else if (finishedMessages.length > 0) {
          await saveMessages({
            messages: finishedMessages.map((currentMessage) => ({
              attachments: [],
              chatId: id,
              createdAt: new Date(),
              id: currentMessage.id,
              parts: currentMessage.parts,
              role: currentMessage.role,
            })),
          });
        }
      },
      onError: () => "Oops, an error occurred!",
      originalMessages: isToolApprovalFlow ? uiMessages : undefined,
    });

    return createUIMessageStreamResponse({
      async consumeSseStream({ stream: sseStream }) {
        if (!process.env.REDIS_URL) {
          return;
        }
        try {
          const streamContext = getStreamContext();
          if (streamContext) {
            const streamId = generateId();
            await createStreamId({ chatId: id, streamId });
            await streamContext.createNewResumableStream(
              streamId,
              () => sseStream
            );
          }
        } catch {
          /* non-critical */
        }
      },
      stream,
    });
  } catch (error) {
    const vercelId = request.headers.get("x-vercel-id");

    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    console.error("Unhandled error in chat API:", error, { vercelId });
    return new ChatbotError("offline:chat").toResponse();
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return new ChatbotError("bad_request:api").toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  const chat = await getChatById({ id });

  if (chat?.userId !== session.user.id) {
    return new ChatbotError("forbidden:chat").toResponse();
  }

  const deletedChat = await deleteChatById({ id });

  return Response.json(deletedChat, { status: 200 });
}

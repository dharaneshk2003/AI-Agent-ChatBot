import {
  AIMessage,
  BaseMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import {
  END,
  MemorySaver,
  MessagesAnnotation,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import SYSTEM_MESSAGE from "@/constants/systemMessage";
import { localTools } from "./tools";

// Keep prompt size bounded without ever producing an empty `contents` array.
const MAX_HISTORY_MESSAGES = 20;
// Stop a model from repeatedly calling tools without producing an answer.
const MAX_TOOL_ROUNDS = 4;

// Local tools replace the retired IBM wxflows service. They need no API key.
const tools = localTools;
const toolNode = new ToolNode(tools);

/**
 * The legacy @google/generative-ai SSE parser throws the misleading error
 * "Failed to parse stream" when Gemini's free tier is overloaded: the API
 * appends a raw JSON 503 error after the valid SSE events. Buffer the stream,
 * retry those transient failures, and hand the SDK only well-formed SSE.
 */
let geminiStreamFixInstalled = false;

function installGeminiStreamFix() {
  if (geminiStreamFixInstalled) return;
  geminiStreamFixInstalled = true;

  const originalFetch = globalThis.fetch.bind(globalThis);
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    const isGeminiStream =
      url.includes("streamGenerateContent") &&
      url.includes("generativelanguage.googleapis.com");
    if (!isGeminiStream) return originalFetch(input, init);

    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await originalFetch(input, init);

      // The free tier commonly returns 429/503 under load; retry briefly.
      if (!response.ok || !response.body) {
        if (
          (response.status === 429 || response.status >= 500) &&
          attempt < 2
        ) {
          await wait(500 * (attempt + 1));
          continue;
        }
        return response;
      }

      const raw = await response.text();

      // An overloaded Gemini can append raw JSON *after* the last SSE event.
      // Inspect only the trailing fragment so normal event text can't match.
      const lastEventEnd = Math.max(
        raw.lastIndexOf("\r\n\r\n"),
        raw.lastIndexOf("\n\n")
      );
      const trailingError = raw.slice(lastEventEnd).trim();
      if (/^\{\s*"error"\s*:/.test(trailingError)) {
        if (attempt < 2) {
          await wait(500 * (attempt + 1));
          continue;
        }
        return new Response(trailingError, {
          status: 503,
          statusText: "Service Unavailable",
          headers: { "Content-Type": "application/json" },
        });
      }

      // Always terminate the final SSE event; the SDK errors on leftover text.
      const body = raw.trimEnd() + "\n\n";
      const headers = new Headers(response.headers);
      headers.delete("content-length");
      headers.delete("content-encoding");
      headers.delete("transfer-encoding");

      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    return originalFetch(input, init);
  };
}

// Connect to the LLM provider. The final round omits tools so the model
// has to produce an answer instead of calling a tool again.
const createModel = () => {
  installGeminiStreamFix();

  return new ChatGoogleGenerativeAI({
    // Free tier model. Override with GEMINI_MODEL if you want a different one.
    model: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
    apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY,
    maxOutputTokens: 4096,
    streaming: true,
    callbacks: [
      {
        handleLLMEnd: async (output) => {
          console.log("🤖 End LLM call", output.llmOutput?.usage ?? "");
        },
      },
    ],
  });
};

const initialiseModel = () => createModel().bindTools(tools);

function toolCallsOf(message: BaseMessage) {
  const calls = (message as AIMessage).tool_calls;
  return Array.isArray(calls) ? calls : [];
}

// Define the function that determines whether to continue or not
function shouldContinue(state: typeof MessagesAnnotation.State) {
  const messages = state.messages;
  const lastMessage = messages[messages.length - 1] as AIMessage;

  // If the LLM makes a tool call, then we route to the "tools" node
  if (toolCallsOf(lastMessage).length) {
    return "tools";
  }

  // Stop (reply to the user) in every other case.
  return END;
}

// Define a new graph
const createWorkflow = () => {
  return new StateGraph(MessagesAnnotation)
    .addNode("agent", async (state) => {
      const promptTemplate = ChatPromptTemplate.fromMessages([
        new SystemMessage(SYSTEM_MESSAGE),
        new MessagesPlaceholder("messages"),
      ]);

      // A bounded, non-empty history keeps Gemini's `contents` field valid.
      const recentMessages = state.messages.slice(-MAX_HISTORY_MESSAGES);
      const prompt = await promptTemplate.invoke({ messages: recentMessages });

      const rounds = state.messages.filter(
        (m) => toolCallsOf(m).length > 0
      ).length;

      // Drop the tools after a few rounds so a stuck model must answer.
      const model = rounds >= MAX_TOOL_ROUNDS ? createModel() : initialiseModel();

      let response: AIMessage;
      try {
        response = (await model.invoke(prompt)) as AIMessage;
      } catch {
        response = new AIMessage(
          "I wasn't able to complete that lookup right now. Please try again shortly."
        );
      }
      return { messages: [response] };
    })
    .addNode("tools", toolNode)
    .addEdge(START, "agent")
    .addConditionalEdges("agent", shouldContinue)
    .addEdge("tools", "agent");
};

export async function submitQuestion(messages: BaseMessage[], chatId: string) {
  const workflow = createWorkflow();

  // Create a checkpoint to save the state of the conversation
  const checkpointer = new MemorySaver();
  const app = workflow.compile({ checkpointer });

  const stream = await app.streamEvents(
    { messages },
    {
      version: "v2",
      configurable: { thread_id: chatId },
      streamMode: "messages",
      runId: chatId,
    }
  );
  return stream;
}

import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { config } from "../config";
import { logger } from "../utils/logger";

let client: OpenAI | null = null;

export function getDeepSeekClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: config.deepseek.apiKey,
      baseURL: config.deepseek.baseURL,
    });
  }
  return client;
}

export interface ChatOptions {
  tools?: ChatCompletionTool[];
  tool_choice?: "auto" | "none" | "required";
  temperature?: number;
  max_tokens?: number;
  model?: string;
}

export async function chat(
  messages: ChatCompletionMessageParam[],
  options: ChatOptions = {}
) {
  const ds = getDeepSeekClient();
  const {
    tools,
    tool_choice = "auto",
    temperature = 0.7,
    max_tokens = 4096,
    model = config.deepseek.model,
  } = options;

  const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
    model,
    messages,
    temperature,
    max_tokens,
  };

  if (tools?.length) {
    params.tools = tools;
    params.tool_choice = tool_choice;
  }

  logger.debug("DeepSeek API call", { model, msgCount: messages.length, hasTools: !!tools?.length });

  return ds.chat.completions.create(params);
}

export type ToolExecutorFn = (args: Record<string, unknown>) => Promise<Record<string, unknown>>;

export interface AgentLoopOptions {
  maxIterations?: number;
  temperature?: number;
  max_tokens?: number;
}

export async function agentLoop(
  systemPrompt: string,
  userMessage: string,
  tools: ChatCompletionTool[],
  toolExecutors: Record<string, ToolExecutorFn>,
  options: AgentLoopOptions = {}
): Promise<{ reply: string; toolCallsMade: number }> {
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  const maxIterations = options.maxIterations ?? 5;
  let iteration = 0;

  while (iteration < maxIterations) {
    iteration++;

    const response = await chat(messages, {
      tools,
      temperature: options.temperature,
      max_tokens: options.max_tokens,
    });

    const choice = response.choices[0];
    const msg = choice.message;

    if (msg.content && !msg.tool_calls?.length) {
      return {
        reply: msg.content,
        toolCallsMade: messages.filter((m) => m.role === "tool").length,
      };
    }

    if (msg.tool_calls?.length) {
      messages.push({
        role: "assistant",
        content: msg.content || null,
        tool_calls: msg.tool_calls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        })),
      });

      for (const tc of msg.tool_calls) {
        const fnName = tc.function.name;
        const executor = toolExecutors[fnName];

        if (!executor) {
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify({ error: `Unknown tool: ${fnName}` }),
          });
          continue;
        }

        try {
          const args = JSON.parse(tc.function.arguments);
          logger.debug(`Tool: ${fnName}`, args);
          const result = await executor(args);
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify(result),
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error(`Tool ${fnName} error:`, message);
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify({ error: message }),
          });
        }
      }
      continue;
    }

    return { reply: msg.content || "(no response)", toolCallsMade: 0 };
  }

  return { reply: "(agent loop exceeded max iterations)", toolCallsMade: -1 };
}

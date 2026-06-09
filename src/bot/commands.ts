import { Composer } from "telegraf";
import type { Context } from "telegraf";
import { processMessage, handleCommand } from "../agent/index";
import { config } from "../config";
import { logger } from "../utils/logger";
import type { PersonaName } from "../agent/prompt";

interface SessionData {
  persona?: string;
  private?: boolean;
}

type BotContext = Context & { session: SessionData };

const commands = new Composer<BotContext>();

commands.command("start", async (ctx: BotContext) => {
  await ctx.reply(
    "嗨，我是「隐」——你的私人 AI 陪伴者。\n\n" +
      "你可以随时跟我说话，我会帮你记录和整理。\n\n" +
      "📝 直接发消息 → 自动归档到知识库\n" +
      "🔍 /search <关键词> → 搜索你的知识库\n" +
      "💭 /think → 进入深度对话模式\n" +
      "📋 /log → 查看最近写入记录\n" +
      "↩️ /undo → 回滚最近一次写入\n" +
      "👤 /persona <listener|coach|analyst|buddy> → 切换人格\n" +
      "🔒 /private → 隐私模式（不记录本轮对话）\n\n" +
      "你也可以发语音消息，我会转写后处理。"
  );
});

commands.command("think", async (ctx: BotContext) => {
  const msg = ctx.message as { text: string };
  const text = msg.text.replace(/^\/think\s*/, "").trim();
  if (!text) {
    await ctx.reply("💭 深度对话模式\n\n请告诉我你想聊什么？\n例如：/think 我该不该接那个offer");
    return;
  }
  await ctx.replyWithChatAction("typing");
  try {
    const { reply } = await processMessage({ text, mode: "think" });
    await ctx.reply(reply);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("/think error:", msg);
    await ctx.reply("抱歉，处理你的问题时出错了。请稍后再试。");
  }
});

commands.command("search", async (ctx: BotContext) => {
  const msg = ctx.message as { text: string };
  const query = msg.text.replace(/^\/search\s*/, "").trim();
  if (!query) {
    await ctx.reply("🔍 请输入搜索关键词。\n例如：/search 上次和妈妈吵架");
    return;
  }
  await ctx.replyWithChatAction("typing");
  try {
    const { reply } = await processMessage({ text: query, mode: "search" });
    await ctx.reply(reply);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("/search error:", msg);
    await ctx.reply("搜索时出错，请稍后再试。");
  }
});

commands.command("log", async (ctx: BotContext) => {
  try {
    const { reply } = await handleCommand("log");
    await ctx.reply(reply);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("/log error:", msg);
    await ctx.reply("获取日志时出错。");
  }
});

commands.command("undo", async (ctx: BotContext) => {
  try {
    const { reply } = await handleCommand("undo");
    await ctx.reply(reply);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("/undo error:", msg);
    await ctx.reply("回滚时出错。");
  }
});

commands.command("persona", async (ctx: BotContext) => {
  const msg = ctx.message as { text: string };
  const persona = msg.text.replace(/^\/persona\s*/, "").trim();
  const validPersonas: PersonaName[] = ["default", "listener", "coach", "analyst", "buddy"];

  if (!persona || !validPersonas.includes(persona as PersonaName)) {
    await ctx.reply(`可选人格: ${validPersonas.join(", ")}\n例如：/persona listener`);
    return;
  }

  ctx.session.persona = persona;

  const names: Record<PersonaName, string> = {
    listener: "倾听者", coach: "教练", analyst: "分析师", buddy: "损友", default: "隐",
  };
  await ctx.reply(`已切换为「${names[persona as PersonaName]}」人格。`);
});

commands.command("private", async (ctx: BotContext) => {
  ctx.session.private = !ctx.session.private;
  if (ctx.session.private) {
    await ctx.reply("🔒 已进入隐私模式。本轮对话不会记录到知识库。");
  } else {
    await ctx.reply("🔓 已退出隐私模式。对话将恢复正常记录。");
  }
});

commands.command("recap", async (ctx: BotContext) => {
  await ctx.replyWithChatAction("typing");
  try {
    const { reply } = await processMessage({ text: "生成复盘的指令", mode: "recap" });
    await ctx.reply(reply);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("/recap error:", msg);
    await ctx.reply("生成复盘时出错。");
  }
});

commands.command("model", async (ctx: BotContext) => {
  await ctx.reply(`当前模型: ${config.deepseek.model}\nAPI: ${config.deepseek.baseURL}`);
});

export { commands };
export type { BotContext, SessionData };

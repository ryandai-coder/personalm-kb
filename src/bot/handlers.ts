import { Composer } from "telegraf";
import { message } from "telegraf/filters";
import { processMessage } from "../agent/index";
import { logger } from "../utils/logger";
import type { BotContext } from "./commands";
import type { PersonaName } from "../agent/prompt";

const handlers = new Composer<BotContext>();

handlers.on(message("text"), async (ctx: BotContext, next) => {
  const msg = ctx.message;
  if (!msg || !("text" in msg)) return next();
  if (msg.text?.startsWith("/")) return next();

  const text = msg.text;
  const persona = (ctx.session?.persona || "default") as PersonaName;
  const isPrivate = ctx.session?.private || false;

  if (isPrivate) {
    await ctx.replyWithChatAction("typing");
    try {
      const { reply } = await processMessage({
        text: `[隐私模式] ${text}\n\n注意：本条消息不写入知识库。请像正常对话一样回应，但不要调用 write_note 工具。`,
        mode: "default",
        persona,
      });
      await ctx.reply(reply);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Private mode error:", msg);
      await ctx.reply("处理时出错。");
    }
    return;
  }

  await ctx.replyWithChatAction("typing");
  try {
    const { reply } = await processMessage({ text, mode: "default", persona });
    await ctx.reply(reply);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Message handler error:", msg);
    await ctx.reply("抱歉，处理你的消息时出错了。请稍后再试。");
  }
});

handlers.on(message("voice"), async (ctx: BotContext) => {
  await ctx.reply(
    "🎤 语音消息暂不支持自动转写。\n请在 Telegram 中长按语音 → 转文字后发送给我。\n\n（语音转写功能需要 Whisper API，将在后续版本支持）"
  );
});

handlers.on(message("photo"), async (ctx: BotContext) => {
  await ctx.reply("📷 收到图片。目前我还不支持图片内容分析，请用文字描述你想记录的内容。");
});

export { handlers };

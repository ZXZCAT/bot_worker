/**
 * NapCatQQ Bot - Cloudflare Workers (反向 WebSocket 模式)
 * 功能：
 *  - 私聊：直接响应所有消息
 *  - 群聊：只响应 @机器人 的消息
 *  - 「画 xxx」→ Workers AI 文生图
 *  - 其他消息 → Workers AI 对话
 */

export interface Env {
  AI: Ai;
  CHAT_KV: KVNamespace;
  // 在 wrangler.jsonc vars 里填机器人自己的 QQ 号
  BOT_QQ: string;
}

interface OneBotEvent {
  post_type: string;
  message_type?: "private" | "group";
  self_id?: number;
  user_id?: number;
  group_id?: number;
  message?: Array<{ type: string; data: Record<string, string> }>;
  raw_message?: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const DRAW_PREFIX = "画 ";
const MAX_HISTORY = 10;
const KV_TTL = 60 * 60 * 24 * 3;
const CHAT_MODEL = "@cf/meta/llama-3.1-8b-instruct";
const DRAW_MODEL = "@cf/lykon/dreamshaper-8-lcm";

const SYSTEM_PROMPT = `你是一个友好的 QQ 助手，名叫"哈吉喵"。
一只毒舌可爱的赛博猫，回复必须极短且带"喵"，
如果用户想画图，告诉他发送"画 [描述]"即可。`;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // ── /ws WebSocket 入口 ──
    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("需要 WebSocket 连接", { status: 426 });
      }

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();

      ctx.waitUntil(
        new Promise<void>((resolve) => {
          server.addEventListener("message", (event) => {
            const task = (async () => {
              let data: OneBotEvent;
              try {
                data = JSON.parse(event.data as string);
              } catch { return; }

              if (data.post_type !== "message") return;

              const userId = data.user_id!;
              const groupId = data.group_id;
              const isGroup = data.message_type === "group";

              // 机器人自己的 QQ 号
              const botQQ = String(data.self_id || env.BOT_QQ || "");

              // 群聊：必须 @ 了机器人才响应（宽松匹配，兼容数字/字符串）
              if (isGroup) {
                const atMe = (data.message || []).some(
                  (seg) => seg.type === "at" && String(seg.data.qq) === botQQ
                );
                console.log(`[群消息] botQQ=${botQQ} atMe=${atMe} segs=${JSON.stringify(data.message)}`);
                if (!atMe) return;
              }

              // 提取纯文字（去掉 @ 段）
              const text = extractText(data);
              if (!text) return;

              console.log(`[${isGroup ? "群" : "私聊"}] ${userId}: ${text}`);

              if (text.startsWith(DRAW_PREFIX)) {
                const prompt = text.slice(DRAW_PREFIX.length).trim();
                if (!prompt) {
                  wsSend(server, isGroup, userId, groupId, "text", "请告诉我你想画什么，例如：画 一只可爱的猫咪");
                  return;
                }
                wsSend(server, isGroup, userId, groupId, "text", "🎨 正在为你绘图，请稍候...");
                const imageBase64 = await drawImage(env, prompt);
                if (!imageBase64) {
                  wsSend(server, isGroup, userId, groupId, "text", "绘图失败了，请稍后再试 😢");
                  return;
                }
                wsSend(server, isGroup, userId, groupId, "image", imageBase64);
              } else {
                const kvKey = `history:${isGroup ? `g${groupId}` : `u${userId}`}`;
                const history = await getHistory(env, kvKey);
                history.push({ role: "user", content: text });
                const reply = await chatWithAI(env, history);
                history.push({ role: "assistant", content: reply });
                await env.CHAT_KV.put(kvKey, JSON.stringify(history.slice(-MAX_HISTORY * 2)), { expirationTtl: KV_TTL });
                wsSend(server, isGroup, userId, groupId, "text", reply);
              }
            })();
            ctx.waitUntil(task);
          });

          server.addEventListener("close", () => resolve());
          server.addEventListener("error", () => resolve());
        })
      );

      return new Response(null, { status: 101, webSocket: client });
    }

    // ── /test-chat 测试对话 ──
    if (url.pathname === "/test-chat") {
      const msg = url.searchParams.get("msg") || "你好";
      try {
        const result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct" as never, {
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: msg }
          ],
          max_tokens: 256,
          stream: false,
        } as never);
        return new Response(
          "<pre>" + JSON.stringify(result, null, 2) + "</pre>",
          { headers: { "Content-Type": "text/html;charset=utf-8" } }
        );
      } catch (e) {
        return new Response("错误: " + String(e), { status: 500 });
      }
    }

    // ── /test-draw 测试绘图 ──
    if (url.pathname === "/test-draw") {
      const prompt = url.searchParams.get("prompt") || "a cute cat";
      try {
        const b64 = await drawImage(env, prompt);
        if (!b64) return new Response("绘图返回空", { status: 500 });
        return new Response(
          `<html><body><img src="data:image/png;base64,${b64}" style="max-width:100%"></body></html>`,
          { headers: { "Content-Type": "text/html" } }
        );
      } catch (e) {
        return new Response("绘图失败: " + String(e), { status: 500 });
      }
    }

    return new Response("NapCatQQ Bot is running ✅", { status: 200 });
  },
} satisfies ExportedHandler<Env>;

// ── WebSocket 发送消息 ──
function wsSend(
  ws: WebSocket,
  isGroup: boolean,
  userId: number,
  groupId: number | undefined,
  type: "text" | "image",
  content: string
): void {
  const msgSegment =
    type === "text"
      ? { type: "text", data: { text: content } }
      : { type: "image", data: { file: `base64://${content}` } };

  const action = isGroup ? "send_group_msg" : "send_private_msg";
  const params = isGroup
    ? { group_id: groupId, message: [msgSegment] }
    : { user_id: userId, message: [msgSegment] };

  try {
    ws.send(JSON.stringify({ action, params, echo: Date.now().toString() }));
  } catch (e) {
    console.error("wsSend error:", e);
  }
}

// ── Workers AI 绘图（ReadableStream 方式）──
async function drawImage(env: Env, prompt: string): Promise<string | null> {
  try {
    const result = await env.AI.run(DRAW_MODEL as Parameters<typeof env.AI.run>[0], {
      prompt: `masterpiece, best quality, ${prompt}`,
      num_steps: 20,
    } as never);

    // 用 Response 包裹，兼容 ReadableStream / ArrayBuffer / Response 各种返回
    const buf = await new Response(result as ReadableStream).arrayBuffer();
    if (!buf || buf.byteLength === 0) return null;

    const bytes = new Uint8Array(buf);
    let binary = "";
    bytes.forEach((b) => (binary += String.fromCharCode(b)));
    return btoa(binary);
  } catch (e) {
    console.error("drawImage error:", String(e));
    return null;
  }
}

// ── Workers AI 对话 ──
async function chatWithAI(env: Env, history: ChatMessage[]): Promise<string> {
  try {
    const result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct" as never, {
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history],
      max_tokens: 256,
      stream: false,
    } as never) as { response?: string; result?: { response?: string } };
    // 兼容不同返回结构
    const text = result?.response ?? (result?.result as { response?: string } | undefined)?.response ?? "";
    console.log("AI 原始回复:", text);
    return text.trim() || "喵？";
  } catch (e) {
    console.error("chatWithAI error 详情:", String(e), JSON.stringify(e));
    return "AI 服务暂时不可用，请稍后再试。";
  }
}

// ── KV 历史记录 ──
async function getHistory(env: Env, key: string): Promise<ChatMessage[]> {
  try {
    const raw = await env.CHAT_KV.get(key);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

// ── 提取纯文本（跳过 @ 段）──
function extractText(msg: OneBotEvent): string {
  if (!msg.message) return msg.raw_message ?? "";
  return msg.message
    .filter((seg) => seg.type === "text")
    .map((seg) => seg.data.text ?? "")
    .join("")
    .trim();
}
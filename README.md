# 🐱 NapCatQQ Bot on Cloudflare Workers

基于 Cloudflare Workers + Workers AI 的免费 QQ 机器人，无需服务器，零成本部署。

## ✨ 功能

- 🎨 **AI 绘图**：发送 `画 [描述]` 生成图片（基于 Dreamshaper-8 模型）
- 💬 **AI 对话**：支持上下文记忆的智能对话（基于 LLaMA 3.1 模型）
- 👥 **群聊**：@ 机器人触发
- 📩 **私聊**：直接对话

## 📦 前置要求

- [Cloudflare 账号](https://dash.cloudflare.com)（免费即可）
- [Node.js](https://nodejs.org) >= 18
- 一个托管在 Cloudflare 的域名
- 运行 [NapCatQQ](https://github.com/NapNeko/NapCatQQ) 的设备

---

## 🚀 部署步骤

### 1. 克隆项目

```bash
git clone https://github.com/ZXZCAT/bot_worker.git
cd napcat-cf-bot
npm install
```

### 2. 登录 Cloudflare

```bash
npx wrangler login
```

浏览器会弹出授权页面，点击授权即可。

### 3. 创建 KV 命名空间

KV 用于存储对话历史记录：

```bash
npx wrangler kv namespace create CHAT_KV
```

命令会输出类似以下内容，复制 `id` 的值：

```
{ binding = "CHAT_KV", id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }
```

### 4. 配置 wrangler.jsonc

复制模板文件并填入你自己的信息：

```bash
cp wrangler.example.jsonc wrangler.jsonc
```

编辑 `wrangler.jsonc`，替换以下字段：

```jsonc
{
  "name": "my-qq-bot",                        // Worker 名称，可自定义
  "main": "src/index.ts",
  "compatibility_date": "2026-02-21",
  "routes": [
    {
      "pattern": "你的域名.com",               // 改为你的域名
      "custom_domain": true
    }
  ],
  "kv_namespaces": [
    {
      "binding": "CHAT_KV",
      "id": "粘贴上面复制的KV id"              // 改为你的 KV id
    }
  ],
  "ai": {
    "binding": "AI"
  },
  "vars": {
    "BOT_QQ": "机器人的QQ号"                   // 改为机器人 QQ 号
  }
}
```

### 5. 自定义机器人人格（可选）

编辑 `src/index.ts`，修改 `SYSTEM_PROMPT` 变量：

```typescript
const SYSTEM_PROMPT = `你是一个友好的 QQ 助手，名叫"你的名字"。
在这里描述你想要的性格和风格。
如果用户想画图，告诉他发送"画 [描述]"即可。`;
```

### 6. 部署

```bash
npx wrangler deploy
```

部署成功后会显示 Worker 地址，例如 `https://你的域名.com`。

---

## ⚙️ 配置 NapCatQQ

打开 NapCatQQ 的网页控制台，添加一个**反向 WebSocket** 连接：

| 字段 | 值 |
|------|-----|
| 类型 | 反向 WebSocket |
| URL | `wss://你的域名.com/ws` |
| 消息格式 | Array |

保存后 NapCatQQ 会自动连接到 Worker。

---

## 🧪 测试接口

部署完成后可以用浏览器直接测试：

- **测试对话**：`https://你的域名.com/test-chat?msg=你好`
- **测试绘图**：`https://你的域名.com/test-draw?prompt=一只猫咪`

---

## 📁 项目结构

```
├── src/
│   └── index.ts          # 主逻辑
├── wrangler.example.jsonc # 配置模板
├── wrangler.jsonc         # 你的配置（不要提交到 git）
├── package.json
└── README.md
```

---

## 💰 费用说明

全部基于 Cloudflare 免费套餐：

| 资源 | 免费额度 |
|------|---------|
| Workers 请求 | 10 万次/天 |
| Workers AI（对话） | 每天赠送神经元额度 |
| Workers AI（绘图） | 每天赠送神经元额度 |
| KV 读写 | 10 万次/天 |

个人日常使用完全够用。

---

## 🤖 使用方式

**私聊：**
```
你好           → AI 回复
画 一只橘猫    → 生成图片
```

**群聊：**
```
@机器人 你好          → AI 回复
@机器人 画 星空下的猫  → 生成图片
```

---

## 📄 License

MIT

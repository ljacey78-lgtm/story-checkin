# 今日故事打卡

这是一个可以部署到 Vercel 的手机网页。部署后，手机打开 HTTPS 链接就能用；OpenRouter API key 放在 Vercel 的环境变量里，不会暴露在前端代码中。

## 你现在需要做什么

1. 准备一个 OpenRouter API key。
2. 把这个项目部署到 Vercel。
3. 在 Vercel 项目的 Environment Variables 里添加：

```text
OPENROUTER_API_KEY=你的 OpenRouter API key
```

4. 重新部署一次。
5. 用手机 Safari 打开 Vercel 给你的 HTTPS 链接。

## 可选模型

默认模型：

```text
OPENROUTER_MODEL=meta-llama/llama-3.1-8b-instruct:free
```

OpenRouter 的免费模型可能会调整。如果默认模型不可用，可以在 Vercel 里修改 `OPENROUTER_MODEL`。

## 本地测试

```bash
OPENROUTER_API_KEY="你的 key" node server.js
```

然后打开：

```text
http://127.0.0.1:4173
```

本地不配置 key 时，页面仍会运行，但会退回本地规则解析。

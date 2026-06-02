# 今日故事打卡

这是一个可以部署到 Vercel 的手机网页。部署后，手机打开 HTTPS 链接就能用；OpenAI API key 放在 Vercel 的环境变量里，不会暴露在前端代码中。

## 你现在需要做什么

1. 准备一个 OpenAI API key。
2. 把这个项目部署到 Vercel。
3. 在 Vercel 项目的 Environment Variables 里添加：

```text
OPENAI_API_KEY=你的 OpenAI API key
```

4. 重新部署一次。
5. 用手机 Safari 打开 Vercel 给你的 HTTPS 链接。

## 运行逻辑

- 前端输入故事。
- 前端请求 `/api/parse`。
- Vercel 后端函数读取 `OPENAI_API_KEY`。
- 后端调用 OpenAI，把日记解析成打卡事项。
- 前端显示解析结果。

## 本地测试

如果只在电脑本地测试：

```bash
OPENAI_API_KEY="你的 key" node server.js
```

然后打开：

```text
http://127.0.0.1:4173
```

本地不配置 key 时，页面仍会运行，但会退回本地规则解析。

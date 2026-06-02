const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const port = Number(process.env.PORT || 4173);
const model = process.env.OPENROUTER_MODEL || "meta-llama/llama-3.1-8b-instruct:free";

const mimeTypes = {
  ".html": "text/html;charset=utf-8",
  ".css": "text/css;charset=utf-8",
  ".js": "text/javascript;charset=utf-8",
  ".json": "application/json;charset=utf-8"
};

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json;charset=utf-8" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 100_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function normalizeParsed(parsed) {
  return {
    title: String(parsed.title || "今日记录").slice(0, 12),
    events: (parsed.events || []).map((event) => ({
      name: String(event.name || "").trim(),
      icon: String(event.icon || "✨").trim() || "✨",
      color: /^#[0-9a-fA-F]{6}$/.test(event.color) ? event.color : "#8fb8a8"
    })).filter((event) => event.name).slice(0, 8)
  };
}

function extractJson(text) {
  const trimmed = String(text || "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {}
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Model did not return JSON");
  return JSON.parse(match[0]);
}

async function parseWithOpenRouter(text, existingTasks) {
  if (!process.env.OPENROUTER_API_KEY) {
    const error = new Error("Missing OPENROUTER_API_KEY");
    error.status = 500;
    throw error;
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "HTTP-Referer": process.env.APP_URL || "http://127.0.0.1:4173",
      "X-Title": "Story Checkin"
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "你是一个中文日记打卡解析器。只返回 JSON，不要 Markdown。JSON 格式必须是：{\"title\":\"不超过8个中文字符的小标题\",\"events\":[{\"name\":\"2到6个中文字符的事项名\",\"icon\":\"一个emoji\",\"color\":\"#柔和颜色六位十六进制\"}]}。只提取实际发生或明确提到、适合长期打卡累计的事项；不要提取情绪、泛泛总结或过细碎动作；优先复用已有事项名称，避免同义词重复。"
        },
        {
          role: "user",
          content: JSON.stringify({ diary: text, existingTasks })
        }
      ],
      temperature: 0.2
    })
  });

  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error?.message || "OpenRouter request failed");
    error.status = response.status;
    throw error;
  }

  return normalizeParsed(extractJson(data.choices?.[0]?.message?.content));
}

async function handleParse(req, res) {
  try {
    const body = JSON.parse(await readBody(req));
    const text = String(body.text || "").trim();
    if (!text) return sendJson(res, 400, { error: "Missing text" });
    const existingTasks = Array.isArray(body.existingTasks) ? body.existingTasks.slice(0, 50) : [];
    sendJson(res, 200, await parseWithOpenRouter(text, existingTasks));
  } catch (error) {
    sendJson(res, error.status || 500, { error: error.message || "Parse failed" });
  }
}

function serveStatic(req, res) {
  let pathname = decodeURIComponent(req.url.split("?")[0]);
  if (pathname === "/") pathname = "/index.html";
  const filePath = path.join(root, pathname);
  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url.split("?")[0] === "/api/parse") {
    handleParse(req, res);
    return;
  }
  if (req.method === "GET" || req.method === "HEAD") {
    serveStatic(req, res);
    return;
  }
  res.writeHead(405);
  res.end("Method not allowed");
});

server.listen(port, () => {
  console.log(`Story check-in app: http://127.0.0.1:${port}`);
  console.log(`OpenRouter model: ${model}`);
});

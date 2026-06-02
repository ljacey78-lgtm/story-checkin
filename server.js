const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const port = Number(process.env.PORT || 4173);
const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
const apiKey = process.env.OPENAI_API_KEY;

const mimeTypes = {
  ".html": "text/html;charset=utf-8",
  ".css": "text/css;charset=utf-8",
  ".js": "text/javascript;charset=utf-8",
  ".json": "application/json;charset=utf-8"
};

const eventSchema = {
  type: "object",
  additionalProperties: false,
  required: ["events", "title"],
  properties: {
    title: {
      type: "string",
      description: "A short Chinese title for the diary, no more than 8 Chinese characters."
    },
    events: {
      type: "array",
      minItems: 0,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "icon", "color"],
        properties: {
          name: {
            type: "string",
            description: "A concise Chinese check-in item name, usually 2 to 6 Chinese characters."
          },
          icon: {
            type: "string",
            description: "One emoji that semantically matches the event."
          },
          color: {
            type: "string",
            description: "A soft hex color like #8fb8a8."
          }
        }
      }
    }
  }
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

function outputText(response) {
  if (typeof response.output_text === "string") return response.output_text;
  const textParts = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) textParts.push(content.text);
    }
  }
  return textParts.join("");
}

async function parseWithOpenAI(text, existingTasks) {
  if (!apiKey) {
    const error = new Error("Missing OPENAI_API_KEY");
    error.status = 500;
    throw error;
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content:
            "你是一个中文日记打卡解析器。你的任务是从用户的自然语言日记中提取用户可能想记录、打卡、累计的具体事项。只提取实际发生或明确提到的事项，不要提取情绪、泛泛总结或过细碎的动作。优先复用已有事项名称，避免同义词重复。"
        },
        {
          role: "user",
          content: JSON.stringify({
            diary: text,
            existingTasks
          })
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "checkin_events",
          strict: true,
          schema: eventSchema
        }
      }
    })
  });

  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error?.message || "OpenAI request failed");
    error.status = response.status;
    throw error;
  }

  const parsed = JSON.parse(outputText(data));
  return {
    title: parsed.title || "今日记录",
    events: (parsed.events || []).map((event) => ({
      name: String(event.name || "").trim(),
      icon: String(event.icon || "✨").trim() || "✨",
      color: /^#[0-9a-fA-F]{6}$/.test(event.color) ? event.color : "#8fb8a8"
    })).filter((event) => event.name)
  };
}

async function handleParse(req, res) {
  try {
    const body = JSON.parse(await readBody(req));
    const text = String(body.text || "").trim();
    if (!text) return sendJson(res, 400, { error: "Missing text" });
    const existingTasks = Array.isArray(body.existingTasks) ? body.existingTasks.slice(0, 50) : [];
    const parsed = await parseWithOpenAI(text, existingTasks);
    sendJson(res, 200, parsed);
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
  console.log(`AI parser model: ${model}`);
});

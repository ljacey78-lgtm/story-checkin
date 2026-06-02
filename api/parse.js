const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

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
  if (!process.env.OPENAI_API_KEY) {
    const error = new Error("Missing OPENAI_API_KEY");
    error.status = 500;
    throw error;
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
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
          content: JSON.stringify({ diary: text, existingTasks })
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

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const text = String(req.body?.text || "").trim();
    if (!text) {
      res.status(400).json({ error: "Missing text" });
      return;
    }
    const existingTasks = Array.isArray(req.body?.existingTasks) ? req.body.existingTasks.slice(0, 50) : [];
    res.status(200).json(await parseWithOpenAI(text, existingTasks));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Parse failed" });
  }
};

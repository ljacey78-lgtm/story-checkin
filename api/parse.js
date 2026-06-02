const model = process.env.OPENROUTER_MODEL || "openrouter/free";

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
      "HTTP-Referer": process.env.APP_URL || "https://story-checkin.local",
      "X-Title": "Story Checkin"
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "你是一个中文日记打卡解析器。只返回 JSON，不要 Markdown。JSON 格式必须是：{\"title\":\"不超过8个中文字符的小标题\",\"events\":[{\"name\":\"2到6个中文字符的事项名\",\"icon\":\"一个emoji\",\"color\":\"#柔和颜色六位十六进制\"}]}。规则：1. 如果文本中出现与 existingTasks 里已有任务语义相似的内容，就返回对应已有任务名称，例如已有“学英语”时，“背很多单词/练口语/听英语”应返回“学英语”。2. 对不存在于 existingTasks 的新事项，只有当用户明确说出类似“这个帮我打卡一下”“打卡一下这个”“帮我记录一下”“这项记一下”“这个保存一下”的打卡/记录指令时才提取。3. 没有已有任务相似内容、也没有明确新事项打卡指令时，events 返回空数组。优先复用已有事项名称，避免同义词重复。"
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

  const content = data.choices?.[0]?.message?.content;
  return normalizeParsed(extractJson(content));
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
    res.status(200).json(await parseWithOpenRouter(text, existingTasks));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Parse failed" });
  }
};

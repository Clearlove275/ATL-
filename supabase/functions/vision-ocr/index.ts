// Supabase Edge Function：视觉识别（率土之滨截图 → 结构化 JSON）
// 模型优先级：qwen（主，速度快）→ GLM（备用，免费模型，qwen 额度用尽后自动兜底）
// 在 Supabase 配置以下 Secrets：
//   VISION_API_KEY     qwen 视觉模型密钥
//   VISION_BASE_URL    qwen OpenAI 兼容端点（不含 /chat/completions）
//   VISION_MODEL       qwen 模型名
//   VISION_API_KEY_2   GLM 视觉模型密钥（备用）
//   VISION_BASE_URL_2  GLM OpenAI 兼容端点
//   VISION_MODEL_2     GLM 模型名

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PROMPT = `你是《率土之滨》游戏截图的数据提取助手。请识别图中的游戏数据：
- 「功勋/本周功勋」对应 merit（武勋）
- 「势力值」对应 power
- 「贡献总量」对应 contributionTotal
- 「贡献周量」对应 contributionWeek
- 「成员」列的名字对应 name

如果是同盟成员列表（多行数据），返回 JSON 数组，每行：
{"name":"玩家名","merit":数字,"power":数字,"contributionTotal":数字,"contributionWeek":数字}
如果是单个玩家的数据页面，返回 JSON 对象：
{"merit":数字,"power":数字,"contributionTotal":数字,"contributionWeek":数字}

规则：
1. 数字一律转为纯整数，例如 47.3万 → 473000，11.2万 → 112000，42482 → 42482。
2. 没有的字段填 0。
3. 只输出 JSON，不要任何解释、注释或 Markdown 代码块。`;

function extractJson(text: string): unknown | null {
  const s = (text || "").trim();
  const start = s.search(/[{[]/);
  if (start < 0) return null;
  const stack: string[] = [];
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") {
      stack.pop();
      if (stack.length === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

type Provider = {
  name: string;
  key: string;
  baseUrl: string;
  model: string;
  enableThinking?: boolean;
  retries: number;
};

const providers: Provider[] = [
  {
    name: "qwen",
    key: Deno.env.get("VISION_API_KEY") ?? "",
    baseUrl: (Deno.env.get("VISION_BASE_URL") ?? "").replace(/\/$/, ""),
    model: Deno.env.get("VISION_MODEL") ?? "qwen3.7-plus",
    enableThinking: false, // 关闭思考，显著降低延迟
    retries: 1,
  },
  {
    name: "glm",
    key: Deno.env.get("VISION_API_KEY_2") ?? "",
    baseUrl: (Deno.env.get("VISION_BASE_URL_2") ?? "").replace(/\/$/, ""),
    model: Deno.env.get("VISION_MODEL_2") ?? "GLM-4.6V-Flash",
    retries: 2,
  },
].filter((p) => p.key && p.baseUrl);

async function callProvider(
  p: Provider,
  image: string,
): Promise<{ text: string }> {
  const url = `${p.baseUrl}/chat/completions`;
  const payload: Record<string, unknown> = {
    model: p.model,
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: image } },
          { type: "text", text: PROMPT },
        ],
      },
    ],
  };
  if (p.enableThinking === false) payload.enable_thinking = false;

  let lastError = "";
  for (let attempt = 0; attempt <= p.retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 4000 * attempt));
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${p.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (resp.ok) {
        const data = await resp.json();
        const text: string = data?.choices?.[0]?.message?.content ?? "";
        if (!text) throw new Error("empty content");
        return { text };
      }
      const errText = await resp.text();
      lastError = `${p.name} ${resp.status}: ${errText.slice(0, 200)}`;
      const retryable = resp.status === 429 || resp.status >= 500;
      if (!retryable) break;
    } catch (e) {
      lastError = `${p.name}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  throw new Error(lastError || `${p.name} failed`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const body = await req.json();
    const image = body.image as string;
    if (!image || typeof image !== "string") {
      throw new Error("缺少 image 字段（data URL）");
    }
    if (!providers.length) throw new Error("未配置视觉模型密钥");

    let text = "";
    const errors: string[] = [];
    for (const p of providers) {
      try {
        text = (await callProvider(p, image)).text;
        break;
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
    if (!text) throw new Error(errors.join(" | ") || "视觉识别失败");

    const json = extractJson(text);
    return new Response(JSON.stringify({ ok: true, text, json }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});

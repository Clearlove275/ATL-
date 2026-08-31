// Supabase Edge Function：视觉识别（率土之滨截图 → 结构化 JSON）
// 部署后在 Supabase 设置以下 Secrets：
//   VISION_API_KEY    视觉模型密钥
//   VISION_BASE_URL   视觉模型兼容端点（以 /compatible-mode/v1 结尾）
//   VISION_MODEL      模型名
//   VISION_FUNC_KEY   （可选）自定义访问密钥，前端通过 apikey 头传过来校验

const VISION_API_KEY = Deno.env.get("VISION_API_KEY") ?? "";
const VISION_BASE_URL =
  Deno.env.get("VISION_BASE_URL") ??
  "https://ws-ljk2aslepsadtndx.cn-beijing.maas.aliyuncs.com/compatible-mode/v1";
const VISION_MODEL = Deno.env.get("VISION_MODEL") ?? "qwen3.7-plus";
const VISION_FUNC_KEY = Deno.env.get("VISION_FUNC_KEY") ?? "";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    if (VISION_FUNC_KEY && req.headers.get("apikey") !== VISION_FUNC_KEY) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const body = await req.json();
    const image = body.image as string;
    if (!image || typeof image !== "string") {
      throw new Error("缺少 image 字段（data URL）");
    }

    const resp = await fetch(`${VISION_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${VISION_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: image } },
              { type: "text", text: PROMPT },
            ],
          },
        ],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`vision api ${resp.status}: ${errText.slice(0, 200)}`);
    }

    const data = await resp.json();
    const text: string = data?.choices?.[0]?.message?.content ?? "";
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
/* ============================================================
 * 率土同盟数据库 · OCR 与字段提取
 * - 使用 Tesseract.js 在浏览器本地识别中文 + 数字
 * - 支持单张截图（主公簿/势力）与同盟成员列表两种识别
 * ============================================================ */
(function () {
  "use strict";

  // 把 "12.5万" / "1,234" / "1.2亿" / "1234" 解析为整数
  function parseChineseNumber(raw) {
    if (raw == null) return null;
    const s = String(raw).replace(/[，,、\s]/g, "").trim();
    if (!s) return null;
    const m = s.match(/^(\d+(?:\.\d+)?)\s*(万|亿|w|W|y|Y|k|K)?$/);
    if (!m) return null;
    let n = parseFloat(m[1]);
    const unit = (m[2] || "").toLowerCase();
    if (unit === "万" || unit === "w") n *= 10000;
    else if (unit === "亿" || unit === "y") n *= 100000000;
    else if (unit === "k") n *= 1000;
    if (!isFinite(n)) return null;
    return Math.round(n);
  }

  // 在文本中定位 label，优先取标签后最近的数字；没有则回退到标签前的数字
  function extractNear(text, labels) {
    if (!text) return null;
    const re = /\d[\d,，]*(?:\.\d+)?\s*(?:万|亿|w|W|y|Y|k|K)?/g;
    for (const label of labels) {
      const idx = text.indexOf(label);
      if (idx < 0) continue;
      const after = text.slice(idx + label.length, idx + label.length + 40);
      const m = new RegExp(re.source).exec(after);
      if (m) { const val = parseChineseNumber(m[0]); if (val != null) return val; }
      const before = text.slice(Math.max(0, idx - 24), idx);
      const nums = [];
      const re2 = new RegExp(re.source, "g");
      let mm;
      while ((mm = re2.exec(before)) !== null) nums.push(mm[0]);
      if (nums.length) { const val = parseChineseNumber(nums[nums.length - 1]); if (val != null) return val; }
    }
    return null;
  }

  function extractMerit(text) {
    return extractNear(text, ["功勋", "武勋", "武勳", "战功", "戰功"]);
  }
  function extractPower(text) {
    return extractNear(text, ["势力值", "勢力值", "势力", "勢力"]);
  }
  function extractContributionTotal(text) {
    return extractNear(text, ["贡献总量", "贡献总", "总量", "累计贡献", "总贡献"]);
  }
  function extractContributionWeek(text) {
    return extractNear(text, ["贡献周量", "贡献周", "周量", "周贡献"]);
  }

  function parseAll(text) {
    return {
      merit: extractMerit(text),
      power: extractPower(text),
      contributionTotal: extractContributionTotal(text),
      contributionWeek: extractContributionWeek(text)
    };
  }

  // 图片预处理：放大 2 倍 + 灰度 + 对比度增强，提升小字识别率
  async function loadImage(url) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("图片加载失败")); img.src = url; });
    return img;
  }

  function preprocess(img) {
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < d.length; i += 4) {
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      let v = (gray - 128) * 1.35 + 128;
      v = v < 0 ? 0 : v > 255 ? 255 : v;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(new ImageData(d, canvas.width, canvas.height), 0, 0);
    return canvas;
  }

  async function recognizeImage(imageUrl, onProgress) {
    if (!window.Tesseract) throw new Error("识别组件未加载，请检查网络后刷新页面");
    const img = await loadImage(imageUrl);
    const canvas = preprocess(img);
    const result = await window.Tesseract.recognize(canvas, "chi_sim+eng", {
      logger: (m) => { if (typeof onProgress === "function") onProgress(m); }
    });
    return result.data;
  }

  // ---------- 同盟成员列表批量解析 ----------
  function wX0(w) { return w.x0 !== undefined ? w.x0 : w.x; }
  function normWords(data) {
    const ws = data && data.words ? data.words : (Array.isArray(data) ? data : []);
    return ws.map((w) => ({
      t: w.text || w.t || "",
      x: w.bbox ? w.bbox.x0 : (w.x0 !== undefined ? w.x0 : w.x),
      y: w.bbox ? w.bbox.y0 : (w.y0 !== undefined ? w.y0 : w.y),
      x1: w.bbox ? w.bbox.x1 : (w.x1 !== undefined ? w.x1 : (w.x + (w.t ? w.t.length * 20 : 20))),
      y1: w.bbox ? w.bbox.y1 : (w.y1 !== undefined ? w.y1 : (w.y + 24)),
      c: typeof w.confidence === "number" ? w.confidence : (w.c !== undefined ? w.c : 90)
    }));
  }
  function parseNumToken(tok) {
    const s = String(tok).replace(/[，,、\s]/g, "").trim();
    const m = s.match(/^(\d+(?:\.\d+)?)(万|亿|w|W|y|Y|k|K)?$/);
    if (!m) return null;
    let n = parseFloat(m[1]);
    const u = (m[2] || "").toLowerCase();
    if (u === "万" || u === "w") n *= 10000;
    else if (u === "亿" || u === "y") n *= 100000000;
    else if (u === "k") n *= 1000;
    return Math.round(n);
  }

  // 输入 Tesseract 的 data（含 words 与 bbox）或归一化后的 words 数组
  function parseMemberTable(input) {
    const words = normWords(input);
    if (!words.length) return { rows: [] };
    const W = Math.max.apply(null, words.map(wX0));
    // 按 y 聚类成行
    const lines = [];
    for (const w of words) {
      const yc = (w.y + w.y1) / 2;
      let line = lines.find((l) => Math.abs(l.y - yc) < 24);
      if (!line) { line = { y: yc, ws: [] }; lines.push(line); }
      line.ws.push(w);
    }
    lines.sort((a, b) => a.y - b.y);
    for (const l of lines) l.ws.sort((a, b) => wX0(a) - wX0(b));

    const header = lines.find((l) => l.ws.some((w) => ["成员", "贡献", "功勋", "坐标", "身份"].some((k) => w.t === k || w.t.includes(k))));
    if (!header) return { rows: [] };
    const headerY = header.y;
    const fw = (ks) => { for (const l of [header]) { const w = l.ws.find((w) => ks.some((k) => w.t === k || w.t.includes(k))); if (w) return w; } return null; };
    const member = fw(["成", "员", "成员"]);
    const contrib = fw(["贡献"]);
    const merit = fw(["功勋", "勋"]);
    const state = fw(["州", "所", "在"]);
    const nameL = member ? wX0(member) - 100 : W * 0.12;
    const nameR = contrib ? wX0(contrib) - 30 : W * 0.34;
    const contribL = contrib ? wX0(contrib) - 70 : W * 0.30;
    const contribR = merit ? wX0(merit) - 110 : W * 0.46;
    const meritL = merit ? wX0(merit) - 110 : W * 0.42;
    const meritR = state ? wX0(state) - 20 : W * 0.62;
    const STOP = new Set(["总", "量", "周", "全", "万", "亿", "贡献", "功勋", "州", "坐标", "身份", "并", "扬", "扬州", "所", "在", "本", "人", "日", "认"]);

    function nums(line, l, r) {
      const out = [];
      for (const w of line.ws) {
        const x = wX0(w);
        if (x >= l && x < r && /\d/.test(w.t)) {
          const n = parseNumToken(w.t);
          if (n == null) continue;
          const unit = line.ws.find((u) => wX0(u) >= x && wX0(u) < x + 90 && /^[万亿]$/.test(u.t));
          if (unit) { const base = parseFloat(String(w.t).replace(/[，,、\s万亿美元wk]/g, "")); out.push(Math.round(base * (unit.t === "亿" ? 1e8 : 1e4))); }
          else out.push(n);
        }
      }
      return out;
    }
    function nameOf(line) {
      return line.ws.filter((w) => {
        const x = wX0(w);
        return x >= nameL && x < nameR && !STOP.has(w.t) && !/^\d/.test(w.t) && /[^\s()|]/.test(w.t);
      }).map((w) => w.t).join("");
    }

    const dataLines = lines.filter((l) => l.y > headerY + 20);
    const rows = [];
    for (let i = 0; i < dataLines.length; i++) {
      const l = dataLines[i];
      const name = nameOf(l);
      const merits = nums(l, meritL, meritR);
      if (name && merits.length) {
        const own = nums(l, contribL, contribR);
        const above = dataLines[i - 1] ? nums(dataLines[i - 1], contribL, contribR) : [];
        const below = dataLines[i + 1] ? nums(dataLines[i + 1], contribL, contribR) : [];
        const total = above[0] != null ? above[0] : (own[0] != null ? own[0] : null);
        const week = below[0] != null ? below[0] : (own[0] != null ? own[0] : null);
        rows.push({
          name,
          merit: merits[0],
          power: merits.length > 1 ? merits[1] : null,
          contributionTotal: total,
          contributionWeek: week
        });
      }
    }
    return { rows };
  }

  // 把图片转成 data URL（用于调用视觉识别后端）
  async function imageToDataUrl(imageUrl) {
    const img = await loadImage(imageUrl);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext("2d").drawImage(img, 0, 0);
    return canvas.toDataURL("image/png");
  }

  // 调用视觉识别后端（Supabase Edge Function），返回 { ok, text, json }
  // anonKey 为 Supabase Publishable 公钥，通过 apikey 头传给网关鉴权
  async function recognizeViaBackend(imageUrl, baseUrl, anonKey) {
    const dataUrl = await imageToDataUrl(imageUrl);
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": anonKey || "" },
      body: JSON.stringify({ image: dataUrl })
    });
    const data = await res.json();
    if (!data || !data.ok) throw new Error((data && data.error) || "视觉识别失败");
    return data;
  }

  window.OCR = {
    recognizeImage,
    recognizeViaBackend,
    parseAll,
    parseMemberTable,
    parseChineseNumber
  };
})();
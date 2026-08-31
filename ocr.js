/* ============================================================
 * OCR 与字段提取
 * 使用 Tesseract.js 在浏览器本地识别中文 + 数字，
 * 然后从识别文本中提取「武勋」与「势力值」。
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

      // 1) 标签之后的数字（允许 ：: 空格 等分隔符）
      const after = text.slice(idx + label.length, idx + label.length + 40);
      const m = new RegExp(re.source).exec(after);
      if (m) {
        const val = parseChineseNumber(m[0]);
        if (val != null) return val;
      }

      // 2) 回退：标签之前的数字（取最后一个）
      const before = text.slice(Math.max(0, idx - 24), idx);
      const nums = [];
      const re2 = new RegExp(re.source, "g");
      let mm;
      while ((mm = re2.exec(before)) !== null) nums.push(mm[0]);
      if (nums.length) {
        const val = parseChineseNumber(nums[nums.length - 1]);
        if (val != null) return val;
      }
    }
    return null;
  }
  function extractMerit(text) {
    // 优先匹配“武勋”，兼容“累计武勋”“本周武勋”“赛季武勋”“战功”
    return extractNear(text, ["武勋", "戰功", "战功", "武勳"]);
  }

  function extractPower(text) {
    // 势力值：优先“势力值”，其次“势力”
    const v = extractNear(text, ["势力值", "勢力值", "势力", "勢力"]);
    return v;
  }

  function parseAll(text) {
    return {
      merit: extractMerit(text),
      power: extractPower(text)
    };
  }

  // 识别图片。logger 用于进度回显。
  async function recognizeImage(imageUrl, onProgress) {
    if (!window.Tesseract) {
      throw new Error("识别组件未加载，请检查网络后刷新页面");
    }
    const result = await window.Tesseract.recognize(imageUrl, "chi_sim+eng", {
      logger: (m) => {
        if (typeof onProgress === "function") onProgress(m);
      }
    });
    return result.data.text;
  }

  window.OCR = {
    recognizeImage,
    parseAll,
    parseChineseNumber
  };
})();
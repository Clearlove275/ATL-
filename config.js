/* ============================================================
 * 率土同盟数据库 · 配置
 * ------------------------------------------------------------
 * backend:
 *   "local"    本地演示模式：数据仅保存在当前浏览器，无需任何配置。
 *   "supabase" 多用户同盟数据库：支持实时更新、跨设备共享。
 *
 * 视觉识别后端（已配置）：
 *   导入截图时优先用智谱 GLM-4.6V-Flash 视觉模型识别，失败自动回退本地识别。
 * ============================================================ */
window.APP_CONFIG = {
  backend: "supabase",
  supabaseUrl: "https://uqxjimxhtvjqpkmeqbnn.supabase.co",
  supabaseAnonKey: "sb_publishable_e9KyKQVfc_12_FpFgO_PPg_pfY4JWSa",

  // 视觉识别后端（Supabase Edge Function）
  visionBackendUrl: "https://uqxjimxhtvjqpkmeqbnn.supabase.co/functions/v1/vision-ocr"
};
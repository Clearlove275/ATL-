/* ============================================================
 * 率土同盟数据库 · 配置
 * ------------------------------------------------------------
 * backend:
 *   "local"    本地演示模式：数据仅保存在当前浏览器，无需任何配置。
 *   "supabase" 多用户同盟数据库：支持实时更新、跨设备共享。
 *              需要先在 https://supabase.com 创建免费项目，
 *              并在 SQL Editor 中执行 supabase/schema.sql，
 *              然后把下方两项填好。
 * ============================================================ */
window.APP_CONFIG = {
  backend: "local",
  supabaseUrl: "https://YOUR-PROJECT.supabase.co",
  supabaseAnonKey: "YOUR-ANON-KEY"
};
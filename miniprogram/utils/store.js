const client = require('./client');
const cfg = require('./config');
async function getUserId() { const u = await client.auth.getUser(); return u ? u.id : null; }

const alliances = {
  async list() { const u = await getUserId(); if (!u) return []; const rows = await client.request('GET', '/rest/v1/alliance_members?select=role,alliances(id,name,season,invite_code)&user_id=eq.' + u); return (rows || []).map(r => ({ id: r.alliances && r.alliances.id, name: r.alliances && r.alliances.name, season: r.alliances && r.alliances.season, invite_code: r.alliances && r.alliances.invite_code, role: r.role })); },
  async create(name, season, gameName) { return await client.request('POST', '/rest/v1/rpc/create_alliance', { p_name: name, p_season: season || '', p_game_name: gameName || '' }); },
  async join(code, gameName) { return await client.request('POST', '/rest/v1/rpc/join_alliance', { p_invite_code: code, p_game_name: gameName || '' }); }
};
const players = {
  async list(aid) { return await client.request('GET', '/rest/v1/players?alliance_id=eq.' + aid + '&order=created_at.asc'); },
  async add(aid, p) { return await client.request('POST', '/rest/v1/players', { alliance_id: aid, game_name: p.game_name, team: p.team || '', duty: p.duty || '' }); }
};
const records = {
  async list(aid) { return await client.request('GET', '/rest/v1/records?alliance_id=eq.' + aid + '&order=recorded_at.asc'); },
  async add(aid, r) { return await client.request('POST', '/rest/v1/records', { alliance_id: aid, player_id: r.player_id, merit: Number(r.merit) || 0, power: Number(r.power) || 0, contribution_total: Number(r.contribution_total) || 0, contribution_week: Number(r.contribution_week) || 0, source: r.source || 'manual', note: r.note || '', recorded_at: r.recorded_at || new Date().toISOString() }); }
};
const members = {
  async list(aid) { return await client.request('GET', '/rest/v1/alliance_members?alliance_id=eq.' + aid + '&select=id,user_id,role,game_name,joined_at'); },
  async setRole(aid, id, role) { return await client.request('PATCH', '/rest/v1/alliance_members?id=eq.' + id, { role: role }); },
  async remove(aid, id) { return await client.request('DELETE', '/rest/v1/alliance_members?id=eq.' + id); }
};
const feedback = {
  async list() { return await client.request('GET', '/rest/v1/feedback?select=*&order=created_at.asc'); },
  async add(p) { return await client.request('POST', '/rest/v1/feedback', { nickname: p.nickname || '匿名玩家', content: p.content, parent_id: p.parent_id || null }); },
  async like(id) { return await client.request('POST', '/rest/v1/rpc/like_feedback', { p_id: id }); }
};
const vision = {
  recognize(tempFilePath) { return new Promise((resolve, reject) => { wx.compressImage({ src: tempFilePath, quality: 80, success: (c) => { const src = c.tempFilePath || tempFilePath; wx.getFileSystemManager().readFile({ filePath: src, encoding: 'base64', success: (r) => { wx.request({ url: cfg.visionBackendUrl, method: 'POST', header: { 'apikey': cfg.anonKey, 'Content-Type': 'application/json' }, data: { image: 'data:image/jpeg;base64,' + r.data }, success: (res) => { if (res.statusCode < 300 && res.data && res.data.ok) resolve(res.data); else reject(new Error((res.data && res.data.error) || '识别失败')); }, fail: () => reject(new Error('网络错误')) }); }, fail: () => reject(new Error('读取图片失败')) }); }, fail: () => reject(new Error('图片压缩失败')) }); }); }
};

// CSV 解析
const COL_ALIASES = { name:['成员','玩家','名称','昵称','游戏昵称','member','name'], merit:['武勋','功勋','本周功勋','战功','merit'], power:['势力值','势力','power'], contributionTotal:['贡献总量','贡献总','累计贡献','总贡献','contributiontotal'], contributionWeek:['贡献周量','贡献周','周贡献','周量','contributionweek'] };
function normCell(v) { return String(v == null ? '' : v).trim().toLowerCase().replace(/[\s*#：:（）()]/g, ''); }
function toNum(v) { if (v == null || v === '') return 0; if (typeof v === 'number') return Math.round(v); const s = String(v).replace(/[，,]/g, ''); const m = s.match(/^(\d+(?:\.\d+)?)(万|亿|w|W|y|Y|k|K)?$/); if (m) { let n = parseFloat(m[1]); const u = (m[2] || '').toLowerCase(); if (u === '万' || u === 'w') n *= 10000; else if (u === '亿' || u === 'y') n *= 100000000; else if (u === 'k') n *= 1000; return Math.round(n); } return 0; }
function parseTableRows(rows) {
  let hi = -1;
  for (let i = 0; i < Math.min(rows.length, 15); i++) { const r = rows[i] || []; if (r.some(c => { const s = normCell(c); return s.indexOf('武勋') >= 0 || s.indexOf('势力') >= 0 || s.indexOf('贡献') >= 0 || s.indexOf('成员') >= 0 || s.indexOf('玩家') >= 0 || s.indexOf('merit') >= 0 || s.indexOf('power') >= 0; })) { hi = i; break; } }
  if (hi < 0) return [];
  const header = (rows[hi] || []).map(normCell);
  const col = f => header.findIndex(s => COL_ALIASES[f].some(a => s.indexOf(a) >= 0));
  const cN = col('name'), cM = col('merit'), cP = col('power'), cT = col('contributionTotal'), cW = col('contributionWeek');
  if (cN < 0) return [];
  const out = [];
  for (let i = hi + 1; i < rows.length; i++) { const r = rows[i] || []; const name = String(r[cN] == null ? '' : r[cN]).trim(); if (!name) continue; out.push({ name, merit: toNum(r[cM]), power: toNum(r[cP]), ct: toNum(r[cT]), cw: toNum(r[cW]) }); }
  return out;
}
function parseCsv(text) { const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim()); const rows = lines.map(l => l.split(',').map(c => c.trim())); return parseTableRows(rows); }

module.exports = { alliances, players, records, members, feedback, vision, parseCsv, parseTableRows, getUserId };

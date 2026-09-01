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
const vision = { recognize(tempFilePath) { return new Promise((resolve, reject) => { wx.compressImage({ src: tempFilePath, quality: 80, success: (c) => { const src = c.tempFilePath || tempFilePath; wx.getFileSystemManager().readFile({ filePath: src, encoding: 'base64', success: (r) => { wx.request({ url: cfg.visionBackendUrl, method: 'POST', header: { 'apikey': cfg.anonKey, 'Content-Type': 'application/json' }, data: { image: 'data:image/jpeg;base64,' + r.data }, success: (res) => { if (res.statusCode < 300 && res.data && res.data.ok) resolve(res.data); else reject(new Error((res.data && res.data.error) || '识别失败')); }, fail: () => reject(new Error('网络错误')) }); }, fail: () => reject(new Error('读取图片失败')) }); }, fail: () => reject(new Error('图片压缩失败')) }); }); } };
module.exports = { alliances, players, records, vision, getUserId };

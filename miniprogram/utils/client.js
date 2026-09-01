const cfg = require('./config');
let accessToken = '';
let refreshToken = '';
function request(method, path, data) {
  return new Promise((resolve, reject) => {
    const header = { 'apikey': cfg.anonKey, 'Content-Type': 'application/json' };
    if (accessToken) header['Authorization'] = 'Bearer ' + accessToken;
    wx.request({ url: cfg.supabaseUrl + path, method: method, data: data, header: header,
      success(res) { if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data); else { const d = res.data || {}; reject(new Error(d.message || d.msg || d.error_description || ('请求失败(' + res.statusCode + ')'))); } },
      fail(err) { reject(new Error((err && err.errMsg) || '网络错误')); } });
  });
}
function setSession(s) { if (s) { accessToken = s.access_token || ''; refreshToken = s.refresh_token || ''; try { wx.setStorageSync('atl_session', s); } catch (e) {} } else { accessToken = ''; refreshToken = ''; try { wx.removeStorageSync('atl_session'); } catch (e) {} } }
function loadSession() { try { const s = wx.getStorageSync('atl_session'); if (s && s.access_token) { accessToken = s.access_token; refreshToken = s.refresh_token; return true; } } catch (e) {} return false; }
const auth = {
  async signUp(email, password) { const d = await request('POST', '/auth/v1/signup', { email, password }); if (d.access_token) setSession(d); return d.user || null; },
  async signIn(email, password) { const d = await request('POST', '/auth/v1/token?grant_type=password', { email, password }); setSession(d); return d.user || null; },
  async getUser() { if (!accessToken) return null; try { return await request('GET', '/auth/v1/user'); } catch (e) { return null; } },
  async signOut() { try { if (accessToken) await request('POST', '/auth/v1/logout', {}); } catch (e) {} setSession(null); }
};
module.exports = { request, setSession, loadSession, getAccessToken: () => accessToken, auth };

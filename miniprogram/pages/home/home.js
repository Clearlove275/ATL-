const store = require('../../utils/store');
const client = require('../../utils/client');
const app = getApp();
Page({ data: { alliances: [], show: '', name: '', season: '', gameName: '', code: '', loading: false },
  noop() {},
  onShow() { this.load(); },
  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },
  async load() { try { const list = await store.alliances.list(); this.setData({ alliances: list }); } catch (e) {} },
  openCreate() { this.setData({ show: 'create' }); }, openJoin() { this.setData({ show: 'join' }); }, close() { this.setData({ show: '' }); },
  onName(e) { this.setData({ name: e.detail.value }); }, onSeason(e) { this.setData({ season: e.detail.value }); }, onGameName(e) { this.setData({ gameName: e.detail.value }); }, onCode(e) { this.setData({ code: e.detail.value }); },
  async doCreate() { if (!this.data.name) { wx.showToast({ title: '请输入同盟名称', icon: 'none' }); return; } this.setData({ loading: true }); try { await store.alliances.create(this.data.name, this.data.season, this.data.gameName); this.setData({ loading: false, show: '' }); wx.showToast({ title: '创建成功', icon: 'success' }); this.load(); } catch (e) { this.setData({ loading: false }); wx.showToast({ title: e.message, icon: 'none' }); } },
  async doJoin() { if (!this.data.code) { wx.showToast({ title: '请输入邀请码', icon: 'none' }); return; } this.setData({ loading: true }); try { await store.alliances.join(this.data.code, this.data.gameName); this.setData({ loading: false, show: '' }); wx.showToast({ title: '加入成功', icon: 'success' }); this.load(); } catch (e) { this.setData({ loading: false }); wx.showToast({ title: e.message, icon: 'none' }); } },
  openAlliance(e) { const a = this.data.alliances[e.currentTarget.dataset.i]; wx.navigateTo({ url: '/pages/alliance/alliance?id=' + a.id + '&name=' + encodeURIComponent(a.name) + '&season=' + encodeURIComponent(a.season || '') + '&code=' + (a.invite_code || '') + '&role=' + a.role }); },
  goFeedback() { wx.navigateTo({ url: '/pages/feedback/feedback' }); },
  async logout() { await client.auth.signOut(); app.globalData.user = null; wx.reLaunch({ url: '/pages/login/login' }); }
});

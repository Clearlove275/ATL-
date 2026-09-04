const client = require('../../utils/client');
const app = getApp();
Page({
  data: { mode: 'login', email: '', password: '', msg: '', loading: false, remember: false },
  onLoad() { this.autoEnter(); },
  async autoEnter() {
    try {
      const u = await client.auth.getUser();
      if (u) { app.globalData.user = u; wx.reLaunch({ url: '/pages/home/home' }); return; }
      const r = wx.getStorageSync('atl_remembered');
      if (r && r.email) {
        this.setData({ email: r.email, password: r.password, remember: true });
        const user = await client.auth.signIn(r.email, r.password);
        if (user) { app.globalData.user = user; wx.reLaunch({ url: '/pages/home/home' }); }
      }
    } catch (e) {}
  },
  switchMode(e) { this.setData({ mode: e.currentTarget.dataset.mode, msg: '' }); },
  onEmail(e) { this.setData({ email: e.detail.value }); },
  onPassword(e) { this.setData({ password: e.detail.value }); },
  onRemember(e) { this.setData({ remember: e.detail.value }); },
  saveRemembered() {
    try { if (this.data.remember) wx.setStorageSync('atl_remembered', { email: this.data.email, password: this.data.password }); else wx.removeStorageSync('atl_remembered'); } catch (e) {}
  },
  forgot() {
    wx.showModal({ title: '重置密码', editable: true, placeholderText: '请输入注册邮箱', success: async res => {
      if (res.confirm && res.content) {
        const email = res.content.trim();
        if (!email) return;
        try { await client.auth.resetPassword(email); wx.showToast({ title: '重置邮件已发送', icon: 'success' }); }
        catch (e) { wx.showToast({ title: e.message, icon: 'none' }); }
      }
    }});
  },
  async submit() {
    const d = this.data;
    if (!d.email || !d.password) { this.setData({ msg: '请输入邮箱和密码' }); return; }
    if (d.mode === 'signup' && d.password.length < 6) { this.setData({ msg: '密码至少 6 位' }); return; }
    this.setData({ loading: true, msg: '' });
    try {
      const user = d.mode === 'signup' ? await client.auth.signUp(d.email, d.password) : await client.auth.signIn(d.email, d.password);
      if (user) {
        this.saveRemembered();
        app.globalData.user = user;
        wx.reLaunch({ url: '/pages/home/home' });
      } else { this.setData({ msg: '注册成功，请登录' }); }
    } catch (e) {
      const m = String(e.message || '').toLowerCase();
      let msg = e.message || '操作失败';
      if (m.indexOf('already registered') >= 0 || m.indexOf('已注册') >= 0) { msg = '该邮箱已注册，请直接登录'; this.setData({ mode: 'login' }); }
      else if (m.indexOf('invalid login') >= 0 || m.indexOf('invalid_credentials') >= 0) msg = '邮箱或密码错误';
      this.setData({ msg: msg });
    } finally { this.setData({ loading: false }); }
  }
});

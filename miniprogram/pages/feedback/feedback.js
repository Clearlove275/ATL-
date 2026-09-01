const store = require('../../utils/store');
Page({
  data: { posts: [], nickname: '', content: '', replyTo: null, replyName: '' },
  onShow() { this.load(); },
  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },
  async load() {
    try {
      const list = await store.feedback.list();
      const liked = new Set(JSON.parse(wx.getStorageSync('fb_liked') || '[]'));
      const posts = list.filter(f => !f.parent_id).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      const replies = list.filter(f => f.parent_id);
      const out = posts.map(p => ({ id: p.id, nickname: p.nickname, content: p.content, like: p.like_count || 0, liked: liked.has(p.id), time: this.fmt(p.created_at), replies: replies.filter(r => r.parent_id === p.id).map(r => ({ nickname: r.nickname, content: r.content, time: this.fmt(r.created_at) })) }));
      this.setData({ posts: out });
    } catch (e) {}
  },
  fmt(iso) { const d = Date.now() - new Date(iso).getTime(); const m = Math.floor(d / 60000); if (m < 1) return '刚刚'; if (m < 60) return m + '分钟前'; const h = Math.floor(m / 60); if (h < 24) return h + '小时前'; return Math.floor(h / 24) + '天前'; },
  onNick(e) { this.setData({ nickname: e.detail.value }); },
  onContent(e) { this.setData({ content: e.detail.value }); },
  reply(e) { const p = this.data.posts[e.currentTarget.dataset.i]; this.setData({ replyTo: p.id, replyName: p.nickname }); },
  cancelReply() { this.setData({ replyTo: null, replyName: '' }); },
  async submit() { const c = this.data.content.trim(); if (!c) { wx.showToast({ title: '请输入内容', icon: 'none' }); return; } try { await store.feedback.add({ nickname: this.data.nickname || '匿名玩家', content: c, parent_id: this.data.replyTo || null }); this.setData({ content: '', replyTo: null, replyName: '' }); wx.showToast({ title: '已提交', icon: 'success' }); this.load(); } catch (e) { wx.showToast({ title: e.message, icon: 'none' }); } },
  async like(e) { const id = e.currentTarget.dataset.id; const liked = new Set(JSON.parse(wx.getStorageSync('fb_liked') || '[]')); if (liked.has(id)) return; liked.add(id); wx.setStorageSync('fb_liked', JSON.stringify([...liked])); try { await store.feedback.like(id); this.load(); } catch (e) { wx.showToast({ title: e.message, icon: 'none' }); } }
});

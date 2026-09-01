const store = require('../../utils/store');
Page({
  data: { aid: '', myRole: 'member', canManage: false, members: [] },
  onLoad(o) { this.setData({ aid: o.id, myRole: o.role || 'member' }); this.load(); },
  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },
  async load() {
    const can = this.data.myRole === 'owner' || this.data.myRole === 'admin';
    try { const ms = (await store.members.list(this.data.aid)).map(m => ({ ...m, roleName: m.role === 'owner' ? '盟主' : (m.role === 'admin' ? '管理' : '成员') })); this.setData({ members: ms, canManage: can }); } catch (e) {}
  },
  async changeRole(e) { const m = this.data.members[e.currentTarget.dataset.i]; wx.showActionSheet({ itemList: ['设为成员', '设为管理'], success: async res => { const role = res.tapIndex === 1 ? 'admin' : 'member'; try { await store.members.setRole(this.data.aid, m.id, role); wx.showToast({ title: '已更新', icon: 'success' }); this.load(); } catch (e) { wx.showToast({ title: e.message, icon: 'none' }); } } }); },
  async removeMember(e) { const m = this.data.members[e.currentTarget.dataset.i]; wx.showModal({ title: '移除成员', content: '确定移除「' + (m.game_name || m.user_id) + '」？', success: async res => { if (res.confirm) { try { await store.members.remove(this.data.aid, m.id); wx.showToast({ title: '已移除', icon: 'success' }); this.load(); } catch (e) { wx.showToast({ title: e.message, icon: 'none' }); } } } }); }
});

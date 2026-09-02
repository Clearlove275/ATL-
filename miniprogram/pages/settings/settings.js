const store = require('../../utils/store');
Page({
  data: { aid:'', myRole:'member', canManage:false, members:[], thMerit:0, thPower:0, thCt:0, thCw:0 },
  onLoad(o){ this.setData({ aid:o.id, myRole:o.role||'member' }); this.load(); },
  onPullDownRefresh(){ this.load().then(()=>wx.stopPullDownRefresh()); },
  async load(){
    const can = this.data.myRole === 'owner' || this.data.myRole === 'admin';
    try {
      const ms = (await store.members.list(this.data.aid)).map(m => ({ ...m, roleName: m.role === 'owner' ? '盟主' : (m.role === 'admin' ? '管理' : '成员') }));
      let all = {};
      try { all = await store.alliances.get(this.data.aid) || {}; } catch(e){}
      this.setData({ members: ms, canManage: can, thMerit: all.threshold_merit||0, thPower: all.threshold_power||0, thCt: all.threshold_contrib_total||0, thCw: all.threshold_contrib_week||0 });
    } catch(e){}
  },
  onTh(e){ const k = e.currentTarget.dataset.k; this.setData({ ['th'+k]: e.detail.value }); },
  async saveThreshold(){
    if (!this.data.canManage) { wx.showToast({ title:'仅盟主/管理员可设置', icon:'none' }); return; }
    try {
      await store.alliances.update(this.data.aid, { threshold_merit:Number(this.data.thMerit)||0, threshold_power:Number(this.data.thPower)||0, threshold_contrib_total:Number(this.data.thCt)||0, threshold_contrib_week:Number(this.data.thCw)||0 });
      wx.showToast({ title:'阈值已保存', icon:'success' });
    } catch(e){ wx.showToast({ title:e.message, icon:'none' }); }
  },
  async changeRole(e){ const m=this.data.members[e.currentTarget.dataset.i]; wx.showActionSheet({ itemList:['设为成员','设为管理'], success: async res => { const role = res.tapIndex===1?'admin':'member'; try { await store.members.setRole(this.data.aid, m.id, role); wx.showToast({title:'已更新',icon:'success'}); this.load(); } catch(e){ wx.showToast({title:e.message,icon:'none'}); } } }); },
  async removeMember(e){ const m=this.data.members[e.currentTarget.dataset.i]; wx.showModal({ title:'移除成员', content:'确定移除「'+(m.game_name||m.user_id)+'」？', success: async res => { if(res.confirm){ try { await store.members.remove(this.data.aid, m.id); wx.showToast({title:'已移除',icon:'success'}); this.load(); } catch(e){ wx.showToast({title:e.message,icon:'none'}); } } } }); }
});

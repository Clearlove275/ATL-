const store = require('../../utils/store');
let timer = null;
Page({
  data: { aid:'', name:'', season:'', code:'', role:'', stats:{}, players:[], records:[], showRec:false, showPlayer:false, showBatch:false, rec:{}, newPlayerName:'', selPid:'', batchRows:[], savingBatch:false },
  noop() {},
  onLoad(o) { this.setData({ aid:o.id, name:decodeURIComponent(o.name||''), season:decodeURIComponent(o.season||''), code:o.code||'', role:o.role||'member' }); wx.setNavigationBarTitle({ title: o.name ? decodeURIComponent(o.name) : '同盟' }); this.load(); },
  onShow() { if (this.data.aid) { this.load(); this.startTimer(); } },
  onHide() { this.stopTimer(); },
  onUnload() { this.stopTimer(); },
  startTimer() { this.stopTimer(); timer = setInterval(() => { if (this.data.aid) this.load(); }, 30000); },
  stopTimer() { if (timer) { clearInterval(timer); timer = null; } },
  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },
  async load() {
    const aid = this.data.aid;
    const [players, records] = await Promise.all([store.players.list(aid), store.records.list(aid)]);
    const byP = {}; (records||[]).forEach(r => { (byP[r.player_id] = byP[r.player_id] || []).push(r); });
    const roster = (players||[]).map(p => { const rs=(byP[p.id]||[]).sort((a,b)=>new Date(a.recorded_at)-new Date(b.recorded_at)); const last=rs.length?rs[rs.length-1]:null; return { id:p.id, game_name:p.game_name, team:p.team||'', duty:p.duty||'', count:rs.length, merit:last?last.merit:0, power:last?last.power:0, ct:last?last.contribution_total:0, cw:last?last.contribution_week:0 }; });
    const stats = { players:(players||[]).length, records:(records||[]).length, topMerit:Math.max.apply(null, roster.map(x=>x.merit).concat([0])), topPower:Math.max.apply(null, roster.map(x=>x.power).concat([0])) };
    this.setData({ players:roster, records:records||[], stats:stats });
  },
  addRecord(e) { const p=this.data.players[e.currentTarget.dataset.i]; this.setData({ showRec:true, selPid:p.id, rec:{ name:p.game_name, merit:'', power:'', ct:'', cw:'' } }); },
  closeRec() { this.setData({ showRec:false }); },
  onRec(e) { const k=e.currentTarget.dataset.k; this.setData({ ['rec.'+k]: e.detail.value }); },
  async saveRec() { const r=this.data.rec, pid=this.data.selPid; try { await store.records.add(this.data.aid, { player_id:pid, merit:r.merit, power:r.power, contribution_total:r.ct, contribution_week:r.cw, source:'manual' }); this.setData({ showRec:false }); wx.showToast({ title:'已保存', icon:'success' }); this.load(); } catch(e){ wx.showToast({ title:e.message, icon:'none' }); } },
  openAddPlayer() { this.setData({ showPlayer:true, newPlayerName:'' }); },
  closePlayer() { this.setData({ showPlayer:false }); },
  onNewPlayer(e) { this.setData({ newPlayerName:e.detail.value }); },
  async savePlayer() { const n=(this.data.newPlayerName||'').trim(); if(!n){ wx.showToast({ title:'请输入昵称', icon:'none' }); return; } try { await store.players.add(this.data.aid, { game_name:n, team:'', duty:'' }); this.setData({ showPlayer:false }); wx.showToast({ title:'已添加', icon:'success' }); this.load(); } catch(e){ wx.showToast({ title:e.message, icon:'none' }); } },
  chooseImage() { wx.chooseMedia({ count:1, mediaType:['image'], sourceType:['album','camera'], success: res => this.doRecognize(res.tempFiles[0].tempFilePath) }); },
  chooseVideo() { wx.chooseMedia({ count:1, mediaType:['video'], sourceType:['album','camera'], success: res => { const t=res.tempFiles[0]; const thumb=t.thumbTempFilePath || t.tempFilePath; if(!thumb){ wx.showToast({ title:'获取视频画面失败', icon:'none' }); return; } this.doRecognize(thumb); } }); },
  doRecognize(path) { wx.showLoading({ title:'识别中…' }); store.vision.recognize(path).then(out => { wx.hideLoading(); this.applyVision(out); }).catch(e => { wx.hideLoading(); wx.showToast({ title:e.message, icon:'none' }); }); },
  applyVision(out) { const j=out.json; if (Array.isArray(j) && j.length) { const rows=j.filter(r=>r&&r.name).map(r=>({ name:r.name, merit:Number(r.merit)||0, power:Number(r.power)||0, ct:Number(r.contributionTotal)||0, cw:Number(r.contributionWeek)||0 })); if(rows.length) this.setData({ batchRows:rows, showBatch:true }); else wx.showToast({ title:'未识别到数据', icon:'none' }); } else if (j && !Array.isArray(j)) { this.setData({ showRec:true, rec:{ name:'', merit:j.merit||'', power:j.power||'', ct:j.contributionTotal||'', cw:j.contributionWeek||'' } }); wx.showToast({ title:'识别完成，请选择玩家', icon:'none' }); } else { wx.showToast({ title:'未识别到数据', icon:'none' }); } },
  chooseCsv() { wx.chooseMessageFile({ count:1, type:'file', extension:['csv'], success: res => { const f=res.tempFiles[0]; wx.getFileSystemManager().readFile({ filePath:f.path, encoding:'utf8', success: r => { const rows=store.parseCsv(r.data); if(rows.length) this.setData({ batchRows:rows, showBatch:true }); else wx.showToast({ title:'未解析到数据', icon:'none' }); }, fail: () => wx.showToast({ title:'读取文件失败', icon:'none' }) }); } }); },
  closeBatch() { this.setData({ showBatch:false }); },
  removeBatch(e) { const i=e.currentTarget.dataset.i; const rows=this.data.batchRows.slice(); rows.splice(i,1); this.setData({ batchRows:rows }); },
  async saveBatch() { const rows=this.data.batchRows; if(!rows.length) return; this.setData({ savingBatch:true }); try { const byName={}; this.data.players.forEach(p=>{ byName[p.game_name]=p; }); for(const r of rows){ let p=byName[r.name]; if(!p){ p=await store.players.add(this.data.aid, { game_name:r.name, team:'', duty:'' }); byName[r.name]=p; } await store.records.add(this.data.aid, { player_id:p.id, merit:r.merit, power:r.power, contribution_total:r.ct, contribution_week:r.cw, source:'ocr' }); } this.setData({ savingBatch:false, showBatch:false }); wx.showToast({ title:'已批量保存', icon:'success' }); this.load(); } catch(e){ this.setData({ savingBatch:false }); wx.showToast({ title:e.message, icon:'none' }); } },
  goCompare() { wx.navigateTo({ url:'/pages/compare/compare?id=' + this.data.aid }); },
  goCharts() { wx.navigateTo({ url:'/pages/charts/charts?id=' + this.data.aid }); },
  goSettings() { wx.navigateTo({ url:'/pages/settings/settings?id=' + this.data.aid + '&role=' + this.data.role }); },
  pickPlayer(e) { const i=e.detail.value, p=this.data.players[i]; this.setData({ selPid:p.id, 'rec.name':p.game_name }); }
});

const store = require('../../utils/store');
Page({
  data: { aid:'', players:[], records:[], selPid:'', recs:[], recOptions:[], startIdx:-1, endIdx:-1, result:null },
  onLoad(o){ this.setData({ aid:o.id }); this.load(); },
  async load(){ const [players, records] = await Promise.all([store.players.list(this.data.aid), store.records.list(this.data.aid)]); this.setData({ players, records }); },
  pickPlayer(e){
    const i=e.detail.value, p=this.data.players[i];
    const recs = this.data.records.filter(r=>r.player_id===p.id).sort((a,b)=>new Date(a.recorded_at)-new Date(b.recorded_at));
    const opts = recs.map(r => (new Date(r.recorded_at).toLocaleString()) + ' 武' + r.merit);
    this.setData({ selPid:p.id, recs, recOptions:opts, startIdx:0, endIdx:recs.length?recs.length-1:-1, result:null });
  },
  pickStart(e){ this.setData({ startIdx:Number(e.detail.value) }); },
  pickEnd(e){ this.setData({ endIdx:Number(e.detail.value) }); },
  calc(){
    const { recs, startIdx, endIdx } = this.data;
    if (startIdx < 0 || endIdx < 0 || startIdx === endIdx) { this.setData({ result:null }); return; }
    const s=recs[startIdx], e=recs[endIdx];
    const sign = n => (n>0?'+':'')+n;
    this.setData({ result:{
      dMerit: sign(e.merit-s.merit), dPower: sign(e.power-s.power),
      dCt: sign(e.contribution_total-s.contribution_total), dCw: sign(e.contribution_week-s.contribution_week),
      start: recOptions[startIdx], end: recOptions[endIdx]
    }});
  }
});

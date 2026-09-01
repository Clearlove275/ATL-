const store = require('../../utils/store');
const KEYS = { merit:'merit', power:'power', ct:'contribution_total', cw:'contribution_week' };
const LABELS = { merit:'武勋', power:'势力值', ct:'贡献总量', cw:'贡献周量' };
Page({
  data: { aid:'', metric:'merit', metricLabel:'武勋', ranking:[], players:[], selPid:'', trendRecs:[] },
  onLoad(o){ this.setData({ aid:o.id }); this.load(); },
  async load(){
    const [players, records] = await Promise.all([store.players.list(this.data.aid), store.records.list(this.data.aid)]);
    const byP={}; (records||[]).forEach(r=>{ (byP[r.player_id]=byP[r.player_id]||[]).push(r); });
    const roster=(players||[]).map(p=>{ const rs=(byP[p.id]||[]).sort((a,b)=>new Date(a.recorded_at)-new Date(b.recorded_at)); const last=rs.length?rs[rs.length-1]:null; return { id:p.id, game_name:p.game_name, merit:last?last.merit:0, power:last?last.power:0, ct:last?last.contribution_total:0, cw:last?last.contribution_week:0 }; });
    this.setData({ players:roster, records: records || [] });
    this.buildRanking();
  },
  setMetric(e){ this.setData({ metric:e.currentTarget.dataset.m, metricLabel:LABELS[e.currentTarget.dataset.m] }); this.buildRanking(); },
  buildRanking(){
    const k=KEYS[this.data.metric];
    const list=this.data.players.slice().sort((a,b)=>b[k]-a[k]).slice(0,10);
    const max=Math.max.apply(null, list.map(x=>x[k]).concat([1]));
    const ranking=list.map(x=>({ id:x.id, name:x.game_name, val:x[k], pct: Math.round(x[k]/max*100) }));
    this.setData({ ranking });
  },
  pickTrend(e){
    const i=e.detail.value, p=this.data.players[i];
    const recs=this.data.records ? this.data.records.filter(r=>r.player_id===p.id).sort((a,b)=>new Date(a.recorded_at)-new Date(b.recorded_at)) : [];
    this.setData({ selPid:p.id, trendRecs:recs }, ()=>this.drawTrend());
  },
  drawTrend(){
    const recs=this.data.trendRecs; if(!recs.length) return;
    const query=wx.createSelectorQuery().in(this);
    query.select('#trendCanvas').fields({ node:true, size:true }).exec(res=>{
      if(!res || !res[0] || !res[0].node) return;
      const canvas=res[0].node, ctx=canvas.getContext('2d');
      const dpr=(wx.getSystemInfoSync && wx.getSystemInfoSync().pixelRatio)||2;
      const w=res[0].width, h=res[0].height;
      canvas.width=w*dpr; canvas.height=h*dpr; ctx.scale(dpr,dpr);
      ctx.clearRect(0,0,w,h);
      const k=KEYS[this.data.metric];
      const vals=recs.map(r=>Number(r[k])||0);
      const max=Math.max.apply(null, vals.concat([1]));
      const pad=14, n=vals.length;
      const stepX = n>1 ? (w-pad*2)/(n-1) : 0;
      const Y = v => h-pad-(v/max)*(h-pad*2);
      ctx.strokeStyle='#ff6b5e'; ctx.lineWidth=2; ctx.beginPath();
      vals.forEach((v,i)=>{ const x=pad+i*stepX, y=Y(v); if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y); });
      ctx.stroke();
      ctx.fillStyle='#ff6b5e';
      vals.forEach((v,i)=>{ ctx.beginPath(); ctx.arc(pad+i*stepX, Y(v), 3, 0, Math.PI*2); ctx.fill(); });
    });
  },
  async pickTrendPlayer(e){ this.pickTrend(e); }
});

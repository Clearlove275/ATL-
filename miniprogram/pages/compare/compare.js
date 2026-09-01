const store = require('../../utils/store');
const sign = n => (n > 0 ? '+' : '') + n;
const pad = n => String(n).padStart(2, '0');
function toTime(dateStr, timeStr) { return new Date(dateStr + 'T' + (timeStr || '00:00')).getTime(); }
function valueAt(recs, timeMs) { if (!recs.length) return null; const before = recs.filter(r => new Date(r.recorded_at).getTime() <= timeMs); if (before.length) return before[before.length - 1]; return recs[0]; }
Page({
  data: { aid:'', players:[], records:[], playerOptions:['全选（全部成员）'], mode:'single', selPid:'', recs:[], recOptions:[], startIdx:-1, endIdx:-1, result:null, allList:[], startDate:'', startTime:'00:00', endDate:'', endTime:'23:59' },
  onLoad(o){ this.setData({ aid:o.id }); this.load(); },
  async load(){
    const [players, records] = await Promise.all([store.players.list(this.data.aid), store.records.list(this.data.aid)]);
    this.setData({ players, records, playerOptions: ['全选（全部成员）'].concat((players||[]).map(p => p.game_name)) });
  },
  pickPlayer(e){
    const i = Number(e.detail.value);
    if (i === 0) { this.setDefaultRange(); this.computeAll(); return; }
    const p = this.data.players[i - 1];
    const recs = this.data.records.filter(r => r.player_id === p.id).sort((a,b) => new Date(a.recorded_at) - new Date(b.recorded_at));
    const opts = recs.map(r => (new Date(r.recorded_at).toLocaleString()) + ' 武' + r.merit);
    this.setData({ mode:'single', selPid:p.id, recs, recOptions:opts, startIdx:0, endIdx:recs.length?recs.length-1:-1, result:null });
  },
  setDefaultRange(){
    const recs = this.data.records || [];
    if (!recs.length) return;
    const times = recs.map(r => new Date(r.recorded_at).getTime());
    const min = new Date(Math.min.apply(null, times)), max = new Date(Math.max.apply(null, times));
    this.setData({
      startDate: min.getFullYear()+'-'+pad(min.getMonth()+1)+'-'+pad(min.getDate()),
      startTime: pad(min.getHours())+':'+pad(min.getMinutes()),
      endDate: max.getFullYear()+'-'+pad(max.getMonth()+1)+'-'+pad(max.getDate()),
      endTime: pad(max.getHours())+':'+pad(max.getMinutes())
    });
  },
  computeAll(){
    const startMs = toTime(this.data.startDate, this.data.startTime);
    const endMs = toTime(this.data.endDate, this.data.endTime);
    const byP = {}; (this.data.records||[]).forEach(r => { (byP[r.player_id] = byP[r.player_id] || []).push(r); });
    const list = (this.data.players||[]).map(p => {
      const rs = (byP[p.id]||[]).sort((a,b) => new Date(a.recorded_at) - new Date(b.recorded_at));
      if (!rs.length) return { name:p.game_name, dMerit:'0', dPower:'0', dCt:'0', dCw:'0' };
      const s = valueAt(rs, startMs), e = valueAt(rs, endMs);
      return { name:p.game_name, dMerit:sign(e.merit-s.merit), dPower:sign(e.power-s.power), dCt:sign(e.contribution_total-s.contribution_total), dCw:sign(e.contribution_week-s.contribution_week) };
    }).sort((a,b) => (parseInt(b.dMerit)||0) - (parseInt(a.dMerit)||0));
    this.setData({ mode:'all', allList:list });
  },
  onStartDate(e){ this.setData({ startDate:e.detail.value }); this.computeAll(); },
  onStartTime(e){ this.setData({ startTime:e.detail.value }); this.computeAll(); },
  onEndDate(e){ this.setData({ endDate:e.detail.value }); this.computeAll(); },
  onEndTime(e){ this.setData({ endTime:e.detail.value }); this.computeAll(); },
  pickStart(e){ this.setData({ startIdx:Number(e.detail.value) }); },
  pickEnd(e){ this.setData({ endIdx:Number(e.detail.value) }); },
  calc(){
    const { recs, startIdx, endIdx } = this.data;
    if (startIdx < 0 || endIdx < 0 || startIdx === endIdx) { this.setData({ result:null }); return; }
    const s = recs[startIdx], e = recs[endIdx];
    this.setData({ result:{ dMerit:sign(e.merit-s.merit), dPower:sign(e.power-s.power), dCt:sign(e.contribution_total-s.contribution_total), dCw:sign(e.contribution_week-s.contribution_week), start:this.data.recOptions[startIdx], end:this.data.recOptions[endIdx] } });
  }
});

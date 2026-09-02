const store = require('../../utils/store');
const sign = n => (n > 0 ? '+' : '') + n;
const pad = n => String(n).padStart(2, '0');
function toTime(dateStr, timeStr) { return new Date(dateStr + 'T' + (timeStr || '00:00')).getTime(); }
function valueAt(recs, timeMs) { if (!recs.length) return null; const before = recs.filter(r => new Date(r.recorded_at).getTime() <= timeMs); if (before.length) return before[before.length - 1]; return recs[0]; }
Page({
  data: { aid:'', players:[], records:[], playerOptions:['全选（全部成员）'], mode:'single', selPid:'', recs:[], recOptions:[], startIdx:-1, endIdx:-1, result:null, allList:[], presets:['前一天','近7天','近30天','全赛季','自定义'], presetValues:['1d','7d','30d','season','custom'], preset:'1d', startDate:'', startTime:'00:00', endDate:'', endTime:'23:59', th:{merit:0,power:0,ct:0,cw:0} },
  onLoad(o){ this.setData({ aid:o.id }); this.load(); },
  async load(){
    const [players, records, all] = await Promise.all([store.players.list(this.data.aid), store.records.list(this.data.aid), store.alliances.get(this.data.aid)]);
    this.setData({ players, records, playerOptions:['全选（全部成员）'].concat((players||[]).map(p=>p.game_name)), th:{ merit:(all&&all.threshold_merit)||0, power:(all&&all.threshold_power)||0, ct:(all&&all.threshold_contrib_total)||0, cw:(all&&all.threshold_contrib_week)||0 } });
  },
  pickPlayer(e){
    const i = Number(e.detail.value);
    if (i === 0) { this.setDefaultRange(); this.computeAll(); return; }
    const p = this.data.players[i-1];
    const recs = this.data.records.filter(r => r.player_id === p.id).sort((a,b)=>new Date(a.recorded_at)-new Date(b.recorded_at));
    const opts = recs.map(r => (new Date(r.recorded_at).toLocaleString()) + ' 武' + r.merit);
    this.setData({ mode:'single', selPid:p.id, recs, recOptions:opts, startIdx:0, endIdx:recs.length?recs.length-1:-1, result:null });
  },
  onPreset(e){ this.setData({ preset: this.data.presetValues[Number(e.detail.value)] }); if (this.data.preset === 'custom') this.setDefaultRange(); this.computeAll(); },
  setDefaultRange(){
    const recs = this.data.records || [];
    if (!recs.length) return;
    const times = recs.map(r => new Date(r.recorded_at).getTime());
    const min = new Date(Math.min.apply(null, times)), max = new Date(Math.max.apply(null, times));
    this.setData({ startDate: min.getFullYear()+'-'+pad(min.getMonth()+1)+'-'+pad(min.getDate()), startTime: pad(min.getHours())+':'+pad(min.getMinutes()), endDate: max.getFullYear()+'-'+pad(max.getMonth()+1)+'-'+pad(max.getDate()), endTime: pad(max.getHours())+':'+pad(max.getMinutes()) });
  },
  computeAll(){
    const preset = this.data.preset, now = Date.now();
    const all = (this.data.records||[]).map(r => new Date(r.recorded_at).getTime());
    const earliest = all.length ? Math.min.apply(null, all) : now;
    const latest = all.length ? Math.max.apply(null, all) : now;
    let start, end;
    if (preset === '1d') { start = now - 86400000; end = now; }
    else if (preset === '7d') { start = now - 7*86400000; end = now; }
    else if (preset === '30d') { start = now - 30*86400000; end = now; }
    else if (preset === 'custom') { start = toTime(this.data.startDate, this.data.startTime); end = toTime(this.data.endDate, this.data.endTime); }
    else { start = earliest; end = latest; }
    const byP = {}; (this.data.records||[]).forEach(r => { (byP[r.player_id] = byP[r.player_id] || []).push(r); });
    const th = this.data.th;
    const list = (this.data.players||[]).map(p => {
      const rs = (byP[p.id]||[]).sort((a,b)=>new Date(a.recorded_at)-new Date(b.recorded_at));
      if (!rs.length) return { name:p.game_name, dMerit:'0', dPower:'0', dCt:'0', dCw:'0', cMerit:'', cPower:'', cCt:'', cCw:'' };
      const s = valueAt(rs, start), e = valueAt(rs, end);
      const dMerit = e.merit - s.merit, dPower = e.power - s.power, dCt = e.contribution_total - s.contribution_total, dCw = e.contribution_week - s.contribution_week;
      return { name:p.game_name, dMerit:sign(dMerit), dPower:sign(dPower), dCt:sign(dCt), dCw:sign(dCw), cMerit: th.merit>0 ? (dMerit>=th.merit?'up':'down') : '', cPower: th.power>0 ? (dPower>=th.power?'up':'down') : '', cCt: th.ct>0 ? (dCt>=th.ct?'up':'down') : '', cCw: th.cw>0 ? (dCw>=th.cw?'up':'down') : '' };
    }).sort((a,b) => (parseInt(b.dMerit)||0) - (parseInt(a.dMerit)||0));
    this.setData({ mode:'all', allList:list });
  },
  onStartDate(e){ this.setData({startDate:e.detail.value}); this.computeAll(); },
  onStartTime(e){ this.setData({startTime:e.detail.value}); this.computeAll(); },
  onEndDate(e){ this.setData({endDate:e.detail.value}); this.computeAll(); },
  onEndTime(e){ this.setData({endTime:e.detail.value}); this.computeAll(); },
  pickStart(e){ this.setData({ startIdx:Number(e.detail.value) }); },
  pickEnd(e){ this.setData({ endIdx:Number(e.detail.value) }); },
  calc(){
    const { recs, startIdx, endIdx } = this.data;
    if (startIdx < 0 || endIdx < 0 || startIdx === endIdx) { this.setData({ result:null }); return; }
    const s = recs[startIdx], e = recs[endIdx];
    this.setData({ result:{ dMerit:sign(e.merit-s.merit), dPower:sign(e.power-s.power), dCt:sign(e.contribution_total-s.contribution_total), dCw:sign(e.contribution_week-s.contribution_week), start:this.data.recOptions[startIdx], end:this.data.recOptions[endIdx] } });
  }
});

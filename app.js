/* ============================================================
 * 率土同盟数据库 · 应用逻辑
 * ============================================================ */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const Store = window.Store;
  const isSupabase = window.STORE_MODE === "supabase";

  const S = {
    user: null,
    alliances: [],
    active: null,       // 当前同盟（含 role）
    myRole: null,
    players: [],
    records: [],
    members: [],
    sortKey: "latest_merit",
    sortDir: "desc",
    deltaPreset: "season",
    preselectPlayer: null,
    unsub: null
  };

  const chartInstances = {};

  /* ---------- 工具 ---------- */
  function toast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2400);
  }
  function safe(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function fmt(n) {
    const v = Number(n) || 0;
    return v.toLocaleString("zh-CN");
  }
  function signed(v) {
    const n = Number(v) || 0;
    return (n > 0 ? "+" : "") + n.toLocaleString("zh-CN");
  }
  function deltaClass(v) {
    return Number(v) > 0 ? "delta-up" : Number(v) < 0 ? "delta-down" : "delta-zero";
  }
  function pad(n) { return String(n).padStart(2, "0"); }
  function toLocalInput(d) {
    const x = new Date(d);
    return x.getFullYear() + "-" + pad(x.getMonth() + 1) + "-" + pad(x.getDate()) + "T" + pad(x.getHours()) + ":" + pad(x.getMinutes());
  }
  function fmtTime(v) {
    if (!v) return "—";
    const d = new Date(v);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function nowLocalInput() {
    return toLocalInput(new Date());
  }
  function isoFromInput(str) {
    if (!str) return null;
    return new Date(str).toISOString();
  }

  /* ---------- 视图切换 ---------- */
  function show(el) { el.classList.remove("hidden"); }
  function hide(el) { el.classList.add("hidden"); }

  function showView(name) {
    document.querySelectorAll("#app > main > .view").forEach((v) => hide(v));
    show($(name + "View"));
  }

  function showTab(name) {
    document.querySelectorAll("#allianceView .tab-view").forEach((v) => v.classList.remove("active"));
    document.querySelectorAll("#allianceTabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
    const el = $(name + "View");
    if (el) el.classList.add("active");
  }

  /* ---------- 登录 / 认证 ---------- */
  let authMode = "login";

  function showAuth() {
    show($("authView"));
    hide($("app"));
    $("authMsg").textContent = "";
  }

  function enterApp(user) {
    if (!user) return;
    if (S.user && S.user.id === user.id) return;
    S.user = user;
    hide($("authView"));
    show($("app"));
    $("topUser").textContent = user.email || "已登录";
    refreshAlliances().then(() => showView("home"));
  }

  function exitApp() {
    S.user = null;
    S.active = null;
    S.myRole = null;
    if (S.unsub) { try { S.unsub(); } catch (e) {} S.unsub = null; }
    showAuth();
  }

  /* ---------- 同盟列表 ---------- */
  async function refreshAlliances() {
    try {
      S.alliances = await Store.alliances.list();
    } catch (e) {
      toast("加载同盟失败：" + e.message);
      S.alliances = [];
    }
    renderAlliances();
  }

  function renderAlliances() {
    const box = $("allianceList");
    $("allianceCount").textContent = S.alliances.length + " 个";
    if (!S.alliances.length) {
      box.innerHTML = '<div class="muted" style="padding:10px">还没有加入任何同盟，请先创建或加入。</div>';
      return;
    }
    box.innerHTML = S.alliances.map((a) => {
      const roleName = a.role === "owner" ? "盟主" : a.role === "admin" ? "管理" : "成员";
      return '<div class="alliance-card" data-aid="' + a.id + '">' +
        '<span class="role">' + roleName + '</span>' +
        '<h4>' + safe(a.name) + '</h4>' +
        '<div class="meta">' + safe(a.season || "") + '</div>' +
        '<div class="meta">邀请码：' + safe(a.invite_code || "") + '</div>' +
      '</div>';
    }).join("");
  }

  /* ---------- 进入同盟 ---------- */
  async function openAlliance(allianceId) {
    const a = S.alliances.find((x) => x.id === allianceId);
    if (!a) return;
    S.active = a;
    S.myRole = a.role;
    S.deltaPreset = "season";
    S.sortKey = "latest_merit";
    S.sortDir = "desc";
    S.preselectPlayer = null;

    $("allianceTitle").textContent = a.name;
    $("allianceMeta").textContent = (a.season || "") + " · 邀请码 " + (a.invite_code || "");
    $("rolePill").textContent = a.role === "owner" ? "盟主" : a.role === "admin" ? "管理" : "成员";
    showView("alliance");
    showTab("dashboard");

    if (S.unsub) { try { S.unsub(); } catch (e) {} S.unsub = null; }
    S.unsub = Store.subscribe(a.id, () => { loadAllianceData(); });

    await loadAllianceData();
  }

  async function loadAllianceData() {
    if (!S.active) return;
    const aid = S.active.id;
    try {
      const [players, records, members, role] = await Promise.all([
        Store.players.list(aid),
        Store.records.list(aid),
        Store.members.list(aid),
        Store.myRole(aid)
      ]);
      S.players = players;
      S.records = records;
      S.members = members;
      S.myRole = role || S.active.role;
      $("rolePill").textContent = S.myRole === "owner" ? "盟主" : S.myRole === "admin" ? "管理" : "成员";
    } catch (e) {
      toast("加载数据失败：" + e.message);
    }
    renderActive();
  }

  function renderActive() {
    const tab = document.querySelector("#allianceView .tab-view.active");
    const name = tab ? tab.id.replace("View", "") : "dashboard";
    if (name === "dashboard") renderDashboard();
    else if (name === "import") renderImport();
    else if (name === "roster") renderRoster();
    else if (name === "compare") renderCompare();
    else if (name === "charts") renderCharts();
    else if (name === "settings") renderSettings();
  }
  /* ---------- 记录与变化值计算 ---------- */
  function recordsOf(pid) {
    return S.records
      .filter((r) => r.player_id === pid)
      .sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at));
  }
  function latestOf(recs) { return recs.length ? recs[recs.length - 1] : null; }

  // 取在 time 之前最近一次快照；若时间早于所有快照，则取最早一条
  function valueAt(recs, timeMs) {
    if (!recs.length) return null;
    const before = recs.filter((r) => new Date(r.recorded_at).getTime() <= timeMs);
    if (before.length) return before[before.length - 1];
    return recs[0];
  }

  function getDeltaTimes() {
    const all = S.records;
    if (!all.length) return { start: null, end: null };
    const times = all.map((r) => new Date(r.recorded_at).getTime());
    const earliest = Math.min.apply(null, times);
    const latest = Math.max.apply(null, times);
    if (S.deltaPreset === "7d") return { start: Date.now() - 7 * 86400000, end: Date.now() };
    if (S.deltaPreset === "30d") return { start: Date.now() - 30 * 86400000, end: Date.now() };
    if (S.deltaPreset === "custom") {
      const s = $("deltaStart").value, e = $("deltaEnd").value;
      if (s && e && new Date(s).getTime() <= new Date(e).getTime()) {
        return { start: new Date(s).getTime(), end: new Date(e).getTime() };
      }
    }
    return { start: earliest, end: latest };
  }

  function playerAgg(p) {
    const recs = recordsOf(p.id);
    const latest = latestOf(recs);
    const range = getDeltaTimes();
    let dMerit = 0, dPower = 0, dContribTotal = 0, dContribWeek = 0;
    if (latest && range.start != null && range.end != null) {
      const sv = valueAt(recs, range.start);
      const ev = valueAt(recs, range.end);
      dMerit = (ev ? Number(ev.merit) : 0) - (sv ? Number(sv.merit) : 0);
      dPower = (ev ? Number(ev.power) : 0) - (sv ? Number(sv.power) : 0);
      dContribTotal = (ev ? Number(ev.contribution_total) : 0) - (sv ? Number(sv.contribution_total) : 0);
      dContribWeek = (ev ? Number(ev.contribution_week) : 0) - (sv ? Number(sv.contribution_week) : 0);
    }
    return {
      p,
      recs,
      latest,
      count: recs.length,
      latestMerit: latest ? Number(latest.merit) : 0,
      latestPower: latest ? Number(latest.power) : 0,
      latestContribTotal: latest ? Number(latest.contribution_total) : 0,
      latestContribWeek: latest ? Number(latest.contribution_week) : 0,
      latestTime: latest ? latest.recorded_at : null,
      dMerit, dPower, dContribTotal, dContribWeek
    };
  }

  /* ---------- 数据看板 ---------- */
  function renderDashboard() {
    const aggs = S.players.map(playerAgg);
    $("statPlayers").textContent = S.players.length;
    $("statRecords").textContent = S.records.length;
    $("statTopMerit").textContent = aggs.length ? fmt(Math.max.apply(null, aggs.map((a) => a.latestMerit))) : "—";
    $("statTopPower").textContent = aggs.length ? fmt(Math.max.apply(null, aggs.map((a) => a.latestPower))) : "—";

    const merit = aggs.filter((a) => a.latest).slice().sort((a, b) => b.latestMerit - a.latestMerit).slice(0, 10);
    const power = aggs.filter((a) => a.latest).slice().sort((a, b) => b.latestPower - a.latestPower).slice(0, 10);

    $("meritRank").innerHTML = rankList(merit, (a) => a.latestMerit);
    $("powerRank").innerHTML = rankList(power, (a) => a.latestPower);
  }

  function rankList(list, valFn) {
    if (!list.length) return '<div class="muted" style="padding:8px">暂无数据</div>';
    return list.map((a, i) =>
      '<div class="rank-row"><span class="rank-number ' + (i < 3 ? "top" : "") + '">' + (i + 1) + '</span>' +
      '<span class="rank-name">' + safe(a.p.game_name) + '</span>' +
      '<span class="rank-val">' + fmt(valFn(a)) + '</span></div>'
    ).join("");
  }

  /* ---------- 导入数据 ---------- */
  function renderImport() {
    const sel = $("recordPlayer");
    const prev = S.preselectPlayer || sel.value;
    sel.innerHTML = '<option value="">请选择玩家</option>' + S.players.map((p) =>
      '<option value="' + p.id + '">' + safe(p.game_name) + '</option>'
    ).join("");
    if (prev) sel.value = prev;
    if (!S.preselectPlayer) S.preselectPlayer = null;
    if (!$("recordTime").value) $("recordTime").value = nowLocalInput();
  }

  /* ---------- 成员数据（排序 + 变化值） ---------- */
  function rosterRows() {
    const q = ($("playerSearch").value || "").trim().toLowerCase();
    let aggs = S.players.map(playerAgg);
    if (q) aggs = aggs.filter((a) => (a.p.game_name + " " + a.p.team + " " + a.p.duty).toLowerCase().includes(q));
    const key = S.sortKey, dir = S.sortDir === "asc" ? 1 : -1;
    const keyMap = {
      latest_merit: "latestMerit",
      latest_power: "latestPower",
      latest_contrib_total: "latestContribTotal",
      latest_contrib_week: "latestContribWeek",
      delta_merit: "dMerit",
      delta_power: "dPower",
      delta_contrib_total: "dContribTotal",
      delta_contrib_week: "dContribWeek",
      count: "count"
    };
    aggs.sort((a, b) => {
      if (key === "game_name") return (a.p.game_name || "").localeCompare(b.p.game_name || "", "zh") * dir;
      if (key === "team") return (a.p.team || "").localeCompare(b.p.team || "", "zh") * dir;
      const prop = keyMap[key];
      const va = a[prop], vb = b[prop];
      return (Number(va) - Number(vb)) * dir;
    });
    return aggs;
  }

  function renderRoster() {
    const aggs = rosterRows();
    $("rosterBody").innerHTML = aggs.length ? aggs.map((a, i) =>
      '<tr>' +
      '<td>' + (i + 1) + '</td>' +
      '<td><span class="table-name">' + safe(a.p.game_name) + '</span><br><span class="muted">' + safe(a.p.duty || "—") + '</span></td>' +
      '<td>' + safe(a.p.team || "—") + '</td>' +
      '<td class="num">' + fmt(a.latestMerit) + '</td>' +
      '<td class="num">' + fmt(a.latestPower) + '</td>' +
      '<td class="num">' + fmt(a.latestContribTotal) + '</td>' +
      '<td class="num">' + fmt(a.latestContribWeek) + '</td>' +
      '<td class="' + deltaClass(a.dMerit) + '">' + signed(a.dMerit) + '</td>' +
      '<td class="' + deltaClass(a.dPower) + '">' + signed(a.dPower) + '</td>' +
      '<td class="' + deltaClass(a.dContribTotal) + '">' + signed(a.dContribTotal) + '</td>' +
      '<td class="' + deltaClass(a.dContribWeek) + '">' + signed(a.dContribWeek) + '</td>' +
      '<td class="num">' + a.count + '</td>' +
      '<td>' +
        '<button class="link-button" data-addrec="' + a.p.id + '">录入</button>' +
        '<button class="link-button" data-editp="' + a.p.id + '">编辑</button>' +
        '<button class="link-button danger" data-delp="' + a.p.id + '">删除</button>' +
      '</td>' +
      '</tr>'
    ).join("") : '<tr><td colspan="13" class="muted" style="text-align:center;padding:16px">还没有玩家，点击右上角「+ 新增玩家」。</td></tr>';

    // 表头排序状态
    document.querySelectorAll("#rosterTable th[data-sort]").forEach((th) => {
      th.classList.remove("sort-asc", "sort-desc");
      if (th.dataset.sort === S.sortKey) th.classList.add(S.sortDir === "asc" ? "sort-asc" : "sort-desc");
    });

    const range = getDeltaTimes();
    $("rosterSummary").textContent = "共 " + aggs.length + " 名玩家 · 变化值区间：" +
      (range.start ? fmtTime(range.start) : "—") + " → " + (range.end ? fmtTime(range.end) : "—");
    syncDeltaInputs(range);
  }

  function syncDeltaInputs(range) {
    if (range.start) $("deltaStart").value = toLocalInput(range.start);
    if (range.end) $("deltaEnd").value = toLocalInput(range.end);
  }

  /* ---------- 变化值对比 ---------- */
  function renderCompare() {
    const sel = $("comparePlayer");
    const prevId = sel.value;
    sel.innerHTML = '<option value="">请选择玩家</option>' + S.players.map((p) =>
      '<option value="' + p.id + '">' + safe(p.game_name) + '</option>'
    ).join("");
    if (prevId && S.players.some((p) => p.id === prevId)) sel.value = prevId;
    renderCompareDetail(sel.value);
  }

  function renderCompareDetail(pid) {
    const startSel = $("compareStart"), endSel = $("compareEnd");
    const records = pid ? recordsOf(pid) : [];
    const opt = (r) => '<option value="' + r.id + '">' + fmtTime(r.recorded_at) + ' · 武勋 ' + fmt(r.merit) + ' · 势力 ' + fmt(r.power) + ' · 贡献 ' + fmt(r.contribution_total) + '</option>';
    startSel.innerHTML = records.map(opt).join("");
    endSel.innerHTML = records.map(opt).join("");
    $("compareCount").textContent = records.length + " 条快照";
    if (records.length) { startSel.value = records[0].id; endSel.value = records[records.length - 1].id; }

    $("compareRecords").innerHTML = records.length ? records.slice().reverse().map((r) =>
      '<tr>' +
      '<td>' + fmtTime(r.recorded_at) + '</td>' +
      '<td class="num">' + fmt(r.merit) + '</td>' +
      '<td class="num">' + fmt(r.power) + '</td>' +
      '<td class="num">' + fmt(r.contribution_total) + '</td>' +
      '<td class="num">' + fmt(r.contribution_week) + '</td>' +
      '<td>' + (r.source === "ocr" ? "截图识别" : "手动") + '</td>' +
      '<td>' + safe(r.note || "—") + '</td>' +
      '<td><button class="link-button danger" data-delrec="' + r.id + '">删除</button></td>' +
      '</tr>'
    ).join("") : '<tr><td colspan="8" class="muted" style="text-align:center;padding:16px">该玩家还没有任何记录。</td></tr>';

    updateCompareResult();
  }

  function compareCard(title, time, merit, power, contribTotal, contribWeek) {
    return '<div class="compare-card"><span>' + title + '</span>' +
      '<strong>武勋 ' + merit + '</strong>' +
      '<strong>势力 ' + power + '</strong>' +
      '<strong>贡献总量 ' + contribTotal + '</strong>' +
      '<strong>贡献周量 ' + contribWeek + '</strong>' +
      '<div class="time">' + time + '</div></div>';
  }

  /* ---------- 变化值结果（供下拉变化事件调用，避免重建选项） ---------- */
  function updateCompareResult() {
    const pid = $("comparePlayer").value;
    const records = pid ? recordsOf(pid) : [];
    const s = records.find((r) => r.id === $("compareStart").value);
    const e = records.find((r) => r.id === $("compareEnd").value);
    if (s && e) {
      const dM = Number(e.merit) - Number(s.merit);
      const dP = Number(e.power) - Number(s.power);
      const dCT = Number(e.contribution_total) - Number(s.contribution_total);
      const dCW = Number(e.contribution_week) - Number(s.contribution_week);
      $("compareResult").innerHTML =
        compareCard("起始快照", fmtTime(s.recorded_at), fmt(s.merit), fmt(s.power), fmt(s.contribution_total), fmt(s.contribution_week)) +
        compareCard("结束快照", fmtTime(e.recorded_at), fmt(e.merit), fmt(e.power), fmt(e.contribution_total), fmt(e.contribution_week)) +
        '<div class="compare-card"><span>变化值（结束 − 起始）</span>' +
        '<strong class="' + deltaClass(dM) + '">武勋 ' + signed(dM) + '</strong>' +
        '<strong class="' + deltaClass(dP) + '">势力 ' + signed(dP) + '</strong>' +
        '<strong class="' + deltaClass(dCT) + '">贡献总量 ' + signed(dCT) + '</strong>' +
        '<strong class="' + deltaClass(dCW) + '">贡献周量 ' + signed(dCW) + '</strong>' +
        '<div class="time">' + fmtTime(s.recorded_at) + ' → ' + fmtTime(e.recorded_at) + '</div></div>';
    } else {
      $("compareResult").innerHTML = '<div class="muted" style="padding:10px">请选择玩家与两次快照。</div>';
    }
  }

  /* ---------- CSV 导出 ---------- */
  function csvEscape(v) {
    const s = String(v == null ? "" : v);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function downloadCsv(filename, rows) {
    const csv = "\uFEFF" + rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 200);
    toast("CSV 已导出");
  }
  function exportRosterCsv() {
    const aggs = rosterRows();
    const rows = [["排名", "游戏昵称", "团组", "职责", "最新武勋", "最新势力值", "最新贡献总量", "最新贡献周量", "最新更新时间", "Δ武勋", "Δ势力值", "Δ贡献总量", "Δ贡献周量", "记录数"]];
    aggs.forEach((a, i) => rows.push([
      i + 1,
      a.p.game_name,
      a.p.team || "",
      a.p.duty || "",
      a.latestMerit,
      a.latestPower,
      a.latestContribTotal,
      a.latestContribWeek,
      fmtTime(a.latestTime),
      a.dMerit,
      a.dPower,
      a.dContribTotal,
      a.dContribWeek,
      a.count
    ]));
    downloadCsv("同盟成员数据.csv", rows);
  }
  function exportRecordsCsv() {
    const pid = $("comparePlayer").value;
    const recs = pid ? recordsOf(pid) : [];
    const player = S.players.find((p) => p.id === pid);
    const rows = [["记录时间", "武勋", "势力值", "贡献总量", "贡献周量", "来源", "备注"]];
    recs.forEach((r) => rows.push([
      fmtTime(r.recorded_at),
      Number(r.merit),
      Number(r.power),
      Number(r.contribution_total) || 0,
      Number(r.contribution_week) || 0,
      r.source === "ocr" ? "截图识别" : "手动",
      r.note || ""
    ]));
    downloadCsv(((player && player.game_name) || "玩家") + "-记录.csv", rows);
  }

  /* ---------- 数据图表 ---------- */
  function destroyChart(name) {
    if (chartInstances[name]) { chartInstances[name].destroy(); chartInstances[name] = null; }
  }
  function chartFallback(wrap) {
    const canvas = wrap.querySelector("canvas");
    if (canvas) canvas.style.display = "none";
    if (!wrap.querySelector(".chart-fallback")) {
      const d = document.createElement("div");
      d.className = "chart-fallback muted";
      d.textContent = "图表组件未加载，请检查网络后刷新。";
      wrap.appendChild(d);
    }
  }
  function renderCharts() {
    const psel = $("chartPlayer");
    const prevPid = psel.value;
    psel.innerHTML = '<option value="">请选择玩家</option>' + S.players.map((p) => '<option value="' + p.id + '">' + safe(p.game_name) + '</option>').join("");
    if (prevPid && S.players.some((p) => p.id === prevPid)) psel.value = prevPid;

    if (!window.Chart) {
      chartFallback($("rankChart").parentElement);
      chartFallback($("trendChart").parentElement);
      return;
    }

    const aggs = S.players.map(playerAgg);
    const metricMap = {
      merit: { label: "武勋", key: "latestMerit" },
      power: { label: "势力值", key: "latestPower" },
      contrib_total: { label: "贡献总量", key: "latestContribTotal" },
      contrib_week: { label: "贡献周量", key: "latestContribWeek" }
    };
    const metric = metricMap[$("chartMetric").value] || metricMap.merit;
    const metricLabel = metric.label;
    const key = metric.key;
    const topN = parseInt($("chartTop").value, 10) || 0;
    let list = aggs.slice().sort((a, b) => b[key] - a[key]);
    if (topN > 0) list = list.slice(0, topN);

    const rankCanvas = $("rankChart");
    destroyChart("rank");
    chartInstances.rank = new window.Chart(rankCanvas, {
      type: "bar",
      data: {
        labels: list.map((a) => a.p.game_name),
        datasets: [{
          label: metricLabel,
          data: list.map((a) => a[key]),
          backgroundColor: "rgba(224,68,60,.78)",
          borderColor: "#ff6b5e",
          borderWidth: 1,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { color: "#c49da1" } },
          x: { ticks: { color: "#c49da1", maxRotation: 45, autoSkip: true } }
        }
      }
    });

    const pid = psel.value;
    const recs = pid ? recordsOf(pid) : [];
    const trendCanvas = $("trendChart");
    destroyChart("trend");
    chartInstances.trend = new window.Chart(trendCanvas, {
      type: "line",
      data: {
        labels: recs.map((r) => fmtTime(r.recorded_at)),
        datasets: [
          { label: "武勋", data: recs.map((r) => Number(r.merit)), borderColor: "#ff6b5e", backgroundColor: "rgba(255,107,94,.15)", tension: 0.3, yAxisID: "y" },
          { label: "势力值", data: recs.map((r) => Number(r.power)), borderColor: "#ffb24d", backgroundColor: "rgba(255,178,77,.15)", tension: 0.3, yAxisID: "y1" },
          { label: "贡献总量", data: recs.map((r) => Number(r.contribution_total)), borderColor: "#6a8fe8", backgroundColor: "rgba(106,143,232,.15)", tension: 0.3, yAxisID: "y1" },
          { label: "贡献周量", data: recs.map((r) => Number(r.contribution_week)), borderColor: "#3ecf8e", backgroundColor: "rgba(62,207,142,.15)", tension: 0.3, yAxisID: "y" }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          y: { position: "left", beginAtZero: true, ticks: { color: "#c49da1" } },
          y1: { position: "right", beginAtZero: true, grid: { drawOnChartArea: false }, ticks: { color: "#c49da1" } },
          x: { ticks: { color: "#c49da1", maxRotation: 45, autoSkip: true } }
        }
      }
    });
  }
  /* ---------- 同盟设置 ---------- */
  function renderSettings() {
    if (!S.active) return;
    $("settingsName").value = S.active.name || "";
    $("settingsSeason").value = S.active.season || "";
    $("settingsInvite").value = S.active.invite_code || "";

    const canManage = S.myRole === "owner" || S.myRole === "admin";
    $("memberManage").innerHTML = S.members.length ? S.members.map((m) => {
      const roleName = m.role === "owner" ? "盟主" : m.role === "admin" ? "管理" : "成员";
      const editable = canManage && m.role !== "owner";
      const options = ["owner", "admin", "member"].map((r) =>
        '<option value="' + r + '"' + (m.role === r ? " selected" : "") + '>' +
        (r === "owner" ? "盟主" : r === "admin" ? "管理" : "成员") + '</option>'
      ).join("");
      return '<div class="member-row">' +
        '<span class="name">' + safe(m.game_name || ("账号 " + String(m.user_id).slice(0, 8))) + '</span>' +
        (editable
          ? '<select data-role="' + m.id + '">' + options + '</select>' +
            '<button class="link-button danger" data-removemember="' + m.id + '">移除</button>'
          : '<span class="pill">' + roleName + '</span>') +
      '</div>';
    }).join("") : '<div class="muted">暂无成员记录</div>';

    $("leaveAllianceBtn").style.display = S.myRole !== "owner" ? "" : "none";
    $("deleteAllianceBtn").style.display = S.myRole === "owner" ? "" : "none";
  }

  /* ---------- 玩家新增 / 编辑弹窗 ---------- */
  function openPlayerModal(player) {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML =
      '<div class="modal-card"><h3>' + (player ? "编辑玩家" : "新增玩家") + '</h3>' +
      '<label>游戏昵称 *<input id="pmName" value="' + safe(player ? player.game_name : "") + '" placeholder="例如：子龙" /></label>' +
      '<label>团组<input id="pmTeam" value="' + safe(player ? (player.team || "") : "") + '" placeholder="例如：主战团" /></label>' +
      '<label>职责<input id="pmDuty" value="' + safe(player ? (player.duty || "") : "") + '" placeholder="例如：主战 / 拆迁 / 后勤" /></label>' +
      '<div class="modal-actions"><button type="button" class="ghost" id="pmCancel">取消</button>' +
      '<button type="button" class="primary" id="pmSave">保存</button></div></div>';
    document.body.appendChild(overlay);
    overlay.querySelector("#pmCancel").onclick = () => overlay.remove();
    overlay.querySelector("#pmSave").onclick = async () => {
      const name = overlay.querySelector("#pmName").value.trim();
      if (!name) { toast("请输入游戏昵称"); return; }
      const patch = { game_name: name, team: overlay.querySelector("#pmTeam").value.trim(), duty: overlay.querySelector("#pmDuty").value.trim() };
      try {
        if (player) await Store.players.update(S.active.id, player.id, patch);
        else await Store.players.add(S.active.id, patch);
        overlay.remove();
        toast(player ? "玩家已更新" : "玩家已添加");
        loadAllianceData();
      } catch (err) { toast("保存失败：" + err.message); }
    };
  }

  /* ---------- OCR / 录入 ---------- */
  function setImage(file) {
    if (!file) return;
    if (!file.type || !file.type.startsWith("image/")) { toast("请选择图片文件"); return; }
    const url = URL.createObjectURL(file);
    $("preview").src = url;
    $("preview").classList.remove("hidden");
    $("runOcr").disabled = false;
    $("ocrStatus").textContent = "已选择：" + file.name + "，点击「开始识别」。";
  }

  function applyParsed(text) {
    const res = window.OCR.parseAll(text);
    let filled = 0;
    if (res.merit != null) { $("recordMerit").value = res.merit; filled++; }
    if (res.power != null) { $("recordPower").value = res.power; filled++; }
    if (res.contributionTotal != null) { $("recordContribTotal").value = res.contributionTotal; filled++; }
    if (res.contributionWeek != null) { $("recordContribWeek").value = res.contributionWeek; filled++; }
    $("recordSource").value = "ocr";
    $("ocrStatus").textContent = filled ? ("已提取 " + filled + " 项字段，请核对后保存。") : "未能自动提取字段，请手动填写。";
  }

  function toNum(v) {
    if (v == null || v === "") return 0;
    if (typeof v === "number") return Math.round(v);
    const n = window.OCR.parseChineseNumber(String(v));
    if (n != null) return n;
    return Number(String(v).replace(/[^\d.]/g, "")) || 0;
  }

  function applyVisionResult(json) {
    if (!json) return;
    if (Array.isArray(json)) {
      batchRows = json.map((r) => ({
        name: r.name || "",
        merit: toNum(r.merit),
        power: toNum(r.power),
        contributionTotal: toNum(r.contributionTotal),
        contributionWeek: toNum(r.contributionWeek)
      })).filter((r) => r.name);
      renderBatchRows();
    } else {
      if (json.merit != null) $("recordMerit").value = toNum(json.merit);
      if (json.power != null) $("recordPower").value = toNum(json.power);
      if (json.contributionTotal != null) $("recordContribTotal").value = toNum(json.contributionTotal);
      if (json.contributionWeek != null) $("recordContribWeek").value = toNum(json.contributionWeek);
      $("recordSource").value = "ocr";
    }
  }

  async function runOcr() {
    if (!$("preview").src) return;
    const btn = $("runOcr");
    btn.disabled = true;
    const cfg = window.APP_CONFIG || {};
    // 1) 视觉识别后端优先
    if (cfg.visionBackendUrl) {
      try {
        $("ocrStatus").textContent = "正在视觉识别…";
        const data = await window.OCR.recognizeViaBackend($("preview").src, cfg.visionBackendUrl, cfg.supabaseAnonKey || "");
        $("ocrText").value = data.text || "";
        applyVisionResult(data.json);
        $("ocrStatus").textContent = "视觉识别完成，请核对后保存。";
        btn.disabled = false;
        return;
      } catch (err) {
        $("ocrStatus").textContent = "视觉识别失败，改用本地识别…";
      }
    }
    // 2) 回退本地 Tesseract
    if (!window.Tesseract) { $("ocrStatus").textContent = "识别组件未加载，请检查网络后刷新。"; btn.disabled = false; return; }
    try {
      const data = await window.OCR.recognizeImage($("preview").src, (m) => {
        if (m.status === "recognizing text") $("ocrStatus").textContent = "正在识别：" + Math.round(m.progress * 100) + "%";
      });
      $("ocrText").value = data.text || "";
      applyParsed(data.text);
      renderBatch(data);
      $("ocrStatus").textContent = "识别完成，请核对结果后保存。";
    } catch (err) {
      $("ocrStatus").textContent = "识别失败：" + err.message + "（可粘贴文字或手动填写）";
    } finally {
      btn.disabled = false;
    }
  }

  // 批量识别成员列表
  let batchRows = [];
  function renderBatchRows() {
    const panel = $("batchPanel");
    if (!batchRows.length) { panel.classList.add("hidden"); return; }
    panel.classList.remove("hidden");
    $("batchSummary").textContent = batchRows.length + " 行";
    $("batchBody").innerHTML = batchRows.map((r, i) =>
      '<tr>' +
      '<td><input data-batch="name" data-i="' + i + '" value="' + safe(r.name || "") + '" /></td>' +
      '<td><input data-batch="merit" data-i="' + i + '" type="number" min="0" value="' + (r.merit != null ? r.merit : "") + '" /></td>' +
      '<td><input data-batch="power" data-i="' + i + '" type="number" min="0" value="' + (r.power != null ? r.power : "") + '" /></td>' +
      '<td><input data-batch="contributionTotal" data-i="' + i + '" type="number" min="0" value="' + (r.contributionTotal != null ? r.contributionTotal : "") + '" /></td>' +
      '<td><input data-batch="contributionWeek" data-i="' + i + '" type="number" min="0" value="' + (r.contributionWeek != null ? r.contributionWeek : "") + '" /></td>' +
      '<td><button class="link-button danger" data-batchremove="' + i + '">移除</button></td>' +
      '</tr>'
    ).join("");
  }

  function renderBatch(data) {
    const res = window.OCR.parseMemberTable(data);
    batchRows = (res && res.rows) || [];
    renderBatchRows();
  }

  /* ---------- 视频识别 ---------- */
  let videoUrl = null;
  function setVideo(file) {
    if (!file) return;
    if (!file.type || !file.type.startsWith("video/")) { toast("请选择视频文件"); return; }
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    videoUrl = URL.createObjectURL(file);
    const v = $("videoPreview");
    v.src = videoUrl;
    v.classList.remove("hidden");
    $("runVideoOcr").disabled = false;
    $("videoStatus").textContent = "已选择：" + file.name + "，点击「开始识别视频」。";
  }

  function captureFrame(video, time, maxW) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { video.removeEventListener("seeked", onSeek); reject(new Error("视频抽帧超时")); }, 8000);
      const onSeek = () => {
        clearTimeout(timer);
        video.removeEventListener("seeked", onSeek);
        try {
          const scale = Math.min(1, maxW / video.videoWidth);
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
          canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
          canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.85));
        } catch (e) { reject(e); }
      };
      video.addEventListener("seeked", onSeek);
      video.currentTime = time;
    });
  }

  function mergeVisionRows(allRows) {
    const map = new Map();
    const pick = (a, b) => (b == null || b === 0 ? a : b);
    for (const row of allRows) {
      if (!row || !row.name) continue;
      const key = String(row.name).trim();
      if (!key) continue;
      let cur = map.get(key);
      if (!cur) { cur = { name: key, merit: 0, power: 0, contributionTotal: 0, contributionWeek: 0 }; map.set(key, cur); }
      cur.merit = pick(cur.merit, toNum(row.merit));
      cur.power = pick(cur.power, toNum(row.power));
      cur.contributionTotal = pick(cur.contributionTotal, toNum(row.contributionTotal));
      cur.contributionWeek = pick(cur.contributionWeek, toNum(row.contributionWeek));
    }
    return Array.from(map.values());
  }

  async function runVideoOcr() {
    const v = $("videoPreview");
    if (!v.src || !videoUrl) return;
    const cfg = window.APP_CONFIG || {};
    if (!cfg.visionBackendUrl) { $("videoStatus").textContent = "未配置视觉识别后端，请改用截图识别。"; return; }
    const interval = Math.max(0.5, Number($("videoInterval").value) || 2);
    const maxFrames = Math.min(40, Math.max(2, Math.round(Number($("videoMaxFrames").value) || 14)));

    let duration = 0;
    try {
      duration = await new Promise((res, rej) => {
        if (v.readyState >= 1 && isFinite(v.duration)) { res(v.duration); return; }
        v.addEventListener("loadedmetadata", () => res(v.duration), { once: true });
        v.addEventListener("error", () => rej(new Error("视频加载失败")), { once: true });
        v.load();
      });
    } catch (e) { $("videoStatus").textContent = "视频加载失败：" + e.message; return; }
    if (!duration || !isFinite(duration)) { $("videoStatus").textContent = "无法读取视频时长，请更换视频。"; return; }

    const count = Math.max(2, Math.min(maxFrames, Math.floor(duration / interval)));
    const times = Array.from({ length: count }, (_, i) => Math.min(duration - 0.05, interval * (i + 0.5)));

    const btn = $("runVideoOcr");
    btn.disabled = true;
    const allRows = [];
    let okFrames = 0;
    for (let i = 0; i < times.length; i++) {
      $("videoStatus").textContent = "正在识别第 " + (i + 1) + " / " + times.length + " 帧…";
      try {
        const dataUrl = await captureFrame(v, times[i], 1280);
        const data = await window.OCR.recognizeViaBackend(dataUrl, cfg.visionBackendUrl, cfg.supabaseAnonKey || "");
        const arr = Array.isArray(data.json) ? data.json : (data.json ? [data.json] : []);
        allRows.push(...arr);
        okFrames++;
      } catch (e) {
        // 单帧失败继续下一帧
      }
    }
    if (okFrames === 0) {
      $("videoStatus").textContent = "视频识别失败，请重试或改用截图识别。";
      btn.disabled = false;
      return;
    }
    batchRows = mergeVisionRows(allRows);
    renderBatchRows();
    if (batchRows.length) {
      $("batchPanel").classList.remove("hidden");
      $("videoStatus").textContent = "已从 " + okFrames + " 帧识别出 " + batchRows.length + " 名成员，请核对后保存。";
    } else {
      $("videoStatus").textContent = "未识别到成员数据，请调整采样间隔后重试。";
    }
    btn.disabled = false;
  }

  function findPlayerByName(name) {
    const n = (name || "").trim().toLowerCase();
    return S.players.find((p) => (p.game_name || "").trim().toLowerCase() === n);
  }

  async function batchSave() {
    if (!S.active) return;
    const inputs = document.querySelectorAll("#batchBody input[data-batch]");
    const rows = batchRows.map(() => ({ name: "", merit: 0, power: 0, contributionTotal: 0, contributionWeek: 0 }));
    inputs.forEach((inp) => {
      const i = Number(inp.dataset.i);
      const f = inp.dataset.batch;
      if (f === "name") rows[i].name = inp.value;
      else if (f === "merit") rows[i].merit = Number(inp.value) || 0;
      else if (f === "power") rows[i].power = Number(inp.value) || 0;
      else if (f === "contributionTotal") rows[i].contributionTotal = Number(inp.value) || 0;
      else if (f === "contributionWeek") rows[i].contributionWeek = Number(inp.value) || 0;
    });
    const valid = rows.filter((r) => (r.name || "").trim());
    if (!valid.length) { toast("没有可保存的行"); return; }
    const recorded_at = new Date().toISOString();
    let saved = 0;
    try {
      for (const r of valid) {
        let player = findPlayerByName(r.name);
        if (!player) {
          player = await Store.players.add(S.active.id, { game_name: r.name.trim(), team: "", duty: "" });
          S.players.push(player);
        }
        await Store.records.add(S.active.id, {
          player_id: player.id,
          merit: r.merit,
          power: r.power,
          contribution_total: r.contributionTotal,
          contribution_week: r.contributionWeek,
          source: "ocr",
          note: "成员列表批量导入",
          recorded_at
        });
        saved++;
      }
      toast("已批量保存 " + saved + " 条记录");
      batchRows = [];
      $("batchPanel").classList.add("hidden");
      loadAllianceData();
    } catch (err) { toast("保存失败：" + err.message); }
  }

  async function saveRecord(e) {
    e.preventDefault();
    const pid = $("recordPlayer").value;
    if (!pid) { toast("请先选择玩家"); return; }
    const recorded_at = isoFromInput($("recordTime").value);
    if (!recorded_at) { toast("请填写记录时间"); return; }
    try {
      await Store.records.add(S.active.id, {
        player_id: pid,
        merit: Number($("recordMerit").value) || 0,
        power: Number($("recordPower").value) || 0,
        contribution_total: Number($("recordContribTotal").value) || 0,
        contribution_week: Number($("recordContribWeek").value) || 0,
        source: $("recordSource").value,
        note: $("recordNote").value.trim(),
        recorded_at
      });
      $("recordMerit").value = "";
      $("recordPower").value = "";
      $("recordContribTotal").value = "";
      $("recordContribWeek").value = "";
      $("recordNote").value = "";
      $("recordSource").value = "manual";
      toast("记录已保存，并已记录时间");
      loadAllianceData();
    } catch (err) {
      toast("保存失败：" + err.message);
    }
  }

  /* ---------- 事件绑定 ---------- */
  function bindEvents() {
    // 认证
    $("tabLogin").onclick = () => { authMode = "login"; $("tabLogin").classList.add("active"); $("tabSignup").classList.remove("active"); $("authSubmit").textContent = "登录"; $("authMsg").textContent = ""; };
    $("tabSignup").onclick = () => { authMode = "signup"; $("tabSignup").classList.add("active"); $("tabLogin").classList.remove("active"); $("authSubmit").textContent = "注册"; $("authMsg").textContent = ""; };
    $("authForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = $("authEmail").value.trim();
      const pw = $("authPassword").value;
      if (!email || !pw) return;
      if (authMode === "signup" && pw.length < 6) { $("authMsg").textContent = "密码至少 6 位"; return; }
      $("authSubmit").disabled = true;
      const res = authMode === "signup"
        ? await Store.auth.signUp(email, pw)
        : await Store.auth.signIn(email, pw);
      $("authSubmit").disabled = false;
      if (res.error) { $("authMsg").textContent = res.error; return; }
      if (res.user) { enterApp(res.user); }
      else { $("authMsg").textContent = "注册成功。请到邮箱完成验证后登录（或在 Supabase 关闭邮箱验证）。"; }
    });
    $("authLocalDemo").onclick = async () => { const u = await Store.auth.getUser(); if (u) enterApp(u); };

    // 顶栏
    $("homeBtn").onclick = () => { if (S.active) { S.active = null; } showView("home"); refreshAlliances(); };
    $("signOutBtn").onclick = async () => { await Store.auth.signOut(); if (!isSupabase) exitApp(); };

    // 我的同盟
    $("createForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = $("createName").value.trim();
      if (!name) return;
      try {
        const a = await Store.alliances.create(name, $("createSeason").value, $("createGameName").value);
        toast("同盟已创建");
        $("createForm").reset();
        await refreshAlliances();
        openAlliance(a.id);
      } catch (err) { toast("创建失败：" + err.message); }
    });
    $("joinForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const code = $("joinCode").value.trim();
      if (!code) return;
      try {
        const a = await Store.alliances.join(code, $("joinGameName").value);
        toast("已加入同盟");
        $("joinForm").reset();
        await refreshAlliances();
        openAlliance(a.id);
      } catch (err) { toast("加入失败：" + err.message); }
    });

    // 同盟页
    $("backHome").onclick = () => { showView("home"); refreshAlliances(); };
    $("refreshBtn").onclick = () => { loadAllianceData(); };
    $("settingsBtn").onclick = () => { showTab("settings"); renderSettings(); };
    document.querySelectorAll("#allianceTabs button").forEach((b) =>
      b.addEventListener("click", () => { showTab(b.dataset.view); renderActive(); })
    );

    // 看板不需要额外事件

    // 导入
    $("chooseImage").onclick = () => $("imageInput").click();
    $("imageInput").onchange = (e) => setImage(e.target.files[0]);
    const dz = $("dropZone");
    ["dragenter", "dragover"].forEach((n) => dz.addEventListener(n, (e) => { e.preventDefault(); dz.style.borderColor = "var(--gold)"; }));
    ["dragleave", "drop"].forEach((n) => dz.addEventListener(n, (e) => { e.preventDefault(); dz.style.borderColor = ""; }));
    dz.addEventListener("drop", (e) => setImage(e.dataTransfer.files[0]));
    $("runOcr").onclick = runOcr;
    $("pasteText").onclick = () => $("ocrTextWrap").classList.toggle("hidden");
    $("parseText").onclick = () => applyParsed($("ocrText").value);
    $("recordForm").addEventListener("submit", saveRecord);
    $("batchSaveBtn").addEventListener("click", batchSave);

    // 视频识别
    $("chooseVideo").onclick = () => $("videoInput").click();
    $("videoInput").onchange = (e) => setVideo(e.target.files[0]);
    $("runVideoOcr").onclick = runVideoOcr;

    // 成员数据
    $("addPlayerBtn").onclick = () => openPlayerModal(null);
    document.querySelectorAll("#rosterTable th[data-sort]").forEach((th) =>
      th.addEventListener("click", () => {
        const k = th.dataset.sort;
        if (S.sortKey === k) S.sortDir = S.sortDir === "asc" ? "desc" : "asc";
        else { S.sortKey = k; S.sortDir = "desc"; }
        renderRoster();
      })
    );
    $("playerSearch").addEventListener("input", renderRoster);
    $("deltaPreset").addEventListener("change", (e) => {
      S.deltaPreset = e.target.value;
      $("deltaStart").disabled = e.target.value !== "custom";
      $("deltaEnd").disabled = e.target.value !== "custom";
      renderRoster();
    });
    $("deltaStart").addEventListener("change", () => { S.deltaPreset = "custom"; $("deltaPreset").value = "custom"; $("deltaStart").disabled = false; $("deltaEnd").disabled = false; renderRoster(); });
    $("deltaEnd").addEventListener("change", () => { S.deltaPreset = "custom"; $("deltaPreset").value = "custom"; $("deltaStart").disabled = false; $("deltaEnd").disabled = false; renderRoster(); });

    // 变化值对比
    $("comparePlayer").addEventListener("change", (e) => renderCompareDetail(e.target.value));
    $("compareStart").addEventListener("change", updateCompareResult);
    $("compareEnd").addEventListener("change", updateCompareResult);

    // 图表与导出
    $("chartMetric").addEventListener("change", renderCharts);
    $("chartTop").addEventListener("change", renderCharts);
    $("chartPlayer").addEventListener("change", renderCharts);
    $("exportCsvBtn").addEventListener("click", exportRosterCsv);
    $("exportRecordsCsv").addEventListener("click", exportRecordsCsv);

    // 设置
    $("allianceSettingsForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = $("settingsName").value.trim();
      if (!name) return;
      try {
        await Store.alliances.update(S.active.id, { name, season: $("settingsSeason").value });
        S.active.name = name;
        S.active.season = $("settingsSeason").value;
        $("allianceTitle").textContent = name;
        $("allianceMeta").textContent = ($("settingsSeason").value || "") + " · 邀请码 " + (S.active.invite_code || "");
        $("topSeason").textContent = $("settingsSeason").value || "武勋 / 势力值统计";
        toast("已保存");
        refreshAlliances();
      } catch (err) { toast("保存失败：" + err.message); }
    });
    $("copyInvite").onclick = () => {
      const v = $("settingsInvite").value;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(v).then(() => toast("邀请码已复制")).catch(() => toast("邀请码：" + v));
      } else { toast("邀请码：" + v); }
    };
    $("leaveAllianceBtn").onclick = async () => {
      if (!confirm("确定退出该同盟？")) return;
      await Store.alliances.leave(S.active.id);
      toast("已退出同盟");
      S.active = null;
      showView("home");
      refreshAlliances();
    };
    $("deleteAllianceBtn").onclick = async () => {
      if (!confirm("确定删除该同盟及其全部数据？此操作不可恢复！")) return;
      await Store.alliances.remove(S.active.id);
      toast("同盟已删除");
      S.active = null;
      showView("home");
      refreshAlliances();
    };

    // 动态点击委托
    document.addEventListener("click", async (e) => {
      const t = e.target.closest("[data-aid],[data-addrec],[data-editp],[data-delp],[data-delrec],[data-removemember],[data-batchremove]");
      if (!t) return;
      if (t.hasAttribute("data-aid")) { openAlliance(t.dataset.aid); return; }
      if (t.hasAttribute("data-addrec")) { S.preselectPlayer = t.dataset.addrec; $("recordSource").value = "manual"; showTab("import"); renderImport(); toast("请填写该玩家的武勋 / 势力值并保存"); return; }
      if (t.hasAttribute("data-editp")) { const p = S.players.find((x) => x.id === t.dataset.editp); if (p) openPlayerModal(p); return; }
      if (t.hasAttribute("data-delp")) {
        const p = S.players.find((x) => x.id === t.dataset.delp);
        if (p && confirm("删除玩家「" + p.game_name + "」及其全部记录？")) {
          await Store.players.remove(S.active.id, p.id); toast("已删除"); loadAllianceData();
        }
        return;
      }
      if (t.hasAttribute("data-delrec")) {
        if (confirm("删除这条记录？")) {
          await Store.records.remove(S.active.id, t.dataset.delrec); toast("已删除"); loadAllianceData();
        }
        return;
      }
      if (t.hasAttribute("data-removemember")) {
        if (confirm("移除该成员的账号权限？")) {
          await Store.members.remove(S.active.id, t.dataset.removemember); toast("已移除"); loadAllianceData();
        }
        return;
      }
      if (t.hasAttribute("data-batchremove")) {
        batchRows.splice(Number(t.dataset.batchremove), 1);
        renderBatchRows();
        return;
      }
    });
    document.addEventListener("change", async (e) => {
      const t = e.target;
      if (t.matches("[data-role]")) {
        await Store.members.setRole(S.active.id, t.dataset.role, t.value);
        toast("权限已更新");
        loadAllianceData();
      }
    });
  }

  /* ---------- 初始化 ---------- */
  async function init() {
    bindEvents();
    if (!isSupabase) {
      $("signOutBtn").classList.add("hidden");
      const u = await Store.auth.getUser();
      enterApp(u);
    } else {
      $("authLocalDemo").classList.add("hidden");
      document.querySelector(".auth-divider").classList.add("hidden");
      const u = await Store.auth.getUser();
      if (u) enterApp(u); else showAuth();
    }
    Store.auth.onAuthChange((u) => { if (u) enterApp(u); else exitApp(); });
    $("deltaStart").disabled = true;
    $("deltaEnd").disabled = true;
  }

  init();
})();

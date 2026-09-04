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
  function loadRemembered() {
    try { const s = JSON.parse(localStorage.getItem("atl_remembered") || "null"); return (s && s.email) ? s : null; } catch (e) { return null; }
  }
  function saveRemembered(email, pw, remember) {
    try { if (remember) localStorage.setItem("atl_remembered", JSON.stringify({ email: email, password: pw })); else localStorage.removeItem("atl_remembered"); } catch (e) {}
  }
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
    S.deltaPreset = "1d";
    if ($("deltaPreset")) $("deltaPreset").value = "1d";
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
    if (S.deltaPreset === "1d") return { start: Date.now() - 86400000, end: Date.now() };
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

  function myUserId() {
    if (S.user && S.user.id) return S.user.id;
    try {
      const u = Store.myUser && Store.myUser();
      if (u && !u.then && u.id) return u.id;
    } catch (e) {}
    return null;
  }

  function canManagePlayers() {
    return S.myRole === "owner" || S.myRole === "admin";
  }

  /* ---------- 导入数据 ---------- */
  function renderImport() {
    const sel = $("recordPlayer");
    const myId = myUserId();
    const myPlayer = myId ? S.players.find((p) => p.user_id === myId) : null;
    const can = canManagePlayers();
    const options = can ? S.players : (myPlayer ? [myPlayer] : []);
    const prev = S.preselectPlayer || (myPlayer && myPlayer.id) || sel.value;
    sel.innerHTML = '<option value="">请选择玩家</option>' + options.map((p) =>
      '<option value="' + p.id + '">' + safe(p.game_name) + '</option>'
    ).join("");
    if (prev && options.some((p) => p.id === prev)) sel.value = prev;
    if (!S.preselectPlayer) S.preselectPlayer = null;
    if (!$("recordTime").value) $("recordTime").value = nowLocalInput();
    const note = $("importRoleNote");
    if (note) note.textContent = can ? "你是盟主 / 管理，可录入任意成员的武勋、势力值与贡献数据。" : "你只能录入自己的数据（已自动选中你的角色）。";
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
      '<td><span class="table-name">' + safe(a.p.game_name) + '</span>' + (a.p.user_id === myUserId() ? '<span class="pill me">我</span>' : '') + (a.p.duty ? '<br><span class="muted">' + safe(a.p.duty) + '</span>' : '') + '</td>' +
      '<td>' + safe(a.p.team || "—") + '</td>' +
      '<td class="num">' + fmt(a.latestMerit) + '</td>' +
      '<td class="num">' + fmt(a.latestPower) + '</td>' +
      '<td class="num">' + fmt(a.latestContribTotal) + '</td>' +
      '<td class="num">' + fmt(a.latestContribWeek) + '</td>' +
      '<td class="' + thresholdClass(a.dMerit, (S.active && S.active.threshold_merit) || 0) + '">' + signed(a.dMerit) + '</td>' +
      '<td class="' + thresholdClass(a.dPower, (S.active && S.active.threshold_power) || 0) + '">' + signed(a.dPower) + '</td>' +
      '<td class="' + thresholdClass(a.dContribTotal, (S.active && S.active.threshold_contrib_total) || 0) + '">' + signed(a.dContribTotal) + '</td>' +
      '<td class="' + thresholdClass(a.dContribWeek, (S.active && S.active.threshold_contrib_week) || 0) + '">' + signed(a.dContribWeek) + '</td>' +
      '<td class="num">' + a.count + '</td>' +
      '<td>' +
        '<button class="link-button" data-addrec="' + a.p.id + '">录入</button>' +
        '<button class="link-button" data-editp="' + a.p.id + '">编辑</button>' +
        (canManagePlayers()
          ? '<button class="link-button" data-merge="' + a.p.id + '">合并</button>'
          : (a.p.user_id === myUserId() ? '<button class="link-button" data-merge="' + a.p.id + '">继承旧数据</button>' : '')) +
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
  function thresholdClass(delta, threshold) {
    if (threshold > 0) return Number(delta) >= threshold ? "delta-up" : "delta-down";
    return deltaClass(delta);
  }
  function getCompareRange() {
    const preset = $("comparePreset").value;
    const now = Date.now();
    const all = S.records.map((r) => new Date(r.recorded_at).getTime());
    const earliest = all.length ? Math.min.apply(null, all) : now;
    const latest = all.length ? Math.max.apply(null, all) : now;
    if (preset === "1d") return { start: now - 86400000, end: now };
    if (preset === "7d") return { start: now - 7 * 86400000, end: now };
    if (preset === "30d") return { start: now - 30 * 86400000, end: now };
    if (preset === "custom") {
      const s = $("compareRangeStart").value, e = $("compareRangeEnd").value;
      return { start: s ? new Date(s).getTime() : earliest, end: e ? new Date(e).getTime() : latest };
    }
    return { start: earliest, end: latest };
  }
  function compareAgg(p, range) {
    const recs = recordsOf(p.id);
    const latest = latestOf(recs);
    const sv = valueAt(recs, range.start), ev = valueAt(recs, range.end);
    return {
      p, count: recs.length,
      latestMerit: latest ? Number(latest.merit) : 0,
      latestPower: latest ? Number(latest.power) : 0,
      latestContribTotal: latest ? Number(latest.contribution_total) : 0,
      latestContribWeek: latest ? Number(latest.contribution_week) : 0,
      dMerit: (ev ? Number(ev.merit) : 0) - (sv ? Number(sv.merit) : 0),
      dPower: (ev ? Number(ev.power) : 0) - (sv ? Number(sv.power) : 0),
      dContribTotal: (ev ? Number(ev.contribution_total) : 0) - (sv ? Number(sv.contribution_total) : 0),
      dContribWeek: (ev ? Number(ev.contribution_week) : 0) - (sv ? Number(sv.contribution_week) : 0)
    };
  }
  function compareRowHtml(a, i) {
    const th = S.active || {};
    return '<tr>' +
      '<td>' + (i + 1) + '</td>' +
      '<td><span class="table-name">' + safe(a.p.game_name) + '</span>' + (a.p.duty ? '<br><span class="muted">' + safe(a.p.duty) + '</span>' : '') + '</td>' +
      '<td class="' + thresholdClass(a.dMerit, th.threshold_merit || 0) + '">' + signed(a.dMerit) + '</td>' +
      '<td class="' + thresholdClass(a.dPower, th.threshold_power || 0) + '">' + signed(a.dPower) + '</td>' +
      '<td class="' + thresholdClass(a.dContribTotal, th.threshold_contrib_total || 0) + '">' + signed(a.dContribTotal) + '</td>' +
      '<td class="' + thresholdClass(a.dContribWeek, th.threshold_contrib_week || 0) + '">' + signed(a.dContribWeek) + '</td>' +
      '</tr>';
  }
  function renderCompare() {
    const sel = $("comparePlayer");
    const prevId = sel.value;
    sel.innerHTML = '<option value="all">全选（全部成员）</option>' + S.players.map((p) =>
      '<option value="' + p.id + '">' + safe(p.game_name) + '</option>'
    ).join("");
    if (prevId && (prevId === "all" || S.players.some((p) => p.id === prevId))) sel.value = prevId;
    else sel.value = "all";

    const isCustom = $("comparePreset").value === "custom";
    $("compareCustomRange").classList.toggle("hidden", !isCustom);
    if (isCustom && !$("compareRangeStart").value && S.records.length) {
      const times = S.records.map((r) => new Date(r.recorded_at).getTime());
      $("compareRangeStart").value = toLocalInput(Math.min.apply(null, times));
      $("compareRangeEnd").value = toLocalInput(Math.max.apply(null, times));
    }
    const range = getCompareRange();
    const pid = sel.value;
    const list = pid === "all" ? S.players : S.players.filter((p) => p.id === pid);
    const aggs = list.map((p) => compareAgg(p, range)).sort((a, b) => b.dMerit - a.dMerit);

    const box = $("compareResult");
    if (!aggs.length) { box.innerHTML = '<div class="muted" style="padding:10px">暂无数据</div>'; }
    else {
      box.innerHTML = '<table class="compare-table"><thead><tr><th>#</th><th>玩家</th><th>Δ武勋</th><th>Δ势力值</th><th>Δ贡献总量</th><th>Δ贡献周量</th></tr></thead><tbody>' +
        aggs.map(compareRowHtml).join("") + '</tbody></table>';
    }

    if (pid !== "all") {
      const records = recordsOf(pid);
      $("compareCount").textContent = records.length + " 条快照";
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
    } else {
      $("compareCount").textContent = "";
      $("compareRecords").innerHTML = '<tr><td colspan="8" class="muted" style="text-align:center;padding:16px">已选择「全选」，上方为全体成员数据。</td></tr>';
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
    $("thMerit").value = S.active.threshold_merit || 0;
    $("thPower").value = S.active.threshold_power || 0;
    $("thContribTotal").value = S.active.threshold_contrib_total || 0;
    $("thContribWeek").value = S.active.threshold_contrib_week || 0;

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

  /* ---------- 合并玩家数据（改名继承） ---------- */
  function openMergeModal(targetId) {
    const target = S.players.find((p) => p.id === targetId);
    if (!target) return;
    const can = canManagePlayers();
    const myId = myUserId();
    const sources = S.players.filter((p) => p.id !== targetId && (can || p.user_id === myId || !p.user_id));
    if (!sources.length) { toast("没有可合并的数据来源"); return; }
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML =
      '<div class="modal-card"><h3>合并玩家数据</h3>' +
      '<p class="muted">把下面玩家的全部记录合并到 <b>' + safe(target.game_name) + '</b>，合并后该来源玩家会被移除。</p>' +
      '<label>数据来源<select id="mergeFrom">' + sources.map((p) => '<option value="' + p.id + '">' + safe(p.game_name) + (p.user_id ? '' : '（未认领）') + '</option>').join("") + '</select></label>' +
      '<div class="modal-actions"><button type="button" class="ghost" id="mergeCancel">取消</button>' +
      '<button type="button" class="primary" id="mergeOk">合并</button></div></div>';
    document.body.appendChild(overlay);
    overlay.querySelector("#mergeCancel").onclick = () => overlay.remove();
    overlay.querySelector("#mergeOk").onclick = async () => {
      const from = overlay.querySelector("#mergeFrom").value;
      if (!from) return;
      try {
        await Store.players.merge(S.active.id, from, targetId);
        overlay.remove();
        toast("已合并数据");
        loadAllianceData();
      } catch (e) { toast("合并失败：" + e.message); }
    };
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

    const count = Math.min(24, Math.max(2, Math.round(duration / 2)));
    const times = Array.from({ length: count }, (_, i) => Math.min(duration - 0.05, (duration / count) * (i + 0.5)));

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

  /* ---------- Excel / CSV 导入 ---------- */
  const COL_ALIASES = {
    name: ["成员", "玩家", "名称", "昵称", "游戏昵称", "member", "name"],
    merit: ["武勋", "功勋", "本周功勋", "战功", "merit"],
    power: ["势力值", "势力", "power"],
    contributionTotal: ["贡献总量", "贡献总", "累计贡献", "总贡献", "contributiontotal"],
    contributionWeek: ["贡献周量", "贡献周", "周贡献", "周量", "contributionweek"]
  };
  function normCell(v) { return String(v == null ? "" : v).trim().toLowerCase().replace(/[\s*#：:（）()]/g, ""); }
  function parseTableRows(rows) {
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const r = rows[i] || [];
      if (r.some((c) => { const s = normCell(c); return s.includes("武勋") || s.includes("势力") || s.includes("贡献") || s.includes("成员") || s.includes("玩家") || s.includes("merit") || s.includes("power"); })) { headerIdx = i; break; }
    }
    if (headerIdx < 0) return [];
    const header = (rows[headerIdx] || []).map(normCell);
    const colOf = (field) => header.findIndex((s) => COL_ALIASES[field].some((alias) => s.includes(alias)));
    const cName = colOf("name"), cMerit = colOf("merit"), cPower = colOf("power"), cTotal = colOf("contributionTotal"), cWeek = colOf("contributionWeek");
    if (cName < 0) return [];
    const out = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const name = String(r[cName] == null ? "" : r[cName]).trim();
      if (!name) continue;
      const toNum = (idx) => {
        if (idx < 0) return 0;
        const v = r[idx];
        if (v == null || v === "") return 0;
        if (typeof v === "number") return Math.round(v);
        const p = window.OCR && window.OCR.parseChineseNumber ? window.OCR.parseChineseNumber(String(v)) : null;
        if (p != null) return p;
        const n = Number(String(v).replace(/[^\d.-]/g, ""));
        return isFinite(n) ? Math.round(n) : 0;
      };
      out.push({ name, merit: toNum(cMerit), power: toNum(cPower), contributionTotal: toNum(cTotal), contributionWeek: toNum(cWeek) });
    }
    return out;
  }
  async function importSheet(file) {
    if (!file) return;
    if (!canManagePlayers()) { toast("只有盟主或管理员可以导入表格数据"); return; }
    if (!window.XLSX) { toast("表格解析组件未加载，请检查网络后刷新"); return; }
    $("sheetStatus").textContent = "正在解析 " + file.name + " …";
    try {
      const buf = await file.arrayBuffer();
      const wb = window.XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
      batchRows = parseTableRows(rows);
      renderBatchRows();
      if (batchRows.length) {
        $("batchPanel").classList.remove("hidden");
        $("sheetStatus").textContent = "已解析 " + batchRows.length + " 行，请核对后保存。";
      } else {
        $("sheetStatus").textContent = "未识别到有效数据，请确认表头含「成员 / 武勋 / 势力值 / 贡献」等列。";
      }
    } catch (e) {
      $("sheetStatus").textContent = "解析失败：" + (e && e.message ? e.message : e);
    }
  }

  function findPlayerByName(name) {
    const n = (name || "").trim().toLowerCase();
    return S.players.find((p) => (p.game_name || "").trim().toLowerCase() === n);
  }

  async function batchSave() {
    if (!S.active) return;
    if (!canManagePlayers()) { toast("只有盟主或管理员可以批量导入他人数据"); return; }
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
    $("forgotPassword").onclick = async () => {
      const email = (prompt("请输入注册邮箱，我们将发送重置链接：", $("authEmail").value || "") || "").trim();
      if (!email) return;
      const err = await Store.auth.resetPassword(email);
      toast(err ? ("发送失败：" + err) : "重置邮件已发送，请查收邮箱");
    };
    $("authForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = $("authEmail").value.trim();
      const pw = $("authPassword").value;
      if (!email || !pw) { $("authMsg").textContent = "请输入邮箱和密码"; return; }
      if (authMode === "signup" && pw.length < 6) { $("authMsg").textContent = "密码至少 6 位"; return; }
      $("authSubmit").disabled = true;
      const res = authMode === "signup"
        ? await Store.auth.signUp(email, pw)
        : await Store.auth.signIn(email, pw);
      $("authSubmit").disabled = false;
      if (res.error) {
        const m = String(res.error).toLowerCase();
        if (m.includes("already registered") || m.includes("already been registered") || m.includes("已注册")) {
          $("authMsg").textContent = "该邮箱已注册，请直接登录（已为你切换到登录）。";
          authMode = "login";
          $("tabLogin").classList.add("active");
          $("tabSignup").classList.remove("active");
          $("authSubmit").textContent = "登录";
        } else if (m.includes("email not confirmed") || m.includes("not confirmed")) {
          $("authMsg").textContent = "该邮箱尚未完成验证，请先到邮箱点击确认链接后再登录。";
        } else if (m.includes("invalid login credentials") || m.includes("invalid_credentials")) {
          $("authMsg").textContent = "邮箱或密码错误，请重试。";
        } else {
          $("authMsg").textContent = res.error;
        }
        return;
      }
      saveRemembered(email, pw, $("rememberMe").checked);
      if (res.user) { enterApp(res.user); }
      else { $("authMsg").textContent = "注册成功，已自动登录。"; }
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
    $("chooseSheet").onclick = () => $("sheetInput").click();
    $("sheetInput").onchange = (e) => importSheet(e.target.files[0]);
    $("openFeedback").onclick = openFeedback;
    $("feedbackFloat").onclick = openFeedback;
    $("closeFeedback").onclick = closeFeedback;
    $("fbSubmit").onclick = submitFeedback;
    $("fbSortNew").onclick = () => setSortMode("new");
    $("fbSortHot").onclick = () => setSortMode("hot");
    $("feedbackOverlay").addEventListener("click", (e) => { if (e.target === $("feedbackOverlay")) closeFeedback(); });

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
    $("comparePlayer").addEventListener("change", renderCompare);
    $("comparePreset").addEventListener("change", renderCompare);
    $("compareRangeStart").addEventListener("change", renderCompare);
    $("compareRangeEnd").addEventListener("change", renderCompare);

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
    $("saveThresholdBtn").onclick = async () => {
      const patch = {
        threshold_merit: Number($("thMerit").value) || 0,
        threshold_power: Number($("thPower").value) || 0,
        threshold_contrib_total: Number($("thContribTotal").value) || 0,
        threshold_contrib_week: Number($("thContribWeek").value) || 0
      };
      try {
        await Store.alliances.update(S.active.id, patch);
        Object.assign(S.active, patch);
        toast("阈值已保存");
      } catch (e) { toast("保存失败：" + e.message); }
    };
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
      const t = e.target.closest("[data-aid],[data-addrec],[data-editp],[data-delp],[data-delrec],[data-removemember],[data-batchremove],[data-merge],[data-reply],[data-like]");
      if (!t) return;
      if (t.hasAttribute("data-aid")) { openAlliance(t.dataset.aid); return; }
      if (t.hasAttribute("data-addrec")) { S.preselectPlayer = t.dataset.addrec; $("recordSource").value = "manual"; showTab("import"); renderImport(); toast("请填写该玩家的武勋 / 势力值并保存"); return; }
      if (t.hasAttribute("data-editp")) { const p = S.players.find((x) => x.id === t.dataset.editp); if (p) openPlayerModal(p); return; }
      if (t.hasAttribute("data-merge")) { openMergeModal(t.dataset.merge); return; }
      if (t.hasAttribute("data-reply")) { replyToId = t.dataset.reply; $("fbReplyHint").textContent = "正在回复，发布后将显示在该评论下方。"; $("fbReplyHint").classList.remove("hidden"); $("fbContent").focus(); return; }
      if (t.hasAttribute("data-like")) { likeFeedback(t.dataset.like); return; }
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

  /* ---------- 反馈区 ---------- */
  let replyToId = null;
  let feedbackData = [];
  let feedbackSort = "new";
  let likedIds = new Set();
  try { likedIds = new Set(JSON.parse(localStorage.getItem("fb-liked") || "[]")); } catch (e) {}

  function timeAgo(iso) {
    if (!iso) return "";
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "刚刚";
    if (m < 60) return m + " 分钟前";
    const h = Math.floor(m / 60);
    if (h < 24) return h + " 小时前";
    const d = Math.floor(h / 24);
    if (d < 30) return d + " 天前";
    return fmtTime(iso);
  }
  function sortedPosts() {
    const posts = feedbackData.filter((f) => !f.parent_id);
    if (feedbackSort === "hot") {
      posts.sort((a, b) => (b.like_count || 0) - (a.like_count || 0) || new Date(b.created_at) - new Date(a.created_at));
    } else {
      posts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
    return posts;
  }
  function renderFeedback() {
    const posts = sortedPosts();
    const replies = feedbackData.filter((f) => f.parent_id);
    const box = $("feedbackList");
    if (!posts.length) {
      box.innerHTML = '<div class="muted" style="text-align:center;padding:28px">还没有反馈，来抢沙发吧～</div>';
      return;
    }
    box.innerHTML = posts.map((p) => {
      const rs = replies.filter((r) => r.parent_id === p.id).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      const liked = likedIds.has(p.id);
      return '<div class="fb-post">' +
        '<div class="fb-avatar">' + safe(String(p.nickname || "匿").charAt(0)) + '</div>' +
        '<div class="fb-body">' +
          '<div class="fb-meta"><span class="fb-name">' + safe(p.nickname) + '</span><span class="fb-time">' + timeAgo(p.created_at) + '</span></div>' +
          '<div class="fb-content">' + safe(p.content).replace(/\n/g, "<br>") + '</div>' +
          '<div class="fb-actions">' +
            '<button class="fb-like' + (liked ? " liked" : "") + '" data-like="' + p.id + '">👍 ' + (p.like_count || 0) + '</button>' +
            '<button class="link-button" data-reply="' + p.id + '">回复</button>' +
          '</div>' +
          (rs.length ? '<div class="fb-replies">' + rs.map((r) =>
            '<div class="fb-reply"><span class="fb-name">' + safe(r.nickname) + '</span>：<span>' + safe(r.content).replace(/\n/g, "<br>") + '</span><span class="fb-time">' + timeAgo(r.created_at) + '</span></div>'
          ).join("") + '</div>' : '') +
        '</div></div>';
    }).join("");
  }
  function setSortMode(mode) {
    feedbackSort = mode;
    const bNew = $("fbSortNew"), bHot = $("fbSortHot");
    if (bNew) bNew.classList.toggle("active", mode === "new");
    if (bHot) bHot.classList.toggle("active", mode === "hot");
    renderFeedback();
  }
  async function openFeedback() {
    show($("feedbackOverlay"));
    $("feedbackList").innerHTML = '<div class="muted" style="text-align:center;padding:24px">加载中…</div>';
    try {
      feedbackData = await Store.feedback.list();
      renderFeedback();
    } catch (e) {
      $("feedbackList").innerHTML = '<div class="muted" style="text-align:center;padding:24px">加载失败：' + safe(e.message) + '</div>';
    }
  }
  function closeFeedback() {
    hide($("feedbackOverlay"));
    replyToId = null;
    $("fbReplyHint").classList.add("hidden");
  }
  async function likeFeedback(id) {
    if (likedIds.has(id)) return;
    likedIds.add(id);
    try { localStorage.setItem("fb-liked", JSON.stringify([...likedIds])); } catch (e) {}
    try {
      await Store.feedback.like(id);
      feedbackData = await Store.feedback.list();
      renderFeedback();
    } catch (e) {
      toast("点赞失败：" + e.message);
    }
  }
  async function submitFeedback() {
    const content = $("fbContent").value.trim();
    if (!content) { toast("请先写下反馈内容"); return; }
    const nickname = $("fbNickname").value.trim() || "匿名玩家";
    const btn = $("fbSubmit");
    btn.disabled = true;
    try {
      await Store.feedback.add({ nickname, content, parent_id: replyToId || null });
      $("fbContent").value = "";
      replyToId = null;
      $("fbReplyHint").classList.add("hidden");
      toast("反馈已提交，感谢！");
      feedbackData = await Store.feedback.list();
      renderFeedback();
    } catch (e) {
      toast("提交失败：" + e.message);
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------- 初始化 ---------- */
  async function init() {
    bindEvents();
    let entered = false;
    if (!isSupabase) {
      $("signOutBtn").classList.add("hidden");
      const u = await Store.auth.getUser();
      enterApp(u);
      entered = true;
    } else {
      $("authLocalDemo").classList.add("hidden");
      document.querySelector(".auth-divider").classList.add("hidden");
      const u = await Store.auth.getUser();
      if (u) { enterApp(u); entered = true; }
      else {
        const rem = loadRemembered();
        if (rem && rem.email) {
          $("authEmail").value = rem.email;
          $("authPassword").value = rem.password;
          $("rememberMe").checked = true;
          try {
            const r = await Store.auth.signIn(rem.email, rem.password);
            if (r.user) { enterApp(r.user); entered = true; }
          } catch (e) {}
        }
        if (!entered) showAuth();
      }
    }
    Store.auth.onAuthChange((u) => { if (u) enterApp(u); else exitApp(); });
    $("deltaStart").disabled = true;
    $("deltaEnd").disabled = true;
  }

  init();
})();

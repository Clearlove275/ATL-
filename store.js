/* ============================================================
 * 数据层：统一接口，支持两种后端
 *   - LocalStore    本地演示（localStorage，跨标签页同步）
 *   - SupabaseStore 多用户同盟数据库（Postgres + Realtime）
 * ============================================================ */
(function () {
  "use strict";

  function uid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }
  function nowIso() { return new Date().toISOString(); }
  function sameLocalDay(a, b) {
    const x = new Date(a), y = new Date(b);
    return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
  }

  /* ================= 本地模式 ================= */
  function LocalStore() {
    const LS_KEY = "stzb-atl-store-v1";
    const self = this;
    const subs = {};

    function defaultState() {
      return { alliances: [], members: [], players: [], records: [], feedback: [] };
    }
    function load() {
      try {
        const s = JSON.parse(localStorage.getItem(LS_KEY));
        return s && Array.isArray(s.alliances) ? s : defaultState();
      } catch (e) { return defaultState(); }
    }
    let state = load();
    function save() {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
      notifyAll();
    }
    function notifyAlliance(aid) {
      const set = subs[aid];
      if (set) set.forEach((cb) => { try { cb(); } catch (e) {} });
    }
    function notifyAll() {
      Object.keys(subs).forEach((aid) => notifyAlliance(aid));
    }

    window.addEventListener("storage", (e) => {
      if (e.key === LS_KEY) { state = load(); notifyAll(); }
    });

    const LOCAL_USER = { id: "local-user", email: "本地演示用户" };

    this.auth = {
      signUp: async () => ({ user: LOCAL_USER, error: null }),
      signIn: async () => ({ user: LOCAL_USER, error: null }),
      signOut: async () => {},
      getUser: () => LOCAL_USER,
      onAuthChange: (cb) => { cb(LOCAL_USER); return () => {}; }
    };

    function myMemberships() {
      return state.members.filter((m) => m.user_id === LOCAL_USER.id);
    }
    function roleIn(aid) {
      const m = state.members.find((x) => x.alliance_id === aid && x.user_id === LOCAL_USER.id);
      return m ? m.role : null;
    }

    this.myUser = () => LOCAL_USER;
    this.myRole = (aid) => roleIn(aid);

    this.alliances = {
      async list() {
        return myMemberships().map((m) => {
          const a = state.alliances.find((x) => x.id === m.alliance_id);
          return a ? Object.assign({}, a, { role: m.role }) : null;
        }).filter(Boolean);
      },
      async create(name, season, gameName) {
        const alliance = {
          id: uid(), name: name.trim(), season: season.trim() || "未命名赛季",
          invite_code: uid().replace(/-/g, "").slice(0, 8).toUpperCase(),
          created_by: LOCAL_USER.id, created_at: nowIso()
        };
        state.alliances.push(alliance);
        state.members.push({ id: uid(), alliance_id: alliance.id, user_id: LOCAL_USER.id, role: "owner", game_name: gameName.trim(), joined_at: nowIso() });
        if (gameName.trim()) addPlayerLocal(alliance.id, gameName.trim(), "", "", LOCAL_USER.id);
        save();
        return alliance;
      },
      async join(code, gameName) {
        const alliance = state.alliances.find((a) => a.invite_code.toUpperCase() === code.trim().toUpperCase());
        if (!alliance) throw new Error("邀请码无效");
        const name = gameName.trim();
        let m = state.members.find((x) => x.alliance_id === alliance.id && x.user_id === LOCAL_USER.id);
        if (!m) {
          m = { id: uid(), alliance_id: alliance.id, user_id: LOCAL_USER.id, role: "member", game_name: name, joined_at: nowIso() };
          state.members.push(m);
        } else if (name) {
          m.game_name = name;
        }
        if (name) addPlayerLocal(alliance.id, name, "", "", LOCAL_USER.id);
        save();
        return alliance;
      },
      async update(id, patch) {
        const a = state.alliances.find((x) => x.id === id);
        if (!a) return null;
        if (patch.name != null) a.name = patch.name;
        if (patch.season != null) a.season = patch.season;
        save();
        return a;
      },
      async remove(id) {
        state.alliances = state.alliances.filter((a) => a.id !== id);
        state.members = state.members.filter((m) => m.alliance_id !== id);
        state.players = state.players.filter((p) => p.alliance_id !== id);
        state.records = state.records.filter((r) => r.alliance_id !== id);
        save();
      },
      async leave(id) {
        state.members = state.members.filter((m) => !(m.alliance_id === id && m.user_id === LOCAL_USER.id));
        state.players = state.players.map((p) => p.alliance_id === id && p.user_id === LOCAL_USER.id ? Object.assign({}, p, { user_id: null }) : p);
        save();
      }
    };

    this.members = {
      async list(aid) { return state.members.filter((m) => m.alliance_id === aid); },
      async setRole(aid, memberId, role) {
        const m = state.members.find((x) => x.id === memberId && x.alliance_id === aid);
        if (m) { m.role = role; save(); }
        return m;
      },
      async remove(aid, memberId) {
        state.members = state.members.filter((m) => !(m.id === memberId && m.alliance_id === aid));
        save();
      }
    };

    this.players = {
      async list(aid) { return state.players.filter((p) => p.alliance_id === aid); },
      async add(aid, p) {
        const row = { id: uid(), alliance_id: aid, game_name: p.game_name.trim(), team: p.team || "", duty: p.duty || "", user_id: p.user_id || null, created_at: nowIso() };
        state.players.push(row); save();
        return row;
      },
      async update(aid, pid, patch) {
        const p = state.players.find((x) => x.id === pid && x.alliance_id === aid);
        if (!p) return null;
        if (patch.game_name != null) p.game_name = patch.game_name;
        if (patch.team != null) p.team = patch.team;
        if (patch.duty != null) p.duty = patch.duty;
        save();
        return p;
      },
      async remove(aid, pid) {
        state.players = state.players.filter((p) => !(p.id === pid && p.alliance_id === aid));
        state.records = state.records.filter((r) => !(r.player_id === pid && r.alliance_id === aid));
        save();
      },
      async merge(aid, fromId, toId) {
        if (fromId === toId) return;
        state.records.forEach((x) => { if (x.alliance_id === aid && x.player_id === fromId) x.player_id = toId; });
        state.players = state.players.filter((p) => !(p.id === fromId && p.alliance_id === aid));
        save();
      }
    };

    this.records = {
      async list(aid) { return state.records.filter((r) => r.alliance_id === aid); },
      async add(aid, r) {
        const recorded_at = r.recorded_at || nowIso();
        const target = new Date(recorded_at);
        const existing = state.records.find((x) => x.alliance_id === aid && x.player_id === r.player_id && sameLocalDay(x.recorded_at, target));
        if (existing) {
          existing.merit = Number(r.merit) || 0;
          existing.power = Number(r.power) || 0;
          existing.contribution_total = Number(r.contribution_total) || 0;
          existing.contribution_week = Number(r.contribution_week) || 0;
          if (r.source) existing.source = r.source;
          if (r.note != null) existing.note = r.note;
          existing.recorded_at = recorded_at;
          existing.created_by = LOCAL_USER.id;
          save();
          return existing;
        }
        const row = {
          id: uid(), alliance_id: aid, player_id: r.player_id,
          merit: Number(r.merit) || 0, power: Number(r.power) || 0,
          contribution_total: Number(r.contribution_total) || 0,
          contribution_week: Number(r.contribution_week) || 0,
          source: r.source || "manual", note: r.note || "",
          recorded_at, created_by: LOCAL_USER.id, created_at: nowIso()
        };
        state.records.push(row); save();
        return row;
      },
      async remove(aid, rid) {
        state.records = state.records.filter((r) => !(r.id === rid && r.alliance_id === aid));
        save();
      }
    };

    this.feedback = {
      async list() { return (state.feedback || []).slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at)); },
      async add(p) {
        const row = { id: uid(), nickname: (p.nickname || "匿名玩家").trim() || "匿名玩家", content: (p.content || "").trim(), parent_id: p.parent_id || null, like_count: 0, created_at: nowIso() };
        state.feedback = state.feedback || [];
        state.feedback.push(row);
        save();
        return row;
      },
      async like(id) {
        const f = (state.feedback || []).find((x) => x.id === id);
        if (f) { f.like_count = (f.like_count || 0) + 1; save(); }
        return f;
      }
    };

    this.subscribe = (aid, cb) => {
      (subs[aid] = subs[aid] || new Set()).add(cb);
      return () => { if (subs[aid]) subs[aid].delete(cb); };
    };

    function addPlayerLocal(aid, name, team, duty, userId) {
      const nm = name.trim();
      if (!nm) return;
      const existing = state.players.find((p) => p.alliance_id === aid && p.game_name === nm);
      if (!existing) {
        state.players.push({ id: uid(), alliance_id: aid, game_name: nm, team: team || "", duty: duty || "", user_id: userId || null, created_at: nowIso() });
      } else if (!existing.user_id && userId) {
        // 认领盟主此前导入但未归属的玩家，避免同名重复
        existing.user_id = userId;
      }
    }
  }

  /* ================= Supabase 模式 ================= */
  function SupabaseStore() {
    const cfg = window.APP_CONFIG || {};
    if (!window.supabase || !cfg.supabaseUrl || cfg.supabaseUrl.includes("YOUR-PROJECT")) {
      throw new Error("Supabase 未配置，请编辑 config.js 填入 supabaseUrl 与 supabaseAnonKey");
    }
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    const self = this;

    this.client = sb;
    this.myUser = () => sb.auth.getUser().then(({ data }) => data.user);

    this.auth = {
      signUp: async (email, password) => {
        const { data, error } = await sb.auth.signUp({ email, password });
        return { user: data && data.user ? data.user : null, error: error ? error.message : null };
      },
      signIn: async (email, password) => {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        return { user: data && data.user ? data.user : null, error: error ? error.message : null };
      },
      signOut: () => sb.auth.signOut(),
      getUser: () => sb.auth.getUser().then(({ data }) => data.user),
      onAuthChange: (cb) => {
        const { data } = sb.auth.onAuthStateChange((event, session) => cb(session ? session.user : null));
        return () => data.subscription.unsubscribe();
      }
    };

    async function uidOf() {
      const { data } = await sb.auth.getUser();
      return data.user ? data.user.id : null;
    }

    this.myRole = async (aid) => {
      const u = await uidOf();
      if (!u) return null;
      const { data } = await sb.from("alliance_members").select("role").eq("alliance_id", aid).eq("user_id", u).maybeSingle();
      return data ? data.role : null;
    };

    this.alliances = {
      async list() {
        const u = await uidOf();
        if (!u) return [];
        const { data, error } = await sb.from("alliance_members")
          .select("alliance_id, role, alliances(*)")
          .eq("user_id", u)
          .order("joined_at", { ascending: true });
        if (error) throw new Error(error.message);
        return (data || []).filter((m) => m.alliances).map((m) => Object.assign({}, m.alliances, { role: m.role }));
      },
      async create(name, season, gameName) {
        const { data, error } = await sb.rpc("create_alliance", {
          p_name: name, p_season: season || "未命名赛季", p_game_name: gameName || ""
        });
        if (error) throw new Error(error.message);
        return data;
      },
      async join(code, gameName) {
        const { data, error } = await sb.rpc("join_alliance", { p_invite_code: code, p_game_name: gameName || "" });
        if (error) throw new Error(error.message);
        return data;
      },
      async update(id, patch) {
        const { error } = await sb.from("alliances").update(patch).eq("id", id);
        if (error) throw new Error(error.message);
        return true;
      },
      async remove(id) {
        const { error } = await sb.from("alliances").delete().eq("id", id);
        if (error) throw new Error(error.message);
        return true;
      },
      async leave(id) {
        const { error } = await sb.rpc("leave_alliance", { p_alliance_id: id });
        if (error) throw new Error(error.message);
        return true;
      }
    };

    this.members = {
      async list(aid) {
        const { data, error } = await sb.from("alliance_members").select("*").eq("alliance_id", aid).order("joined_at", { ascending: true });
        if (error) throw new Error(error.message);
        return data || [];
      },
      async setRole(aid, memberId, role) {
        const { error } = await sb.from("alliance_members").update({ role }).eq("id", memberId).eq("alliance_id", aid);
        if (error) throw new Error(error.message);
        return true;
      },
      async remove(aid, memberId) {
        const { error } = await sb.from("alliance_members").delete().eq("id", memberId).eq("alliance_id", aid);
        if (error) throw new Error(error.message);
        return true;
      }
    };

    this.players = {
      async list(aid) {
        const { data, error } = await sb.from("players").select("*").eq("alliance_id", aid).order("created_at", { ascending: true });
        if (error) throw new Error(error.message);
        return data || [];
      },
      async add(aid, p) {
        const { data, error } = await sb.from("players").insert({
          alliance_id: aid, game_name: p.game_name.trim(), team: p.team || "", duty: p.duty || "", user_id: p.user_id || null
        }).select().single();
        if (error) throw new Error(error.message);
        return data;
      },
      async update(aid, pid, patch) {
        const { error } = await sb.from("players").update(patch).eq("id", pid).eq("alliance_id", aid);
        if (error) throw new Error(error.message);
        return true;
      },
      async remove(aid, pid) {
        const { error } = await sb.from("players").delete().eq("id", pid).eq("alliance_id", aid);
        if (error) throw new Error(error.message);
        return true;
      },
      async merge(aid, fromId, toId) {
        if (fromId === toId) return;
        const { error } = await sb.rpc("merge_players", { p_alliance_id: aid, p_from_id: fromId, p_to_id: toId });
        if (error) throw new Error(error.message);
        return true;
      }
    };

    this.records = {
      async list(aid) {
        const { data, error } = await sb.from("records").select("*").eq("alliance_id", aid).order("recorded_at", { ascending: true });
        if (error) throw new Error(error.message);
        return data || [];
      },
      async add(aid, r) {
        const u = await uidOf();
        const recorded_at = r.recorded_at || nowIso();
        const target = new Date(recorded_at);
        const payload = {
          merit: Number(r.merit) || 0, power: Number(r.power) || 0,
          contribution_total: Number(r.contribution_total) || 0,
          contribution_week: Number(r.contribution_week) || 0,
          source: r.source || "manual", note: r.note || "",
          recorded_at, created_by: u
        };
        const { data: existing, error: e0 } = await sb.from("records").select("id, recorded_at").eq("alliance_id", aid).eq("player_id", r.player_id);
        if (e0) throw new Error(e0.message);
        const same = (existing || []).find((x) => sameLocalDay(x.recorded_at, target));
        if (same) {
          const { data, error } = await sb.from("records").update(payload).eq("id", same.id).select().single();
          if (error) throw new Error(error.message);
          return data;
        }
        const { data, error } = await sb.from("records").insert({ alliance_id: aid, player_id: r.player_id, ...payload }).select().single();
        if (error) throw new Error(error.message);
        return data;
      },
      async remove(aid, rid) {
        const { error } = await sb.from("records").delete().eq("id", rid).eq("alliance_id", aid);
        if (error) throw new Error(error.message);
        return true;
      }
    };

    this.feedback = {
      async list() {
        const { data, error } = await sb.from("feedback").select("*").order("created_at", { ascending: true });
        if (error) throw new Error(error.message);
        return data || [];
      },
      async add(p) {
        const { data, error } = await sb.from("feedback").insert({
          nickname: (p.nickname || "匿名玩家").trim() || "匿名玩家",
          content: (p.content || "").trim(),
          parent_id: p.parent_id || null
        }).select().single();
        if (error) throw new Error(error.message);
        return data;
      },
      async like(id) {
        const { error } = await sb.rpc("like_feedback", { p_id: id });
        if (error) throw new Error(error.message);
        return true;
      }
    };

    this.subscribe = (aid, cb) => {
      const channel = sb.channel("atl-" + aid)
        .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: "alliance_id=eq." + aid }, cb)
        .on("postgres_changes", { event: "*", schema: "public", table: "records", filter: "alliance_id=eq." + aid }, cb)
        .on("postgres_changes", { event: "*", schema: "public", table: "alliance_members", filter: "alliance_id=eq." + aid }, cb)
        .subscribe();
      return () => { sb.removeChannel(channel); };
    };
  }

  // 选择后端
  let store;
  const mode = (window.APP_CONFIG && window.APP_CONFIG.backend) || "local";
  try {
    store = mode === "supabase" ? new SupabaseStore() : new LocalStore();
  } catch (e) {
    console.error("[Store] 初始化失败，回退到本地模式：", e);
    store = new LocalStore();
    window.__STORE_FALLBACK__ = e.message;
  }
  window.Store = store;
  window.STORE_MODE = mode;
})();
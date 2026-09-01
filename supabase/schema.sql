-- ============================================================
-- 率土同盟数据库 · Supabase 建表脚本
-- 使用方法：
--   1. 在 https://supabase.com 创建项目
--   2. 打开左侧 SQL Editor -> New query
--   3. 粘贴本文件全部内容并点击 Run
--   4. 在 Project Settings -> API 中复制 URL 与 anon key，
--      填入本站 config.js
--   5. 建议：Authentication -> Providers -> Email
--      关闭 “Confirm email”，避免注册后需收邮件验证
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- 表结构 ----------
create table if not exists public.alliances (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  season text not null default '未命名赛季',
  invite_code text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.alliance_members (
  id uuid primary key default gen_random_uuid(),
  alliance_id uuid not null references public.alliances(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  game_name text not null default '',
  joined_at timestamptz not null default now(),
  unique (alliance_id, user_id)
);

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  alliance_id uuid not null references public.alliances(id) on delete cascade,
  game_name text not null,
  team text not null default '',
  duty text not null default '',
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (alliance_id, game_name)
);
create index if not exists players_alliance_idx on public.players(alliance_id);

create table if not exists public.records (
  id uuid primary key default gen_random_uuid(),
  alliance_id uuid not null references public.alliances(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  merit bigint not null default 0,
  power bigint not null default 0,
  contribution_total bigint not null default 0,
  contribution_week bigint not null default 0,
  source text not null default 'manual' check (source in ('ocr','manual')),
  note text not null default '',
  recorded_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists records_alliance_idx on public.records(alliance_id, player_id, recorded_at);

-- ---------- 权限辅助函数 ----------
create or replace function public.is_member_of(aid uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.alliance_members m
    where m.alliance_id = aid and m.user_id = auth.uid()
  );
$$;

create or replace function public.role_in(aid uuid)
returns text
language sql stable security definer set search_path = public as $$
  select m.role from public.alliance_members m
  where m.alliance_id = aid and m.user_id = auth.uid()
  limit 1;
$$;

-- ---------- RPC：创建同盟 ----------
create or replace function public.create_alliance(
  p_name text,
  p_season text default '未命名赛季',
  p_game_name text default ''
)
returns public.alliances
language plpgsql security definer set search_path = public as $$
declare
  v_alliance public.alliances;
  v_code text;
begin
  if auth.uid() is null then
    raise exception '请先登录';
  end if;
  if nullif(trim(p_name), '') is null then
    raise exception '同盟名称不能为空';
  end if;

  loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (select 1 from public.alliances where invite_code = v_code);
  end loop;

  insert into public.alliances(name, season, invite_code, created_by)
  values (trim(p_name), coalesce(nullif(trim(p_season), ''), '未命名赛季'), v_code, auth.uid())
  returning * into v_alliance;

  insert into public.alliance_members(alliance_id, user_id, role, game_name)
  values (v_alliance.id, auth.uid(), 'owner', trim(p_game_name));

  if nullif(trim(p_game_name), '') is not null then
    insert into public.players(alliance_id, game_name, user_id)
    values (v_alliance.id, trim(p_game_name), auth.uid())
    on conflict (alliance_id, game_name)
    do update set user_id = coalesce(public.players.user_id, excluded.user_id);
  end if;

  return v_alliance;
end;
$$;

-- ---------- RPC：加入同盟 ----------
create or replace function public.join_alliance(
  p_invite_code text,
  p_game_name text default ''
)
returns public.alliances
language plpgsql security definer set search_path = public as $$
declare
  v_alliance public.alliances;
begin
  if auth.uid() is null then
    raise exception '请先登录';
  end if;

  select * into v_alliance
  from public.alliances
  where upper(invite_code) = upper(trim(p_invite_code));

  if v_alliance.id is null then
    raise exception '邀请码无效';
  end if;

  insert into public.alliance_members(alliance_id, user_id, role, game_name)
  values (v_alliance.id, auth.uid(), 'member', trim(p_game_name))
  on conflict (alliance_id, user_id) do update set game_name = excluded.game_name;

  if nullif(trim(p_game_name), '') is not null then
    insert into public.players(alliance_id, game_name, user_id)
    values (v_alliance.id, trim(p_game_name), auth.uid())
    on conflict (alliance_id, game_name)
    do update set user_id = coalesce(public.players.user_id, excluded.user_id);
  end if;

  return v_alliance;
end;
$$;

-- ---------- RPC：合并玩家（改名继承） ----------
create or replace function public.merge_players(
  p_alliance_id uuid,
  p_from_id uuid,
  p_to_id uuid
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_role text;
  v_from_user uuid;
  v_to_user uuid;
begin
  if auth.uid() is null then
    raise exception '请先登录';
  end if;
  if p_from_id = p_to_id then
    return;
  end if;

  select m.role into v_role
  from public.alliance_members m
  where m.alliance_id = p_alliance_id and m.user_id = auth.uid();
  if v_role is null then
    raise exception '你不是该同盟成员';
  end if;

  select user_id into v_from_user from public.players
  where id = p_from_id and alliance_id = p_alliance_id;
  select user_id into v_to_user from public.players
  where id = p_to_id and alliance_id = p_alliance_id;
  if v_from_user is null or v_to_user is null then
    raise exception '玩家不存在';
  end if;

  if v_role not in ('owner','admin') then
    if v_to_user is distinct from auth.uid() then
      raise exception '你只能合并到自己的角色';
    end if;
    if v_from_user is not null and v_from_user is distinct from auth.uid() then
      raise exception '你只能继承未认领或自己的旧数据';
    end if;
  end if;

  update public.records set player_id = p_to_id
  where alliance_id = p_alliance_id and player_id = p_from_id;
  delete from public.players
  where id = p_from_id and alliance_id = p_alliance_id;
end;
$$;

-- ---------- RPC：退出同盟 ----------
create or replace function public.leave_alliance(p_alliance_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.alliance_members
  where alliance_id = p_alliance_id and user_id = auth.uid();
  update public.players set user_id = null
  where alliance_id = p_alliance_id and user_id = auth.uid();
end;
$$;

-- ---------- 行级安全 ----------
alter table public.alliances enable row level security;
alter table public.alliance_members enable row level security;
alter table public.players enable row level security;
alter table public.records enable row level security;

drop policy if exists alliances_select on public.alliances;
create policy alliances_select on public.alliances
  for select using (public.is_member_of(id));

drop policy if exists alliances_update on public.alliances;
create policy alliances_update on public.alliances
  for update using (public.role_in(id) in ('owner','admin'))
  with check (public.role_in(id) in ('owner','admin'));

drop policy if exists alliances_delete on public.alliances;
create policy alliances_delete on public.alliances
  for delete using (public.role_in(id) = 'owner');

-- 盟员关系
drop policy if exists alliance_members_select on public.alliance_members;
create policy alliance_members_select on public.alliance_members
  for select using (public.is_member_of(alliance_id));

drop policy if exists alliance_members_update on public.alliance_members;
create policy alliance_members_update on public.alliance_members
  for update using (
    public.role_in(alliance_id) = 'owner'
    or (public.role_in(alliance_id) = 'admin' and role <> 'owner')
  );

drop policy if exists alliance_members_delete on public.alliance_members;
create policy alliance_members_delete on public.alliance_members
  for delete using (
    public.role_in(alliance_id) in ('owner','admin')
    or user_id = auth.uid()
  );

-- 玩家名单
drop policy if exists players_select on public.players;
create policy players_select on public.players
  for select using (public.is_member_of(alliance_id));

drop policy if exists players_insert on public.players;
create policy players_insert on public.players
  for insert with check (public.role_in(alliance_id) in ('owner','admin'));

drop policy if exists players_update on public.players;
create policy players_update on public.players
  for update using (
    public.is_member_of(alliance_id)
    and (
      public.role_in(alliance_id) in ('owner','admin')
      or user_id = auth.uid()
    )
  );

drop policy if exists players_delete on public.players;
create policy players_delete on public.players
  for delete using (
    public.role_in(alliance_id) in ('owner','admin')
    or user_id = auth.uid()
  );

-- 数据记录
drop policy if exists records_select on public.records;
create policy records_select on public.records
  for select using (public.is_member_of(alliance_id));

drop policy if exists records_insert on public.records;
create policy records_insert on public.records
  for insert with check (
    public.is_member_of(alliance_id)
    and (
      public.role_in(alliance_id) in ('owner','admin')
      or exists (select 1 from public.players p where p.id = player_id and p.user_id = auth.uid())
    )
  );

drop policy if exists records_update on public.records;
create policy records_update on public.records
  for update using (
    public.is_member_of(alliance_id)
    and (
      public.role_in(alliance_id) in ('owner','admin')
      or exists (select 1 from public.players p where p.id = player_id and p.user_id = auth.uid())
    )
  );

drop policy if exists records_delete on public.records;
create policy records_delete on public.records
  for delete using (
    public.role_in(alliance_id) in ('owner','admin')
    or created_by = auth.uid()
  );

-- ---------- 实时订阅 ----------
do $$
begin
  begin
    alter publication supabase_realtime add table public.alliances;
  exception when others then null;
  end;
  begin
    alter publication supabase_realtime add table public.alliance_members;
  exception when others then null;
  end;
  begin
    alter publication supabase_realtime add table public.players;
  exception when others then null;
  end;
  begin
    alter publication supabase_realtime add table public.records;
  exception when others then null;
  end;
end $$;

-- ---------- 反馈区 ----------
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  nickname text not null default '匿名玩家',
  content text not null,
  parent_id uuid references public.feedback(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists feedback_created_idx on public.feedback(created_at);
alter table public.feedback enable row level security;
drop policy if exists feedback_select on public.feedback;
create policy feedback_select on public.feedback for select using (true);
drop policy if exists feedback_insert on public.feedback;
create policy feedback_insert on public.feedback for insert with check (true);


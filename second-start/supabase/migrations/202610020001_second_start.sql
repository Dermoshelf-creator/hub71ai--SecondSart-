-- Dedicated tables. No existing application tables are modified.
create table if not exists public.second_start_jobs (
  id text primary key, profession text not null, payload jsonb not null
);
create table if not exists public.second_start_neighborhoods (
  id text primary key, commute_key text not null unique, payload jsonb not null
);
create table if not exists public.second_start_candidates (
  id text primary key, channel text not null check (channel in ('web', 'whatsapp')),
  revision integer not null default 0 check (revision >= 0),
  payload jsonb not null, updated_at timestamptz not null default now(),
  check (payload->>'id' = id), check ((payload->>'revision')::integer = revision)
);
create table if not exists public.second_start_events (
  id text primary key,
  candidate_id text not null references public.second_start_candidates(id) on delete cascade,
  response jsonb not null, expires_at timestamptz not null
);
create index if not exists second_start_events_expiry on public.second_start_events(expires_at);
create table if not exists public.second_start_metadata (key text primary key, value jsonb not null);

-- Visitors have no direct table access. Our server authorizes the anonymous cookie.
alter table public.second_start_jobs enable row level security;
alter table public.second_start_neighborhoods enable row level security;
alter table public.second_start_candidates enable row level security;
alter table public.second_start_events enable row level security;
alter table public.second_start_metadata enable row level security;
revoke all on public.second_start_jobs, public.second_start_neighborhoods,
  public.second_start_candidates, public.second_start_events, public.second_start_metadata
  from anon, authenticated, public;
grant all on public.second_start_jobs, public.second_start_neighborhoods,
  public.second_start_candidates, public.second_start_events, public.second_start_metadata
  to service_role;

create or replace function public.second_start_import_dataset(p_dataset jsonb, p_version text)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(7102026);
  if (select value #>> '{}' from public.second_start_metadata where key = 'version') = p_version then return false; end if;
  if coalesce(jsonb_array_length(p_dataset->'jobs'), 0) = 0 or coalesce(jsonb_array_length(p_dataset->'neighborhoods'), 0) = 0 then
    raise exception 'Empty dataset rejected';
  end if;
  insert into public.second_start_jobs(id, profession, payload)
    select j->>'id', j->>'profession_category', j from jsonb_array_elements(p_dataset->'jobs') j
    on conflict (id) do update set profession = excluded.profession, payload = excluded.payload;
  insert into public.second_start_neighborhoods(id, commute_key, payload)
    select n->>'id', n->>'commute_key', n from jsonb_array_elements(p_dataset->'neighborhoods') n
    on conflict (id) do update set commute_key = excluded.commute_key, payload = excluded.payload;
  delete from public.second_start_jobs where id not in (select j->>'id' from jsonb_array_elements(p_dataset->'jobs') j);
  delete from public.second_start_neighborhoods where id not in (select n->>'id' from jsonb_array_elements(p_dataset->'neighborhoods') n);
  insert into public.second_start_metadata(key, value) values ('sources', p_dataset->'sources'), ('version', to_jsonb(p_version))
    on conflict (key) do update set value = excluded.value;
  return true;
end;
$$;

create or replace function public.second_start_dataset()
returns jsonb language sql security invoker set search_path = '' as $$
  select jsonb_build_object(
    'jobs', coalesce((select jsonb_agg(payload order by id) from public.second_start_jobs), '[]'::jsonb),
    'neighborhoods', coalesce((select jsonb_agg(payload order by id) from public.second_start_neighborhoods), '[]'::jsonb),
    'sources', coalesce((select value from public.second_start_metadata where key = 'sources'), '[]'::jsonb),
    'version', (select value from public.second_start_metadata where key = 'version')
  );
$$;

create or replace function public.second_start_open_session(p_candidate jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare result jsonb;
begin
  insert into public.second_start_candidates(id, channel, revision, payload, updated_at)
    values (p_candidate->>'id', p_candidate->>'channel', 0, p_candidate, (p_candidate->>'updated_at')::timestamptz)
    on conflict (id) do nothing;
  select payload into result from public.second_start_candidates where id = p_candidate->>'id';
  return result;
end;
$$;

-- Candidate update and retry record commit together under a row lock.
create or replace function public.second_start_save_answer(
  p_candidate jsonb, p_old_revision integer, p_event_id text, p_response jsonb
)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare stored_revision integer;
begin
  select revision into stored_revision from public.second_start_candidates
    where id = p_candidate->>'id' for update;
  if not found or stored_revision <> p_old_revision then return false; end if;
  if (p_candidate->>'revision')::integer <> p_old_revision + 1 then raise exception 'Invalid revision'; end if;
  delete from public.second_start_events where expires_at <= now();
  if exists(select 1 from public.second_start_events where id = p_event_id) then return false; end if;
  update public.second_start_candidates set payload = p_candidate,
    revision = p_old_revision + 1, updated_at = (p_candidate->>'updated_at')::timestamptz
    where id = p_candidate->>'id';
  insert into public.second_start_events(id, candidate_id, response, expires_at)
    values (p_event_id, p_candidate->>'id', p_response, now() + interval '7 days');
  return true;
end;
$$;

revoke all on function public.second_start_import_dataset(jsonb, text),
  public.second_start_dataset(), public.second_start_open_session(jsonb),
  public.second_start_save_answer(jsonb, integer, text, jsonb) from public, anon, authenticated;
grant execute on function public.second_start_import_dataset(jsonb, text),
  public.second_start_dataset(), public.second_start_open_session(jsonb),
  public.second_start_save_answer(jsonb, integer, text, jsonb) to service_role;
notify pgrst, 'reload schema';

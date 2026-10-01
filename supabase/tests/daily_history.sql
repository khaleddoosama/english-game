-- The admin's activity numbers come from the players' daily totals, not
-- just their newest 50 rounds (review F12, migration 0021). Compares
-- before/after, so other players' data doesn't matter
-- (begin; <this>; rollback;).
do $$
declare
  v_admin uuid := (select id from public.profiles where role = 'admin' order by created_at limit 1);
  v_new uuid;
  v_old uuid;
  v_today text := to_char((now() at time zone 'UTC')::date, 'YYYY-MM-DD');
  v_yesterday text := to_char((now() at time zone 'UTC')::date - 1, 'YYYY-MM-DD');
  before_today integer; after_today integer;
  before_y integer; after_y integer;
  r record;
  report text := '';
  logs jsonb;
begin
  perform public.register_player('t_dh_new', 'secret1');
  perform public.register_player('t_dh_old', 'secret1');
  select id into v_new from public.profiles where username = 't_dh_new';
  select id into v_old from public.profiles where username = 't_dh_old';
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  select sessions into before_today from public.admin_activity(3, 'UTC') where day = v_today::date;
  select sessions into before_y from public.admin_activity(3, 'UTC') where day = v_yesterday::date;

  -- A player with daily totals: 75 rounds over two days, only 50 in the log.
  select jsonb_agg(jsonb_build_object('id', 'r' || i, 'kind', 'practice', 'title', 'Food', 'correct', 3, 'total', 4,
    'at', floor(extract(epoch from now()) * 1000) - i * 1000)) into logs from generate_series(1, 50) i;
  insert into public.progress (user_id, section, data) values (v_new, 'history', jsonb_build_object(
    'sessionLogs', logs,
    'dailyHistory', jsonb_build_object(v_today, '{"rounds":45,"answered":180,"correct":135}'::jsonb, v_yesterday, '{"rounds":30,"answered":120,"correct":90}'::jsonb,
      '2026-02-31', '{"rounds":999}'::jsonb, 'junk', '{"rounds":999}'::jsonb)));
  -- A player from before daily totals: counted from the log (2 rounds today).
  insert into public.progress (user_id, section, data) values (v_old, 'history', jsonb_build_object('sessionLogs', jsonb_build_array(
    jsonb_build_object('id', 'o1', 'kind', 'practice', 'title', 'x', 'correct', 1, 'total', 2, 'at', floor(extract(epoch from now()) * 1000)),
    jsonb_build_object('id', 'o2', 'kind', 'practice', 'title', 'x', 'correct', 2, 'total', 2, 'at', floor(extract(epoch from now()) * 1000) - 5000))));

  select sessions into after_today from public.admin_activity(3, 'UTC') where day = v_today::date;
  select sessions into after_y from public.admin_activity(3, 'UTC') where day = v_yesterday::date;
  if after_today - before_today <> 47 or after_y - before_y <> 30 then
    raise exception 'FAIL: admin activity counted % today and % yesterday (want 47 and 30)', after_today - before_today, after_y - before_y;
  end if;
  report := report || 'every round counts, bad day keys skipped; ';

  select * into r from public.admin_players('UTC') where username = 't_dh_new';
  if r.sessions_30d <> 75 or r.answers_30d <> 300 or r.correct_30d <> 225 then raise exception 'FAIL: player 30 days %', row_to_json(r); end if;
  select * into r from public.admin_players('UTC') where username = 't_dh_old';
  if r.sessions_30d <> 2 or r.answers_30d <> 4 then raise exception 'FAIL: older player %', row_to_json(r); end if;
  report := report || 'per player; ';

  -- Players can't read anyone's daily rows directly.
  perform set_config('request.jwt.claims', json_build_object('sub', v_new, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.activity_day_rows('UTC');
    raise exception 'FAIL: a player read everyone''s activity';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  report := report || 'admin only';

  raise exception 'DAILY HISTORY TESTS PASSED: %', report;
end;
$$;

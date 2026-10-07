import { useCallback, useEffect, useState } from "react";
import { Check, UserPlus, Users } from "lucide-react";
import { navigate } from "../../lib/router";

// Friends inside Live Challenge: pick friends when creating, invite more from
// the waiting room, and answer the invitations that were sent to me.
// `friendsApi` is the friends API (social/friendsApi.js); null hides all of it.

const useFriends = (friendsApi) => {
  const [list, setList] = useState(null);
  useEffect(() => {
    let stale = false;
    if (!friendsApi) return undefined;
    friendsApi.list().then((l) => { if (!stale) setList(l.friends); }).catch(() => { if (!stale) setList([]); });
    return () => { stale = true; };
  }, [friendsApi]);
  return list;
};

const FindFriends = () => <button type="button" className="lv-link-btn" onClick={() => navigate("/friends")}>Find friends</button>;

// New-challenge form: tap the friends to invite once it's created.
export function FriendPicker({ friendsApi, value, onChange, max }) {
  const friends = useFriends(friendsApi);
  if (!friendsApi) return null;
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="lv-field">
      <span>Invite friends <b className="lv-val">{value.length ? `${value.length} picked` : "optional"}</b></span>
      {friends === null ? <div className="ui-skeleton-row short" /> : !friends.length
        ? <small className="lv-hint">You have no friends here yet. <FindFriends /></small>
        : <div className="lv-chips" role="group" aria-label="Friends to invite">
          {friends.map((f) => {
            const on = value.includes(f.id);
            return <button key={f.id} type="button" aria-pressed={on} className={on ? "on" : ""} onClick={() => toggle(f.id)}>{on && <Check size={13} />}{f.username}</button>;
          })}
        </div>}
      {friends?.length > 0 && <small className="lv-hint">They'll see an invitation next time they open the game. The challenge closes when {max ? `all ${max} seats are` : "it's"} taken, so the first ones to join get in.</small>}
    </div>
  );
}

// Waiting room (and a finished-early "anytime" challenge): invite more friends.
export function InviteFriends({ friendsApi, view }) {
  const friends = useFriends(friendsApi);
  const [sent, setSent] = useState(null);
  const [busy, setBusy] = useState(null);
  const [problem, setProblem] = useState(null);
  const code = view.code;
  useEffect(() => {
    let stale = false;
    if (!friendsApi) return undefined;
    friendsApi.invitesSent(code).then((ids) => { if (!stale) setSent(ids); }).catch(() => { if (!stale) setSent([]); });
    return () => { stale = true; };
  }, [friendsApi, code]);
  if (!friendsApi) return null;
  const inside = new Set(view.players.map((p) => p.user_id));
  const candidates = (friends || []).filter((f) => !inside.has(f.id));
  if (friends && !candidates.length) return friends.length ? null : (
    <div className="lv-invite-friends"><p className="lv-kicker">Invite friends</p><p className="lv-note">You have no friends here yet. <FindFriends /></p></div>
  );
  async function send(f) {
    setBusy(f.id); setProblem(null);
    try {
      const r = await friendsApi.invite(code, [f.id]);
      if (r.invited) setSent((old) => [...(old || []), f.id]);
      else if (r.skipped?.[0]?.reason === "already invited") setSent((old) => [...(old || []), f.id]);
      else setProblem(`${f.username} can't be invited (${r.skipped?.[0]?.reason || "unknown"}).`);
    } catch (e) { setProblem(e.message); }
    setBusy(null);
  }
  return (
    <div className="lv-invite-friends">
      <p className="lv-kicker">Invite friends</p>
      {friends === null || sent === null ? <div className="ui-skeleton-row short" /> : (
        <div className="lv-chips" role="group" aria-label="Invite a friend">
          {candidates.map((f) => {
            const done = sent.includes(f.id);
            return <button key={f.id} type="button" disabled={done || busy === f.id} className={done ? "on" : ""} onClick={() => send(f)} aria-label={done ? `${f.username} was invited` : `Invite ${f.username}`}>
              {done ? <Check size={13} /> : <UserPlus size={13} />}{f.username}{done && " · invited"}
            </button>;
          })}
        </div>
      )}
      {problem && <p className="lv-error">{problem}</p>}
    </div>
  );
}

// Live home: challenges my friends invited me to.
export function Invitations({ friendsApi, api, onOpenCode, onSocialChanged }) {
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(null);
  const [problems, setProblems] = useState({});
  const load = useCallback(async () => {
    if (!friendsApi) return;
    try { setList(await friendsApi.myInvites()); } catch { setList((old) => old || []); }
  }, [friendsApi]);
  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    const onShow = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onShow);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onShow); };
  }, [load]);
  if (!friendsApi || !list?.length) return null;
  async function join(inv) {
    setBusy(inv.code); setProblems((p) => ({ ...p, [inv.code]: null }));
    try { await api.join(inv.code); onSocialChanged?.(); onOpenCode(inv.code); }
    catch (e) { setProblems((p) => ({ ...p, [inv.code]: e.message })); await load(); onSocialChanged?.(); }
    setBusy(null);
  }
  async function dismiss(inv) {
    setBusy(inv.code);
    try { await friendsApi.dismissInvite(inv.code); } catch { /* it stays in the list */ }
    await load(); onSocialChanged?.(); setBusy(null);
  }
  return (
    <section className="lv-list lv-invites" aria-label="Invitations">
      <h3><Users size={13} /> Invitations ({list.length})</h3>
      <ul>
        {list.map((inv) => (
          <li key={inv.code}>
            <span className="lv-list-main"><b>{inv.title}</b><small>{inv.from} invited you · {inv.players}/{inv.max_players} players · {inv.question_count} questions{inv.seconds ? ` · ${inv.seconds}s each` : ""}</small></span>
            <span className="lv-inv-actions">
              <button className="lv-btn gold" disabled={busy === inv.code} onClick={() => join(inv)}>{busy === inv.code ? "…" : "Join"}</button>
              <button className="lv-btn ghost" disabled={busy === inv.code} onClick={() => dismiss(inv)} aria-label={`Dismiss the invitation to ${inv.title}`}>Dismiss</button>
            </span>
            {problems[inv.code] && <p className="lv-error">{problems[inv.code]}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

import { useState } from "react";
import { Check, UserMinus, UserPlus, Users, X, Zap } from "lucide-react";
import { navigate } from "../../lib/router";
import { useFriendsList } from "./useFriendsList";
import "../../styles/friends.css";

// Friends: ask someone by username, answer the requests you got, and send a
// friend a challenge. `api` is the friends API (friendsApi.js); `onChanged`
// lets the app refresh the badges on the navigation after a change.
export default function FriendsPage({ api, onChanged, local = false }) {
  const [username, setUsername] = useState("");
  const { data, loadError, busy, notice, sure, clearNotice, askSure, request, accept, decline, remove, cancel } = useFriendsList(api, onChanged);

  async function add(e) {
    e.preventDefault();
    if (await request(username)) setUsername("");
  }

  const Row = ({ person, sub, children }) => (
    <li className="fr-row">
      <span className="fr-avatar" aria-hidden="true">{person.username.slice(0, 1).toUpperCase()}</span>
      <span className="fr-name"><b>{person.username}</b>{sub && <small>{sub}</small>}</span>
      <span className="fr-actions">{children}</span>
    </li>
  );

  return (
    <section className="ui-page fr">
      <header className="ui-page-head">
        <h2><Users size={20} /> Friends</h2>
        <button className="wh-back-btn" onClick={() => navigate("/profile")}>Back</button>
      </header>

      <form className="ui-inline-form" onSubmit={add} aria-label="Add a friend">
        <input value={username} onChange={(e) => { setUsername(e.target.value); clearNotice(); }} placeholder="Their username" aria-label="Username of the friend to add"
          autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={30} />
        <button className="ui-row-btn" disabled={busy === "add" || !username.trim()}><UserPlus size={16} /> {busy === "add" ? "Sending…" : "Send request"}</button>
      </form>
      <p className="ui-muted">Ask a friend for their username. They get a request and, once they accept, you can invite each other to challenges.{local && " (Local mode: you can find players who opened the game in this browser.)"}</p>
      {notice && <p className={notice.kind === "ok" ? "ui-ok" : "wh-import-error"} role="status">{notice.text}</p>}
      {loadError && <p className="wh-import-error">{loadError}</p>}
      {!data && !loadError && <ul className="fr-list">{[0, 1, 2].map((i) => <li key={i} className="ui-skeleton-row" />)}</ul>}

      {data?.incoming.length > 0 && <>
        <h3 className="ui-section-title">Requests for you ({data.incoming.length})</h3>
        <ul className="fr-list" aria-label="Friend requests">
          {data.incoming.map((p) => (
            <Row key={p.id} person={p} sub="wants to be your friend">
              <button className="ui-row-btn fr-primary" disabled={!!busy} onClick={() => accept(p)}><Check size={15} /> Accept</button>
              <button className="ui-row-btn" disabled={!!busy} onClick={() => decline(p)}><X size={15} /> Decline</button>
            </Row>
          ))}
        </ul>
      </>}

      <h3 className="ui-section-title">Your friends{data ? ` (${data.friends.length})` : ""}</h3>
      {data && !data.friends.length && <p className="ui-muted">No friends yet. Send a request with a friend's username above.</p>}
      {data?.friends.length > 0 && <ul className="fr-list" aria-label="Friends">
        {data.friends.map((f) => (
          <Row key={f.id} person={f} sub={local ? null : `${f.score} pts · ${f.study_streak}d streak · ${f.live_wins} live wins`}>
            <button className="ui-row-btn fr-primary" disabled={!!busy} onClick={() => navigate(`/live?invite=${encodeURIComponent(f.id)}`)}><Zap size={15} /> Challenge</button>
            {sure === f.id
              ? <button className="ui-row-btn ui-danger fr-sure" disabled={!!busy} onClick={() => remove(f)}>Sure?</button>
              : <button className="ui-row-btn" disabled={!!busy} onClick={() => askSure(f.id)} aria-label={`Remove ${f.username}`}><UserMinus size={15} /></button>}
          </Row>
        ))}
      </ul>}

      {data?.outgoing.length > 0 && <>
        <h3 className="ui-section-title">Waiting for an answer ({data.outgoing.length})</h3>
        <ul className="fr-list" aria-label="Sent requests">
          {data.outgoing.map((p) => (
            <Row key={p.id} person={p} sub="request sent">
              <button className="ui-row-btn" disabled={!!busy} onClick={() => cancel(p)}>Cancel</button>
            </Row>
          ))}
        </ul>
      </>}
    </section>
  );
}

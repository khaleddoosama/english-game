import { Inbox } from "lucide-react";
import { count } from "./format";

// Views friends offered me: take a copy, or leave it.
export default function ShareInbox({ offers, busy, onAnswer }) {
  if (!offers.length) return null;
  return (
    <div className="lib-inbox" aria-label="Views friends shared with you">
      <h3 className="lib-sub"><Inbox size={14} /> Shared with you</h3>
      <ul>
        {offers.map((o) => (
          <li key={o.id}>
            <span><b>{o.name}</b> from {o.from}<small>{count(o.words, "word")}{o.rules ? ` · ${count(o.rules, "rule")}` : ""}{o.views > 1 ? ` · ${o.views} views` : ""}</small></span>
            <span className="lib-actions">
              <button className="ui-row-btn lib-primary" disabled={busy} onClick={() => onAnswer(o, true)}>Add to my library</button>
              <button className="ui-row-btn" disabled={busy} onClick={() => onAnswer(o, false)}>Not now</button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

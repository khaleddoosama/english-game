import { useCallback, useEffect, useState } from 'react';
import { acceptFriend, dismissInvite, dismissShare, loadFriends, removeFriend, requestFriend } from './friendsApi';
import { chooseWords } from '../library/libraryApi';
import { navigate, pathFor } from '../../lib/router';
import '../../styles/library.css';
const EMPTY = {friends:[],requests:[],shares:[],invites:[]};
export default function FriendsPage({userId,onLibraryChanged,local=false}) {
  const [data,setData]=useState(EMPTY),[username,setUsername]=useState('');
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[message,setMessage]=useState('');
  const refresh = useCallback(async()=>{setData(await loadFriends(userId));},[userId]);
  useEffect(()=>{
    let active=true;
    const update=()=>loadFriends(userId).then(d=>{if(active){setData(d);setLoading(false);}}).catch(e=>{if(active){setError(e.message);setLoading(false);}});
    update();const timer=setInterval(update,20000);window.addEventListener('focus',update);
    return ()=>{active=false;clearInterval(timer);window.removeEventListener('focus',update);};
  },[userId]);
  async function act(fn){if(busy)return;setBusy(true);setError('');setMessage('');try{await fn();await refresh();}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <section className="pl-page"><header><p className="lv-kicker">Learn together</p><h2>Friends</h2><p>Invite your friends to challenges and share the words you are learning.</p></header>
    {local?<p>Friends need an online account.</p>:<form className="pl-form" onSubmit={e=>{e.preventDefault();act(async()=>{await requestFriend(userId,username);setUsername('');setMessage('Friend request sent.');});}}><label htmlFor="friend-name">Add by username</label><div className="pl-row"><input id="friend-name" value={username} onChange={e=>setUsername(e.target.value)} placeholder="Enter your friend's username" maxLength={20} autoCapitalize="none"/><button className="wh-level-btn" disabled={busy||!username.trim()}>Send request</button></div></form>}
    {error&&<p className="pl-error" role="alert">{error}</p>}{message&&<p role="status">{message}</p>}{loading&&<p role="status">Loading friends…</p>}
    <h3>Requests · {data.requests.length}</h3>{data.requests.map(r=><article className="pl-result" key={r.id}><div><b>{r.username}</b><p>{r.incoming?'Wants to be your friend':'Waiting for their reply'}</p></div><div className="pl-row">{r.incoming&&<button className="wh-level-btn" disabled={busy} onClick={()=>act(()=>acceptFriend(r.id))}>Accept</button>}<button className="wh-back-btn" disabled={busy} onClick={()=>act(()=>removeFriend(r.id))}>{r.incoming?'Decline':'Cancel'}</button></div></article>)}
    <h3>My friends · {data.friends.length}</h3>{!loading&&!data.friends.length&&<p>Add a friend using their username.</p>}{data.friends.map(f=><article className="pl-result" key={f.id}><b>{f.username}</b><div className="pl-row"><button className="wh-level-btn" onClick={()=>navigate('/live')}>Create a challenge</button><button className="wh-back-btn" onClick={()=>navigate('/library')}>Share words</button><button className="wh-back-btn" disabled={busy} onClick={()=>act(()=>removeFriend(f.id))}>Remove friend</button></div></article>)}
    <h3>Challenge invitations · {data.invites.length}</h3>{data.invites.map(i=><article className="pl-result" key={i.id}><div><b>{i.username}</b><p>Invited you to challenge {i.code}</p></div><div className="pl-row"><button className="wh-level-btn" onClick={()=>navigate(pathFor('live',{code:i.code}))}>Open challenge</button><button className="wh-back-btn" disabled={busy} onClick={()=>act(()=>dismissInvite(i.id))}>Dismiss</button></div></article>)}
    <h3>Words shared with me · {data.shares.length}</h3>{data.shares.map(s=><article className="pl-word" key={s.id}><b>From {s.username} · {s.word_keys.length} words</b><p>{s.word_keys.join(' · ')}</p><div className="pl-row"><button className="wh-level-btn" disabled={busy} onClick={()=>act(async()=>{await chooseWords(userId,s.word_keys);await onLibraryChanged();await dismissShare(s.id);setMessage('Shared words added to your library.');})}>Add to my words</button><button className="wh-back-btn" disabled={busy} onClick={()=>act(()=>dismissShare(s.id))}>Dismiss</button></div></article>)}
  </section>;
}
export function InviteFriends({userId,code}) {
  const [friends,setFriends]=useState([]),[recipient,setRecipient]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  useEffect(()=>{let active=true;loadFriends(userId).then(d=>{if(active)setFriends(d.friends);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[userId]);
  async function send(){setBusy(true);setError('');setMessage('');try{const {inviteFriend}=await import('./friendsApi');await inviteFriend(userId,recipient,code);setMessage('Invitation sent.');}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <div className="pl-invite"><label>Invite a friend <select value={recipient} onChange={e=>setRecipient(e.target.value)}><option value="">Choose a friend</option>{friends.map(f=><option value={f.userId} key={f.id}>{f.username}</option>)}</select></label><button className="lv-btn" disabled={busy||!recipient} onClick={send}>{busy?'Sending…':'Invite'}</button>{message&&<p role="status">{message}</p>}{error&&<p role="alert" className="pl-error">{error}</p>}{!friends.length&&<a href="/friends" onClick={e=>{e.preventDefault();navigate('/friends');}}>Add friends</a>}</div>;
}

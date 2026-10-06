import { isLocalMode, supabase } from '../../lib/supabase';
const check = ({data,error}) => { if(error) throw new Error(error.message); return data; };
export async function loadFriends(userId) {
  if(isLocalMode) return {friends:[],requests:[],shares:[],invites:[]};
  const [relations,shares,invites] = await Promise.all([
    supabase.from('friendships').select('id,requester,recipient,status').order('created_at',{ascending:false}),
    supabase.from('friend_shares').select('id,sender,recipient,word_keys,created_at').eq('recipient',userId).order('created_at',{ascending:false}).limit(50),
    supabase.from('friend_invites').select('id,sender,recipient,code,created_at').eq('recipient',userId).order('created_at',{ascending:false}).limit(50),
  ]);
  const rows = check(relations), wordShares = check(shares), roomInvites = check(invites);
  const ids = [...new Set([...rows.flatMap(f=>[f.requester,f.recipient]),...wordShares.map(x=>x.sender),...roomInvites.map(x=>x.sender)])];
  const profiles = ids.length ? check(await supabase.from('profiles').select('id,username').in('id',ids)) : [];
  const names = new Map(profiles.map(p=>[p.id,p.username]));
  return {
    friends:rows.filter(f=>f.status==='accepted').map(f=>({...f,userId:f.requester===userId?f.recipient:f.requester,username:names.get(f.requester===userId?f.recipient:f.requester)||'Player'})),
    requests:rows.filter(f=>f.status==='pending').map(f=>({...f,incoming:f.recipient===userId,username:names.get(f.requester===userId?f.recipient:f.requester)||'Player'})),
    shares:wordShares.map(s=>({...s,username:names.get(s.sender)||'Player'})),
    invites:roomInvites.map(s=>({...s,username:names.get(s.sender)||'Player'})),
  };
}
export async function requestFriend(userId,username) {
  if(isLocalMode) throw new Error('Sign in online to add friends.');
  const clean = username.toLowerCase().trim();
  if(!/^[a-z0-9_]{3,20}$/.test(clean)) throw new Error('Enter a valid username.');
  const player = check(await supabase.from('profiles').select('id,username').eq('username',clean).maybeSingle());
  if(!player) throw new Error('No player has that username.');
  if(player.id===userId) throw new Error('Choose another player.');
  const result = await supabase.from('friendships').insert({requester:userId,recipient:player.id});
  if(result.error?.code==='23505') throw new Error('You already have a friendship or pending request with this player.');
  check(result);
}
export async function acceptFriend(id) { check(await supabase.from('friendships').update({status:'accepted'}).eq('id',id)); }
export async function removeFriend(id) { check(await supabase.from('friendships').delete().eq('id',id)); }
export async function shareWords(sender,recipient,keys) { check(await supabase.from('friend_shares').insert({sender,recipient,word_keys:keys})); }
export async function inviteFriend(sender,recipient,code) {
  const r = await supabase.from('friend_invites').insert({sender,recipient,code});
  if(r.error?.code==='23505') throw new Error('This friend already has an invitation to this challenge.');
  check(r);
}
export async function dismissShare(id) { check(await supabase.from('friend_shares').delete().eq('id',id)); }
export async function dismissInvite(id) { check(await supabase.from('friend_invites').delete().eq('id',id)); }

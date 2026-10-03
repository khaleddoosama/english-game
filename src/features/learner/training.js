import { V2 } from '../../engine/v2';
function exampleSentence(word) {
  const sentences=String(word.example||word.situation||'').split(/(?<=[.!?])\s+(?=[A-Z])/).filter(Boolean);
  return sentences.find(s=>V2.norm(s).includes(V2.norm(word.word)))||sentences[0]||'';
}
export function interactiveTraining(unit, mode, mastery = {}, count = 12, rng = Math.random) {
  const words=V2.shuffleCopy(unit.words,rng).sort((a,b)=>(mastery[a.word]?.total||0)-(mastery[b.word]?.total||0)).slice(0,count);
  const queue=[];
  if(mode==='match') {
    // Identical definitions do not make a fair matching task.
    const seen=new Set(), valid=words.filter(w=>w.meaning&&!seen.has(w.meaning)&&seen.add(w.meaning));
    for(let i=0;i<valid.length;i+=4){const group=valid.slice(i,i+4);if(group.length<2)continue;queue.push({id:'match-'+i,mode:'match',type:'match',prompt:'Tap each word and its meaning.',targets:group.map(w=>w.word),answers:group.map(w=>w.word+' ↔ '+w.meaning),pairs:group.map(w=>({word:w.word,meaning:w.meaning})),meanings:V2.shuffleCopy(group.map(w=>w.meaning),rng),explanation:'Each pair connects a word to its course definition.'});}
  } else for(const w of words) {
    if(mode==='listen') queue.push({id:'listen-'+w.word,mode:'listen',type:'typing',audio:w.word,prompt:'Listen, then type the word you hear.',targets:[w.word],answers:[w.word],explanation:w.meaning});
    if(mode==='speak' && (w.example||w.situation)) {const text=exampleSentence(w);queue.push({id:'speak-'+w.word,mode:'speak',type:'speech',prompt:'Say this sentence',speechText:text,targets:[w.word],answers:[text],explanation:'Speech recognition checks the words it heard. It does not assess pronunciation quality.'});}
    if(mode==='build' && (w.example||w.situation)) {const text=exampleSentence(w);queue.push({id:'build-'+w.word,mode:'order',type:'typing',builder:true,prompt:'Put the words in order to make the course example.',tokens:V2.shuffleCopy(text.split(/\s+/),rng),targets:[w.word],answers:[text],explanation:text});}
  }
  if(!queue.length)throw Error('This unit does not have enough content for this activity. Try word training.');
  return {id:mode+'-'+Date.now(),kind:'practice',title:unit.title+' · '+mode,queue,index:0,answers:[],introductions:[],introduced:true};
}

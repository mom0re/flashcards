/* Swipe Study Cards
   Built-in decks: JSON files in /decks, listed in /decks/index.json (see FORMAT.md).
   User decks: imported in the app, kept in this browser's localStorage (key "sscards-user-decks").
   Study progress is never saved: it lives in memory, so a refresh or 3 hours idle starts fresh. */
(function(){
"use strict";
const TYPES = {recall:"Recall",explain:"Explain / discuss",calc:"Calculate",formula:"Formula"};
const MAX_CARDS = 150;
const USER_KEY = "sscards-user-decks";
const $ = id => document.getElementById(id);
const GREYS = ["#d6d6d6","#b3b3b3","#919191","#727272","#555555","#c4c4c4","#a2a2a2","#828282"];
const sw = c => GREYS[(c-1)%GREYS.length];
function hash(s){let h=0;for(let i=0;i<s.length;i++){h=(h*31+s.charCodeAt(i))|0}return (h>>>0).toString(36)}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}

/* old builds saved progress; wipe it */
try{Object.keys(localStorage).filter(k=>k.startsWith("g10ug")||k.startsWith("swipe")).forEach(k=>localStorage.removeItem(k))}catch(e){}

/* ---------- sanitising imported HTML ---------- */
const ALLOWED = new Set(["B","STRONG","I","EM","U","P","BR","UL","OL","LI","TABLE","THEAD","TBODY","TR","TD","TH","SUB","SUP","SPAN","DIV","CODE","PRE","SMALL","HR"]);
const ALLOWED_CLASS = new Set(["eq","res","tscroll","math"]);
function sanitize(html){
  if(!/[<>]/.test(html)) return "<p>"+esc(html).replace(/\n/g,"<br>")+"</p>";
  const doc = new DOMParser().parseFromString("<div>"+html+"</div>","text/html");
  const walk = node => {
    [...node.childNodes].forEach(ch=>{
      if(ch.nodeType===1){
        if(/^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|TEMPLATE|NOSCRIPT)$/.test(ch.tagName)){ ch.remove(); return; }
        if(!ALLOWED.has(ch.tagName)){ const t=document.createTextNode(ch.textContent); ch.replaceWith(t); return; }
        [...ch.attributes].forEach(a=>{ if(a.name!=="class") ch.removeAttribute(a.name); });
        if(ch.hasAttribute("class")){ const k=[...ch.classList].filter(c=>ALLOWED_CLASS.has(c)); k.length?ch.setAttribute("class",k.join(" ")):ch.removeAttribute("class"); }
        walk(ch);
      } else if(ch.nodeType!==3) ch.remove();
    });
  };
  const root = doc.body.firstChild; walk(root); return root.innerHTML;
}
function plain(s){return esc(String(s||"")).slice(0,2000)}

/* ---------- deck normalising ---------- */
function normalise(raw, id, trusted){
  if(!raw||typeof raw!=="object") throw new Error("That isn't a deck: it should be one JSON object with a \"cards\" list.");
  const cardsIn = Array.isArray(raw.cards)?raw.cards:(Array.isArray(raw)?raw:null);
  if(!cardsIn||!cardsIn.length) throw new Error("No cards found. The JSON needs a \"cards\" list with at least one card.");
  if(!trusted && cardsIn.length>MAX_CARDS) throw new Error(`That deck has ${cardsIn.length} cards. The limit is ${MAX_CARDS}: ask the AI to cut it down or split it into two decks.`);
  const secIn = raw.sections&&typeof raw.sections==="object"?raw.sections:{};
  const sections={};
  for(const [k,v] of Object.entries(secIn)){const n=parseInt(k,10); if(n>0) sections[n]=String(v).slice(0,60)}
  const cards=[]; let skipped=0;
  for(const c of cardsIn){
    if(!c||typeof c!=="object"){skipped++;continue}
    const q=c.q??c.question??c.front, a=c.a??c.answer??c.back;
    if(!q||!a){skipped++;continue}
    let sec=parseInt(c.section??c.c??1,10); if(!(sec>0)) sec=1;
    let t=String(c.type??c.t??"recall").toLowerCase(); if(!TYPES[t]) t="recall";
    const card={c:sec,t,q:trusted?String(q):plain(q),a:trusted?String(a):sanitize(String(a))};
    const h=c.hint??c.h, tip=c.tip, pp=c.source??c.pp;
    if(h) card.h=trusted?String(h):plain(h);
    if(tip) card.tip=trusted?String(tip):sanitize(String(tip));
    if(pp) card.pp=trusted?String(pp):plain(pp).slice(0,80);
    if(c.ref) card.ref=trusted?String(c.ref):plain(c.ref).slice(0,160);
    if(c.group!=null&&c.group!==""){ card.g=String(c.group).slice(0,40); const pt=parseInt(c.part,10); card.part=pt>0?pt:0; }
    card.id=sec+"-"+hash(card.q);
    cards.push(card);
  }
  if(!cards.length) throw new Error("None of the cards had both a question (\"q\") and an answer (\"a\").");
  cards.forEach(c=>{ if(!sections[c.c]) sections[c.c]= c.c===1&&Object.keys(sections).length===0 ? "All cards" : "Section "+c.c; });
  let name=String(raw.name||raw.title||"My deck").slice(0,60);
  let short=String(raw.short||name).slice(0,28);
  const exam=/^\d{4}-\d{2}-\d{2}$/.test(raw.exam||"")?raw.exam:"";
  let notes=null;
  if(trusted&&raw.notes&&typeof raw.notes==="object"){notes={};for(const [k,v] of Object.entries(raw.notes)){const n=parseInt(k,10);if(n>0&&typeof v==="string"&&v)notes[n]=v}if(!Object.keys(notes).length)notes=null}
  return {id,name,short,exam,sectionWord:String(raw.sectionWord||"Section").slice(0,16),sections,cards,notes,user:!trusted,skipped};
}
function extractJSON(text){
  text=String(text).trim().replace(/^```(?:json)?\s*/i,"").replace(/```\s*$/,"");
  try{return JSON.parse(text)}catch(e){}
  const a=text.indexOf("{"), b=text.lastIndexOf("}");
  if(a>=0&&b>a){ try{return JSON.parse(text.slice(a,b+1))}catch(e){} }
  throw new Error("Couldn't read that as JSON. Copy the AI's whole reply, from the first { to the last }.");
}

/* ---------- user deck storage ---------- */
function readUserRaw(){try{return JSON.parse(localStorage.getItem(USER_KEY)||"[]")||[]}catch(e){return []}}
function writeUserRaw(list){try{localStorage.setItem(USER_KEY,JSON.stringify(list));return true}catch(e){return false}}

/* ---------- state (memory only) ---------- */
let DECKS=[], D=null;
const MEM={};
let marks={},prefs={},best=0;
let pend=[];   // cards still to be drawn, as units: {ids:[...], again:bool}. Multi-part questions are one unit.
let queue=[],total=0,doneCount=0,gotCount=0,streak=0,flipped=false,busy=false;
function loadDeck(){
  const m=MEM[D.id]||(MEM[D.id]={marks:{},prefs:{chs:[],types:[],pp:false,known:false,shuffle:true},best:0});
  marks=m.marks; prefs=m.prefs; best=m.best;
}
function saveBest(){MEM[D.id].best=best}
function pickDeck(id){D=DECKS.find(d=>d.id===id)||DECKS[0]; loadDeck()}

/* ---------- deck flow ---------- */
function pool(){return D.cards.map((x,i)=>i).filter(i=>{const x=D.cards[i];
  if(prefs.chs.length&&!prefs.chs.includes(x.c))return false;
  if(prefs.types.length&&!prefs.types.includes(x.t))return false;
  if(prefs.pp&&!x.pp)return false;
  if(!prefs.known&&marks[x.id]==="got")return false;
  return true;})}
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function startDeck(){
  if(!D){renderEmptyLibrary();return}
  const poolIdx=pool();
  if(prefs.shuffle){ pend=buildUnits(poolIdx); queue=[]; refill(null) }
  else { pend=[]; queue=orderQueue(poolIdx,false) }
  total=poolIdx.length; doneCount=0; gotCount=0; flipped=false; streak=0;
  try{localStorage.setItem("sscards-last-deck",D.id)}catch(e){}
  updateTop(); countdown(); render();
}
function updateTop(){
  $("openNotes").hidden=!(D&&D.notes);
  syncLayout();
  const chSel=[...prefs.chs].sort((p,q)=>p-q);
  const chTxt=!chSel.length||Object.keys(D.sections).length<2?"":(chSel.length<=3?` · ${D.sectionWord}${chSel.length>1?"s":""} ${chSel.join(", ")}`:` · ${chSel.length} ${D.sectionWord.toLowerCase()}s`);
  $("deckName").textContent=D.short+chTxt+(prefs.pp?" · past papers":"");
  $("progBar").style.width=total?(100*doneCount/total)+"%":"0%";
  const known=D.cards.filter(x=>marks[x.id]==="got").length;
  $("subL").textContent=total?`${doneCount}/${total} cleared`:"";
  $("subR").textContent=`${known}/${D.cards.length} known · best streak ${best}`;
}

/* ---------- maths (KaTeX) ---------- */
function typeset(el){
  if(!el||!window.renderMathInElement)return;
  try{renderMathInElement(el,{delimiters:[{left:"$$",right:"$$",display:true},{left:"$",right:"$",display:false}],throwOnError:false,strict:"ignore",trust:false})}catch(e){}
}
window.addEventListener("load",()=>{typeset($("stack"))});

/* ---------- multi-part questions ---------- */
function groupInfo(x){
  if(!x.g)return null;
  const all=D.cards.filter(y=>y.g===x.g); if(all.length<2)return null;
  const sorted=all.slice().sort((a,b)=>(a.part||0)-(b.part||0));
  return {k:sorted.indexOf(x)+1,n:sorted.length};
}
function buildUnits(idx){
  // parts of the same question stay together and in order
  const units=[],byG={};
  for(const i of idx){const x=D.cards[i]; if(x.g){ if(!byG[x.g]){byG[x.g]={ids:[],again:false};units.push(byG[x.g])} byG[x.g].ids.push(i) } else units.push({ids:[i],again:false})}
  for(const u of units)u.ids.sort((p,q)=>(D.cards[p].part||0)-(D.cards[q].part||0));
  return units;
}
/* Next card is drawn at random from everything not yet "Got it". A card you pressed Again on is a little more likely than a
   normal card. With x cards left the extra chance is, in percent,
       boost(x) = exp(5.9909 - 1.2855*ln(x) + 0.0410*ln(x)^2)
   (log-log curve fitted through: x=131 -> 2%, x=50 -> 5%, x=20 -> 12%, x=10 -> 26%). Normal cards have weight 1,
   Again cards 1 + boost/100. The boost grows as the pool shrinks, so late in a run Again cards come back more often. */
function againBoost(x){const l=Math.log(Math.max(x,1));return Math.min(300,Math.exp(5.9909-1.2855*l+0.0410*l*l))}
function pickUnit(units,exclude,rnd){
  const x=units.reduce((s,u)=>s+u.ids.length,0);
  const wAgain=1+againBoost(x)/100;
  const w=units.map(u=>u===exclude&&units.length>1?0:u.ids.length*(u.again?wAgain:1));
  let r=(rnd||Math.random)()*w.reduce((s,v)=>s+v,0);
  for(let k=0;k<units.length;k++){ if(w[k]>0&&(r-=w[k])<=0)return units[k] }
  return units[units.length-1];
}
function refill(exclude){
  while(queue.length<2&&pend.length){
    const u=pickUnit(pend,exclude,Math.random); exclude=null;
    pend.splice(pend.indexOf(u),1); queue.push(...u.ids);
  }
}
function orderQueue(idx,shuf){
  // keep parts of the same question together and in order; shuffle whole questions
  const units=[],byG={};
  for(const i of idx){const x=D.cards[i]; if(x.g){ if(!byG[x.g]){byG[x.g]=[];units.push(byG[x.g])} byG[x.g].push(i) } else units.push([i])}
  for(const u of units)u.sort((a,b)=>(D.cards[a].part||0)-(D.cards[b].part||0));
  if(shuf)shuffle(units);
  return units.flat();
}

/* ---------- render ---------- */
function faceHTML(x,isBack){
  const multi=Object.keys(D.sections).length>1;
  const tags=`<div class="tags">${multi?`<span class="tag" style="box-shadow:inset 4px 0 0 ${sw(x.c)}">${esc(D.sectionWord)} ${x.c}</span>`:""}<span class="tag">${TYPES[x.t]}</span>${x.pp?`<span class="tag pp">${x.pp}</span>`:""}${(()=>{const gi=groupInfo(x);return gi?`<span class="tag part">Part ${gi.k} of ${gi.n}</span>`:""})()}</div>`;
  if(!isBack) return `<div class="band" style="--sw:${sw(x.c)}"></div><div class="inner front">${tags}<p class="q">${x.q}</p>${x.h?`<div class="hint"><b>Hint:</b> ${x.h}</div>`:""}<div class="cue">${x.t==="calc"?"Work it out on paper · tap to check":"Answer out loud · tap to flip"}</div></div>`;
  return `<div class="band" style="--sw:${sw(x.c)}"></div><div class="inner back"><div class="side">Answer</div><p class="q">${x.q}</p><div class="ans">${x.a}${x.tip?`<div class="tip">${x.tip}</div>`:""}</div>${x.ref?`<p class="ref">Source: ${x.ref}</p>`:""}<div class="backcue">← still learning · got it →</div></div>`;
}
function renderEmptyLibrary(){
  $("deckName").textContent="No decks yet";
  ["bAgain","bGot","bFlip"].forEach(id=>$(id).disabled=true);
  $("stack").innerHTML=`<div class="done"><h2>Add your first deck</h2><p>Make up to ${MAX_CARDS} cards from your notes with Claude or ChatGPT, then paste them in.</p><button class="primary" id="dAdd">Add a deck</button></div>`;
  $("dAdd").onclick=openImport;
}
function render(){
  const st=$("stack"); st.innerHTML="";
  const off=!queue.length;
  ["bAgain","bGot","bFlip"].forEach(id=>$(id).disabled=off);
  if(off){
    const deckEmpty=total===0;
    st.innerHTML=`<div class="done">${deckEmpty?`<h2>Nothing to study</h2><p>${!prefs.known?"You know every card in this selection. Include known cards to run through them again.":"No cards match these filters."}</p><button class="primary" id="dKnown">Include cards I know</button><button class="ghost" id="dMenu">Change deck</button>`:
      `<div class="big">${gotCount}/${total}</div><h2>Deck cleared</h2><p>Every card got a "got it". Pick another section, or go back through the ones you found hard.</p><button class="primary" id="dAgain">Run this deck again</button><button class="ghost" id="dMenu">Change deck</button>`}</div>`;
    const a=$("dAgain"),k=$("dKnown"); if(a)a.onclick=()=>{prefs.known=true;startDeck()}; if(k)k.onclick=()=>{prefs.known=true;startDeck()};
    $("dMenu").onclick=openMenu; return;
  }
  if(queue[1]!=null){const b=document.createElement("div");b.className="card behind";b.innerHTML=faceHTML(D.cards[queue[1]],false);st.appendChild(b)}
  const x=D.cards[queue[0]];
  const c=document.createElement("div"); c.className="card "+(flipped?"back-side":"front-side"); c.id="top"; c.tabIndex=0;
  c.setAttribute("role","button"); c.setAttribute("aria-label",flipped?"Answer side. Swipe right if you got it, left if not.":"Question side. Tap to flip.");
  c.innerHTML=faceHTML(x,flipped)+`<div class="stamp got">GOT IT</div><div class="stamp again">AGAIN</div>`;
  st.appendChild(c); attachDrag(c); typeset(st);
  $("flipLbl").textContent=flipped?"Question":"Flip";
}

/* ---------- actions ---------- */
function toast(t){const el=$("toast");el.textContent=t;el.classList.add("on");clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove("on"),1600)}
function buzz(ms){try{navigator.vibrate&&navigator.vibrate(ms)}catch(e){}}
function flip(){
  const c=$("top"); if(!c||busy)return; busy=true;
  c.classList.add("flipping");
  setTimeout(()=>{flipped=!flipped;render();const n=$("top");n.style.transform="scaleX(.02)";n.offsetWidth;n.style.transition="transform .16s ease-out";n.style.transform="";setTimeout(()=>{n.style.transition="";busy=false},170)},140);
}
function fly(dir){
  const c=$("top"); if(!c||busy)return; busy=true;
  c.classList.add("anim");
  c.style.transform=`translateX(${dir*window.innerWidth*1.3}px) rotate(${dir*24}deg)`;
  c.style.opacity="0";
  const stamp=c.querySelector(dir===1?".stamp.got":".stamp.again"); if(stamp)stamp.style.opacity=1;
  setTimeout(()=>{busy=false;commit(dir)},260);
}
function commit(dir){
  const i=queue.shift(); const x=D.cards[i];
  if(dir===1){
    marks[x.id]="got"; doneCount++; gotCount++; streak++;
    if(streak>best){best=streak;saveBest()}
    buzz(12);
    if(streak%10===0)toast(`${streak} in a row`);
    else if(doneCount===Math.ceil(total/2)&&total>=10)toast("Halfway through the deck");
  }else{
    marks[x.id]="again"; streak=0; buzz([8,40,8]);
    if(prefs.shuffle){ const u={ids:[i],again:true}; pend.push(u); refill(u) }
    else queue.splice(Math.min(4,queue.length),0,i);
  }
  if(dir===1&&prefs.shuffle)refill(null);
  flipped=false; updateTop(); render();
}

/* ---------- swipe ---------- */
function attachDrag(c){
  let sx=0,sy=0,dx=0,dy=0,mode=null,id=null,t0=0;
  const stG=c.querySelector(".stamp.got"),stA=c.querySelector(".stamp.again");
  c.addEventListener("pointerdown",e=>{
    if(busy||(e.pointerType==="mouse"&&e.button!==0))return;
    if(e.target.closest(".tscroll,.eq,.math"))return;
    sx=e.clientX;sy=e.clientY;dx=dy=0;mode="pending";id=e.pointerId;t0=Date.now();
  });
  c.addEventListener("pointermove",e=>{
    if(e.pointerId!==id||!mode)return;
    dx=e.clientX-sx;dy=e.clientY-sy;
    if(mode==="pending"){
      if(Math.abs(dx)>10&&Math.abs(dx)>Math.abs(dy)){mode="h";try{c.setPointerCapture(id)}catch(_){}}
      else if(Math.abs(dy)>10){mode=null;return}
      else return;
    }
    c.style.transform=`translateX(${dx}px) rotate(${dx/18}deg)`;
    stG.style.opacity=Math.max(0,Math.min(1,dx/90)); stA.style.opacity=Math.max(0,Math.min(1,-dx/90));
  });
  const end=e=>{
    if(e.pointerId!==id)return;
    const m=mode; mode=null; id=null;
    const dt=Math.max(1,Date.now()-t0);
    if(m==="pending"&&e.type==="pointerup"){ if(Math.abs(dx)<8&&Math.abs(dy)<8)flip(); return }
    if(m==="h"){
      if(Math.abs(dx)>110||(Math.abs(dx)/dt>0.6&&Math.abs(dx)>40)){fly(dx>0?1:-1);return}
      c.classList.add("anim");c.style.transform="";stG.style.opacity=stA.style.opacity=0;setTimeout(()=>c.classList.remove("anim"),330);
    }
  };
  c.addEventListener("pointerup",end); c.addEventListener("pointercancel",end);
}
/* ---------- trackpad: two-finger swipe left/right over the card (MacBook) ----------
   Swipe right = Got it, swipe left = Again. The card follows your fingers like a touch drag; let go early and it snaps back.
   Vertical scrolling (answer text) and sideways scrolling inside tables/equations are left alone. */
function attachWheel(){
  const stack=$("stack"); if(!stack)return;
  let acc=0,snapT=null,swallowUntil=0;
  const THRESH=120;
  const snapBack=()=>{
    const c=$("top"); acc=0; if(!c)return;
    const g=c.querySelector(".stamp.got"),ag=c.querySelector(".stamp.again");
    c.classList.add("anim");c.style.transform="";if(g)g.style.opacity=0;if(ag)ag.style.opacity=0;
    setTimeout(()=>c.classList.remove("anim"),330);
  };
  stack.addEventListener("wheel",e=>{
    if(e.ctrlKey||e.metaKey)return;                                   // pinch-zoom / browser zoom
    const horizontal=Math.abs(e.deltaX)>Math.abs(e.deltaY)*1.2;
    if(!horizontal&&!acc)return;                                       // normal vertical scroll
    if(e.target.closest&&e.target.closest(".tscroll,.eq,.math"))return;  // let tables/equations scroll sideways
    e.preventDefault();                                                // stops the browser's back/forward swipe
    const c=$("top"); if(!c||busy)return;
    const now=performance.now();
    if(now<swallowUntil){swallowUntil=now+250;return}                  // momentum after a swipe: ignore until it dies down
    const unit=e.deltaMode===1?16:e.deltaMode===2?400:1;
    // finger direction: with "natural" scrolling (default) fingers moving right gives a negative deltaX
    const fingersRight=(e.webkitDirectionInvertedFromDevice===false?e.deltaX:-e.deltaX)*unit;
    acc=Math.max(-400,Math.min(400,acc+fingersRight));
    c.classList.remove("anim");
    c.style.transform=`translateX(${acc}px) rotate(${acc/18}deg)`;
    const g=c.querySelector(".stamp.got"),ag=c.querySelector(".stamp.again");
    if(g)g.style.opacity=Math.max(0,Math.min(1,acc/90)); if(ag)ag.style.opacity=Math.max(0,Math.min(1,-acc/90));
    clearTimeout(snapT);
    if(Math.abs(acc)>=THRESH){const dir=acc>0?1:-1; acc=0; swallowUntil=now+250; fly(dir); return}
    snapT=setTimeout(snapBack,140);
  },{passive:false});
}
attachWheel();
$("bFlip").onclick=flip; $("bGot").onclick=()=>fly(1); $("bAgain").onclick=()=>fly(-1);
document.addEventListener("keydown",e=>{
  if(!$("zoom").hidden){if(e.key==="Escape")closeZoom();return}
  if(!$("notes").hidden&&!isSplit()){if(e.key==="Escape")closeNotes();return}
  if(isSplit()&&e.target.closest&&e.target.closest("#notes"))return;
  if(document.querySelector(".sheet.on")){if(e.key==="Escape")closeSheets();return}
  if(e.target.closest&&e.target.closest("textarea,input"))return;
  if(e.key===" "||e.key==="Enter"){if(e.target.tagName==="BUTTON"&&e.target.id!=="bFlip")return;e.preventDefault();flip()}
  else if(e.key==="ArrowRight"||e.key==="2")fly(1);
  else if(e.key==="ArrowLeft"||e.key==="1")fly(-1);
});

/* ---------- sheets ---------- */
function openSheet(id){document.querySelectorAll(".sheet.on").forEach(s=>s.classList.remove("on"));$("scrim").classList.add("on");$(id).classList.add("on")}
function closeSheets(){$("scrim").classList.remove("on");document.querySelectorAll(".sheet.on").forEach(s=>s.classList.remove("on"))}
$("scrim").onclick=closeSheets;
function openMenu(){buildMenu();openSheet("menu")}
$("openMenu").onclick=openMenu;
function bar(got,n){return `<span class="bar"><i style="width:${n?100*got/n:0}%;background:var(--accent)"></i></span>`}
function buildMenu(){
  const dl=$("deckList"); dl.innerHTML="";
  for(const d of DECKS){
    const m=(MEM[d.id]&&MEM[d.id].marks)||{}; const got=d.cards.filter(x=>m[x.id]==="got").length;
    const b=document.createElement("button"); b.className="chbtn"; b.setAttribute("aria-pressed",String(D&&d.id===D.id));
    b.innerHTML=`<span class="dot" style="background:${d.user?"var(--muted)":"var(--accent)"}"></span><span class="nm">${esc(d.name)}${d.user?' <small class="mine">yours</small>':""}</span><span class="ct">${got}/${d.cards.length}</span>${bar(got,d.cards.length)}`;
    b.onclick=()=>{if(!D||d.id!==D.id){pickDeck(d.id)}buildMenu()}; dl.appendChild(b);
  }
  const add=document.createElement("button"); add.className="chbtn addbtn"; add.innerHTML=`<span class="dot plus">+</span><span class="nm">Add your own deck</span><span class="ct">up to ${MAX_CARDS}</span>`;
  add.onclick=openImport; dl.appendChild(add);
  const hasD=!!D;
  ["secBlock","typeBlock","optBlock","startDeck","menuRow"].forEach(id=>$(id).hidden=!hasD);
  if(!hasD)return;
  const secs=Object.keys(D.sections).map(Number).sort((a,b)=>a-b);
  $("secBlock").hidden=secs.length<2;
  $("secLbl").textContent=(D.sectionWord||"Section")+" · pick one or more";
  const l=$("chList"); l.innerHTML="";
  for(const c of [0,...secs]){
    const set=D.cards.filter(x=>!c||x.c===c),got=set.filter(x=>marks[x.id]==="got").length;
    if(c&&!set.length)continue;
    const b=document.createElement("button"); b.className="chbtn"; b.setAttribute("aria-pressed",String(c?prefs.chs.includes(c):prefs.chs.length===0));
    b.innerHTML=`<span class="dot" style="background:${c?sw(c):"var(--accent)"}"></span><span class="nm">${c?`${c}. ${esc(D.sections[c])}`:"Everything"}</span><span class="ct">${got}/${set.length}</span>${bar(got,set.length)}`;
    b.onclick=()=>{prefs.chs=!c?[]:(prefs.chs.includes(c)?prefs.chs.filter(n=>n!==c):[...prefs.chs,c]);buildMenu()}; l.appendChild(b);
  }
  const tc=$("typeChips"); tc.innerHTML="";
  const present=Object.keys(TYPES).filter(k=>D.cards.some(x=>x.t===k));
  $("typeBlock").hidden=present.length<2;
  for(const k of present){
    const b=document.createElement("button"); b.className="chip"; b.setAttribute("aria-pressed",String(prefs.types.includes(k)));
    b.textContent=TYPES[k]; b.onclick=()=>{prefs.types=prefs.types.includes(k)?prefs.types.filter(t=>t!==k):[...prefs.types,k];buildMenu()}; tc.appendChild(b);
  }
  $("oPP").hidden=!D.cards.some(x=>x.pp);
  $("oPP").setAttribute("aria-pressed",String(prefs.pp)); $("oKnown").setAttribute("aria-pressed",String(prefs.known)); $("oShuffle").setAttribute("aria-pressed",String(prefs.shuffle));
  $("openFormulas").hidden=!D.cards.some(x=>x.t==="formula");
  $("menuNotes").hidden=!D.notes;
  $("delDeck").hidden=!D.user; $("delDeck").textContent="Delete this deck"; delArmed=false;
  const n=pool().length; $("startDeck").textContent=n?`Start ${n} card${n===1?"":"s"}`:"No cards match";
  $("startDeck").disabled=!n;
}
$("oPP").onclick=()=>{prefs.pp=!prefs.pp;buildMenu()};
$("oKnown").onclick=()=>{prefs.known=!prefs.known;buildMenu()};
$("oShuffle").onclick=()=>{prefs.shuffle=!prefs.shuffle;buildMenu()};
$("startDeck").onclick=()=>{closeSheets();startDeck()};
$("reset").onclick=()=>{MEM[D.id]=null;delete MEM[D.id];loadDeck();streak=0;buildMenu();toast("Progress cleared")};
let delArmed=false;
$("delDeck").onclick=()=>{
  if(!D||!D.user)return;
  if(!delArmed){delArmed=true;$("delDeck").textContent="Tap again to delete";setTimeout(()=>{delArmed=false;$("delDeck").textContent="Delete this deck"},3500);return}
  const id=D.id; writeUserRaw(readUserRaw().filter(x=>x.id!==id));
  DECKS=DECKS.filter(d=>d.id!==id); delete MEM[id];
  D=DECKS[0]||null; if(D)loadDeck(); closeSheets(); startDeck(); toast("Deck deleted");
};
$("openFormulas").onclick=()=>{
  $("fList").innerHTML=D.cards.filter(x=>x.t==="formula").map(x=>`<div class="fitem"><span class="tag" style="align-self:flex-start;box-shadow:inset 4px 0 0 ${sw(x.c)}">${esc(D.sectionWord)} ${x.c}</span><h4>${x.q}</h4><div class="ans">${x.a}</div></div>`).join("");
  typeset($("fList")); openSheet("formulas")};
$("closeFormulas").onclick=closeSheets;

/* ---------- import ---------- */
const AI_PROMPT = `Make study flashcards from the notes/slides/past papers I give you.

Reply with ONLY valid JSON (no other text, no code fences) in exactly this shape:
{
  "name": "Full course name",
  "short": "Short name (max 25 characters)",
  "exam": "YYYY-MM-DD",
  "sectionWord": "Chapter",
  "sections": { "1": "First chapter title", "2": "Second chapter title" },
  "cards": [
    { "section": 1, "type": "recall", "q": "Question", "a": "Answer" },
    { "section": 2, "type": "calc", "q": "Question with all the data it needs", "a": "<div class=\\"math\\">$$\\\\begin{aligned} x &= ... \\\\\\\\ &= \\\\boxed{...} \\\\end{aligned}$$</div>", "hint": "optional nudge", "tip": "optional exam tip", "ref": "where in the material this comes from", "group": "optional", "part": 1 }
  ]
}

Rules:
- At most ${MAX_CARDS} cards. Cover every topic; prioritise what is most likely to be examined.
- "type" is one of: recall (facts, lists, definitions), explain (discuss/compare/why), calc (worked numerical problems), formula (state an equation and its terms).
- Phrase questions the way an exam would ask them. Keep answers short, accurate and in my course's terms.
- Use ONLY information from my material. Every answer must be supported by it; add "ref" saying where (e.g. "Lecture 3 slides, Darcy's law" or "Notes §4.2").
- "a" can be plain text or simple HTML: <b>, <i>, <p>, <br>, <ul><li>, <ol><li>, <table><tr><td>.
- Write ALL maths in LaTeX so it displays as proper equations: inline as $V = f\\lambda$, and worked steps as <div class="math">$$\\begin{aligned} d &= \\frac{V \\times TWT}{2} \\\\ &= \\boxed{400\\ \\text{m}} \\end{aligned}$$</div>. Box final answers with \\boxed{}. Remember to escape backslashes in JSON (\\frac becomes \\\\frac).
- For calc cards, show the full working, state assumptions, and check the arithmetic. Each card must make sense on its own: restate any data it needs.
- For multi-part questions, give every part the same "group" (e.g. "Q3") and a "part" number (1, 2, 3…) so they stay together in order.
- "exam", "hint", "tip", "source" (e.g. "Past paper 2024 Q3"), "ref", "group" and "part" are optional; leave out anything you don't know.
- Use plain double quotes and escape any quotes inside text, so the JSON is valid.

Here are my notes:
`;
function openImport(){
  $("impText").value=""; $("impMsg").textContent=""; $("impMsg").className="impmsg"; $("impPrompt").value=AI_PROMPT; if(!generating)renderGenFiles();
  openSheet("importSheet");
}
$("copyPrompt").onclick=async()=>{
  try{await navigator.clipboard.writeText(AI_PROMPT);toast("Prompt copied")}
  catch(e){const t=$("impPrompt");t.hidden=false;t.focus();t.select();toast("Select and copy the prompt below")}
};
$("showPrompt").onclick=()=>{const t=$("impPrompt");t.hidden=!t.hidden};
$("impFile").onchange=e=>{
  const f=e.target.files&&e.target.files[0]; if(!f)return;
  if(f.size>2e6){impError("That file is too big for a flashcard deck.");return}
  const r=new FileReader(); r.onload=()=>{$("impText").value=String(r.result);doImport()}; r.readAsText(f); e.target.value="";
};
$("impPaste").onclick=async()=>{
  try{const t=await navigator.clipboard.readText(); if(t){$("impText").value=t;toast("Pasted")}}catch(e){$("impText").focus();toast("Long-press the box and tap Paste")}
};
function impError(m){$("impMsg").textContent=m;$("impMsg").className="impmsg err"}
function doImport(){
  const text=$("impText").value;
  if(!text.trim()){impError("Paste the AI's reply into the box first.");return}
  importText(text,impError);
}
function importText(text,onErr){
  let deck,parsed;
  const id="u-"+Date.now().toString(36);
  try{ parsed=extractJSON(text); if(Array.isArray(parsed))parsed={cards:parsed}; deck=normalise(parsed,id,false) }catch(e){onErr(e.message);return false}
  const rawList=readUserRaw();
  rawList.push(Object.assign({},parsed,{id}));
  const saved=writeUserRaw(rawList);
  DECKS.push(deck); pickDeck(deck.id); closeSheets(); startDeck();
  toast(`Added ${deck.cards.length} cards`+(deck.skipped?` (${deck.skipped} skipped)`:""));
  if(!saved)setTimeout(()=>toast("Couldn't save the deck on this phone; it will go if you refresh"),1800);
  return true;
}
$("impGo").onclick=doImport;

/* ---------- make cards from uploaded files (server calls Claude) ---------- */
const GEN_MAX_BYTES=3.2*1024*1024, GEN_MAX_FILES=5;
let genFiles=[], generating=false;
try{$("genPass").value=localStorage.getItem("sscards-pass")||""}catch(e){}
function genMsg(m,err){$("genMsg").textContent=m;$("genMsg").className="impmsg"+(err?" err":"")}
function fileType(f){
  if(f.type)return f.type.toLowerCase();
  const ext=(f.name.split(".").pop()||"").toLowerCase();
  return ({pdf:"application/pdf",txt:"text/plain",md:"text/markdown",csv:"text/csv",jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",webp:"image/webp",gif:"image/gif"})[ext]||"";
}
function readB64(blob){return new Promise((ok,bad)=>{const r=new FileReader();r.onload=()=>ok(String(r.result).split(",")[1]||"");r.onerror=()=>bad(new Error("Couldn't read the file."));r.readAsDataURL(blob)})}
async function shrinkImage(file){
  // phone photos are huge: scale to 2000px JPEG so more fit under the size limit
  try{
    const bmp=await createImageBitmap(file); const k=Math.min(1,2000/Math.max(bmp.width,bmp.height));
    const c=document.createElement("canvas"); c.width=Math.round(bmp.width*k); c.height=Math.round(bmp.height*k);
    c.getContext("2d").drawImage(bmp,0,0,c.width,c.height);
    const blob=await new Promise(r=>c.toBlob(r,"image/jpeg",0.82)); return blob||file;
  }catch(e){return file}
}
function renderGenFiles(){
  const total=genFiles.reduce((s,f)=>s+f.size,0);
  $("genList").innerHTML=genFiles.map((f,i)=>`<li><span>${esc(f.name)}</span><small>${(f.size/1048576).toFixed(1)} MB</small><button class="x" data-i="${i}" aria-label="Remove ${esc(f.name)}">✕</button></li>`).join("");
  $("genList").querySelectorAll(".x").forEach(b=>b.onclick=()=>{genFiles.splice(+b.dataset.i,1);renderGenFiles()});
  $("genGo").disabled=!genFiles.length||generating;
  if(total>GEN_MAX_BYTES)genMsg(`Files total ${(total/1048576).toFixed(1)} MB; the limit is about 3 MB. Remove one or split the PDF.`,true);
  else if(!generating)genMsg(genFiles.length?"":"PDF, photos of notes, or text files. Export Word or PowerPoint as PDF first.");
}
$("genFile").onchange=async e=>{
  const picked=[...(e.target.files||[])]; e.target.value="";
  for(const f of picked){
    const t=fileType(f);
    if(!(t==="application/pdf"||t.startsWith("image/")||t.startsWith("text/"))){genMsg(`"${f.name}" isn't supported. Use PDF, a photo, or a text file.`,true);continue}
    if(genFiles.length>=GEN_MAX_FILES){genMsg(`Up to ${GEN_MAX_FILES} files at a time.`,true);break}
    let blob=f; if(t.startsWith("image/")&&t!=="image/gif") blob=await shrinkImage(f);
    genFiles.push({name:f.name,type:blob===f?t:"image/jpeg",size:blob.size,blob});
  }
  renderGenFiles();
};
$("genGo").onclick=async()=>{
  if(generating)return;
  const pass=$("genPass").value.trim();
  if(!pass){genMsg("Enter the passcode first.",true);$("genPass").focus();return}
  const total=genFiles.reduce((s,f)=>s+f.size,0);
  if(!genFiles.length){genMsg("Add a file first.",true);return}
  if(total>GEN_MAX_BYTES){renderGenFiles();return}
  try{localStorage.setItem("sscards-pass",pass)}catch(e){}
  generating=true; $("genGo").disabled=true; $("genGo").textContent="Making cards…"; genMsg("Uploading…");
  const started=Date.now(); const tick=setInterval(()=>{const s=Math.round((Date.now()-started)/1000);if($("genMsg").dataset.cards)genMsg(`Writing cards… ${$("genMsg").dataset.cards} so far (${s}s)`);else genMsg(`Reading your files… (${s}s)`)},1000);
  const finish=()=>{clearInterval(tick);generating=false;$("genGo").textContent="Make flashcards";$("genMsg").dataset.cards="";renderGenFiles()};
  try{
    const files=await Promise.all(genFiles.map(async f=>({name:f.name,type:f.type,data:await readB64(f.blob)})));
    const r=await fetch("api/generate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({passcode:pass,details:$("genDetails").value.slice(0,500),files})});
    if(!r.ok){let m=`Something went wrong (${r.status}).`;try{const j=await r.json();if(j.error)m=j.error}catch(e){} if(r.status===413)m="Those files are too big together. Split them and make two decks."; finish(); genMsg(m,true); return}
    const reader=r.body.getReader(), dec=new TextDecoder(); let text="";
    for(;;){const {done,value}=await reader.read(); if(done)break; text+=dec.decode(value,{stream:true}); const n=(text.match(/"q"\s*:/g)||[]).length; if(n)$("genMsg").dataset.cards=n}
    finish();
    const em=text.match(/\[\[ERROR:([\s\S]*?)\]\]/);
    if(em){genMsg(em[1],true);return}
    if(importText(text,m=>genMsg("The AI's reply didn't come out as a valid deck. Try again. ("+m+")",true))){genFiles=[];renderGenFiles();$("genDetails").value=""}
  }catch(e){finish();genMsg("Lost connection while making the cards. Check your signal and try again.",true)}
};
$("impClose").onclick=closeSheets;

/* ---------- countdown ---------- */
function countdown(){
  const p=$("days").parentElement;
  if(!D||!D.exam){p.hidden=true;return} p.hidden=false;
  const [y,m,dd]=D.exam.split("-").map(Number);const exam=new Date(y,m-1,dd),now=new Date();now.setHours(0,0,0,0);
  const d=Math.round((exam-now)/86400000);
  if(d>0){$("days").textContent=d;$("daysLbl").textContent=d===1?"day left":"days left"}
  else if(d===0){$("days").textContent="0";$("daysLbl").textContent="test day"}
  else p.hidden=true;
}

/* ---------- reset after inactivity ---------- */
const IDLE_MS=3*60*60*1000;
let lastActive=Date.now();
function checkIdle(){
  if(Date.now()-lastActive>IDLE_MS){
    for(const k in MEM)delete MEM[k];
    if(D)loadDeck(); streak=0; closeSheets(); startDeck(); toast("New session started");
  }
  lastActive=Date.now();
}
window.__ssIdle=v=>{lastActive=v};
["pointerdown","keydown"].forEach(ev=>document.addEventListener(ev,checkIdle,{capture:true}));
document.addEventListener("visibilitychange",()=>{if(!document.hidden)checkIdle()});
setInterval(()=>{if(Date.now()-lastActive>IDLE_MS)checkIdle()},60000);

/* ---------- notes view ---------- */
let notesBuilt=null,notesPos=null;
function buildNotes(){
  const wrap=$("nwrap"),chips=$("nchips");
  wrap.innerHTML="";chips.innerHTML="";
  const rail=$("nrail");rail.innerHTML="";
  const chs=Object.keys(D.sections).map(Number).filter(c=>D.notes&&D.notes[c]);
  $("notesTitle").textContent=D.short+" notes";
  for(const c of chs){
    const sec=document.createElement("section");sec.className="nch";sec.id="nch-"+c;sec.style.setProperty("--sw",sw(c));
    sec.innerHTML=`<div class="nhead"><div class="nnum">${D.sectionWord} ${c}</div><h2>${esc(D.sections[c])}</h2></div><div class="ntoc"><div class="lbl">In this chapter</div></div><div class="nt">${D.notes[c]}</div><div class="nfoot"><button class="primary" data-study="${c}">Practise ${D.sectionWord.toLowerCase()} ${c} cards</button></div>`;
    wrap.appendChild(sec);
    const toc=sec.querySelector(".ntoc");
    sec.querySelectorAll(".nt h3").forEach((h,i)=>{h.id=`n${c}-${i}`;const a=document.createElement("a");a.href="#"+h.id;a.textContent=h.textContent;a.onclick=e=>{e.preventDefault();h.scrollIntoView({block:"start"})};toc.appendChild(a)});
    const rc=document.createElement("div");rc.className="rc";rc.dataset.ch=c;rc.innerHTML=`<span class="dot" style="background:${sw(c)}"></span><span>${c}. ${esc(D.sections[c])}</span>`;rc.onclick=()=>sec.scrollIntoView({block:"start"});rail.appendChild(rc);
    sec.querySelectorAll(".nt h3").forEach(h=>{const ra=document.createElement("a");ra.className="rs";ra.dataset.id=h.id;ra.textContent=h.textContent;ra.onclick=()=>h.scrollIntoView({block:"start"});rail.appendChild(ra)});
    const b=document.createElement("button");b.className="nchip";b.textContent=`${c}. ${D.sections[c]}`;b.dataset.ch=c;
    b.onclick=()=>{sec.scrollIntoView({block:"start"})};chips.appendChild(b);
  }
  wrap.querySelectorAll("[data-study]").forEach(b=>b.onclick=()=>{
    const c=+b.dataset.study;closeNotes();prefs.chs=[c];prefs.types=[];prefs.pp=false;
    if(!pool().length)prefs.known=true;startDeck();toast(`${D.sectionWord} ${c} cards`);
  });
  notesBuilt=D.id;
  typeset(wrap);
  $("nsInput").value="";nsHits=[];nsCur=-1;$("nsCount").textContent="";$("nsPrev").disabled=$("nsNext").disabled=true;
}
function notesSpy(){
  const sc=$("nscroll"),top=sc.getBoundingClientRect().top+40;
  let cur=null;
  document.querySelectorAll(".nch").forEach(s=>{if(s.getBoundingClientRect().top<=top)cur=s.id.slice(4)});
  if(!cur){const f=document.querySelector(".nch");cur=f&&f.id.slice(4)}
  let on=null;
  $("nchips").querySelectorAll(".nchip").forEach(b=>{const is=b.dataset.ch===cur;b.setAttribute("aria-current",String(is));if(is)on=b});
  if(on){const bar=$("nchips");const l=on.offsetLeft-bar.clientWidth/2+on.offsetWidth/2;bar.scrollTo({left:l})}
  let curH=null;document.querySelectorAll(".nt h3").forEach(h=>{if(h.getBoundingClientRect().top<=top+20)curH=h.id});
  document.querySelectorAll("#nrail .rc").forEach(r=>r.classList.toggle("on",r.dataset.ch===cur));
  document.querySelectorAll("#nrail .rs").forEach(r=>{const is=r.dataset.id===curH;r.classList.toggle("on",is);if(is&&isSplit())r.scrollIntoView({block:"nearest"})});
  notesPos={id:D.id,top:sc.scrollTop};
}
let spyT=null;
$("nscroll").addEventListener("scroll",()=>{clearTimeout(spyT);spyT=setTimeout(notesSpy,80)},{passive:true});
function openNotes(chap){
  if(!D.notes)return;
  closeSheets();
  if(notesBuilt!==D.id)buildNotes();
  $("notes").hidden=false;
  typeset($("nwrap"));
  const sc=$("nscroll");sc.style.scrollBehavior="auto";
  const sv=notesPos&&notesPos.id===D.id?notesPos:null;
  if(chap){const s=$("nch-"+chap);if(s)sc.scrollTop=s.offsetTop-sc.querySelector(".nwrap").offsetTop}
  else if(sv&&typeof sv.top==="number")sc.scrollTop=sv.top;
  else sc.scrollTop=0;
  sc.style.scrollBehavior="";notesSpy();if(!isSplit())$("closeNotes").focus({preventScroll:true});
}
function closeNotes(){if(isSplit())return;$("nsInput").blur();nsClearMarks();$("nsInput").value="";$("nsCount").textContent="";$("nsPrev").disabled=$("nsNext").disabled=true;$("notes").hidden=true;fitNotesToViewport();$("openNotes").focus({preventScroll:true})}
/* laptop layout: at >=1024px the notes stay open beside the flashcards */
const mqSplit=window.matchMedia("(min-width:1024px)");
function isSplit(){return document.body.classList.contains("split")}
function syncLayout(){
  const want=mqSplit.matches&&!!(D&&D.notes),was=isSplit();
  if(want===was&&(!want||notesBuilt===D.id))return;
  document.body.classList.toggle("split",want);
  if(want){
    if(notesBuilt!==D.id)buildNotes();
    $("notes").hidden=false;typeset($("nwrap"));
    const sc=$("nscroll"),sv=notesPos&&notesPos.id===D.id?notesPos:null;
    sc.style.scrollBehavior="auto";sc.scrollTop=sv?sv.top:0;sc.style.scrollBehavior="";
    notesSpy();
  }else if(was){$("notes").hidden=true}
}
mqSplit.addEventListener("change",syncLayout);
$("openNotes").onclick=()=>openNotes();
$("menuNotes").onclick=()=>openNotes();
$("closeNotes").onclick=closeNotes;


/* ---------- search the notes (live, like find-in-page) ---------- */
let nsHits=[],nsCur=-1,nsT=null;
function nsClearMarks(){
  const w=$("nwrap");
  w.querySelectorAll("mark.hit").forEach(m=>{const p=m.parentNode;p.replaceChild(document.createTextNode(m.textContent),m);p.normalize()});
  nsHits=[];nsCur=-1;
}
function nsRun(){
  const q=$("nsInput").value.trim(),w=$("nwrap");
  nsClearMarks();
  $("nsPrev").disabled=$("nsNext").disabled=true;
  if(q.length<2){$("nsCount").textContent=q.length?"2+ letters":"";return}
  const needle=q.toLowerCase();
  const walker=document.createTreeWalker(w,NodeFilter.SHOW_TEXT,{acceptNode(n){
    if(!n.nodeValue.trim())return NodeFilter.FILTER_REJECT;
    const p=n.parentElement;
    if(!p||p.closest(".katex,.ntoc,.nfoot,script,style,mark.hit"))return NodeFilter.FILTER_REJECT;
    return NodeFilter.FILTER_ACCEPT}});
  const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
  const MAX=1000;let total=0;
  for(const node of nodes){
    if(total>=MAX)break;
    const text=node.nodeValue,low=text.toLowerCase(),idx=[];
    let i=low.indexOf(needle);
    while(i!==-1&&total+idx.length<MAX){idx.push(i);i=low.indexOf(needle,i+needle.length)}
    if(!idx.length)continue;
    const frag=document.createDocumentFragment();let last=0;
    for(const s of idx){
      if(s>last)frag.appendChild(document.createTextNode(text.slice(last,s)));
      const m=document.createElement("mark");m.className="hit";m.textContent=text.slice(s,s+needle.length);frag.appendChild(m);nsHits.push(m);last=s+needle.length;
    }
    if(last<text.length)frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag,node);total+=idx.length;
  }
  if(!nsHits.length){$("nsCount").textContent="No matches";return}
  $("nsPrev").disabled=$("nsNext").disabled=nsHits.length<2;
  nsGo(0,false);
}
function nsGo(i,focusInput){
  if(!nsHits.length)return;
  if(nsCur>=0&&nsHits[nsCur])nsHits[nsCur].classList.remove("cur");
  nsCur=(i+nsHits.length)%nsHits.length;
  const m=nsHits[nsCur];m.classList.add("cur");
  const sc=$("nscroll");sc.style.scrollBehavior="auto";
  m.scrollIntoView({block:"center",inline:"nearest"});
  sc.style.scrollBehavior="";
  $("nsCount").textContent=`${nsCur+1} / ${nsHits.length}${nsHits.length>=1000?"+":""}`;
}
$("nsInput").addEventListener("input",()=>{clearTimeout(nsT);nsT=setTimeout(nsRun,120)});
$("nsInput").addEventListener("keydown",e=>{
  if(e.key==="Enter"){e.preventDefault();clearTimeout(nsT);if(!nsHits.length)nsRun();else nsGo(nsCur+(e.shiftKey?-1:1))}
  else if(e.key==="Escape"){$("nsInput").value="";nsRun();$("nsInput").blur();e.stopPropagation()}
});
$("nsNext").onclick=()=>nsGo(nsCur+1);
$("nsPrev").onclick=()=>nsGo(nsCur-1);
/* on phones the keyboard covers the bottom of the screen: size the notes screen to what is visible so the bar sits above it */
function fitNotesToViewport(){
  const n=$("notes"),vv=window.visualViewport;
  const keyboardUp=vv&&innerHeight-vv.height>140;
  if(!vv||n.hidden||isSplit()||!keyboardUp){n.style.height="";n.style.top="";n.style.bottom="";return}
  n.style.bottom="auto";n.style.top=vv.offsetTop+"px";n.style.height=vv.height+"px";
}
if(window.visualViewport){visualViewport.addEventListener("resize",fitNotesToViewport);visualViewport.addEventListener("scroll",fitNotesToViewport)}

/* ---------- tap a figure to zoom ---------- */
function openZoom(src,alt){$("zoomImg").src=src;$("zoomImg").alt=alt||"";$("zoom").hidden=false;$("zoom").scrollTop=0;$("zoom").scrollLeft=0}
function closeZoom(){$("zoom").hidden=true;$("zoomImg").removeAttribute("src")}
$("nwrap").addEventListener("click",e=>{const im=e.target.closest(".nfig img");if(im)openZoom(im.currentSrc||im.src,im.alt)});
$("zoom").addEventListener("click",e=>{if(e.target.id!=="zoomImg")closeZoom()});
$("zoomClose").onclick=closeZoom;

/* ---------- boot ---------- */
async function boot(){
  $("stack").innerHTML=`<div class="done"><p>Loading decks…</p></div>`;
  let builtIn=[];
  try{
    const idx=await (await fetch("decks/index.json",{cache:"no-cache"})).json();
    const loaded=await Promise.all((idx.decks||[]).map(async e=>{
      try{const r=await fetch(e.file,{cache:"no-cache"}); return normalise(await r.json(),e.id,true)}catch(err){return null}
    }));
    builtIn=loaded.filter(Boolean);
  }catch(e){ toast("Couldn't load the built-in decks") }
  const users=readUserRaw().map(r=>{try{return normalise(r,r.id,false)}catch(e){return null}}).filter(Boolean);
  DECKS=[...builtIn,...users];
  let last=null; try{last=localStorage.getItem("sscards-last-deck")}catch(e){}
  if(DECKS.length){pickDeck(last&&DECKS.some(d=>d.id===last)?last:DECKS[0].id)}
  startDeck();
}
boot();
})();

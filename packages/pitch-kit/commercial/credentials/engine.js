/* Credenciales · icons and animation helpers. Every animation is a pure function of t:
   render(state, t) can be drawn at any time, so the deck plays it, prints its last frame and
   captures it frame by frame for the PPTX. */
/* ---------- Icons: cells of the kit's sprite ---------- */
const ICONS=['activity','airplane','apple-half','arrow-right','arrow-up-right','bank','bell-notification','box-iso','brain','building','calendar','calendar-plus','car','cart','chat-bubble','chat-lines','check-circle','cinema-old','city','clipboard-check','clock','coins','community','compass','cpu','crown','cube','data-transfer-both','database','design-pencil','dollar-circle','download','droplet','eye','filter','flash','gamepad','glass-half','globe','graph-up','group','hand-card','hand-cash','headset','health-shield','heart','help-circle','home','home-simple','hospital','industry','infinite','journal-page','leaf','light-bulb','link','lock','mail','map','medal','megaphone','minus','multiple-pages','nav-arrow-right','network','open-book','page-search','path-arrow','percentage','phone','piggy-bank','pizza-slice','play','plus','position','presentation','priority-high','puzzle','question-mark','refresh-double','repeat','reports','rocket','ruler','search','send','shield-check','shirt','shop','soccer-ball','sofa','sound-high','sparks','star','stats-report','suitcase','thumbs-up','timer','trophy','truck','tv','user-badge-check','user-crown','wallet','warning-triangle','wifi','xmark-circle'];
function paintIcons(root){
  root.querySelectorAll('.ico[data-i]').forEach(e=>{
    const i=ICONS.indexOf(e.dataset.i); if(i<0) return;
    const s=e.offsetWidth||parseFloat(getComputedStyle(e).width);
    const tone=e.dataset.t||'teal';
    e.style.backgroundImage=`url(assets/sprite-${tone}.png)`;
    e.style.backgroundSize=`${12*s}px ${9*s}px`;
    e.style.backgroundPosition=`-${(i%12)*s}px -${Math.floor(i/12)*s}px`;
  });
}

/* ---------- Animation engine ---------- */
const NS='http://www.w3.org/2000/svg';
const C={ink:'#0a0a0a',fg:'#2b2b2b',fg2:'#6d6d6d',fg3:'#9a9a9a',teal:'#008a8a',tealSoft:'#e6f7f7',coral:'#e2543c',coralSoft:'#fdece8',skel:'#e3e3e3',dot:'#c4c4c4',border:'#e8e8e8',white:'#fff'};
const cl=x=>Math.min(1,Math.max(0,x));
const E=x=>1-Math.pow(1-cl(x),4);                 // long, soft ease out
const EIO=x=>{x=cl(x);return x<.5?8*x*x*x*x:1-Math.pow(-2*x+2,4)/2};
const seg=(t,a,b,f=E)=>f((t-a)/(b-a));
const lerp=(a,b,k)=>a+(b-a)*k;
function rng(s){return()=>{s=(s*16807)%2147483647;return(s-1)/2147483646}}
function el(tag,at,p){const e=document.createElementNS(NS,tag);for(const k in at)e.setAttribute(k,at[k]);if(p)p.appendChild(e);return e}
function txt(p,x,y,s,at={}){const e=el('text',Object.assign({x,y,'font-size':20,fill:C.fg},at),p);e.textContent=s;return e}
function pill(p,x,y,label,o={}){
  const g=el('g',{},p); const fs=o.fs||20, h=o.h||46;
  const t=txt(g,0,0,label,{'font-size':fs,fill:o.color||C.fg,'font-weight':o.bold?700:500,'dominant-baseline':'central'});
  const w=Math.max(o.minW||0,t.getComputedTextLength()+(o.padX||22)*2);
  const r=el('rect',{x:0,y:-h/2,width:w,height:h,rx:h/2,fill:o.fill||C.white,stroke:o.stroke||C.border,'stroke-width':1.5},g);
  g.insertBefore(r,t); t.setAttribute('x',o.center?w/2:(o.padX||22)); if(o.center)t.setAttribute('text-anchor','middle');
  g.setAttribute('transform',`translate(${o.anchor==='mid'?x-w/2:x},${y})`);
  g.w=w; return g;
}
function drawOn(path,k){const L=path.__L||(path.__L=path.getTotalLength());path.setAttribute('stroke-dasharray',L);path.setAttribute('stroke-dashoffset',L*(1-k))}
function bez(x1,y1,x2,y2){const mx=(x1+x2)/2;return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
function bezPt(x1,y1,x2,y2,k){const mx=(x1+x2)/2,u=1-k;return[u*u*u*x1+3*u*u*k*mx+3*u*k*k*mx+k*k*k*x2,u*u*u*y1+3*u*u*k*y1+3*u*k*k*y2+k*k*k*y2]}
function op(e,v){e.setAttribute('opacity',v)}
function tr(e,x,y,s){e.setAttribute('transform',`translate(${x},${y})`+(s!=null?` scale(${s})`:''))}

// LIB holds every animation by name (anims/*.js). ANIMS maps a slide index to its animation, bound
// from <svg data-anim="name"> when the deck builds, so capture_gifs.py can drive ANIMS[k] by index.
const LIB={}, ANIMS={};
// A list of labels the deck can replace with data-labels='{"rows":[...]}' on the <svg>.
function lab(svg,key,fallback){try{const d=JSON.parse(svg.dataset.labels||'{}');return d[key]||fallback}catch(e){return fallback}}

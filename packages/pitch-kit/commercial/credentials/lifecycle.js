/* Credenciales · lifecycle. Binds each <svg data-anim="name"> to its animation in LIB, draws every
   animation on its last frame, plays the one on the active slide from 0, and prints last frames. */
const deck=document.querySelector('deck-stage');
let raf=null, built=false; const ST={};
function build(){ if(built) return; built=true;
  const slides=[...deck.querySelectorAll(':scope > section')];
  slides.forEach((s,k)=>{
    const svg=s.querySelector('svg[data-anim]'); if(!svg) return;
    const A=LIB[svg.dataset.anim]; if(!A){console.warn('no animation',svg.dataset.anim);return}
    ANIMS[k]=A; ST[k]=A.setup(svg); A.render(ST[k],A.dur);
  });
}
// Website slides carry a video: it plays from the start when its slide comes in and stops on the
// finished diagram (data-stop, the website's poster frame), before the composition fades out to loop.
// If a browser misses the stop, the end shows the finished PNG instead of a blank stage.
function holdOnPoster(v){
  const stop=parseFloat(v.dataset.stop);
  const img=v.parentElement.querySelector('img.poster');
  const rest=()=>{v.pause();if(stop)v.currentTime=stop};
  const tick=()=>{if(v.paused)return;if(stop&&v.currentTime>=stop){rest();return}
    if(v.requestVideoFrameCallback)v.requestVideoFrameCallback(tick);else requestAnimationFrame(tick)};
  // A class, not an inline display: an inline style would beat the print rule that shows the poster.
  v.addEventListener('play',()=>{if(img)img.classList.remove('shown');tick()});
  // timeupdate still fires (about 4 times a second) where frame callbacks are throttled, e.g. a hidden tab.
  v.addEventListener('timeupdate',()=>{if(!v.paused&&stop&&v.currentTime>=stop)rest()});
  v.addEventListener('ended',()=>{if(img)img.classList.add('shown')});
}
document.querySelectorAll('video[data-web]').forEach(holdOnPoster);
function playVideos(idx){
  deck.querySelectorAll(':scope > section').forEach((s,i)=>{const v=s.querySelector('video[data-web]');if(!v)return;
    if(i===idx){v.currentTime=0;v.play().catch(()=>{})}else{v.pause();if(parseFloat(v.dataset.stop))v.currentTime=parseFloat(v.dataset.stop)}});
}
function play(idx){
  playVideos(idx);
  cancelAnimationFrame(raf);
  for(const k in ANIMS) if(+k!==idx) ANIMS[k].render(ST[k],ANIMS[k].dur);
  const A=ANIMS[idx]; if(!A) return;
  const t0=performance.now();
  const step=now=>{const t=(now-t0)/1000;A.render(ST[idx],Math.min(t,A.dur));if(t<A.dur) raf=requestAnimationFrame(step)};
  A.render(ST[idx],0); raf=requestAnimationFrame(step);
}
document.fonts.ready.then(()=>{
  build(); paintIcons(document);
  const cur=deck.querySelectorAll(':scope > section'); let idx=0;
  cur.forEach((s,i)=>{if(getComputedStyle(s).visibility!=='hidden')idx=i});
  play(idx);
});
deck.addEventListener('slidechange',e=>{ if(built) play(e.detail.index) });
window.addEventListener('beforeprint',()=>{cancelAnimationFrame(raf);for(const k in ANIMS)ANIMS[k].render(ST[k],ANIMS[k].dur)});

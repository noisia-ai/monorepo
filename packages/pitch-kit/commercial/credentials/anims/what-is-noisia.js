/* what-is-noisia · en
   Slide 'what Noisia is': 84 dots, noise falls, three clusters, a priority card and the evidence card. 1680x400.
   From a real credentials deck. Labels in lab(svg,'key',[...]) can be replaced per deck with
   data-labels on the <svg>; the rest of the text is in this file's language. */
LIB['what-is-noisia']={dur:6.6,setup(svg){
  const R=rng(7), S={};
  [0,1,2,3].forEach(i=>{ if(i) el('line',{x1:i*420,y1:20,x2:i*420,y2:380,stroke:'#f0f0f0','stroke-width':1.5},svg) });
  const clusters=[[560,130,C.teal],[700,250,C.coral],[540,310,C.ink]];
  S.halo=clusters.map(c=>el('circle',{cx:c[0],cy:c[1],r:62,fill:c[2],opacity:0},svg));
  S.dots=[];
  for(let i=0;i<84;i++){
    const keep=i<60, ci=i%3, a=R()*6.28, rr=Math.sqrt(R())*44;
    const d={x0:30+R()*360,y0:30+R()*340,keep,ci,x1:clusters[ci][0]+Math.cos(a)*rr,y1:clusters[ci][1]+Math.sin(a)*rr,delay:R()*1.1};
    d.g=el('circle',{r:6.5,fill:C.dot,cx:d.x0,cy:d.y0,opacity:0},svg); d.e=el('circle',{r:6.5,fill:C.dot},svg); S.dots.push(d);
  }
  S.card=el('g',{},svg); tr(S.card,890,60);
  el('rect',{width:320,height:270,rx:16,fill:C.white,stroke:C.border,'stroke-width':1.5},S.card);
  txt(S.card,24,44,'What do we do first?',{'font-size':21,'font-weight':700,fill:C.ink});
  S.rows=[0,1,2].map(i=>{const g=el('g',{},S.card);tr(g,24,80+i*62);
    el('circle',{cx:16,cy:16,r:16,fill:i?'#f1f1f1':C.tealSoft},g);
    txt(g,16,17,String(i+1),{'font-size':16,'font-weight':700,fill:i?C.fg2:C.teal,'text-anchor':'middle','dominant-baseline':'central'});
    const b=el('rect',{x:46,y:6,height:20,rx:10,width:0,fill:i?C.skel:C.teal,opacity:i?1:.85},g); b.W=[210,170,130][i]; return b});
  S.links=clusters.map((c,i)=>el('path',{d:bez(c[0]+60,c[1],890,140+i*62),fill:'none',stroke:'#d9d9d9','stroke-width':2},svg));
  S.ev=el('g',{},svg); tr(S.ev,1330,150);
  el('rect',{width:300,height:150,rx:16,fill:C.white,stroke:C.border,'stroke-width':1.5},S.ev);
  el('circle',{cx:38,cy:40,r:16,fill:C.skel},S.ev);
  el('rect',{x:66,y:30,width:150,height:14,rx:7,fill:C.skel},S.ev);
  el('rect',{x:24,y:74,width:252,height:14,rx:7,fill:'#eeeeee'},S.ev);
  el('rect',{x:24,y:98,width:200,height:14,rx:7,fill:'#eeeeee'},S.ev);
  txt(S.ev,24,136,'text · date · platform · market',{'font-size':15,fill:C.fg3});
  S.evl2=el('path',{d:'M1210,140 C1270,140 1270,225 1330,225',fill:'none',stroke:C.teal,'stroke-width':2.5},svg);
  return S},
 render(S,t){
  S.dots.forEach(d=>{
    const kin=seg(t,d.delay*.6,d.delay*.6+.9), km=seg(t,1.6+d.delay*.5,2.9+d.delay*.5,EIO);
    let x=lerp(d.x0-70,d.x0,kin), y=d.y0, o=kin, f=C.dot;
    if(d.keep){x=lerp(x,d.x1,km);y=lerp(y,d.y1,km); if(km>.5) f=[C.teal,C.coral,C.ink][d.ci];}
    else o=kin*(1-seg(t,1.5+d.delay*.4,2.2+d.delay*.4));
    d.e.setAttribute('cx',x);d.e.setAttribute('cy',y);d.e.setAttribute('fill',f);op(d.e,d.keep?o*(km>.5?.9:1):o);
    op(d.g,.35*seg(t,1.7+d.delay*.5,2.6+d.delay*.5));
  });
  S.halo.forEach((h,i)=>op(h,.08*seg(t,3+i*.15,3.6+i*.15)));
  S.links.forEach((p,i)=>drawOn(p,seg(t,3.5+i*.12,4.3+i*.12)));
  op(S.card,seg(t,3.4,3.9)); tr(S.card,890+20*(1-seg(t,3.4,4)),60);
  S.rows.forEach((b,i)=>b.setAttribute('width',b.W*seg(t,3.9+i*.18,4.7+i*.18)));
  op(S.ev,seg(t,5.2,5.7)); tr(S.ev,1330+20*(1-seg(t,5.2,5.8)),150);
  drawOn(S.evl2,seg(t,4.8,5.5));
 }};

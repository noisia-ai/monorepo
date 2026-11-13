/* protocol-zooms · en
   One protocol: language pills, a relevance filter, collected vs analyzed, four zooms (global, region, country, brand). 1680x400.
   From a real credentials deck. Labels in lab(svg,'key',[...]) can be replaced per deck with
   data-labels on the <svg>; the rest of the text is in this file's language. */
LIB['protocol-zooms']={dur:6.4,setup(svg){
  const S={}, langs=lab(svg,'langs',['Español','Português','English','Français','Türkçe','Bahasa']);
  S.langs=langs.map((l,i)=>{const g=pill(svg,0,56+i*58,l,{fs:18,h:42,minW:150});return g});
  // filter gate
  S.gate=el('g',{},svg); tr(S.gate,430,20);
  el('rect',{width:96,height:330,rx:20,fill:C.tealSoft},S.gate);
  el('rect',{width:96,height:330,rx:20,fill:'none',stroke:C.teal,'stroke-width':2},S.gate);
  txt(S.gate,48,-2,'',{});
  S.gateLbl=txt(svg,478,385,'Relevance filter',{'font-size':17,'font-weight':700,fill:C.teal,'text-anchor':'middle'});
  // dots
  const R=rng(31); S.dots=[];
  for(let i=0;i<70;i++){const li=Math.floor(R()*6), keep=R()<.48;
    S.dots.push({li,keep,y0:56+li*58,y1:60+R()*270,yk:70+R()*250,t0:.6+R()*2.2,e:el('circle',{r:6,fill:C.dot,opacity:0},svg)})}
  // collected vs analyzed
  S.bars=el('g',{},svg); tr(S.bars,570,300);
  txt(S.bars,0,0,'Collected',{'font-size':16,fill:C.fg2});
  el('rect',{x:0,y:10,width:90,height:10,rx:5,fill:'#ececec'},S.bars);
  S.bc=el('rect',{x:0,y:10,width:0,height:10,rx:5,fill:C.dot},S.bars);
  txt(S.bars,0,50,'Analyzed',{'font-size':16,fill:C.teal,'font-weight':700});
  S.ba=el('rect',{x:0,y:60,width:0,height:10,rx:5,fill:C.teal},S.bars);
  // four zooms
  const zooms=['Global','Region','Country','Brand'];
  S.panels=zooms.map((z,i)=>{const g=el('g',{},svg);const x=730+i*238;tr(g,x,40);g.X=x;
    el('rect',{width:212,height:300,rx:16,fill:C.white,stroke:C.border,'stroke-width':1.5},g);
    txt(g,20,40,z,{'font-size':20,'font-weight':700,fill:i==0?C.teal:C.ink});
    const R2=rng(50+i*7); g.cells=[];
    for(let r=0;r<5;r++)for(let c=0;c<4;c++){const v=R2();g.cells.push(el('rect',{x:20+c*44,y:66+r*44,width:36,height:36,rx:8,fill:v>.62?C.teal:v>.3?'#7cc4c4':'#e6f2f2',opacity:0},g))}
    return g});
  S.arrows=[0,1,2].map(i=>el('path',{d:`M${730+i*238+214},190 L${730+(i+1)*238-4},190`,fill:'none',stroke:'#cfcfcf','stroke-width':2},svg));
  S.bracket=el('path',{d:'M730,362 L730,372 L1644,372 L1644,362',fill:'none',stroke:C.teal,'stroke-width':2},svg);
  S.bLbl=txt(svg,1187,396,'One protocol',{'font-size':17,'font-weight':700,fill:C.teal,'text-anchor':'middle'});
  S.feed=el('path',{d:bez(526,185,730,190),fill:'none',stroke:C.teal,'stroke-width':2.5},svg);
  return S},
 render(S,t){
  const fin=t>=this.dur-.001;
  S.langs.forEach((g,i)=>op(g,seg(t,i*.08,.5+i*.08)));
  op(S.gate,seg(t,.4,.9)); op(S.gateLbl,seg(t,.5,1));
  let nc=0,na=0;
  S.dots.forEach(d=>{const k=(t-d.t0)/1.3; if(k>=1)nc++,d.keep&&na++;
    if(fin||k<0||k>=1.6){op(d.e,0);return}
    const xs=S.langs[d.li].w+10;
    if(k<1){const x=lerp(xs,478,EIO(k)), y=lerp(d.y0,d.y1,EIO(k));d.e.setAttribute('cx',x);d.e.setAttribute('cy',y);d.e.setAttribute('fill',C.dot);op(d.e,Math.min(1,k*5))}
    else{const k2=(k-1)/.6;
      if(d.keep){d.e.setAttribute('cx',lerp(478,560,k2));d.e.setAttribute('cy',lerp(d.y1,185,k2));d.e.setAttribute('fill',C.teal);op(d.e,1-k2)}
      else{d.e.setAttribute('cx',478);d.e.setAttribute('cy',d.y1+k2*40);d.e.setAttribute('fill',C.dot);op(d.e,(1-k2)*.6)}}
  });
  if(fin){nc=70;na=S.dots.filter(d=>d.keep).length}
  op(S.bars,seg(t,1,1.4));
  S.bc.setAttribute('width',90*nc/70); S.ba.setAttribute('width',90*na/70);
  drawOn(S.feed,seg(t,3.2,3.8));
  S.panels.forEach((g,i)=>{const k=seg(t,3.6+i*.45,4.2+i*.45);op(g,k);tr(g,g.X+12*(1-k),40);
    g.cells.forEach((c,j)=>op(c,seg(t,3.9+i*.45+j*.012,4.3+i*.45+j*.012)))});
  S.arrows.forEach((p,i)=>drawOn(p,seg(t,4.1+i*.45,4.5+i*.45)));
  drawOn(S.bracket,seg(t,5.4,6)); op(S.bLbl,seg(t,5.6,6));
 }};

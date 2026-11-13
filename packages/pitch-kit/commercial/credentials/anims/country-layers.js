/* country-layers · en
   Case: moments and the four layers around a person. 920x780. Lists: names, moments.
   From a real credentials deck. Labels in lab(svg,'key',[...]) can be replaced per deck with
   data-labels on the <svg>; the rest of the text is in this file's language. */
LIB['country-layers']={dur:5.8,setup(svg){
  const S={}, cx=460, cy=430, radii=[80,145,210,275], names=lab(svg,'names',['Psychological','Personal','Social','Cultural']);
  const moments=lab(svg,'moments',['Meal','Heat','Sport','Celebration','Work','Gaming']);
  let x=0; const ps=moments.map(m=>{const g=pill(svg,0,0,m,{fs:17,h:40});return g});
  const W=ps.reduce((a,g)=>a+g.w,0)+12*(ps.length-1); x=(920-W)/2;
  ps.forEach(g=>{g.X=x;x+=g.w+12;tr(g,g.X,62)}); S.moments=ps;
  S.rings=radii.map((r,i)=>el('circle',{cx,cy,r,fill:i==0?C.tealSoft:'none',stroke:i==0?C.teal:'#d8d8d8','stroke-width':i==0?2:1.6,transform:`rotate(-90 ${cx} ${cy})`},svg));
  S.labels=radii.map((r,i)=>{const g=el('g',{},svg);
    const t=txt(g,cx,cy-r+ (i==0?0:0),names[i],{'font-size':15,'font-weight':700,fill:i==0?C.teal:C.fg2,'text-anchor':'middle','dominant-baseline':'central'});
    const w=t.getComputedTextLength()+16; const bg=el('rect',{x:cx-w/2,y:cy-r-11,width:w,height:22,rx:11,fill:'#fafafa'},g); g.insertBefore(bg,t);
    if(i==0){t.setAttribute('y',cy);bg.setAttribute('y',cy-11);bg.setAttribute('fill',C.tealSoft)}
    return g});
  const R=rng(29); S.dots=[];
  for(let i=0;i<34;i++){const ri=1+Math.floor(R()*3)%3, a=(-Math.PI/2)+0.35+R()*(2*Math.PI-0.7), drive=R()<.58;
    const r=radii[ri]; S.dots.push({e:el('circle',{cx:cx+Math.cos(a)*r,cy:cy+Math.sin(a)*r,r:0,fill:drive?C.teal:C.coral},svg),d:R()*1.4})}
  S.leg=el('g',{},svg); tr(S.leg,40,748);
  el('circle',{cx:8,cy:-6,r:8,fill:C.teal},S.leg); txt(S.leg,24,0,'Drives',{'font-size':16,fill:C.fg2});
  el('circle',{cx:118,cy:-6,r:8,fill:C.coral},S.leg); txt(S.leg,134,0,'Holds back',{'font-size':16,fill:C.fg2});
  return S},
 render(S,t){
  S.moments.forEach((g,i)=>{const k=seg(t,i*.1,.5+i*.1);op(g,k);tr(g,g.X,62+10*(1-k))});
  S.rings.forEach((c,i)=>drawOn(c,seg(t,.6+i*.25,1.6+i*.25)));
  S.labels.forEach((g,i)=>op(g,seg(t,1.2+i*.25,1.6+i*.25)));
  S.dots.forEach(d=>d.e.setAttribute('r',8*seg(t,2.6+d.d,3.1+d.d,E)));
  op(S.leg,seg(t,4.4,4.9));
 }};

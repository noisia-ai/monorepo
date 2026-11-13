/* campaign-weeks · en
   Case: before, during and after, weeks 1, 2 and 4 against last year. 920x780.
   From a real credentials deck. Labels in lab(svg,'key',[...]) can be replaced per deck with
   data-labels on the <svg>; the rest of the text is in this file's language. */
LIB['campaign-weeks']={dur:5.4,setup(svg){
  const S={}, x0=60,x1=880,base=560;
  S.win=el('rect',{x:300,y:150,width:330,height:base-150,rx:12,fill:C.tealSoft,opacity:0},svg);
  ['Before','During','After'].forEach((s,i)=>txt(svg,[180,465,760][i],132,s,{'font-size':19,'font-weight':700,fill:i==1?C.teal:C.fg2,'text-anchor':'middle'}));
  el('line',{x1:x0,y1:base,x2:x1,y2:base,stroke:'#dcdcdc','stroke-width':1.5},svg);
  const mk=(seed,amp,shift)=>{const R=rng(seed);const pts=[];for(let i=0;i<=40;i++){const x=x0+i*(x1-x0)/40;const bump=Math.exp(-Math.pow((x-450-shift)/90,2))*amp+Math.exp(-Math.pow((x-560)/50,2))*amp*.35;pts.push([x,base-(70+bump+R()*24)])}return pts};
  const pts=mk(41,230,0), prev=mk(9,120,-20);
  const d=p=>'M'+p.map(q=>q.map(n=>n.toFixed(1)).join(',')).join(' L');
  S.prev=el('path',{d:d(prev),fill:'none',stroke:'#bdbdbd','stroke-width':2.5,'stroke-dasharray':'8 8'},svg);
  S.area=el('path',{d:d(pts)+` L${x1},${base} L${x0},${base} Z`,fill:C.teal,opacity:0},svg);
  S.line=el('path',{d:d(pts),fill:'none',stroke:C.teal,'stroke-width':3.5,'stroke-linejoin':'round','stroke-linecap':'round'},svg);
  S.marks=[[pts[12],'Week 1'],[pts[17],'Week 2'],[pts[27],'Week 4']].map(([p,l])=>{const g=el('g',{},svg);tr(g,p[0],p[1]);
    el('circle',{r:8,fill:C.white,stroke:C.teal,'stroke-width':3},g);
    const b=el('g',{},g);tr(b,-62,-86);el('rect',{width:124,height:62,rx:10,fill:C.white,stroke:C.border,'stroke-width':1.5},b);
    txt(b,14,24,l,{'font-size':15,'font-weight':700,fill:C.teal});el('rect',{x:14,y:38,width:90,height:9,rx:4.5,fill:C.skel},b);return g});
  S.cities=el('g',{},svg); tr(S.cities,40,620);
  let x=0; ['City 1','City 2','City 3','Country view'].forEach((c,i)=>{const g=pill(S.cities,x,40,c,{fs:16,h:38,fill:i==3?C.tealSoft:C.white,stroke:i==3?C.tealSoft:C.border,color:i==3?C.teal:C.fg});x+=g.w+10});
  S.leg=el('g',{},svg); tr(S.leg,560,660);
  el('line',{x1:0,y1:0,x2:30,y2:0,stroke:C.teal,'stroke-width':3.5},S.leg); txt(S.leg,40,6,'This year',{'font-size':16,fill:C.fg2});
  el('line',{x1:140,y1:0,x2:170,y2:0,stroke:'#bdbdbd','stroke-width':2.5,'stroke-dasharray':'8 8'},S.leg); txt(S.leg,180,6,'Last year',{'font-size':16,fill:C.fg2});
  return S},
 render(S,t){
  op(S.win,seg(t,.1,.7)); drawOn(S.prev,seg(t,.3,2.2,EIO)); drawOn(S.line,seg(t,.5,2.8,EIO)); op(S.area,.08*seg(t,2.4,3));
  S.marks.forEach((g,i)=>op(g,seg(t,2.9+i*.3,3.4+i*.3)));
  op(S.cities,seg(t,4,4.5)); op(S.leg,seg(t,4.2,4.7));
 }};

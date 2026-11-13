/* campaign-window · es
   Caso: antes, durante y después con la curva y tres marcas. 920x780.
   From a real credentials deck. Labels in lab(svg,'key',[...]) can be replaced per deck with
   data-labels on the <svg>; the rest of the text is in this file's language. */
LIB['campaign-window']={dur:4.6,setup(svg){
  const S={}, x0=60,x1=880,base=440;
  S.win=el('rect',{x:360,y:70,width:240,height:base-70,rx:12,fill:C.tealSoft,opacity:0},svg);
  ['Antes','Durante','Después'].forEach((s,i)=>txt(svg,[210,480,740][i],52,s,{'font-size':19,'font-weight':700,fill:i==1?C.teal:C.fg2,'text-anchor':'middle'}));
  el('line',{x1:x0,y1:base,x2:x1,y2:base,stroke:'#dcdcdc','stroke-width':1.5},svg);
  const R=rng(41);let pts=[];for(let i=0;i<=40;i++){const x=x0+i*(x1-x0)/40;let bump=Math.exp(-Math.pow((x-470)/80,2))*190+Math.exp(-Math.pow((x-560)/40,2))*70;const v=80+bump+R()*28;pts.push([x,base-v])}
  const d='M'+pts.map(p=>p.map(n=>n.toFixed(1)).join(',')).join(' L');
  S.area=el('path',{d:d+` L${x1},${base} L${x0},${base} Z`,fill:C.teal,opacity:0},svg);
  S.line=el('path',{d,fill:'none',stroke:C.teal,'stroke-width':3.5,'stroke-linejoin':'round','stroke-linecap':'round'},svg);
  S.marks=[[pts[13],0],[pts[18],1],[pts[29],2]].map(([p,i])=>{const g=el('g',{},svg);tr(g,p[0],p[1]);
    el('circle',{r:8,fill:C.white,stroke:C.teal,'stroke-width':3},g);
    const b=el('g',{},g);tr(b,-70,-74);el('rect',{width:140,height:50,rx:10,fill:C.white,stroke:C.border,'stroke-width':1.5},b);
    el('rect',{x:14,y:14,width:96,height:9,rx:4.5,fill:C.skel},b);el('rect',{x:14,y:30,width:70,height:9,rx:4.5,fill:'#ececec'},b);return g});
  ['Semana 1','Semana 2','Semana 3','Semana 4','Semana 5','Semana 6'].forEach((s,i)=>txt(svg,x0+40+i*(x1-x0-80)/5,base+36,s,{'font-size':15,fill:C.fg3,'text-anchor':'middle'}));
  return S},
 render(S,t){
  op(S.win,seg(t,.1,.7)); drawOn(S.line,seg(t,.4,2.8,EIO)); op(S.area,.08*seg(t,2.4,3));
  S.marks.forEach((g,i)=>op(g,seg(t,2.9+i*.25,3.4+i*.25)));
 }};

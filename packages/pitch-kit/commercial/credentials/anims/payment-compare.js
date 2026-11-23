/* payment-compare · en
   Case: a payment experience read topic by topic against each competitor; the weak spot of the brand lifts
   into "act first". 920x780. Lists: rows, cols.
   Labels in lab(svg,'key',[...]) can be replaced per deck with data-labels on the <svg>; fixed text can be
   replaced with the 'ui' key (data-labels='{"ui":{...}}'), so the same file serves any language. */
LIB['payment-compare']={dur:5.6,setup(svg){
  const S={}, U=Object.assign({title:'Payment experience, topic by topic',adds:'Adds',mixed:'Mixed',holds:'Holds back',act:'Act first this month'},lab(svg,'ui',{})),
    rows=lab(svg,'rows',['Declined payments','Fees and charges','Refunds and chargebacks','Transfer times','Support when it fails','Fraud and security']),
    cols=lab(svg,'cols',['You','Competitor 1','Competitor 2','Competitor 3']);
  S.title=txt(svg,40,64,U.title,{'font-size':22,'font-weight':700,fill:C.ink});
  const X0=440,CW=128,Y0=176,RH=62, HOT=2;   // HOT: the row where the brand holds back, highlighted at the end
  S.tint=el('rect',{x:24,y:Y0+HOT*RH-27,width:872,height:54,rx:12,fill:C.coralSoft,opacity:0},svg);
  S.head=cols.map((c,i)=>txt(svg,X0+i*CW,128,c,{'font-size':16,'font-weight':i?500:700,fill:i?C.fg2:C.ink,'text-anchor':'middle'}));
  S.rows=rows.map((r,i)=>{const g=el('g',{},svg);
    if(i)el('line',{x1:40,y1:Y0+i*RH-RH/2,x2:880,y2:Y0+i*RH-RH/2,stroke:'#efefef','stroke-width':1.5},g);
    txt(g,40,Y0+i*RH+1,r,{'font-size':18,'font-weight':500,fill:C.fg,'dominant-baseline':'central'});return g});
  const R=rng(29); S.cells=[];
  rows.forEach((_,ri)=>cols.forEach((_,ci)=>{let v=R(); if(ri===HOT&&ci===0)v=.1; if(ri===HOT&&ci===1)v=.9;
    const g=el('g',{},svg); tr(g,X0+ci*CW,Y0+ri*RH);
    if(v>.55){el('circle',{r:14,fill:C.teal},g)}
    else if(v>.25){el('circle',{r:13,fill:'none',stroke:C.teal,'stroke-width':3},g);el('path',{d:'M0,-13 A13,13 0 0,1 0,13 Z',fill:C.teal},g)}
    else{el('circle',{r:13,fill:'none',stroke:C.coral,'stroke-width':3},g)}
    g.X=X0+ci*CW; g.Y=Y0+ri*RH; g.d=ri*.16+ci*.07; S.cells.push(g)}));
  S.ring=el('circle',{cx:X0,cy:Y0+HOT*RH,r:24,fill:'none',stroke:C.coral,'stroke-width':2.5,opacity:0},svg);
  // legend
  S.leg=el('g',{},svg); tr(S.leg,40,560);
  [[U.adds,'full'],[U.mixed,'half'],[U.holds,'ring']].reduce((x,[l,k])=>{const g=el('g',{},S.leg);tr(g,x,0);
    if(k==='full')el('circle',{cx:9,cy:0,r:9,fill:C.teal},g);
    else if(k==='half'){el('circle',{cx:9,cy:0,r:8,fill:'none',stroke:C.teal,'stroke-width':2.5},g);el('path',{d:'M9,-8 A8,8 0 0,1 9,8 Z',fill:C.teal},g)}
    else el('circle',{cx:9,cy:0,r:8,fill:'none',stroke:C.coral,'stroke-width':2.5},g);
    const t=txt(g,28,6,l,{'font-size':16,fill:C.fg2}); return x+40+l.length*9+28},0);
  // act-first card
  S.card=el('g',{},svg); tr(S.card,40,600);
  el('rect',{width:840,height:140,rx:16,fill:C.white,stroke:C.border,'stroke-width':1.5},S.card);
  el('rect',{x:24,y:24,width:44,height:44,rx:12,fill:C.coralSoft},S.card);
  const ph=el('g',{},S.card); tr(ph,31,31); const n=ICONS.indexOf('priority-high');
  el('image',{href:'assets/sprite-coral.png',width:12*30,height:9*30,x:-(n%12)*30,y:-Math.floor(n/12)*30,'clip-path':'url(#cpPay)'},ph);
  const cp=el('clipPath',{id:'cpPay'},svg); el('rect',{x:0,y:0,width:30,height:30},cp);
  txt(S.card,86,52,U.act,{'font-size':19,'font-weight':700,fill:C.ink});
  txt(S.card,86,100,rows[HOT],{'font-size':18,'font-weight':500,fill:C.coral});
  S.b1=el('rect',{x:420,y:84,width:0,height:14,rx:7,fill:C.skel},S.card);
  S.b2=el('rect',{x:420,y:108,width:0,height:14,rx:7,fill:'#ececec'},S.card);
  S.pct=el('rect',{x:728,y:24,width:88,height:52,rx:12,fill:C.coralSoft,opacity:0},S.card);
  S.pctT=txt(S.card,772,51,'XX%',{'font-size':22,'font-weight':700,fill:C.coral,'text-anchor':'middle','dominant-baseline':'central',opacity:0});
  return S},
 render(S,t){
  op(S.title,seg(t,0,.5));
  S.head.forEach((h,i)=>op(h,seg(t,.3+i*.08,.8+i*.08)));
  S.rows.forEach((g,i)=>op(g,seg(t,.5+i*.08,1+i*.08)));
  S.cells.forEach(g=>{const k=seg(t,1.3+g.d,1.8+g.d);op(g,k);g.setAttribute('transform',`translate(${g.X},${g.Y}) scale(${.6+.4*k})`)});
  op(S.leg,seg(t,2.6,3.1));
  op(S.tint,seg(t,3.3,3.8)); op(S.ring,seg(t,3.4,3.9));
  op(S.card,seg(t,3.8,4.3)); tr(S.card,40,600+16*(1-seg(t,3.8,4.4)));
  S.b1.setAttribute('width',300*seg(t,4.3,5)); S.b2.setAttribute('width',220*seg(t,4.5,5.2));
  op(S.pct,seg(t,4.9,5.3)); op(S.pctT,seg(t,5,5.4));
 }};

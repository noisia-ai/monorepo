/* trend-matrix · en
   Case: trend by category matrix and a tension card. 920x780. Lists: rows, cols.
   From a real credentials deck. Labels in lab(svg,'key',[...]) can be replaced per deck with
   data-labels on the <svg>; the rest of the text is in this file's language. */
LIB['trend-matrix']={dur:5.6,setup(svg){
  const S={}, rows=lab(svg,'rows',['Health & Wellness','Indulgence & Premium','Occasions','Sustainability & Pack','Culture & Passions','Regulation']),
    cols=lab(svg,'cols',['Sparkling','Water','Sports','Coffee, tea','Juice, dairy']);
  txt(svg,40,64,'Trend by category',{'font-size':22,'font-weight':700,fill:C.ink});
  const X0=330,CW=112,Y0=150,RH=64;
  S.cols=cols.map((c,i)=>txt(svg,X0+i*CW,118,c,{'font-size':16,fill:C.fg2,'text-anchor':'middle'}));
  S.rows=rows.map((r,i)=>{const g=el('g',{},svg);
    el('line',{x1:40,y1:Y0+i*RH+RH/2,x2:880,y2:Y0+i*RH+RH/2,stroke:'#efefef','stroke-width':1.5},g);
    txt(g,40,Y0+i*RH+6,r,{'font-size':18,'font-weight':500,fill:C.fg,'dominant-baseline':'central'});return g});
  const R=rng(17); S.b=[];
  rows.forEach((_,ri)=>cols.forEach((_,ci)=>{const v=R(); const rr=6+v*v*20;
    S.b.push({e:el('circle',{cx:X0+ci*CW,cy:Y0+ri*RH,r:0,fill:C.teal,opacity:.25+v*.6},svg),R:rr,d:ri*.12+ci*.05})}));
  // highlight of the top cell
  const top=S.b.reduce((a,b)=>b.R>a.R?b:a);
  S.ring=el('circle',{cx:top.e.getAttribute('cx'),cy:top.e.getAttribute('cy'),r:top.R+9,fill:'none',stroke:C.teal,'stroke-width':2.5,opacity:0},svg);
  // tension card
  S.card=el('g',{},svg); tr(S.card,40,560);
  el('rect',{width:840,height:150,rx:16,fill:C.white,stroke:C.border,'stroke-width':1.5},S.card);
  txt(S.card,28,46,'A tension, sized',{'font-size':18,'font-weight':700,fill:C.ink});
  txt(S.card,28,100,'I want',{'font-size':24,'font-weight':700,fill:C.teal});
  S.w1=el('rect',{x:120,y:84,width:0,height:20,rx:10,fill:'#bfe3e3'},S.card);
  txt(S.card,390,100,'but',{'font-size':24,'font-weight':700,fill:C.coral});
  S.w2=el('rect',{x:448,y:84,width:0,height:20,rx:10,fill:'#f6c9bf'},S.card);
  S.pct=el('rect',{x:724,y:66,width:88,height:56,rx:12,fill:C.tealSoft,opacity:0},S.card);
  S.pctT=txt(S.card,768,95,'XX%',{'font-size':24,'font-weight':700,fill:C.teal,'text-anchor':'middle','dominant-baseline':'central',opacity:0});
  return S},
 render(S,t){
  S.cols.forEach((c,i)=>op(c,seg(t,.1+i*.06,.5+i*.06)));
  S.rows.forEach((g,i)=>op(g,seg(t,.2+i*.08,.6+i*.08)));
  S.b.forEach(b=>b.e.setAttribute('r',b.R*seg(t,.9+b.d,1.6+b.d,E)));
  op(S.ring,seg(t,2.9,3.3));
  op(S.card,seg(t,3.3,3.8)); tr(S.card,40,560+16*(1-seg(t,3.3,3.9)));
  S.w1.setAttribute('width',240*seg(t,3.8,4.5)); S.w2.setAttribute('width',240*seg(t,4.2,4.9));
  op(S.pct,seg(t,4.8,5.2)); op(S.pctT,seg(t,4.9,5.3));
 }};

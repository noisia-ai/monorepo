/* idea-by-country · en
   Case: an innovation idea read by dimension and country. 920x780. Lists: dims, ctry.
   From a real credentials deck. Labels in lab(svg,'key',[...]) can be replaced per deck with
   data-labels on the <svg>; the rest of the text is in this file's language. */
LIB['idea-by-country']={dur:5.4,setup(svg){
  const S={}, dims=lab(svg,'dims',['Claim','Portion','Pack','Conversation']), ctry=lab(svg,'ctry',['Mexico','Brazil','Colombia','Argentina','Chile']);
  S.card=el('g',{},svg); tr(S.card,40,40);
  el('rect',{width:840,height:110,rx:16,fill:C.white,stroke:C.border,'stroke-width':1.5},S.card);
  el('rect',{x:24,y:24,width:62,height:62,rx:14,fill:C.tealSoft},S.card);
  txt(S.card,110,48,'Product idea',{'font-size':20,'font-weight':700,fill:C.ink});
  el('rect',{x:110,y:66,width:280,height:12,rx:6,fill:C.skel},S.card);
  let x=470; S.tags=dims.slice(0,3).map(d=>{const g=pill(S.card,x,55,d,{fs:16,h:38});x+=g.w+10;return g});
  const X0=330,CW=140,Y0=250,RH=86;
  S.head=dims.map((d,i)=>txt(svg,X0+i*CW,214,d,{'font-size':17,'font-weight':700,fill:C.fg2,'text-anchor':'middle'}));
  S.rows=ctry.map((c,i)=>{const g=el('g',{},svg);
    el('rect',{x:40,y:Y0+i*RH-30,width:840,height:60,rx:12,fill:i%2?'#fafafa':'#f4f4f4'},g);
    txt(g,64,Y0+i*RH,c,{'font-size':19,'font-weight':500,fill:C.fg,'dominant-baseline':'central'});return g});
  const R=rng(13); S.cells=[];
  ctry.forEach((_,ri)=>dims.forEach((_,ci)=>{const v=R(); const g=el('g',{},svg); tr(g,X0+ci*CW,Y0+ri*RH);
    if(v>.55){el('circle',{r:15,fill:C.teal},g)}
    else if(v>.25){el('circle',{r:14,fill:'none',stroke:C.teal,'stroke-width':3},g);el('path',{d:'M0,-14 A14,14 0 0,1 0,14 Z',fill:C.teal},g)}
    else{el('circle',{r:14,fill:'none',stroke:C.coral,'stroke-width':3},g)}
    g.d=ri*.22+ci*.06; S.cells.push(g)}));
  S.src=txt(svg,40,742,'Product pages · reviews · conversation',{'font-size':16,fill:C.fg3});
  return S},
 render(S,t){
  op(S.card,seg(t,0,.5)); S.tags.forEach((g,i)=>op(g,seg(t,.4+i*.12,.8+i*.12)));
  S.head.forEach((h,i)=>op(h,seg(t,.9+i*.08,1.3+i*.08)));
  S.rows.forEach((g,i)=>op(g,seg(t,1+i*.1,1.4+i*.1)));
  S.cells.forEach(g=>{const k=seg(t,1.8+g.d,2.3+g.d);op(g,k);g.setAttribute('transform',g.getAttribute('transform').replace(/ scale\([^)]*\)/,'')+` scale(${.6+.4*k})`)});
  op(S.src,seg(t,4.6,5));
 }};

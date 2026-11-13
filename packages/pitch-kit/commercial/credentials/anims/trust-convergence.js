/* trust-convergence · es
   Caso: lo que vamos a revisar converge en una lectura que se parte en empuja y frena. 920x780. Lista: labels.
   From a real credentials deck. Labels in lab(svg,'key',[...]) can be replaced per deck with
   data-labels on the <svg>; the rest of the text is in this file's language. */
LIB['trust-convergence']={dur:5,setup(svg){
  const S={}, labels=lab(svg,'labels',['Claridad del costo total','Registro ante autoridades','Reseñas en tiendas de apps','Rapidez del depósito','Trato en la cobranza','Cuidado de los datos']);
  txt(svg,40,64,'Lo que vamos a revisar',{'font-size':22,'font-weight':700,fill:C.ink});
  S.chips=[]; const rows=[[0,1],[2,3],[4,5]];
  rows.forEach((r,ri)=>r.forEach((li,j)=>{const g=pill(svg,0,0,labels[li],{fs:19,h:46});g.X=40+j*430;g.Y=112+ri*62;g.idx=li;S.chips.push(g)}));
  // centrar cada fila
  rows.forEach((r,ri)=>{const gs=S.chips.filter(c=>r.includes(c.idx));const W=gs.reduce((a,c)=>a+c.w,0)+16;let x=(920-W)/2;gs.forEach(c=>{c.X=x;x+=c.w+16})});
  S.node=el('g',{},svg); tr(S.node,460,360);
  el('circle',{r:46,fill:C.tealSoft},S.node); el('circle',{r:46,fill:'none',stroke:C.teal,'stroke-width':2},S.node);
  txt(S.node,0,1,'Lectura',{'font-size':18,'font-weight':700,fill:C.teal,'text-anchor':'middle','dominant-baseline':'central'});
  S.in=S.chips.map(c=>el('path',{d:bez(c.X+c.w/2,c.Y+23,460,314).replace('C','C'),fill:'none',stroke:'#dcdcdc','stroke-width':1.6},svg));
  S.in.forEach(p=>svg.insertBefore(p,svg.firstChild));
  const cols=[[70,'Lo que empuja',C.teal,C.tealSoft],[490,'Lo que frena',C.coral,C.coralSoft]];
  S.out=cols.map(c=>{const p=el('path',{d:bez(460,406,c[0]+180,470),fill:'none',stroke:c[2],'stroke-width':2},svg);svg.insertBefore(p,svg.firstChild);return p});
  S.cols=cols.map((c,ci)=>{const g=el('g',{},svg);tr(g,c[0],470);
    el('rect',{width:360,height:250,rx:16,fill:c[3]},g);
    txt(g,24,40,c[1],{'font-size':20,'font-weight':700,fill:c[2]});
    const R=rng(11+ci*5); g.bars=[0,1,2,3].map(i=>{const b=el('rect',{x:24,y:68+i*42,height:18,rx:9,width:0,fill:c[2],opacity:.28+.5*(1-i/4)},g);b.W=150+R()*150;
      b.dot=el('circle',{cx:0,cy:77+i*42,r:6,fill:c[2],opacity:0},g);return b});return g});
  return S},
 render(S,t){
  S.chips.forEach((c,i)=>{const k=seg(t,.1+i*.16,.7+i*.16);op(c,k);tr(c,c.X,c.Y+14*(1-k))});
  S.in.forEach((p,i)=>drawOn(p,seg(t,1.3+i*.06,2.1+i*.06)));
  const kn=seg(t,1.9,2.4); op(S.node,kn); tr(S.node,460,360,.7+.3*kn);
  S.out.forEach((p,i)=>drawOn(p,seg(t,2.4+i*.1,3)));
  S.cols.forEach((g,ci)=>{op(g,seg(t,2.7+ci*.1,3.2+ci*.1));g.bars.forEach((b,i)=>{const k=seg(t,3+i*.15+ci*.1,3.8+i*.15+ci*.1);b.setAttribute('width',b.W*k);b.dot.setAttribute('cx',24+b.W+20);op(b.dot,seg(t,3.9+i*.12,4.3+i*.12))})});
 }};

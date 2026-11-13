/* journey-stepper · es
   Caso: un stepper de pasos donde la intención se cae en coral; barras de empuja y frena por paso. 920x780. Lista: steps.
   From a real credentials deck. Labels in lab(svg,'key',[...]) can be replaced per deck with
   data-labels on the <svg>; the rest of the text is in this file's language. */
LIB['journey-stepper']={dur:7,setup(svg){
  const S={}, steps=lab(svg,'steps',['Descarga','Registro','Identificación','Cuenta bancaria','Firma','Depósito']);
  S.X=steps.map((_,i)=>80+i*152); const Y=150;
  el('line',{x1:80,y1:Y,x2:840,y2:Y,stroke:'#e6e6e6','stroke-width':4,'stroke-linecap':'round'},svg);
  S.prog=el('line',{x1:80,y1:Y,x2:80,y2:Y,stroke:C.teal,'stroke-width':4,'stroke-linecap':'round'},svg);
  S.nodes=steps.map((s,i)=>{const g=el('g',{},svg);tr(g,S.X[i],Y);
    el('circle',{r:20,fill:C.white,stroke:C.teal,'stroke-width':3},g);
    txt(g,0,1,String(i+1),{'font-size':16,'font-weight':700,fill:C.teal,'text-anchor':'middle','dominant-baseline':'central'});
    const lines=s.split(' '); lines.forEach((l,j)=>txt(g,0,52+j*22,l,{'font-size':18,fill:C.fg,'text-anchor':'middle'}));return g});
  // puntos que viajan
  const R=rng(3); S.dots=[];
  for(let i=0;i<46;i++){const drop=R()<.55?1+Math.floor(R()*4.99):null;S.dots.push({t0:.2+i*.09,drop,e:el('circle',{r:7,fill:C.teal,opacity:0},svg)})}
  // barras arriba y abajo, por paso
  const base=470; S.base=base;
  el('line',{x1:40,y1:base,x2:880,y2:base,stroke:'#dcdcdc','stroke-width':1.5},svg);
  txt(svg,40,300,'Lo que empuja',{'font-size':17,fill:C.teal,'font-weight':700});
  txt(svg,40,660,'Lo que frena',{'font-size':17,fill:C.coral,'font-weight':700});
  const R2=rng(19); S.bars=S.X.map((x,i)=>{const up=el('rect',{x:x-22,width:44,rx:8,fill:C.teal,opacity:.55},svg),dn=el('rect',{x:x-22,width:44,rx:8,fill:C.coral,opacity:.55},svg);
    up.H=40+R2()*110; dn.H=30+R2()*120; return[up,dn]});
  return S},
 render(S,t){
  const Y=150; S.prog.setAttribute('x2',lerp(80,840,seg(t,0,1.4,EIO)));
  S.nodes.forEach((g,i)=>{const k=seg(t,i*.18,.5+i*.18);op(g,k)});
  const fin=t>=this.dur-.001;
  S.dots.forEach(d=>{
    const lt=t-d.t0-1.2; if(fin||lt<0){op(d.e,0);return}
    const speed=260, x=80+lt*speed;
    const stopX=d.drop?S.X[d.drop]:900;
    if(x<stopX){d.e.setAttribute('cx',x);d.e.setAttribute('cy',Y);d.e.setAttribute('fill',C.teal);op(d.e,Math.min(1,lt*4)*(x>860?Math.max(0,1-(x-860)/40):1));}
    else{const ft=(x-stopX)/speed; d.e.setAttribute('cx',stopX+ft*30); d.e.setAttribute('cy',Y+900*ft*ft); d.e.setAttribute('fill',C.coral); op(d.e,Math.max(0,1-ft*2.2));}
  });
  S.bars.forEach(([u,d],i)=>{const k=seg(t,4.6+i*.12,5.6+i*.12);
    const hu=u.H*k, hd=d.H*k; u.setAttribute('y',S.base-6-hu);u.setAttribute('height',hu);d.setAttribute('y',S.base+6);d.setAttribute('height',hd)});
 }};

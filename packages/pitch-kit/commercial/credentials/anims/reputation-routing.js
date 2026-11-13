/* reputation-routing · es
   Caso: fuentes que se enrutan a carriles de tema y un top 3 para atender. 920x780. Listas: src, top.
   From a real credentials deck. Labels in lab(svg,'key',[...]) can be replaced per deck with
   data-labels on the <svg>; the rest of the text is in this file's language. */
LIB['reputation-routing']={dur:6.8,setup(svg){
  const S={}, src=lab(svg,'src',['Tiendas de apps','Redes sociales','Foros','Búsqueda']), top=lab(svg,'top',['Cobranza','Costos y cargos','Pagos y extensiones','Atención','Suplantación y fraude']);
  S.src=src.map((s,i)=>{const g=pill(svg,24,150+i*130,s,{fs:18,h:44,minW:180});return g});
  S.lanes=top.map((s,i)=>{const g=el('g',{},svg);const y=110+i*118;tr(g,300,y);
    el('rect',{x:0,y:-28,width:250,height:56,rx:14,fill:C.white,stroke:C.border,'stroke-width':1.5},g);
    txt(g,18,-5,s,{'font-size':17,'font-weight':700,fill:C.ink});
    el('rect',{x:18,y:9,width:214,height:8,rx:4,fill:'#f0f0f0'},g);
    g.fill=el('rect',{x:18,y:9,width:0,height:8,rx:4,fill:C.teal},g); g.Y=y; g.n=0; return g});
  S.paths=[]; const R=rng(23); S.chips=[];
  const weights=[.3,.24,.18,.14,.14];
  for(let i=0;i<54;i++){const si=Math.floor(R()*4);let r=R(),li=0;for(;li<4&&r>weights[li];li++)r-=weights[li];
    const x1=24+S.src[si].w,y1=150+si*130;S.chips.push({si,li,x1,y1,x2:300,y2:110+li*118,t0:.8+i*.065,e:el('circle',{r:6,fill:C.teal,opacity:0},svg)})}
  // panel
  S.panel=el('g',{},svg);tr(S.panel,600,180);
  el('rect',{width:296,height:400,rx:16,fill:C.white,stroke:C.border,'stroke-width':1.5},S.panel);
  const ph=el('g',{},S.panel);tr(ph,22,24);
  const ic=el('image',{href:'assets/sprite-coral.png',width:12*30,height:9*30,x:-(ICONS.indexOf('priority-high')%12)*30,y:-Math.floor(ICONS.indexOf('priority-high')/12)*30,'clip-path':'url(#cp7)'},ph);
  const cp=el('clipPath',{id:'cp7'},svg);el('rect',{x:0,y:0,width:30,height:30},cp);
  txt(S.panel,62,46,'Para atender',{'font-size':20,'font-weight':700,fill:C.ink});
  txt(S.panel,62,70,'esta semana',{'font-size':17,fill:C.fg2});
  S.rows=[0,1,2].map(i=>{const g=el('g',{},S.panel);tr(g,22,110+i*96);
    el('rect',{width:252,height:78,rx:12,fill:i?'#f6f6f6':C.coralSoft},g);
    txt(g,20,40,String(i+1),{'font-size':22,'font-weight':700,fill:i?C.fg2:C.coral,'dominant-baseline':'central'});
    el('rect',{x:50,y:22,width:170,height:12,rx:6,fill:i?C.skel:'#f3c3b8'},g);el('rect',{x:50,y:44,width:120,height:12,rx:6,fill:i?'#ececec':'#f7d6ce'},g);return g});
  S.to=[0,1,3].map((li,i)=>{const p=el('path',{d:bez(550,110+li*118,600,290+i*96),fill:'none',stroke:i?'#d6d6d6':C.coral,'stroke-width':2},svg);svg.insertBefore(p,svg.firstChild);return p});
  return S},
 render(S,t){
  const fin=t>=this.dur-.001;
  S.src.forEach((g,i)=>op(g,seg(t,i*.12,.5+i*.12)));
  S.lanes.forEach((g,i)=>{op(g,seg(t,.3+i*.1,.8+i*.1));g.n=0});
  S.chips.forEach(c=>{const k=(t-c.t0)/.9;
    if(k>=1||fin){op(c.e,0);S.lanes[c.li].n++;return} if(k<0){op(c.e,0);return}
    const [x,y]=bezPt(c.x1,c.y1,c.x2,c.y2,EIO(k));c.e.setAttribute('cx',x);c.e.setAttribute('cy',y);op(c.e,Math.min(1,k*5))});
  const max=Math.max(...[0.3,.24,.18,.14,.14].map(w=>w*54))*1.05;
  S.lanes.forEach(g=>g.fill.setAttribute('width',Math.min(214,214*g.n/max)));
  op(S.panel,seg(t,4.9,5.4));tr(S.panel,600+16*(1-seg(t,4.9,5.5)),180);
  S.to.forEach((p,i)=>drawOn(p,seg(t,5.2+i*.12,5.9+i*.12)));
  S.rows.forEach((g,i)=>op(g,seg(t,5.5+i*.15,6+i*.15)));
 }};

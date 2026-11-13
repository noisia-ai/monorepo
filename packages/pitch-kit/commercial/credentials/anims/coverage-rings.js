/* coverage-rings · en
   Coverage: the person at the center, platforms in three rings (brands-white sprite). 920x780.
   From a real credentials deck. Labels in lab(svg,'key',[...]) can be replaced per deck with
   data-labels on the <svg>; the rest of the text is in this file's language. */
const BRANDS=['appstore','discord','facebook','google','googlegemini','googlemaps','googleplay','instagram','perplexity','pinterest','quora','reddit','spotify','telegram','threads','tiktok','tripadvisor','trustpilot','twitch','whatsapp','x','yelp','youtube'];
const RINGS=[[160,['instagram','tiktok','facebook','x','youtube','whatsapp'],-90],
 [255,['reddit','threads','pinterest','spotify','twitch','discord','telegram','quora'],-67.5],
 [350,['google','googlegemini','perplexity','googlemaps','appstore','googleplay','trustpilot','tripadvisor','yelp'],-90]];
LIB['coverage-rings']={dur:5.6,setup(svg){
  const S={}, cx=460, cy=395, defs=el('defs',{},svg);
  S.rings=RINGS.map(([r])=>el('circle',{cx,cy,r,fill:'none',stroke:'#e2e2e2','stroke-width':1.6,transform:`rotate(-90 ${cx} ${cy})`},svg));
  S.flow=el('g',{},svg);
  S.core=el('g',{},svg); tr(S.core,cx,cy);
  el('circle',{r:92,fill:C.tealSoft},S.core);
  el('circle',{r:92,fill:'none',stroke:C.teal,'stroke-width':2},S.core);
  const ik=ICONS.indexOf('community'), s=84;
  const cp0=el('clipPath',{id:'core'},defs); el('rect',{x:-s/2,y:-s/2-10,width:s,height:s},cp0);
  const ig=el('g',{'clip-path':'url(#core)'},S.core);
  el('image',{href:'assets/sprite-teal.png',x:-s/2-(ik%12)*s,y:-s/2-10-Math.floor(ik/12)*s,width:12*s,height:9*s},ig);
  txt(S.core,0,52,'People',{'font-size':19,'font-weight':700,fill:C.teal,'text-anchor':'middle'});
  S.chips=[]; let n=0;
  RINGS.forEach(([r,list,a0],ri)=>list.forEach((b,i)=>{
    const a=(a0+i*360/list.length)*Math.PI/180, x=cx+Math.cos(a)*r, y=cy+Math.sin(a)*r, R=31;
    const g=el('g',{},svg);
    el('circle',{r:R,fill:C.ink},g);
    const k=BRANDS.indexOf(b), cell=R*1.12*128/112, col=k%12, row=Math.floor(k/12);
    const cp=el('clipPath',{id:'bc'+n},defs); el('rect',{x:-cell/2,y:-cell/2,width:cell,height:cell},cp);
    const gg=el('g',{'clip-path':`url(#bc${n})`},g);
    el('image',{href:'assets/brands-white.png',x:-cell/2-col*cell,y:-cell/2-row*cell,width:12*cell,height:2*cell},gg);
    g.X=x;g.Y=y;g.d=1.2+ri*.55+i*.07;
    g.dots=[0,1].map(j=>({e:el('circle',{r:5,fill:C.teal,opacity:0},S.flow),t0:2.8+((n*0.37+j*0.9)%1.6)}));
    S.chips.push(g); n++;
  }));
  return S},
 render(S,t){
  const fin=t>=this.dur-.001, cx=460, cy=395;
  const kc=seg(t,0,.6,EIO); op(S.core,kc); tr(S.core,cx,cy,.7+.3*kc);
  S.rings.forEach((c,i)=>drawOn(c,seg(t,.4+i*.3,1.4+i*.3)));
  S.chips.forEach(g=>{const k=seg(t,g.d,g.d+.4,EIO);op(g,k);tr(g,g.X,g.Y,.5+.5*k);
    g.dots.forEach(d=>{const k2=(t-d.t0)/1.1; if(fin||k2<0||k2>1){op(d.e,0);return}
      const e=EIO(k2); d.e.setAttribute('cx',lerp(g.X,cx,e)); d.e.setAttribute('cy',lerp(g.Y,cy,e)); op(d.e,Math.sin(k2*Math.PI)*.9)})});
 }};

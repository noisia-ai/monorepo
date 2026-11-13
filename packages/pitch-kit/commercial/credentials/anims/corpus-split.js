/* corpus-split · es
   Caso: un corpus de puntos que se reparte entre alternativas alrededor de una necesidad. 920x780. Lista: alts.
   From a real credentials deck. Labels in lab(svg,'key',[...]) can be replaced per deck with
   data-labels on the <svg>; the rest of the text is in this file's language. */
LIB['corpus-split']={dur:5.4,setup(svg){
  const S={}, alts=lab(svg,'alts',['Otras apps de préstamo','Tarjeta de crédito','Banco tradicional','Casa de empeño','Tanda o familia','Préstamo informal']);
  const cx=460,cy=400, R=rng(5);
  S.title=txt(svg,460,92,'Un corpus de conversación',{'font-size':22,'font-weight':700,fill:C.ink,'text-anchor':'middle'});
  S.centers=alts.map((a,i)=>{const ang=-Math.PI/2+i*Math.PI/3;return[cx+Math.cos(ang)*230,cy+Math.sin(ang)*210,ang]});
  S.lines=S.centers.map(c=>el('line',{x1:cx,y1:cy,x2:cx,y2:cy,stroke:'#e2e2e2','stroke-width':2},svg));
  S.dots=[]; const cols=18,rows=12;
  for(let i=0;i<cols*rows;i++){const ci=i%6,a=R()*6.28,rr=Math.sqrt(R())*(46+ (ci%3)*8);
    S.dots.push({x0:460-(cols-1)*13+(i%cols)*26,y0:400-(rows-1)*13+Math.floor(i/cols)*26,x1:S.centers[ci][0]+Math.cos(a)*rr,y1:S.centers[ci][1]+Math.sin(a)*rr,dl:R()*.6,e:el('circle',{r:6,fill:C.dot},svg)})}
  S.labels=alts.map((a,i)=>{const [x,y,ang]=S.centers[i];const lx=cx+Math.cos(ang)*230,ly=cy+Math.sin(ang)*210;
    const yy=ly+(Math.sin(ang)<-.5?-80:Math.sin(ang)>.5?96:0); const xx=Math.abs(Math.cos(ang))>.5?lx+(Math.cos(ang)>0?0:0):lx;
    const g=pill(svg,xx,yy,a,{fs:18,h:40,anchor:'mid',center:true});
    return g});
  S.core=pill(svg,cx,cy,'Necesito dinero hoy',{fs:19,h:50,anchor:'mid',center:true,fill:C.teal,stroke:C.teal,color:C.white,bold:true});
  return S},
 render(S,t){
  op(S.title,1-seg(t,1.2,1.8));
  S.dots.forEach(d=>{const k=seg(t,1.2+d.dl,2.8+d.dl,EIO);d.e.setAttribute('cx',lerp(d.x0,d.x1,k));d.e.setAttribute('cy',lerp(d.y0,d.y1,k));op(d.e,seg(t,0,.6))});
  S.lines.forEach((l,i)=>{const k=seg(t,3.2+i*.06,3.9+i*.06);l.setAttribute('x2',lerp(460,S.centers[i][0],k));l.setAttribute('y2',lerp(400,S.centers[i][1],k))});
  op(S.core,seg(t,3,3.5));
  S.labels.forEach((g,i)=>op(g,seg(t,3.6+i*.1,4.1+i*.1)));
 }};

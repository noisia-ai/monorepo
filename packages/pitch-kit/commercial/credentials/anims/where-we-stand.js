/* where-we-stand · any language
   The comparison: social listening tools, Noisia and marketing agencies (or two columns for the
   agency variant), from the kit's copy where_we_stand. The columns come in, their points appear one
   by one, the Noisia column lifts with its teal border, and the verdicts land last.
   Data: data-columns='[{"name","kicker","points":[3],"verdict","noisia":true}]' on the <svg>, 1680x620. */
LIB['where-we-stand']={dur:5.8,setup(svg){
  const S={}, cols=JSON.parse(svg.dataset.columns||'[]'), n=cols.length||1;
  const W=+svg.getAttribute('width'), H=+svg.getAttribute('height'), gap=24;
  // Same proportions as the kit's native slide (noisia_pptx where_we_stand): Noisia's column is 1.25 wide.
  const wt=cols.map(c=>c.noisia?1.25:1), unit=(W-gap*(n-1))/wt.reduce((a,b)=>a+b,0);
  let acc=0; const xs=wt.map(w=>{const x=acc;acc+=w*unit+gap;return x});
  function wrap(g,x,y,s,w,at,lh){
    const t=txt(g,x,y,'',at), words=s.split(' '); let line=[], ln=0, sp=null;
    const add=()=>{sp=el('tspan',{x,dy:ln?lh:0},t); ln++};
    add();
    for(const w0 of words){line.push(w0);sp.textContent=line.join(' ');
      if(sp.getComputedTextLength()>w&&line.length>1){line.pop();sp.textContent=line.join(' ');line=[w0];add();sp.textContent=w0}}
    t.lines=ln; return t;
  }
  S.cols=cols.map((c,i)=>{
    const g=el('g',{},svg), x=xs[i], cw=wt[i]*unit, hi=!!c.noisia;
    const card=el('rect',{x:0,y:0,width:cw,height:H-40,rx:16,fill:hi?C.tealSoft:'#fafafa',stroke:hi?C.tealSoft:'#eeeeee','stroke-width':1.5},g);
    const ring=el('rect',{x:0,y:0,width:cw,height:H-40,rx:16,fill:'none',stroke:C.teal,'stroke-width':3,opacity:0},g);
    if(hi) el('image',{href:'assets/noisia.png',x:40,y:40,height:36},g);
    else txt(g,40,74,c.name||'',{'font-size':28,'font-weight':700,fill:C.ink});
    wrap(g,40,118,c.kicker||'',cw-80,{'font-size':21,'font-weight':hi?700:400,fill:hi?C.teal:C.fg2},28);
    const pts=(c.points||[]).map((p,j)=>{const pg=el('g',{},g);tr(pg,40,200+j*92);
      el('circle',{cx:7,cy:-7,r:6,fill:hi?C.teal:C.dot},pg);
      wrap(pg,28,0,p,cw-110,{'font-size':23,fill:hi?C.fg:C.fg2},30);return pg});
    const vg=el('g',{},g); tr(vg,40,H-40-118);
    el('line',{x1:0,y1:-26,x2:cw-80,y2:-26,stroke:C.border,'stroke-width':1.5},vg);
    wrap(vg,0,8,c.verdict||'',cw-80,{'font-size':24,'font-weight':hi?700:400,fill:hi?C.teal:C.fg},31);
    return {g,x,hi,ring,pts,vg};
  });
  return S;
},render(S,t){
  S.cols.forEach((c,i)=>{
    const k=seg(t,.1+i*.18,.9+i*.18), lift=c.hi?seg(t,3.6,4.3,EIO):0;
    op(c.g,k); tr(c.g,c.x,16+(1-k)*30-12*lift);   // 16 px of room so the lift never clips
    op(c.ring,lift);
    c.pts.forEach((p,j)=>{const a=1.1+j*.55+i*.12, kk=seg(t,a,a+.5);op(p,kk);p.setAttribute('transform',`translate(${40+(1-kk)*-16},${200+j*92})`)});
    const v=seg(t,4.4+i*.15,5.1+i*.15); op(c.vg,v);
  });
}};

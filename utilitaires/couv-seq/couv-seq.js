/* ──────────────────────────────────────────────────────────
   URL state sync — partage par lien + persistance miroir
   ────────────────────────────────────────────────────────── */
// 1) Au chargement : si l'URL porte un état, on prime localStorage avant les loaders.
(function primeStorageFromURL(){
  try {
    const m = location.hash.match(/[#&]s=([^&]+)/);
    if(!m) return;
    const s = JSON.parse(decodeURIComponent(m[1]));
    if(!s || s.v !== 1) return;
    if(Array.isArray(s.b))  localStorage.setItem('couvseq_bets',    JSON.stringify(s.b));
    if(Array.isArray(s.c))  localStorage.setItem('couvseq_covers',  JSON.stringify(s.c));
    if(typeof s.n === 'number' && s.n >= 2 && s.n <= 8) localStorage.setItem('couvseq_ncovers', String(s.n));
  } catch(e){}
})();

// 2) Push : on attend la fin du boot pour ne pas écraser pendant l'init.
let __urlSyncReady = false;
function pushStateToURL(){
  if(!__urlSyncReady) return;
  try {
    const s = { v:1, b:placedBets, c:covers, n:nCovers };
    const enc = '#s=' + encodeURIComponent(JSON.stringify(s));
    if(location.hash !== enc){
      history.replaceState(null, '', location.pathname + location.search + enc);
    }
  } catch(e){}
}

let mode='single';
function switchMode(m){
  if(!document.getElementById('panel-single')) return; // ancien UI retiré
  mode=m;
  document.querySelectorAll('.tab').forEach((t,i)=>t.classList.toggle('active',
    (i===0&&m==='single')||(i===1&&m==='combo')||(i===2&&m==='recup')));
  document.getElementById('panel-single').classList.toggle('on',m==='single');
  document.getElementById('panel-combo').classList.toggle('on',m==='combo');
  document.getElementById('panel-recup').classList.toggle('on',m==='recup');
  document.getElementById('result').innerHTML='';
  if(m==='recup') calcRecup(); else calc();
}
const gv=id=>{const e=document.getElementById(id);if(!e)return null;const s=e.value.trim();if(s==='')return null;const n=parseFloat(s);return(!isNaN(n)&&n>0)?n:null};
const fmt=n=>n.toFixed(2);
const pct=(p,F)=>(p/F*100).toFixed(1)+'%';
const q_=c=>1-c;

/* ── SINGLE ── */
function singleLay(F,b,l,c,cash){
  const q=q_(c);
  let P,S;
  if(cash){P=F*((b-1)*q-(l-1))/(l-c);S=(P+F)/q;}
  else{P=F*(b-1)*q/(l-c);S=P/q;}
  return{P,S,liab:S*(l-1),type:'lay',odd:l};
}
function singleBackOpp(F,b,bp,c,cash){
  const q=q_(c);
  let P,S;
  if(cash){const d=(bp-1)*q;P=(F*(b-1)*d-F)/(d+1);S=(P+F)/d;}
  else{P=F*(b-1)*(bp-1)*q/(bp-c*(bp-1));S=P/((bp-1)*q);}
  return{P,S,liab:null,type:'back',odd:bp};
}

/* ── COMBO ── */
/* G = F*(b1*b2-1) for freebet */
/* All 4 hedge combinations: first=M1 hedge, second=M2 hedge */
/* Scenarios: A=M1≠sel, B=M1=sel&M2≠sel, C=both=sel */

function comboLL(F,b1,l1,b2,l2,c){
  const q=q_(c),G=F*(b1*b2-1);
  const P=G*q*q/((l1-c)*(l2-c));
  const S1=P/q,S2=P*(l1-c)/(q*q);
  return{P,S1,liab1:S1*(l1-1),S2,liab2:S2*(l2-1),key:'LL',
    h1:{type:'lay',odd:l1},h2:{type:'lay',odd:l2},
    sc:[S1*q,-S1*(l1-1)+S2*q,G-S1*(l1-1)-S2*(l2-1)]};
}
function comboLB(F,b1,l1,b2,bp2,c){
  const q=q_(c),G=F*(b1*b2-1),d2=bp2-c*(bp2-1);
  if(d2<=0)return null;
  const P=G*q*q*(bp2-1)/((l1-c)*d2);
  const S1=P/q,S2=P*(l1-c)/(q*q*(bp2-1));
  return{P,S1,liab1:S1*(l1-1),S2,liab2:null,key:'LB',
    h1:{type:'lay',odd:l1},h2:{type:'back',odd:bp2},
    sc:[S1*q,-S1*(l1-1)+S2*(bp2-1)*q,G-S1*(l1-1)-S2]};
}
function comboBL(F,b1,bp1,b2,l2,c){
  const q=q_(c),G=F*(b1*b2-1),d1=bp1-c*(bp1-1);
  if(d1<=0)return null;
  const P=G*(bp1-1)*q*q/(d1*(l2-c));
  const S1=P/((bp1-1)*q),S2=G/(l2-c);
  return{P,S1,liab1:null,S2,liab2:S2*(l2-1),key:'BL',
    h1:{type:'back',odd:bp1},h2:{type:'lay',odd:l2},
    sc:[S1*(bp1-1)*q,-S1+S2*q,G-S1-S2*(l2-1)]};
}
function comboBB(F,b1,bp1,b2,bp2,c){
  const q=q_(c),G=F*(b1*b2-1),d1=bp1-c*(bp1-1),d2=bp2-c*(bp2-1);
  if(d1<=0||d2<=0)return null;
  const P=G*(bp1-1)*(bp2-1)*q*q/(d1*d2);
  const S1=P/((bp1-1)*q),S2=P*d1/((bp1-1)*q*q*(bp2-1));
  return{P,S1,liab1:null,S2,liab2:null,key:'BB',
    h1:{type:'back',odd:bp1},h2:{type:'back',odd:bp2},
    sc:[S1*(bp1-1)*q,-S1+S2*(bp2-1)*q,G-S1-S2]};
}

/* ── RENDER HELPERS ── */
const pillL=o=>`<span class="pill pill-l">LAY @ ${o}</span>`;
const pillB=o=>`<span class="pill pill-b">BACK opp. @ ${o}</span>`;

function renderCompare(results,F,label1,label2){
  if(results.length<2)return'';
  let h=`<div class="compare-wrap">`;
  results.forEach((r,i)=>{
    const win=i===0;
    const lbl=label2?`${label1} + ${label2}`:(r.type==='lay'?`Lay @ ${r.odd}`:`Back opp. @ ${r.odd}`);
    const p1tag=r.h1?((r.h1.type==='lay'?pillL(r.h1.odd):pillB(r.h1.odd))):'';
    const p2tag=r.h2?((r.h2.type==='lay'?pillL(r.h2.odd):pillB(r.h2.odd))):'';
    const methodHtml=r.h1?`${p1tag} ${p2tag}`:(r.type==='lay'?`<span class="pill pill-l">LAY @ ${r.odd}</span>`:`<span class="pill pill-b">BACK opp. @ ${r.odd}</span>`);
    h+=`<div class="compare-row ${win?'winner':'loser'}">
      <div class="method-label">${win?`<span class="pill pill-best">BEST</span>`:''}${methodHtml}</div>
      <div class="c-rate">${pct(r.P,F)}</div>
      <div class="c-profit">+${fmt(r.P)} €</div>
    </div>`;
  });
  return h+`</div>`;
}

function renderDetailSingle(r,F,b,c){
  const maxL=r.liab||0;
  const wH=maxL>100?`<div class="warn">⚠ Liability : <strong>${fmt(maxL)} €</strong> à immobiliser sur Piwi.</div>`:'';
  const hedgeIco=r.type==='lay'?'ico-lay':'ico-back';
  const hedgeLabel=r.type==='lay'?`Lay sur Piwi — @ ${r.odd}`:`Back opposé sur Piwi — @ ${r.odd}`;
  const liabHtml=r.liab!=null?`<span class="step-liab">liab. ${fmt(r.liab)} €</span>`:`<span class="step-noliab">pas de liab.</span>`;
  const formulaLay=`<span class="v">P</span> = F×(b−1)×(1−c)/(l−c)<br><span class="eq">= ${fmt(F)}×${fmt(b-1)}×${fmt(1-c)} / ${fmt(r.odd-c)} = ${fmt(r.P)} €</span>`;
  const formulaBO=`<span class="v">P</span> = F×(b−1)×(bp−1)×(1−c) / (bp−c×(bp−1))<br><span class="eq">= ${fmt(F)}×${fmt(b-1)}×${fmt(r.odd-1)}×${fmt(1-c)} / ${fmt(r.odd-c*(r.odd-1))} = ${fmt(r.P)} €</span>`;
  return`<div class="best-detail">
    <div class="detail-head">
      <div><div class="detail-title">Résultat</div></div>
      <div><span class="big-profit">+${fmt(r.P)} €</span><span class="big-rate">(${pct(r.P,F)})</span></div>
    </div>
    ${wH}
    <div class="steps">
      <div class="step"><span class="step-ico ico-back">B</span><div class="step-name">Freebet bookmaker<small>BACK @ ${b}</small></div><span class="step-stake">${fmt(F)} €</span><span class="step-noliab">freebet</span></div>
      <div class="step"><span class="step-ico ${hedgeIco}">${r.type==='lay'?'L':'B'}</span><div class="step-name">${hedgeLabel}</div><span class="step-stake">${fmt(r.S)} €</span>${liabHtml}</div>
    </div>
    <div class="formula">${r.type==='lay'?formulaLay:formulaBO}</div>
  </div>`;
}

function renderDetailCombo(r,F,b1,b2,c){
  const maxL=Math.max(r.liab1||0,r.liab2||0);
  const wH=maxL>100?`<div class="warn">⚠ Liability max : <strong>${fmt(maxL)} €</strong> à avoir disponible sur Piwi.</div>`:'';
  const G=F*(b1*b2-1);
  // step M1
  const m1ico=r.h1.type==='lay'?'ico-lay':'ico-back';
  const m1lbl=r.h1.type==='lay'?`Lay M1 sur Piwi — @ ${r.h1.odd}`:`Back opposé M1 sur Piwi — @ ${r.h1.odd}`;
  const m1sub=r.h1.type==='lay'?`Avant 18:45 · pose toujours`:`Avant 18:45 · pose toujours`;
  const m1liab=r.liab1!=null?`<span class="step-liab">liab. ${fmt(r.liab1)} €</span>`:`<span class="step-noliab">pas de liab.</span>`;
  // condition for M2
  const cond2=r.h1.type==='lay'?`si M1 = sél. back`:`si M1 ≠ sél. back`;
  const m2ico=r.h2.type==='lay'?'ico-m2':'ico-back';
  const m2lbl=r.h2.type==='lay'?`Lay M2 sur Piwi — @ ${r.h2.odd}`:`Back opposé M2 sur Piwi — @ ${r.h2.odd}`;
  const m2liab=r.liab2!=null?`<span class="step-liab">liab. ${fmt(r.liab2)} €</span>`:`<span class="step-noliab">pas de liab.</span>`;

  const scDesc=[
    r.h1.type==='lay'?`M1 ≠ sél. → Lay 1 gagne, terminé`:`M1 = sél. back → Back opp. 1 gagne, terminé`,
    r.h1.type==='lay'
      ?(r.h2.type==='lay'?`M1=sél., M2≠sél. → Lay 2 rattrape`:`M1=sél., M2≠sél. → Back opp. 2 rattrape`)
      :(r.h2.type==='lay'?`M1≠sél., M2≠sél. → Lay 2 rattrape`:`M1≠sél., M2≠sél. → Back opp. 2 rattrape`),
    `Les deux = sél. → Combiné gagne, lays perdent`
  ];
  const dotC=['var(--c-primary)','var(--c-tertiary)','var(--color-pos)'];
  const scHtml=r.sc.map((n,i)=>`<div class="sc"><span class="dot" style="background:${dotC[i]}"></span>${scDesc[i]}<span class="sc-net">+${fmt(n)} €</span></div>`).join('');

  // formula
  const fmlMap={
    LL:`<span class="v">P</span> = G×q² / ((l1−c)×(l2−c))`,
    LB:`<span class="v">P</span> = G×q²×(bp2−1) / ((l1−c)×(bp2−c(bp2−1)))`,
    BL:`<span class="v">P</span> = G×(bp1−1)×q² / ((bp1−c(bp1−1))×(l2−c))`,
    BB:`<span class="v">P</span> = G×(bp1−1)×(bp2−1)×q² / ((bp1−c(bp1−1))×(bp2−c(bp2−1)))`
  };

  const keyLabel={LL:'Lay + Lay',LB:'Lay + Back opp.',BL:'Back opp. + Lay',BB:'Back opp. + Back opp.'};

  return`<div class="best-detail">
    <div class="detail-head">
      <div>
        <div class="detail-title">${keyLabel[r.key]||r.key}</div>
        <div class="detail-combo">Combiné @ ${fmt(b1*b2)} · G = ${fmt(G)} €</div>
      </div>
      <div><span class="big-profit">+${fmt(r.P)} €</span><span class="big-rate">(${pct(r.P,F)})</span></div>
    </div>
    ${wH}
    <div class="steps">
      <div class="step"><span class="step-ico ${m1ico}">${r.h1.type==='lay'?'L':'B'}</span><div class="step-name">${m1lbl}<small>${m1sub}</small></div><span class="step-stake">${fmt(r.S1)} €</span>${m1liab}</div>
      <div class="step"><span class="step-ico ${m2ico}">${r.h2.type==='lay'?'L':'B'}</span><div class="step-name">${m2lbl}<small>Avant 21:00 · seulement ${cond2}</small></div><span class="step-stake">${fmt(r.S2)} €</span>${m2liab}</div>
    </div>
    <div class="divider"></div>
    <div class="sc-title">3 SCÉNARIOS</div>
    <div class="scenarios">${scHtml}</div>
    <div class="formula">${fmlMap[r.key]||''}<br><span class="eq">= ${fmt(r.P)} €</span></div>
  </div>`;
}

/* ── RECOVERY ── */
// Key insight: S2 = G/(l2-c) regardless of loss1
// P = G*(1-c)/(l2-c) - loss1
// For back-opp: S2 = G/(bp2-c*(bp2-1)), P = G*(bp2-1)*(1-c)/(bp2-c*(bp2-1)) - loss1

function calcRecup(){
  const el=document.getElementById('result'); if(!el) return; // ancien UI retiré
  const F=gv('freebet'), c=(gv('comm')||0)/100;
  const loss=gv('r_loss')||0, b1=gv('r_b1'), b2=gv('r_b2');
  const l2=gv('r_l2'), bp2=gv('r_bp2');

  if(!b1||!b2){el.innerHTML='<div class="na">Renseigner les cotes back des 2 matchs.</div>';return}
  if(!l2&&!bp2){el.innerHTML='<div class="na">Renseigner au moins une cote Piwi pour le Match 2.</div>';return}

  const G = F*(b1*b2-1);
  const q = 1-c;
  const results=[];

  if(l2){
    const S2=G/(l2-c);
    const P=G*q/(l2-c)-loss;
    const liab=S2*(l2-1);
    const scWin=S2*q-loss;   // lay2 wins
    const scLose=G-loss-liab; // combo wins = lay2 loses
    results.push({type:'lay',odd:l2,S2,liab,P,scWin,scLose,G});
  }
  if(bp2){
    const den=bp2-c*(bp2-1);
    const S2=G/den;
    const P=G*(bp2-1)*q/den-loss;
    const scWin=S2*(bp2-1)*q-loss;
    const scLose=G-loss-S2;
    results.push({type:'back',odd:bp2,S2,liab:null,P,scWin,scLose,G});
  }

  results.sort((a,b)=>b.P-a.P);

  const profitClass=p=>p>0.05?'profit-pos':p<-0.05?'profit-neg':'profit-zero';

  // comparison if both options
  let html='';
  if(results.length>1){
    html+=`<div class="compare-wrap">`;
    results.forEach((r,i)=>{
      const win=i===0;
      const tag=r.type==='lay'?`<span class="pill pill-l">LAY @ ${r.odd}</span>`:`<span class="pill pill-b">BACK opp. @ ${r.odd}</span>`;
      const pc=profitClass(r.P);
      html+=`<div class="compare-row ${win?'winner':'loser'}">
        <div class="method-label">${win?`<span class="pill pill-best">BEST</span>`:''} ${tag}</div>
        <div class="c-rate">${r.P>=0?pct(r.P,F):'-'}</div>
        <div class="c-profit ${pc}">${r.P>=0?'+':''}${fmt(r.P)} €</div>
      </div>`;
    });
    html+=`</div>`;
  }

  // best detail
  const r=results[0];
  const pc=profitClass(r.P);
  const hedgeTag=r.type==='lay'?`Lay M2 sur Piwi — @ ${r.odd}`:`Back opposé M2 sur Piwi — @ ${r.odd}`;
  const liabHtml=r.liab!=null?`<span class="step-liab">liab. ${fmt(r.liab)} €</span>`:`<span class="step-noliab">pas de liab.</span>`;
  const beNote=r.P<0?`<div class="be-note">⚠ Profit négatif : il n'est pas possible de récupérer 100% de la perte avec cette cote. Tu récupères <strong>${fmt(r.G-loss)} €</strong> si le combiné gagne, ou <strong>${fmt(r.scWin)} €</strong> si lay 2 gagne — c'est la meilleure option disponible.</div>`
    :(r.P<1?`<div class="be-note">Quasi break-even — tu récupères presque intégralement ta perte lay 1.</div>`:'');

  html+=`<div class="best-detail">
    <div class="detail-head">
      <div>
        <div class="detail-title">RÉCUPÉRATION — ${r.type==='lay'?'Lay':'Back opp.'} M2</div>
        <div class="detail-combo">Perte lay 1 : −${fmt(loss)} € · G combiné : ${fmt(r.G)} €</div>
      </div>
      <div><span class="big-profit ${pc}">${r.P>=0?'+':''}${fmt(r.P)} €</span>${r.P>=0?`<span class="big-rate">(${pct(r.P,F)})</span>`:''}</div>
    </div>

    <div class="loss-display">
      <span class="loss-ico">💸</span>
      <div class="loss-txt">Lay 1 déjà perdu — M1 = sélection back ✓</div>
      <span class="loss-amt">−${fmt(loss)} €</span>
    </div>

    <div class="steps">
      <div class="step">
        <span class="step-ico ico-m2">${r.type==='lay'?'L':'B'}</span>
        <div class="step-name">${hedgeTag}<small>À placer maintenant · seulement ce pari restant</small></div>
        <span class="step-stake">${fmt(r.S2)} €</span>
        ${liabHtml}
      </div>
    </div>

    <div class="divider"></div>
    <div class="sc-remain">2 SCÉNARIOS RESTANTS</div>
    <div class="scenarios">
      <div class="sc">
        <span class="dot" style="background:var(--c-tertiary)"></span>
        M2 ≠ sél. → ${r.type==='lay'?'Lay 2 gagne':'Back opp. 2 gagne'}
        <span class="sc-net ${profitClass(r.scWin)}">${r.scWin>=0?'+':''}${fmt(r.scWin)} €</span>
      </div>
      <div class="sc">
        <span class="dot" style="background:var(--color-pos)"></span>
        M2 = sél. → Combiné gagne, ${r.type==='lay'?'lay 2 perd':'back opp. 2 perd'}
        <span class="sc-net ${profitClass(r.scLose)}">${r.scLose>=0?'+':''}${fmt(r.scLose)} €</span>
      </div>
    </div>
    ${beNote}
    <div class="formula">
      <span class="v">S2</span> = G / (l2−c) = ${fmt(r.G)} / ${fmt(r.odd-c)} = <span class="eq">${fmt(r.S2)} €</span><br>
      <span class="v">P</span> = G×(1−c)/(l2−c) − perte = <span class="eq">${r.P>=0?'+':''}${fmt(r.P)} €</span>
    </div>
  </div>`;

  el.innerHTML=html;
}

/* ── MAIN ── */
function calc(){
  const el=document.getElementById('result'); if(!el) return; // ancien UI retiré
  const F=gv('freebet'),c=(gv('comm')||0)/100,cash=document.getElementById('bonusType').value==='cash';
  if(!F){el.innerHTML='';return}

  if(mode==='single'){
    const b=gv('s_back'),l=gv('s_lay'),bp=gv('s_bp');
    if(!b){el.innerHTML='';return}
    const res=[];
    if(l) res.push(singleLay(F,b,l,c,cash));
    if(bp) res.push(singleBackOpp(F,b,bp,c,cash));
    if(!res.length){el.innerHTML='<div class="na">Entrer au moins une cote Piwi.</div>';return}
    res.sort((a,b)=>b.P-a.P);
    el.innerHTML=renderCompare(res,F)+renderDetailSingle(res[0],F,b,c);

  } else {
    const b1=gv('b1'),l1=gv('l1'),bp1=gv('bp1');
    const b2=gv('b2'),l2=gv('l2'),bp2=gv('bp2');
    if(!b1||!b2){el.innerHTML='';return}
    if(!l1&&!bp1){el.innerHTML='<div class="na">Renseigner au moins une cote Piwi pour le Match 1.</div>';return}
    if(!l2&&!bp2){el.innerHTML='<div class="na">Renseigner au moins une cote Piwi pour le Match 2.</div>';return}

    const combos=[];
    if(l1&&l2){const r=comboLL(F,b1,l1,b2,l2,c);if(r&&r.P>0)combos.push(r);}
    if(l1&&bp2){const r=comboLB(F,b1,l1,b2,bp2,c);if(r&&r.P>0)combos.push(r);}
    if(bp1&&l2){const r=comboBL(F,b1,bp1,b2,l2,c);if(r&&r.P>0)combos.push(r);}
    if(bp1&&bp2){const r=comboBB(F,b1,bp1,b2,bp2,c);if(r&&r.P>0)combos.push(r);}
    if(!combos.length){el.innerHTML='<div class="na">Aucune combinaison valide.</div>';return}
    combos.sort((a,b2)=>b2.P-a.P);

    const keyLabel={LL:'Lay + Lay',LB:'Lay + Back opp.',BL:'Back opp. + Lay',BB:'Back opp. + Back opp.'};
    let html=`<div class="rank-list">`;
    combos.forEach((r,i)=>{
      const top=i===0;
      const p1=r.h1.type==='lay'?pillL(r.h1.odd):pillB(r.h1.odd);
      const p2=r.h2.type==='lay'?pillL(r.h2.odd):pillB(r.h2.odd);
      html+=`<div class="rank-row ${top?'top':''}" onclick="document.getElementById('det${i}').scrollIntoView({behavior:'smooth'})">
        <div class="rk">${i===0?'🏆':i+1}</div>
        <div class="rank-desc"><div>${keyLabel[r.key]||r.key}</div><div style="margin-top:3px">${p1} ${p2}</div></div>
        <div class="rrate">${pct(r.P,F)}</div>
        <div class="rp">+${fmt(r.P)} €</div>
      </div>`;
    });
    html+=`</div>`;
    combos.forEach((r,i)=>{
      html+=`<div id="det${i}" style="${i>0?'margin-top:10px':''}">`;
      if(i>0)html+=`<div class="option-sep">OPTION #${i+1}</div>`;
      html+=renderDetailCombo(r,F,b1,b2,c);
      html+=`</div>`;
    });
    el.innerHTML=html;
  }
}
calc();

/* ── PERSISTANCE ── */
const FIELDS=['freebet','bonusType',
  's_back','s_lay','s_bp',
  'b1','l1','bp1','b2','l2','bp2',
  'r_loss','r_b1','r_b2','r_l2','r_bp2'];

function saveState(){
  const state={mode};
  FIELDS.forEach(id=>{
    const el=document.getElementById(id);
    if(el) state[id]=el.value;
  });
  try{localStorage.setItem('fbcalc',JSON.stringify(state));}catch(e){}
}

function loadState(){
  try{
    const raw=localStorage.getItem('fbcalc');
    if(!raw) return;
    const state=JSON.parse(raw);
    FIELDS.forEach(id=>{
      const el=document.getElementById(id);
      if(el && state[id]!==undefined) el.value=state[id];
    });
    if(state.mode && state.mode!=='single') switchMode(state.mode);
    else calc();
  }catch(e){}
}

// Save on every input change
FIELDS.forEach(id=>{
  const el=document.getElementById(id);
  if(el) el.addEventListener('input',saveState);
  if(el) el.addEventListener('change',saveState);
});

loadState();

/* ──────────────────────────────────────────────────────────
   PARIS PLACÉS — portefeuille de paris à équilibrer
   ────────────────────────────────────────────────────────── */
const PLACED_BETS_KEY = 'couvseq_bets';
let placedBets = [];

const SVG_X = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
const SVG_TRASH = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';

function newBetId(){ return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2,5); }

function createBet(){
  return { id:newBetId(), type:'freebet', amount:50, oddsMode:'individual', totalOdd:null, odds:[null,null] };
}

function loadPlacedBets(){
  try { const raw = localStorage.getItem(PLACED_BETS_KEY); if(raw) placedBets = JSON.parse(raw) || []; } catch(e){}
}
function savePlacedBets(){
  try { localStorage.setItem(PLACED_BETS_KEY, JSON.stringify(placedBets)); } catch(e){}
  pushStateToURL();
  if(typeof recompute === 'function') recompute();
}

function computeTotalOdd(bet){
  if(bet.oddsMode === 'total') return (bet.totalOdd > 1) ? bet.totalOdd : 0;
  let prod = 1, count = 0;
  for(const o of bet.odds){
    if(o && o > 1){ prod *= o; count++; }
  }
  return count > 0 ? prod : 0;
}

function addPlacedBet(){
  placedBets.push(createBet());
  savePlacedBets();
  renderPlacedBets();
}
function removePlacedBet(id){
  placedBets = placedBets.filter(b => b.id !== id);
  savePlacedBets();
  renderPlacedBets();
}
function setBetType(id, type){
  const b = placedBets.find(b => b.id === id); if(!b) return;
  b.type = type; savePlacedBets(); renderPlacedBets();
}
function setOddsMode(id, mode){
  const b = placedBets.find(b => b.id === id); if(!b) return;
  b.oddsMode = mode; savePlacedBets(); renderPlacedBets();
}
function onBetAmount(id, value){
  const b = placedBets.find(b => b.id === id); if(!b) return;
  b.amount = parseFloat(value) || 0; savePlacedBets();
}
function onBetTotalOdd(id, value){
  const b = placedBets.find(b => b.id === id); if(!b) return;
  b.totalOdd = parseFloat(value) || null; savePlacedBets();
}
function onOddInput(id, index, value){
  const b = placedBets.find(b => b.id === id); if(!b) return;
  b.odds[index] = parseFloat(value) || null;
  savePlacedBets();
  // mise à jour locale de l'affichage du total uniquement
  const card = document.querySelector('.placed-bet[data-id="'+id+'"]');
  if(card){
    const v = card.querySelector('.total-odd-display .value');
    if(v){ const t = computeTotalOdd(b); v.textContent = t ? t.toFixed(2) : '—'; }
  }
}
function addOdd(id){
  const b = placedBets.find(b => b.id === id); if(!b) return;
  b.odds.push(null); savePlacedBets(); renderPlacedBets();
}
function removeOdd(id, index){
  const b = placedBets.find(b => b.id === id); if(!b || b.odds.length <= 1) return;
  b.odds.splice(index, 1); savePlacedBets(); renderPlacedBets();
}

function renderBetCard(bet, idx){
  const oddsHtml = bet.oddsMode === 'total'
    ? '<div class="field"><label>Cote totale du combiné</label>'
      + '<input type="number" step="0.01" min="1" placeholder="—" value="' + (bet.totalOdd ?? '') + '" '
      + 'oninput="onBetTotalOdd(\''+bet.id+'\',this.value)"></div>'
    : renderIndividualOdds(bet);

  return ''
    + '<div class="placed-bet" data-id="' + bet.id + '">'
    +   '<div class="placed-bet-head">'
    +     '<span class="placed-bet-title">Pari #' + (idx+1) + '</span>'
    +     '<button class="bet-remove-btn" title="Retirer ce pari" onclick="removePlacedBet(\''+bet.id+'\')">' + SVG_TRASH + '</button>'
    +   '</div>'
    +   '<div class="bet-row">'
    +     '<div class="bet-row-item">'
    +       '<div class="bet-section-label">Type de mise</div>'
    +       '<div class="bet-toggle">'
    +         '<button class="bet-toggle-btn bet-toggle-btn--fb '   + (bet.type==='freebet'?'active':'') + '" onclick="setBetType(\''+bet.id+'\',\'freebet\')">Freebet</button>'
    +         '<button class="bet-toggle-btn bet-toggle-btn--cash ' + (bet.type==='cash'   ?'active':'') + '" onclick="setBetType(\''+bet.id+'\',\'cash\')">Cash</button>'
    +       '</div>'
    +     '</div>'
    +     '<div class="bet-row-item">'
    +       '<div class="bet-section-label">Mise placée (€)</div>'
    +       '<input type="number" step="1" min="0" value="' + (bet.amount ?? '') + '" '
    +       'oninput="onBetAmount(\''+bet.id+'\',this.value)">'
    +     '</div>'
    +   '</div>'
    +   '<div>'
    +     '<div class="bet-section-label">Cotes</div>'
    +     '<div class="bet-toggle">'
    +       '<button class="bet-toggle-btn bet-toggle-btn--total ' + (bet.oddsMode==='total'     ?'active':'') + '" onclick="setOddsMode(\''+bet.id+'\',\'total\')">Cote totale</button>'
    +       '<button class="bet-toggle-btn bet-toggle-btn--ind '   + (bet.oddsMode==='individual'?'active':'') + '" onclick="setOddsMode(\''+bet.id+'\',\'individual\')">Individuelles</button>'
    +     '</div>'
    +   '</div>'
    +   oddsHtml
    + '</div>';
}

function renderIndividualOdds(bet){
  const rows = bet.odds.map((o, i) =>
    '<div class="odd-row">'
    + '<span class="odd-row-label">Cote ' + (i+1) + '</span>'
    + '<input type="number" step="0.01" min="1" placeholder="—" value="' + (o ?? '') + '" '
    +   'oninput="onOddInput(\''+bet.id+'\','+i+',this.value)">'
    + '<button class="odd-trash" title="Retirer cette cote" onclick="removeOdd(\''+bet.id+'\','+i+')" '
    +   (bet.odds.length <= 1 ? 'disabled' : '') + '>' + SVG_TRASH + '</button>'
    + '</div>'
  ).join('');
  const total = computeTotalOdd(bet);
  return ''
    + '<div class="odds-list">'
    +   rows
    +   '<button class="add-odd-btn" onclick="addOdd(\''+bet.id+'\')">+ Ajouter une cote</button>'
    +   '<div class="total-odd-display">'
    +     '<span class="label">Cote totale</span>'
    +     '<span class="value">' + (total ? total.toFixed(2) : '—') + '</span>'
    +   '</div>'
    + '</div>';
}

function renderPlacedBets(){
  const container = document.getElementById('placed-bets');
  if(!container) return;
  if(placedBets.length === 0){
    container.innerHTML = '<p class="placed-bets-empty">Aucun pari placé pour le moment.</p>';
    return;
  }
  container.innerHTML = placedBets.map(renderBetCard).join('');
}

loadPlacedBets();
renderPlacedBets();

/* ── Nombre de couvertures (2 à 8) ── */
const NCOVERS_KEY = 'couvseq_ncovers';
let nCovers = 2;
try { const v = parseInt(localStorage.getItem(NCOVERS_KEY), 10); if(v >= 2 && v <= 8) nCovers = v; } catch(e){}

function setNCovers(n){
  nCovers = n;
  try { localStorage.setItem(NCOVERS_KEY, String(n)); } catch(e){}
  pushStateToURL();
  renderNCovers();
  renderCovers();
}
function renderNCovers(){
  const el = document.getElementById('ncovers-toggle');
  if(!el) return;
  let html = '';
  for(let n = 2; n <= 8; n++){
    html += '<button class="bet-toggle-btn bet-toggle-btn--n ' + (n === nCovers ? 'active' : '') + '" '
         + 'onclick="setNCovers(' + n + ')">' + n + '</button>';
  }
  el.innerHTML = html;
}
renderNCovers();

/* ──────────────────────────────────────────────────────────
   COUVERTURES SÉQUENTIELLES — cartes de la zone centrale
   ────────────────────────────────────────────────────────── */
const COVERS_KEY = 'couvseq_covers';
let covers = [];

function defaultCover(){
  return { status:'pending', backOdd:null, layOdd:null, commission:3, loss:null };
}
function loadCovers(){
  try { const raw = localStorage.getItem(COVERS_KEY); if(raw) covers = JSON.parse(raw) || []; } catch(e){}
}
function saveCovers(){
  try { localStorage.setItem(COVERS_KEY, JSON.stringify(covers)); } catch(e){}
  pushStateToURL();
  if(typeof recompute === 'function') recompute();
}
function ensureCoversLength(){
  while(covers.length < nCovers) covers.push(defaultCover());
  if(covers.length > nCovers) covers.length = nCovers;
  // Verrou : toute couverture après une non-réalisée doit rester 'pending'
  let lock = false;
  for(let i = 0; i < covers.length; i++){
    if(lock) covers[i].status = 'pending';
    if(covers[i].status !== 'realized') lock = true;
  }
}
function previousAllRealized(idx){
  for(let i = 0; i < idx; i++) if(covers[i].status !== 'realized') return false;
  return true;
}

function setCoverStatus(idx, status){
  if(!covers[idx] || !previousAllRealized(idx)) return;
  covers[idx].status = status;
  if(status === 'pending'){
    for(let i = idx + 1; i < covers.length; i++) covers[i].status = 'pending';
  }
  saveCovers();
  renderCovers();
}
function setCoverField(idx, field, value){
  if(!covers[idx]) return;
  const numeric = new Set(['backOdd','layOdd','commission','loss']);
  covers[idx][field] = numeric.has(field) ? (parseFloat(value) || null) : value;
  saveCovers();
}

function renderCoverCard(c, idx){
  const showSelector = previousAllRealized(idx);
  const isRealized = c.status === 'realized';

  const selectorHtml = showSelector
    ? '<div class="bet-toggle cover-status-toggle">'
      + '<button class="bet-toggle-btn bet-toggle-btn--pending ' + (c.status==='pending'?'active':'') + '" onclick="setCoverStatus('+idx+',\'pending\')">À venir</button>'
      + '<button class="bet-toggle-btn bet-toggle-btn--done '    + (c.status==='realized'?'active':'') + '" onclick="setCoverStatus('+idx+',\'realized\')">Réalisé</button>'
      + '</div>'
    : '<span class="cover-lock-badge">À venir</span>';

  const bodyHtml = isRealized
    ? '<div class="field"><label>Perte Couverture ' + (idx+1) + ' (€)</label>'
      + '<input type="number" step="1" min="0" placeholder="—" value="' + (c.loss ?? '') + '" '
      + 'oninput="setCoverField('+idx+',\'loss\',this.value)"></div>'
    : '<div class="row-wrap">'
      +   '<div class="field"><label>Cote Back opposé</label>'
      +     '<input type="number" step="0.01" min="1" placeholder="—" value="' + (c.backOdd ?? '') + '" '
      +     'oninput="setCoverField('+idx+',\'backOdd\',this.value)"></div>'
      +   '<div class="field"><label>Cote Lay</label>'
      +     '<input type="number" step="0.01" min="1" placeholder="—" value="' + (c.layOdd ?? '') + '" '
      +     'oninput="setCoverField('+idx+',\'layOdd\',this.value)"></div>'
      +   '<div class="field"><label>Commission (%)</label>'
      +     '<input type="number" step="0.5" min="0" value="' + (c.commission ?? 3) + '" '
      +     'oninput="setCoverField('+idx+',\'commission\',this.value)"></div>'
      + '</div>';

  return ''
    + '<div class="cover-card cover-card--' + c.status + '" data-idx="' + idx + '">'
    +   '<div class="cover-card-head">'
    +     '<span class="cover-card-title">Couverture ' + (idx+1) + '</span>'
    +     selectorHtml
    +   '</div>'
    +   bodyHtml
    +   '<div class="cover-result"></div>'
    + '</div>';
}

function renderCovers(){
  ensureCoversLength();
  saveCovers();
  const el = document.getElementById('covers-container');
  if(!el) return;
  el.innerHTML = covers.map(renderCoverCard).join('');
  recompute();
}

/* ──────────────────────────────────────────────────────────
   MOTEUR DE CALCUL — couverture séquentielle équilibrée
   ────────────────────────────────────────────────────────── */
// Options de couverture (Lay et/ou Back opp.) en fonction des cotes saisies.
function getCoverFactorsOptions(cov){
  const comm = (cov.commission || 0) / 100;
  const opts = [];
  if(cov.layOdd && cov.layOdd > 1){
    opts.push({ mode:'lay', odd:cov.layOdd, comm, gain:1-comm, loss:cov.layOdd-1 });
  }
  if(cov.backOdd && cov.backOdd > 1){
    opts.push({ mode:'back', odd:cov.backOdd, comm, gain:(cov.backOdd-1)*(1-comm), loss:1 });
  }
  return opts;
}

// Évalue une combinaison de facteurs : renvoie { M, P, Qarr, Rarr }.
function evaluateCombination(combo, W, cashRisk, L){
  const K = combo.length;
  const Qarr = new Array(K), Rarr = new Array(K);
  let denom = 1, Q = 1, R = 1;
  for(let k = 0; k < K; k++){
    if(k > 0) Q *= (combo[k-1].gain + combo[k-1].loss);
    R *= combo[k].gain;
    Qarr[k] = Q;
    Rarr[k] = R;
    denom += Q * combo[k].loss / R;
  }
  const M = (W + cashRisk) / denom;
  const P = M - L - cashRisk;
  return { M, P, Qarr, Rarr };
}

function computeSequential(){
  // Agrégation des paris placés
  let W = 0, cashRisk = 0, freebetTotal = 0, validBets = 0;
  for(const bet of placedBets){
    const o = computeTotalOdd(bet);
    if(!o || o <= 1 || !bet.amount || bet.amount <= 0) continue;
    W += bet.amount * (o - 1);
    if(bet.type === 'cash') cashRisk += bet.amount;
    else freebetTotal += bet.amount;
    validBets++;
  }

  // Pertes déjà réalisées
  let L = 0;
  for(const c of covers){
    if(c.status === 'realized') L += (c.loss || 0);
  }

  // Couvertures à venir
  const pendingIdx = [];
  for(let i = 0; i < covers.length; i++){
    if(covers[i].status === 'pending') pendingIdx.push(i);
  }

  if(validBets === 0) return { W, L, cashRisk, freebetTotal, status:'no-bets' };
  if(pendingIdx.length === 0) return { W, L, cashRisk, freebetTotal, status:'no-pending' };

  // Options par couverture (Lay et/ou Back opp.)
  const options = pendingIdx.map(i => getCoverFactorsOptions(covers[i]));
  const firstMissing = options.findIndex(o => o.length === 0);
  if(firstMissing !== -1){
    return { W, L, cashRisk, freebetTotal, status:'missing-odds', firstMissingIdx: pendingIdx[firstMissing] };
  }

  // Brute-force sur le produit cartésien des options (max 2^K, K ≤ 8 ⇒ ≤ 256)
  const K = options.length;
  let best = null;
  const combo = new Array(K);
  function explore(k){
    if(k === K){
      const e = evaluateCombination(combo, W, cashRisk, L);
      if(!best || e.P > best.P) best = { combo: combo.slice(), M:e.M, P:e.P, Qarr:e.Qarr, Rarr:e.Rarr };
      return;
    }
    for(const opt of options[k]){
      combo[k] = opt;
      explore(k + 1);
    }
  }
  explore(0);

  const stakes = [];
  for(let k = 0; k < K; k++){
    const S = best.M * best.Qarr[k] / best.Rarr[k];
    const f = best.combo[k];
    stakes.push({
      idx: pendingIdx[k],
      mode: f.mode,
      odd: f.odd,
      stake: S,
      liability: f.mode === 'lay' ? S * (f.odd - 1) : null,
      winProfit: best.P,
    });
  }

  return { W, L, cashRisk, freebetTotal, P: best.P, stakes, status:'ok' };
}

function fmt2(n){ return (Math.round(n * 100) / 100).toFixed(2); }

function updateCoverResultsDom(r){
  for(let i = 0; i < covers.length; i++){
    const card = document.querySelector('.cover-card[data-idx="'+i+'"]');
    if(!card) continue;
    const resultEl = card.querySelector('.cover-result');
    if(!resultEl) continue;

    if(covers[i].status === 'realized'){
      resultEl.innerHTML = '';
      continue;
    }

    const stake = r.stakes && r.stakes.find(s => s.idx === i);
    if(!stake){
      let msg = '';
      if(r.status === 'no-bets') msg = 'Ajoutez un pari placé pour calculer.';
      else if(r.status === 'missing-odds' && r.firstMissingIdx === i) msg = 'Renseignez Lay ou Back opposé pour calculer cette couverture et les suivantes.';
      else if(r.status === 'missing-odds') msg = 'En attente de la couverture ' + (r.firstMissingIdx+1) + '.';
      resultEl.innerHTML = msg ? '<div class="cover-result-empty">' + msg + '</div>' : '';
      continue;
    }

    const modeLabel = stake.mode === 'lay' ? 'Lay @ ' + stake.odd : 'Back opp. @ ' + stake.odd;
    const liabHtml = stake.liability != null
      ? '<span class="cover-result-liab">Liability ' + fmt2(stake.liability) + ' €</span>'
      : '<span class="cover-result-liab cover-result-liab--none">sans liability</span>';
    resultEl.innerHTML = ''
      + '<div class="cover-result-row">'
      +   '<span class="cover-result-mode">' + modeLabel + '</span>'
      +   '<span class="cover-result-stake-label">Mise à placer</span>'
      +   '<span class="cover-result-stake">' + fmt2(stake.stake) + ' €</span>'
      +   liabHtml
      + '</div>';
  }
}

function updateGlobalSummary(r){
  const el = document.getElementById('results-summary');
  if(!el) return;

  if(r.status === 'no-bets'){
    el.innerHTML = '<div class="summary-empty">Ajoutez au moins un pari placé pour démarrer le calcul.</div>';
    return;
  }
  if(r.status === 'missing-odds'){
    el.innerHTML = '<div class="summary-empty">Renseignez les cotes (Lay ou Back opposé) des couvertures à venir pour obtenir le profit équilibré.</div>';
    return;
  }

  // 'ok' ou 'no-pending' (toutes réalisées) : on affiche les 3 métriques.
  const cashRecup = r.status === 'no-pending' ? -r.L : r.P;
  const conv = r.freebetTotal > 0 ? (cashRecup / r.freebetTotal) * 100 : null;
  const sign = v => v > 0.01 ? 'profit-pos' : v < -0.01 ? 'profit-neg' : 'profit-zero';
  const cashCls = sign(cashRecup);
  const convCls = conv === null ? '' : sign(conv);

  el.innerHTML = ''
    + '<div class="summary-card">'
    +   '<div class="summary-metrics">'
    +     '<div class="summary-metric">'
    +       '<div class="summary-metric-label">Freebet placé</div>'
    +       '<div class="summary-metric-value">' + fmt2(r.freebetTotal) + ' €</div>'
    +     '</div>'
    +     '<div class="summary-metric">'
    +       '<div class="summary-metric-label">Cash récupéré</div>'
    +       '<div class="summary-metric-value ' + cashCls + '">' + (cashRecup >= 0 ? '+' : '') + fmt2(cashRecup) + ' €</div>'
    +     '</div>'
    +     '<div class="summary-metric">'
    +       '<div class="summary-metric-label">Conversion</div>'
    +       '<div class="summary-metric-value ' + convCls + '">' + (conv !== null ? conv.toFixed(1) + ' %' : '—') + '</div>'
    +     '</div>'
    +   '</div>'
    + '</div>';
}

function recompute(){
  const r = computeSequential();
  updateCoverResultsDom(r);
  updateGlobalSummary(r);
}

loadCovers();
renderCovers();

/* ──────────────────────────────────────────────────────────
   CONFIGURATIONS ENREGISTRÉES — snapshots locaux nommés
   ────────────────────────────────────────────────────────── */
const SAVES_KEY = 'couvseq_saves';
let savedConfigs = [];

function loadSavedConfigs(){
  try { const raw = localStorage.getItem(SAVES_KEY); if(raw) savedConfigs = JSON.parse(raw) || []; } catch(e){}
}
function persistSavedConfigs(){
  try { localStorage.setItem(SAVES_KEY, JSON.stringify(savedConfigs)); } catch(e){}
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function deepClone(o){ return JSON.parse(JSON.stringify(o)); }

function saveCurrentConfig(){
  const now = new Date();
  const defaultName = 'Config ' + now.toLocaleDateString('fr-FR') + ' ' + now.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });
  const name = prompt('Nom de la configuration :', defaultName);
  if(name === null) return; // annulé
  const trimmed = name.trim() || defaultName;
  savedConfigs.unshift({
    id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2,5),
    name: trimmed,
    createdAt: Date.now(),
    state: deepClone({ v:1, b:placedBets, c:covers, n:nCovers })
  });
  persistSavedConfigs();
  renderSavedConfigs();
}

function loadSavedConfig(id){
  const conf = savedConfigs.find(x => x.id === id);
  if(!conf || !conf.state) return;
  const s = deepClone(conf.state);
  if(Array.isArray(s.b)) placedBets = s.b;
  if(Array.isArray(s.c)) covers = s.c;
  if(typeof s.n === 'number' && s.n >= 2 && s.n <= 8) nCovers = s.n;
  // écritures directes (savePlacedBets/saveCovers déclencheraient recompute avant que tout soit aligné)
  try { localStorage.setItem(PLACED_BETS_KEY, JSON.stringify(placedBets)); } catch(e){}
  try { localStorage.setItem(COVERS_KEY,      JSON.stringify(covers));     } catch(e){}
  try { localStorage.setItem(NCOVERS_KEY,     String(nCovers));            } catch(e){}
  pushStateToURL();
  renderNCovers();
  renderPlacedBets();
  renderCovers(); // déclenche recompute
}

function deleteSavedConfig(id){
  const conf = savedConfigs.find(x => x.id === id);
  if(!conf) return;
  if(!confirm('Supprimer la configuration « ' + conf.name + ' » ?')) return;
  savedConfigs = savedConfigs.filter(x => x.id !== id);
  persistSavedConfigs();
  renderSavedConfigs();
}

function renderSavedConfigs(){
  const el = document.getElementById('saved-configs');
  if(!el) return;
  if(savedConfigs.length === 0){
    el.innerHTML = '<p class="saved-configs-empty">Aucune configuration enregistrée.</p>';
    return;
  }
  el.innerHTML = savedConfigs.map(c =>
    '<div class="saved-config-item" data-id="' + c.id + '">'
    +   '<div class="saved-config-info">'
    +     '<span class="saved-config-name" title="' + escapeHtml(c.name) + '">' + escapeHtml(c.name) + '</span>'
    +     '<span class="saved-config-date">' + new Date(c.createdAt).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' }) + '</span>'
    +   '</div>'
    +   '<button class="saved-config-load" onclick="loadSavedConfig(\'' + c.id + '\')" title="Charger cette configuration">Charger</button>'
    +   '<button class="saved-config-delete" onclick="deleteSavedConfig(\'' + c.id + '\')" title="Supprimer">' + SVG_TRASH + '</button>'
    + '</div>'
  ).join('');
}

loadSavedConfigs();
renderSavedConfigs();

// Boot terminé : on autorise les écritures URL et on aligne l'URL avec l'état actuel.
__urlSyncReady = true;
pushStateToURL();

/* ── VERSIONS ── */
document.getElementById('footer-version').textContent =
  'Couverture séquentielle — ' + (window.CURRENT_VERSION || 'version actuelle');

const versionsWidget   = document.getElementById('versions-widget');
const versionsBtn      = document.getElementById('versions-btn');
const versionsDropdown = document.getElementById('versions-dropdown');
let versionsLoaded = false;

versionsBtn.addEventListener('click', () => {
  const isOpen = !versionsDropdown.hidden;
  versionsDropdown.hidden = isOpen;
  if (isOpen || versionsLoaded) return;

  versionsLoaded = true;
  const versions = window.AVAILABLE_VERSIONS || [];

  if (versions.length === 0) {
    versionsDropdown.innerHTML = '<p class="versions-msg">Aucune version disponible</p>';
  } else {
    versionsDropdown.innerHTML =
      '<p class="versions-header">Versions précédentes</p>' +
      versions.map(v =>
        `<a href="${v}/index.html" class="version-link">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          ${v}
        </a>`
      ).join('');
  }
});

document.addEventListener('click', (e) => {
  if (!versionsWidget.contains(e.target)) versionsDropdown.hidden = true;
});

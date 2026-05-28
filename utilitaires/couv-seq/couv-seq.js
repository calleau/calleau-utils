let mode='single';
function switchMode(m){
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
  const F=gv('freebet'), c=(gv('comm')||0)/100;
  const loss=gv('r_loss')||0, b1=gv('r_b1'), b2=gv('r_b2');
  const l2=gv('r_l2'), bp2=gv('r_bp2');
  const el=document.getElementById('result');

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
  const F=gv('freebet'),c=(gv('comm')||0)/100,cash=document.getElementById('bonusType').value==='cash';
  const el=document.getElementById('result');
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
const FIELDS=['freebet','comm','bonusType',
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

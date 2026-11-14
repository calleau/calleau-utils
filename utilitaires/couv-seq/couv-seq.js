/* ──────────────────────────────────────────────────────────
   URL state sync — partage par lien (?s=<lz-string>) + miroir localStorage.

   Format compact aligné sur calc-couverture (voir URL_STATE.md) :
   - JSON minifié avec clés courtes.
   - Omission agressive de toutes les valeurs par défaut.
   - Compression via LZString.compressToEncodedURIComponent → URL-safe.
   - Sync auto debouncée (~500ms) via history.replaceState.
   - Fallback silencieux si décodage échoue (param corrompu nettoyé).
   ────────────────────────────────────────────────────────── */

const URL_PARAM = 's';
const URL_STATE_VERSION = 1;
const URL_MAX_TEXT_LEN = 200;

// Texte libre (site, intitulé) : trimmé + tronqué, '' si vide.
function urlText(s){ return String(s || '').trim().slice(0, URL_MAX_TEXT_LEN); }

/* ---- Bet (compact ⇄ localStorage shape) ----
   Défauts localStorage : { type:"freebet", amount:50, oddsMode:"individual",
                            totalOdd:null, odds:[null, null], site:"", label:"" }
   Format URL :
     t  = type       (défaut "freebet", omis pour freebet)
     a  = amount     (défaut 50, omis si 50)
     m  = oddsMode   (défaut "individual", omis pour individual)
     to = totalOdd   (défaut null, omis si null)
     o  = odds       (défaut [null,null], omis si tableau à 2 nulls)
     w  = site       (défaut "", omis si vide)
     i  = label      (défaut "", omis si vide)
*/
function serializeBetForUrl(bet){
  const b = {};
  if(bet.type && bet.type !== 'freebet')       b.t = bet.type;
  if(bet.amount != null && bet.amount !== 50)  b.a = bet.amount;
  if(bet.oddsMode && bet.oddsMode !== 'individual') b.m = bet.oddsMode;
  if(bet.totalOdd != null)                     b.to = bet.totalOdd;
  if(Array.isArray(bet.odds)){
    const isDefaultOdds = bet.odds.length === 2 && bet.odds.every(o => o == null);
    if(!isDefaultOdds) b.o = bet.odds;
  }
  if(urlText(bet.site))  b.w = urlText(bet.site);
  if(urlText(bet.label)) b.i = urlText(bet.label);
  return b;
}
function expandBetFromUrl(cb){
  return {
    id: (typeof newBetId === 'function') ? newBetId() : ('b' + Date.now().toString(36) + Math.random().toString(36).slice(2,5)),
    type:     cb.t || 'freebet',
    amount:   (cb.a != null) ? cb.a : 50,
    oddsMode: cb.m || 'individual',
    totalOdd: (cb.to != null) ? cb.to : null,
    odds:     Array.isArray(cb.o) ? cb.o : [null, null],
    site:     cb.w || '',
    label:    cb.i || ''
  };
}

/* ---- Cover (compact ⇄ localStorage shape) ----
   Défauts localStorage : { status:"pending", backOdd:null, layOdd:null,
                            backComm:3, layComm:3, loss:null, site:"", label:"" }
   Format URL :
     s = status     (défaut "pending", omis pour pending)
     b = backOdd    (défaut null, omis si null)
     l = layOdd     (défaut null, omis si null)
     mb = backComm  (défaut 3, omis si 3) — commission sur la cote Back opp.
     ml = layComm   (défaut 3, omis si 3) — commission sur la cote Lay
     m  = (ancien format) commission unique, lue en repli pour mb et ml
     x = loss       (défaut null, omis si null)
     w = site       (défaut "", omis si vide)
     i = label      (défaut "", omis si vide)
     f = fills      (défaut [], omis si vide) — mises validées, chacune :
         t = mode (défaut "lay", "back" sinon), o = odd, s = stake,
         m = comm (défaut 3)
*/
function serializeFillForUrl(fill){
  const f = {};
  if(fill.mode === 'back')               f.t = 'back';
  if(fill.odd   != null)                 f.o = fill.odd;
  if(fill.stake != null)                 f.s = fill.stake;
  if(fill.comm != null && fill.comm !== 3) f.m = fill.comm;
  return f;
}
function expandFillFromUrl(cf){
  return {
    mode:  cf.t === 'back' ? 'back' : 'lay',
    odd:   (cf.o != null) ? cf.o : null,
    stake: (cf.s != null) ? cf.s : null,
    comm:  (cf.m != null) ? cf.m : 3
  };
}
function serializeCoverForUrl(cover){
  const c = {};
  if(cover.status && cover.status !== 'pending') c.s = cover.status;
  if(cover.backOdd != null) c.b = cover.backOdd;
  if(cover.layOdd  != null) c.l = cover.layOdd;
  if(cover.backComm != null && cover.backComm !== 3) c.mb = cover.backComm;
  if(cover.layComm  != null && cover.layComm  !== 3) c.ml = cover.layComm;
  if(cover.loss != null) c.x = cover.loss;
  if(urlText(cover.site))  c.w = urlText(cover.site);
  if(urlText(cover.label)) c.i = urlText(cover.label);
  if(Array.isArray(cover.fills) && cover.fills.length > 0) c.f = cover.fills.map(serializeFillForUrl);
  return c;
}
function expandCoverFromUrl(cc){
  return {
    status:     cc.s || 'pending',
    backOdd:    (cc.b != null) ? cc.b : null,
    layOdd:     (cc.l != null) ? cc.l : null,
    backComm:   (cc.mb != null) ? cc.mb : (cc.m != null) ? cc.m : 3,
    layComm:    (cc.ml != null) ? cc.ml : (cc.m != null) ? cc.m : 3,
    loss:       (cc.x != null) ? cc.x : null,
    site:       cc.w || '',
    label:      cc.i || '',
    fills:      Array.isArray(cc.f) ? cc.f.map(expandFillFromUrl) : []
  };
}

/* ---- Root state ---- */
function serializeStateForUrl(){
  const state = { v: URL_STATE_VERSION };
  if(typeof nCovers === 'number' && nCovers !== 2) state.n = nCovers;
  if(Array.isArray(placedBets) && placedBets.length > 0){
    state.b = placedBets.map(serializeBetForUrl);
  }
  if(Array.isArray(covers) && covers.length > 0){
    // Compact + rogne les covers par défaut en fin de tableau (padding
    // sera reconstitué par ensureCoversLength depuis nCovers).
    const cc = covers.map(serializeCoverForUrl);
    while(cc.length > 0 && Object.keys(cc[cc.length - 1]).length === 0) cc.pop();
    if(cc.length > 0) state.c = cc;
  }
  return state;
}

/* ---- Boot : prime localStorage from URL BEFORE loaders run ----
   Les loaders (loadPlacedBets/loadCovers) lisent localStorage juste après
   ce bloc. On y injecte donc l'état URL au format localStorage attendu. */
(function primeStorageFromURL(){
  if(typeof LZString === 'undefined') return;
  try {
    const params = new URLSearchParams(window.location.search);
    const s = params.get(URL_PARAM);
    if(!s) return;
    const json = LZString.decompressFromEncodedURIComponent(s);
    if(!json) throw new Error('decompress');
    const state = JSON.parse(json);
    if(!state || state.v !== URL_STATE_VERSION) return;

    if(Array.isArray(state.b)){
      const expanded = state.b.map(expandBetFromUrl);
      localStorage.setItem('couvseq_bets', JSON.stringify(expanded));
    }
    if(Array.isArray(state.c)){
      const expanded = state.c.map(expandCoverFromUrl);
      localStorage.setItem('couvseq_covers', JSON.stringify(expanded));
    }
    if(typeof state.n === 'number' && state.n >= 2 && state.n <= 8){
      localStorage.setItem('couvseq_ncovers', String(state.n));
    }
  } catch(e){
    // Param corrompu : nettoie silencieusement
    try {
      const url = new URL(window.location);
      url.searchParams.delete(URL_PARAM);
      history.replaceState(null, '', url);
    } catch(_){}
  }
})();

/* ---- Debounced write ---- */
let __urlSyncReady = false;
let __urlSyncTimer = null;
function pushStateToURL(){
  if(!__urlSyncReady) return;
  if(__urlSyncTimer) clearTimeout(__urlSyncTimer);
  __urlSyncTimer = setTimeout(writeStateToURL, 500);
}
function writeStateToURL(){
  __urlSyncTimer = null;
  if(typeof LZString === 'undefined') return;
  try {
    const state = serializeStateForUrl();
    const encoded = LZString.compressToEncodedURIComponent(JSON.stringify(state));
    const url = new URL(window.location);
    url.searchParams.set(URL_PARAM, encoded);
    // Nettoie l'ancien format à base de hash si présent (compat des anciens liens)
    if(url.hash && /^#s=/.test(url.hash)) url.hash = '';
    history.replaceState(null, '', url);
  } catch(e){}
}

/* ──────────────────────────────────────────────────────────
   PARIS PLACÉS — portefeuille de paris à équilibrer
   ────────────────────────────────────────────────────────── */
const PLACED_BETS_KEY = 'couvseq_bets';
let placedBets = [];

const SVG_X = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
const SVG_TRASH = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';

const SVG_HAND_COINS = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 15h2a2 2 0 1 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 17"/><path d="m7 21 1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-4.4a2 2 0 0 0-2.75-2.91l-4.2 3.9"/><path d="m2 16 6 6"/><circle cx="16" cy="9" r="2.9"/><circle cx="6" cy="5" r="3"/></svg>';

/* Sites connus (miroir de calc-couverture / .ff-site-pill du theme.css).
   Détection par substring insensible à la casse, le premier match gagne. */
const KNOWN_SITES = [
  'bet365', 'betclic', 'betify', 'betsson', 'bwin', 'daznbet', 'feelingbet',
  'olybet', 'piwix', 'pmu', 'pokerstars', 'unibet', 'vbet', 'winamax',
];
function detectSiteFromText(text){
  const t = String(text || '').toLowerCase();
  if(!t) return null;
  for(const s of KNOWN_SITES) if(t.includes(s)) return s;
  return null;
}
function applySiteDetection(input){
  const site = detectSiteFromText(input.value);
  if(site) input.setAttribute('data-site-match', site);
  else input.removeAttribute('data-site-match');
}

// Ligne "Site + Intitulé" commune aux paris placés et aux couvertures.
// onInput : nom de la fonction appelée avec (key, field, input).
function renderMetaFields(onInput, key, obj){
  const site = obj.site || '';
  const siteMatch = detectSiteFromText(site);
  return ''
    + '<div class="meta-row">'
    +   '<div class="field meta-site"><label>Site</label>'
    +     '<input type="text" class="site-input" placeholder="Site…" spellcheck="false" value="' + escapeHtml(site) + '"'
    +     (siteMatch ? ' data-site-match="' + siteMatch + '"' : '')
    +     ' oninput="' + onInput + '(' + key + ',\'site\',this)"></div>'
    +   '<div class="field meta-label"><label>Intitulé</label>'
    +     '<input type="text" placeholder="Intitulé…" value="' + escapeHtml(obj.label || '') + '"'
    +     ' oninput="' + onInput + '(' + key + ',\'label\',this)"></div>'
    + '</div>';
}

function newBetId(){ return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2,5); }

function createBet(){
  return { id:newBetId(), type:'freebet', amount:50, oddsMode:'individual', totalOdd:null, odds:[null,null], site:'', label:'' };
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
function onBetText(id, field, input){
  const b = placedBets.find(b => b.id === id); if(!b) return;
  b[field] = input.value;
  if(field === 'site') applySiteDetection(input);
  savePlacedBets();
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
    +   renderMetaFields('onBetText', '\''+bet.id+'\'', bet)
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

let lastResult = null; // dernier résultat de computeSequential (pré-remplissages)

// fills = mises déjà validées sur l'exchange pour cette couverture
// (placement partiel, cote qui a bougé…) : [{ mode, odd, comm, stake }]
function defaultCover(){
  return { status:'pending', backOdd:null, layOdd:null, backComm:3, layComm:3, loss:null, site:'', label:'', fills:[] };
}
// Migration : ancien champ 'commission' unique → backComm + layComm ; fills absent → [].
function migrateCover(c){
  if(c && c.commission !== undefined){
    const m = c.commission ?? 3;
    if(c.backComm == null) c.backComm = m;
    if(c.layComm  == null) c.layComm  = m;
    delete c.commission;
  }
  if(c && !Array.isArray(c.fills)) c.fills = [];
  return c;
}
function loadCovers(){
  try { const raw = localStorage.getItem(COVERS_KEY); if(raw) covers = (JSON.parse(raw) || []).map(migrateCover); } catch(e){}
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
// Couverture en cours = la première non réalisée (-1 si toutes réalisées).
function currentCoverIdx(){ return covers.findIndex(c => c.status !== 'realized'); }

// Perte subie si la couverture perd : mises validées + mise conseillée restante.
function expectedCoverLoss(idx){
  let loss = fillsFixedPart(covers[idx]).loss;
  const s = lastResult && lastResult.stakes && lastResult.stakes.find(x => x.idx === idx);
  if(s && !s.covered) loss += s.stake * (s.mode === 'lay' ? s.odd - 1 : 1);
  return loss;
}

function setCoverStatus(idx, status){
  if(!covers[idx] || !previousAllRealized(idx)) return;
  if(status === 'realized' && covers[idx].status !== 'realized' && covers[idx].loss == null){
    const loss = expectedCoverLoss(idx);
    if(loss > 0) covers[idx].loss = Math.round(loss * 100) / 100;
  }
  covers[idx].status = status;
  if(status === 'pending'){
    for(let i = idx + 1; i < covers.length; i++) covers[i].status = 'pending';
  }
  saveCovers();
  renderCovers();
}
function setCoverField(idx, field, value){
  if(!covers[idx]) return;
  const numeric = new Set(['backOdd','layOdd','loss']);
  const commissions = new Set(['backComm','layComm']);
  if(commissions.has(field)){
    const v = parseFloat(value);
    covers[idx][field] = isNaN(v) ? 0 : v; // champ vidé = 0 %
  } else {
    covers[idx][field] = numeric.has(field) ? (parseFloat(value) || null) : value;
  }
  saveCovers();
}

/* ---- Mises validées (fills) ---- */
// Nouvelle mise pré-remplie avec la mise conseillée (type, cote, montant) :
// il ne reste qu'à corriger le montant réellement validé.
function addFill(idx){
  const c = covers[idx]; if(!c) return;
  const s = lastResult && lastResult.stakes && lastResult.stakes.find(x => x.idx === idx);
  let fill;
  if(s && !s.covered){
    fill = { mode:s.mode, odd:s.odd, comm:(s.mode === 'lay' ? c.layComm : c.backComm) ?? 3, stake:Math.round(s.stake * 100) / 100 };
  } else {
    const mode = c.layOdd ? 'lay' : 'back';
    fill = { mode, odd:(mode === 'lay' ? c.layOdd : c.backOdd), comm:(mode === 'lay' ? c.layComm : c.backComm) ?? 3, stake:null };
  }
  c.fills.push(fill);
  saveCovers();
  renderCovers();
}
function removeFill(idx, j){
  const c = covers[idx]; if(!c) return;
  c.fills.splice(j, 1);
  saveCovers();
  renderCovers();
}
function setFillMode(idx, j, mode){
  const f = covers[idx] && covers[idx].fills[j]; if(!f) return;
  f.mode = mode;
  saveCovers();
  renderCovers();
}
function setFillField(idx, j, field, value){
  const f = covers[idx] && covers[idx].fills[j]; if(!f) return;
  if(field === 'comm'){
    const v = parseFloat(value);
    f.comm = isNaN(v) ? 0 : v; // champ vidé = 0 %
  } else {
    f[field] = parseFloat(value) || null;
  }
  saveCovers();
}

function onCoverText(idx, field, input){
  if(!covers[idx]) return;
  covers[idx][field] = input.value;
  if(field === 'site') applySiteDetection(input);
  saveCovers();
}

// Commission d'une cote (même rendu que calc-couverture : label + icône à gauche).
function renderCommissionField(idx, field, value){
  return ''
    + '<div class="cell-commission">'
    +   '<span class="cell-commission-label">Com.</span>'
    +   '<span class="cell-commission-icon">' + SVG_HAND_COINS + '</span>'
    +   '<input type="number" step="0.5" min="0" value="' + (value ?? 3) + '" '
    +   'oninput="setCoverField('+idx+',\''+field+'\',this.value)">'
    +   '<span class="cell-commission-suffix">%</span>'
    + '</div>';
}

// Bloc « Mises validées » : affiché sur la couverture en cours (avec le bouton
// d'ajout) et sur toute couverture à venir qui en a déjà.
function renderFills(c, idx){
  const isCurrent = idx === currentCoverIdx();
  const fills = c.fills || (c.fills = []);
  if(!isCurrent && fills.length === 0) return '';

  const rows = c.fills.map((f, j) => ''
    + '<div class="fill-row">'
    +   '<div class="bet-toggle fill-mode">'
    +     '<button class="bet-toggle-btn ' + (f.mode==='back'?'active':'') + '" onclick="setFillMode('+idx+','+j+',\'back\')">Back opp.</button>'
    +     '<button class="bet-toggle-btn ' + (f.mode==='lay' ?'active':'') + '" onclick="setFillMode('+idx+','+j+',\'lay\')">Lay</button>'
    +   '</div>'
    +   '<label class="fill-field"><span>Cote</span>'
    +     '<input type="number" step="0.01" min="1" placeholder="—" value="' + (f.odd ?? '') + '" '
    +     'oninput="setFillField('+idx+','+j+',\'odd\',this.value)"></label>'
    +   '<label class="fill-field fill-field--stake"><span>Mise validée</span>'
    +     '<input type="number" step="0.01" min="0" placeholder="—" value="' + (f.stake ?? '') + '" '
    +     'oninput="setFillField('+idx+','+j+',\'stake\',this.value)"><span>€</span></label>'
    +   '<div class="cell-commission">'
    +     '<span class="cell-commission-label">Com.</span>'
    +     '<span class="cell-commission-icon">' + SVG_HAND_COINS + '</span>'
    +     '<input type="number" step="0.5" min="0" value="' + (f.comm ?? 3) + '" '
    +     'oninput="setFillField('+idx+','+j+',\'comm\',this.value)">'
    +     '<span class="cell-commission-suffix">%</span>'
    +   '</div>'
    +   '<button class="odd-trash" title="Retirer cette mise validée" onclick="removeFill('+idx+','+j+')">' + SVG_TRASH + '</button>'
    + '</div>'
  ).join('');

  return ''
    + '<div class="fills">'
    +   (c.fills.length ? '<div class="bet-section-label">Mises validées</div>' + rows : '')
    +   (isCurrent ? '<button class="add-odd-btn" onclick="addFill('+idx+')">+ Mise validée</button>' : '')
    +   (c.fills.length
          ? '<p class="fills-hint">Mets à jour les cotes ci-dessus avec les cotes actuelles. '
            + 'Annule la partie non validée de l\'ordre sur l\'exchange avant de placer le complément.</p>'
          : '')
    + '</div>';
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
      +     'oninput="setCoverField('+idx+',\'backOdd\',this.value)">'
      +     renderCommissionField(idx, 'backComm', c.backComm)
      +   '</div>'
      +   '<div class="field"><label>Cote Lay</label>'
      +     '<input type="number" step="0.01" min="1" placeholder="—" value="' + (c.layOdd ?? '') + '" '
      +     'oninput="setCoverField('+idx+',\'layOdd\',this.value)">'
      +     renderCommissionField(idx, 'layComm', c.layComm)
      +   '</div>'
      + '</div>'
      + renderFills(c, idx);

  return ''
    + '<div class="cover-card cover-card--' + c.status + '" data-idx="' + idx + '">'
    +   '<div class="cover-card-head">'
    +     '<span class="cover-card-title">Couverture ' + (idx+1) + '</span>'
    +     selectorHtml
    +   '</div>'
    +   renderMetaFields('onCoverText', idx, c)
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
// Gain / perte par euro misé, si la couverture gagne / perd.
function coverFactor(mode, odd, commPct){
  const comm = (commPct ?? 3) / 100;
  return mode === 'lay'
    ? { mode, odd, comm, gain:1-comm,           loss:odd-1 }
    : { mode, odd, comm, gain:(odd-1)*(1-comm), loss:1 };
}

// Options de couverture (Lay et/ou Back opp.) en fonction des cotes saisies.
function getCoverFactorsOptions(cov){
  const opts = [];
  if(cov.layOdd  && cov.layOdd  > 1) opts.push(coverFactor('lay',  cov.layOdd,  cov.layComm));
  if(cov.backOdd && cov.backOdd > 1) opts.push(coverFactor('back', cov.backOdd, cov.backComm));
  return opts;
}

// Part fixe apportée par les mises validées : gain total si la couverture
// gagne, perte totale si elle perd.
function fillsFixedPart(cov){
  let gain = 0, loss = 0;
  for(const f of (cov.fills || [])){
    if(!f.odd || f.odd <= 1 || !f.stake || f.stake <= 0) continue;
    const x = coverFactor(f.mode, f.odd, f.comm);
    gain += f.stake * x.gain;
    loss += f.stake * x.loss;
  }
  return { gain, loss };
}

/* Évalue une combinaison de facteurs : renvoie { M, P, stakes, covered }.
   Tₖ = M + pertes cumulées avant la couverture k (affine en M : aₖ·M + bₖ).
   Couverture k gagne : Sₖ·gₖ + Gₖ = Tₖ  (Gₖ, Lₖ = part fixe des mises validées)
   Couverture k perd  : Tₖ₊₁ = Tₖ + Sₖ·lₖ + Lₖ
   Combiné passe      : W + cashRisk = T_{K+1}
   Si une mise ressort négative (déjà sur-couvert), on la fige à 0 et on
   renonce à égaliser cette issue (elle rapporte alors plus que P). */
function evaluateCombination(combo, fixed, W, cashRisk, L){
  const K = combo.length;
  const covered = new Array(K).fill(false);
  for(let pass = 0; pass <= K; pass++){
    const A = new Array(K), B = new Array(K);
    let a = 1, b = 0;
    for(let k = 0; k < K; k++){
      A[k] = a; B[k] = b;
      const f = combo[k], x = fixed[k];
      if(covered[k]){ b += x.loss; continue; }
      const r = (f.gain + f.loss) / f.gain;
      a *= r;
      b = b * r + x.loss - x.gain * f.loss / f.gain;
    }
    const M = (W + cashRisk - b) / a;
    const stakes = combo.map((f, k) => covered[k] ? 0 : (A[k] * M + B[k] - fixed[k].gain) / f.gain);
    let changed = false;
    stakes.forEach((s, k) => { if(s < -1e-9 && !covered[k]){ covered[k] = true; changed = true; } });
    if(!changed) return { M, P: M - L - cashRisk, stakes, covered };
  }
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

  const fixed = pendingIdx.map(i => fillsFixedPart(covers[i]));

  // Brute-force sur le produit cartésien des options (max 2^K, K ≤ 8 ⇒ ≤ 256)
  const K = options.length;
  let best = null;
  const combo = new Array(K);
  function explore(k){
    if(k === K){
      const e = evaluateCombination(combo, fixed, W, cashRisk, L);
      if(!best || e.P > best.P) best = { combo: combo.slice(), ...e };
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
    const S = best.stakes[k];
    const f = best.combo[k];
    const hasFills = (covers[pendingIdx[k]].fills || []).length > 0;
    stakes.push({
      idx: pendingIdx[k],
      mode: f.mode,
      odd: f.odd,
      stake: S,
      liability: f.mode === 'lay' ? S * (f.odd - 1) : null,
      // mises validées suffisantes (sur-couvert, ou complément < 1 centime)
      covered: best.covered[k] || (hasFills && S < 0.005),
      hasFills,
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

    if(stake.covered){
      resultEl.innerHTML = '<div class="cover-result-empty cover-result-empty--ok">'
        + 'Rien à ajouter : les mises validées couvrent déjà cette couverture.</div>';
      continue;
    }

    const modeLabel = stake.mode === 'lay' ? 'Lay @ ' + stake.odd : 'Back opp. @ ' + stake.odd;
    const liabHtml = stake.liability != null
      ? '<span class="cover-result-liab">Liability ' + fmt2(stake.liability) + ' €</span>'
      : '<span class="cover-result-liab cover-result-liab--none">sans liability</span>';
    resultEl.innerHTML = ''
      + '<div class="cover-result-row">'
      +   '<span class="cover-result-mode">' + modeLabel + '</span>'
      +   '<span class="cover-result-stake-label">' + (stake.hasFills ? 'Complément à placer' : 'Mise à placer') + '</span>'
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
  // Toutes réalisées = toutes les couvertures ont perdu, donc le combiné est passé.
  const cashRecup = r.status === 'no-pending' ? r.W - r.L - r.cashRisk : r.P;
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
  lastResult = r;
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
  if(Array.isArray(s.c)) covers = s.c.map(migrateCover);
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

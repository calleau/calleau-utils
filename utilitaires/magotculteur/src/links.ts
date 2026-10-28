// Libellés d'issues et liens pré-remplis vers calc-couverture / couv-seq.
// Partagé par l'interface (app.ts) et l'API (api/server.mjs) : aucune dépendance au DOM.
import LZString from 'lz-string';
import { eventDisplayName, getBackOddsGross } from './engine';
import type { AmountMode, BetDetail, CoveringSetResult, LegRef } from './types';

export interface LinkContext {
  data: any;              // cotes, format Betxtractor (noms d'équipes, dates, cotes par site)
  sitesInfo: any | null;  // assets/sites-informations.json (commissions)
  amountMode: AmountMode; // décide de l'issue fixée dans calc-couverture
  baseUrl: string;        // racine des utilitaires : '../' depuis l'interface, 'https://utils.calleau.org/' sinon
}

// Libellé texte d'une issue ("1" → nom de l'équipe, "1/X", écart de buts…).
export function issueLabelText(data: any, outcomeName: string, eventKey: string): string {
  const opp = data?.[eventKey]?.opponents;
  if (!opp) return outcomeName;
  const k = outcomeName.trim();
  const side = (s: string) => s === '1' ? String(opp['1'] ?? s) : s === '2' ? String(opp['2'] ?? s) : 'Nul';
  if (k === '1' || k === '2' || k === 'X') return side(k);
  // Mi-temps / fin de match ("1/X") : résultat à la mi-temps / en fin de match
  const htft = k.match(/^([12X])\/([12X])$/);
  if (htft) return `${side(htft[1])} / ${side(htft[2])}`;
  const eh = goalDiffLabel(k, String(opp['1'] ?? '1'), String(opp['2'] ?? '2'));
  if (eh) return eh;
  return outcomeName;
}

// Écart de buts au format Betxtractor "1 (0:2)" : avance domicile:extérieur. Avec
// g = buts dom. − buts ext. et t = ext − dom : "1" ⇔ g > t, "X" ⇔ g = t, "2" ⇔ g < t.
export function goalDiffLabel(outcome: string, team1: string, team2: string): string | null {
  const m = outcome.match(/^([12X]) \((\d+):(\d+)\)$/);
  if (!m) return null;
  const t = Number(m[3]) - Number(m[2]);
  const buts = (n: number) => `${n} but${n > 1 ? 's' : ''}`;
  // Phrase pour "team marque au moins n buts de plus que l'adversaire"
  const atLeast = (team: string, n: number) =>
    n >= 2 ? `${team} gagne de ${buts(n)} ou +`
    : n === 1 ? `${team} gagne`
    : n === 0 ? `${team} ne perd pas`
    : `${team} ne perd pas ou perd de ${buts(-n)} max`;
  let label: string;
  if (m[1] === '1') label = atLeast(team1, t + 1);
  else if (m[1] === '2') label = atLeast(team2, 1 - t);
  else label = t > 0 ? `${team1} gagne de ${buts(t)} exactement`
    : t < 0 ? `${team2} gagne de ${buts(-t)} exactement`
    : 'Nul';
  return `${label} (${m[2]}:${m[3]})`;
}

export function getLegIndivOdds(data: any, leg: LegRef, site: string): number | null {
  const oddsMap = data?.[leg.eventKey]?.markets?.[leg.marketName]?.[leg.outcomeName];
  if (!oddsMap) return null;
  return getBackOddsGross(oddsMap[site]);
}

// Matchs d'un résultat par date, puis par nom.
export function sortedEventKeys(data: any, r: CoveringSetResult): string[] {
  return [...r.eventKeys].sort((a, b) => {
    const evA = data?.[a], evB = data?.[b];
    const tA = evA?.dateTime ? new Date(evA.dateTime).getTime() : Infinity;
    const tB = evB?.dateTime ? new Date(evB.dateTime).getTime() : Infinity;
    if (tA !== tB) return tA - tB;
    const nA = evA ? eventDisplayName(a, evA) : a;
    const nB = evB ? eventDisplayName(b, evB) : b;
    return nA.localeCompare(nB, 'fr', { sensitivity: 'base' });
  });
}

// Commission rate (in %) for a site. Looked up in sites-informations.json
// (commission_winning, stored as a fraction 0..1). Lecture directe — déduire la
// commission à partir des cotes odds_net est imprécis car odds_net est arrondi
// à quelques décimales dans les données (ex. 3 % réel sort à 2,9 %).
function extractCommissionPct(sitesInfo: any, bet: BetDetail): number {
  const entry = sitesInfo?.[bet.site];
  const c = (entry && typeof entry.commission_winning === 'number')
    ? entry.commission_winning
    : (sitesInfo?.default?.commission_winning ?? 0);
  return Math.max(0, Math.min(100, c * 100));
}

// Format nombre au style français (virgule, 2 décimales) attendu par
// calc-couverture / couv-seq côté inputs.
function fmtNumFr(n: number, d = 2): string {
  return n.toFixed(d).replace('.', ',');
}

// Intitulé texte d'un pari : "marché issue" par leg, joints par " + ".
function betLegsLabel(data: any, b: BetDetail): string {
  return b.legs
    .map(l => `${l.marketName} ${issueLabelText(data, l.outcomeName, l.eventKey)}`)
    .join(' + ');
}

// Build a URL pointing to the couv-seq utility, pré-rempli avec le principal
// combiné comme placed bet et chaque cover (Back ou Lay) pré-remplie.
// Format : ?s=<LZString.compressToEncodedURIComponent(JSON compact)>.
// Cf. utilitaires/couv-seq/URL_STATE.md pour le schéma détaillé.
export function buildCouvSeqUrl(r: CoveringSetResult, ctx: LinkContext): string {
  const principal = r.bets.find(b => b.role === 'principal');
  if (!principal) return '';
  const covers = r.bets.filter(b => b.role === 'cover');
  if (!covers.length) return '';

  // Bet compact (omission des défauts : type="freebet", amount=50,
  // oddsMode="individual", totalOdd=null, odds=[null,null]).
  const bet: any = {};
  if (principal.betType === 'cash') bet.t = 'cash';
  if (principal.stake !== 50) bet.a = principal.stake;
  const odds = principal.legs.map(l => getLegIndivOdds(ctx.data, l, principal.site) ?? null);
  const isDefaultOdds = odds.length === 2 && odds.every(o => o == null);
  if (!isDefaultOdds) bet.o = odds;
  bet.w = principal.site;
  bet.i = betLegsLabel(ctx.data, principal);

  // Covers compacts (omission : status="pending", backOdd=null, layOdd=null,
  // backComm=3, layComm=3, loss=null). La commission va sur la cote utilisée.
  const cc = covers.map(c => {
    const isLay = c.legs[0]?.betType === 'Lay';
    const commPct = extractCommissionPct(ctx.sitesInfo, c);
    const cov: any = {};
    if (isLay) cov.l = c.odds; else cov.b = c.odds;
    if (commPct !== 3) cov[isLay ? 'ml' : 'mb'] = commPct;
    cov.w = c.site;
    cov.i = betLegsLabel(ctx.data, c);
    return cov;
  });

  const state: any = { v: 1 };
  if (covers.length !== 2) state.n = covers.length;
  state.b = [bet];
  // On garde tous les covers (pas de trim du trailing) : la longueur porte
  // l'info du nCovers voulu côté couv-seq via state.n.
  if (cc.length > 0) state.c = cc;

  const encoded = LZString.compressToEncodedURIComponent(JSON.stringify(state));
  return `${ctx.baseUrl}couv-seq/index.html?s=${encoded}`;
}

// Ce que calc-couverture doit garder fixe pour retrouver les mises du résultat :
// la référence du calcul du moteur. En simultané, mise totale → le Total (mises
// Back + engagements Lay, comme le Total de calc-couverture) ; mise min. par pari →
// le pari mis au montant minimum (le pari boosté s'il y en a un, sinon la plus
// petite mise principale). Autres cas : le premier principal.
function calcCouvAnchor(r: CoveringSetResult, amountMode: AmountMode): { fixedIdx: number | null; fixedTotal: number | null } {
  const firstPrincipal = Math.max(0, r.bets.findIndex(b => b.role === 'principal'));
  if (r.timing !== 'simult') return { fixedIdx: firstPrincipal, fixedTotal: null };
  if (amountMode === 'mise_totale') {
    return { fixedIdx: null, fixedTotal: r.bets.reduce((s, b) => s + (b.liability ?? b.stake), 0) };
  }
  if (amountMode === 'mise_min_par_pari') {
    const boosted = r.bets.findIndex(b => b.boosted);
    if (boosted >= 0) return { fixedIdx: boosted, fixedTotal: null };
    const principals = r.bets.map((b, i) => i).filter(i => r.bets[i].role === 'principal');
    const pool = principals.length ? principals : r.bets.map((_, i) => i);
    const minIdx = pool.reduce((best, i) => (r.bets[i].stake < r.bets[best].stake ? i : best), pool[0]);
    return { fixedIdx: minIdx, fixedTotal: null };
  }
  return { fixedIdx: firstPrincipal, fixedTotal: null };
}

// Build a URL pointing to calc-couverture, avec une issue par bet, quel que
// soit son rôle : un résultat peut contenir plusieurs principaux (freebets,
// groupe obligatoire, ou tous les paris en cash simultané) et zéro cover.
// Format : ?s=<LZString.compressToEncodedURIComponent(JSON)>.
// Cf. utilitaires/calc-couverture/URL_STATE.md pour le schéma détaillé.
//
// Note : la mise en forme est un "best-effort" pour la vérification manuelle.
// Le modèle "1 bet = 1 issue" reflète bien la couverture (chaque issue = un
// scénario mutuellement exclusif). Pour un pari freebet, la cote transmise est
// diminuée de 1 pour que le retour affiché exclue la mise (non rendue).
//
// Une colonne de cotes par match (ordre chronologique) : chaque sélection va dans
// la colonne de son match, calc-couverture multipliant les colonnes et ignorant
// les cases vides. Freebet et pari boosté gardent leur cote totale dans une seule
// colonne : leur cote n'est pas le produit des cotes individuelles.
export function buildCalcCouvUrl(r: CoveringSetResult, ctx: LinkContext): string {
  if (!r.bets.length) return '';
  const { fixedIdx, fixedTotal } = calcCouvAnchor(r, ctx.amountMode);
  const eventCols = sortedEventKeys(ctx.data, r);
  const nCols = Math.max(1, eventCols.length);
  const colOf = (ek: string) => Math.max(0, eventCols.indexOf(ek));

  // Globaux : activer commissions, détails, sites, labels d'issue.
  const g = { cm: 1, d: 1, ds: 1, il: 1 };

  const issues = r.bets.map((b, i) => {
    const isLay = b.liability != null || b.legs[0]?.betType === 'Lay';
    const commPct = extractCommissionPct(ctx.sitesInfo, b);
    const legsLabel = betLegsLabel(ctx.data, b);
    const typeLabel = isLay ? 'Lay' : b.betType === 'fb' ? 'Freebet' : 'Cash';
    const realOdds = b.betType === 'fb' ? ` (cote réelle ${fmtNumFr(b.odds)})` : '';
    const iss: any = { l: `${typeLabel} · ${legsLabel}${realOdds}` };

    const o: string[] = Array(nCols).fill('');
    const m: string[] = Array(nCols).fill('');
    const firstCol = colOf(b.legs[0]?.eventKey ?? '');
    const legOdds = b.legs.map(l => (b.legs.length === 1 ? b.odds : getLegIndivOdds(ctx.data, l, b.site)));
    if (b.betType === 'fb' || b.boosted || legOdds.some(x => x == null)) {
      // Freebet : la mise n'est pas rendue, le retour vaut stake × (cote − 1).
      o[firstCol] = fmtNumFr(b.betType === 'fb' ? b.odds - 1 : b.odds);
    } else {
      // Deux sélections du même match (cas théorique) : produit dans sa colonne.
      const byCol = new Map<number, number>();
      b.legs.forEach((l, k) => byCol.set(colOf(l.eventKey), (byCol.get(colOf(l.eventKey)) ?? 1) * legOdds[k]!));
      for (const [col, val] of byCol) o[col] = fmtNumFr(val);
    }
    if (commPct > 0) m[firstCol] = fmtNumFr(commPct);

    const detail: any = { w: b.site, o };
    if (isLay) detail.t = 'l';
    if (m.some(x => x !== '')) detail.m = m;
    if (i === fixedIdx) {
      iss.f = 1;
      detail.s = fmtNumFr(b.stake);
    }
    iss.dt = [detail];
    return iss;
  });

  const calc: any = { i: issues };
  if (nCols > 1) calc.n = nCols;
  if (fixedTotal !== null) calc.t = { s: fmtNumFr(fixedTotal), f: 1 };
  const state = { v: 1, g, c: [calc] };
  const encoded = LZString.compressToEncodedURIComponent(JSON.stringify(state));
  return `${ctx.baseUrl}calc-couverture/index.html?s=${encoded}`;
}

// Liens proposés pour un résultat : calc-couverture toujours, couv-seq pour les
// couvertures séquentielles multi-matchs.
export function resultLinks(r: CoveringSetResult, ctx: LinkContext): { calcCouverture?: string; couvSeq?: string } {
  const links: { calcCouverture?: string; couvSeq?: string } = {};
  const calc = buildCalcCouvUrl(r, ctx);
  if (calc) links.calcCouverture = calc;
  if (r.timing === 'seq' && r.nMatches >= 2) {
    const seq = buildCouvSeqUrl(r, ctx);
    if (seq) links.couvSeq = seq;
  }
  return links;
}

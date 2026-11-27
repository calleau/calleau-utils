// ===== COVERAGE RULES =====

export interface BetSpec {
  market: string;
  issue: string;
  betType: 'Back' | 'Lay';
}

export interface CoverageRule {
  issues: number;
  A: BetSpec[];
  B: BetSpec[];
  C?: BetSpec[];
  D?: BetSpec[];
  E?: BetSpec[];
  F?: BetSpec[];
  G?: BetSpec[];
  H?: BetSpec[];
  I?: BetSpec[];
}

// ===== SITE CONFIGURATION =====

export interface Mission {
  id: string;
  number: number; // numéro stable d'affichage par site (ex: Unibet #1)
  importance: 'obligatoire' | 'optionnelle';
  montantMode: 'mise_min' | 'profit_net_min' | 'profit_brut';
  montant: number;
  objectif: 'gagner' | 'miser' | 'perdre';
  coteMin: number;
  coteMinParSelection: number;
  nbCombinesMin: number; // nombre de legs minimum pour qu'un pari compte pour cette mission
}

export interface SiteConfig {
  freebetAmount: number;       // 0 = pas de freebet
  freebetPriority: 1 | 2 | 3; // 1=tout utiliser, 2=pour compléter, 3=ne pas utiliser
  missions: Mission[];
}

// ===== ENGINE OPTIONS =====

export type AmountMode = 'mise_totale' | 'mise_min_par_pari' | 'profit_net_min' | 'profit_brut';
export type CashObjective = 'gagner' | 'miser' | 'perdre';
export type BetType = 'fb' | 'cash';

// Séquentiel : durée (minutes) entre le coup d'envoi d'un match et son résultat, par sport et par
// période (assets/sport-durations.json, personnalisable dans l'interface).
export interface SportDuration { full: number; half: number | null }
export interface SeqTiming {
  marginMinutes: number;
  default: SportDuration;
  sports: (SportDuration & { name: string; aliases: string[] })[];
}

// Contrainte de montant (Cash) : mode + montant, éventuellement limitée aux paris d'un site.
export interface AmountConstraint {
  mode: AmountMode;
  amount: number;
  site?: string;
}

export interface EngineOpts {
  coverageRules: CoverageRule[];
  betType: BetType;
  sites: Record<string, SiteConfig>; // tous les sites présents dans le JSON
  allowedNLegs: number[];             // ex: [1, 2, 3]
  // Montant de référence (mode simple ou global)
  amountMode: AmountMode;
  amount: number;
  // Cash, optionnel (mode avancé : une contrainte par mission de référence). Toutes
  // doivent être respectées : la plus exigeante fixe les mises. Absent : une seule
  // contrainte { amountMode, amount } sur les paris principaux.
  amountConstraints?: AmountConstraint[];
  // Cash uniquement
  cashObjective: CashObjective;
  // Filtres globaux (mode simple)
  coteMin: number;
  coteMinParSelection: number;
  // Séquentiel : écart entre deux matchs d'un combiné = durée jusqu'au résultat du précédent (sport,
  // période de son marché) + marge. Absent : 90 min entre coups d'envoi (ancien comportement).
  seqTiming?: SeqTiming;
  // Cote maximale des paris placés sur les sites obligatoires (cote combinée pour un
  // combiné ; couvertures libres). Absente ou 0 = pas de limite. Pas d'équivalent dans
  // l'interface : utilisée par l'API (Cotorico).
  coteMax?: number;
  // Toggles de méthodes
  allowSeq: boolean;
  allowSimult: boolean;
  allowUni: boolean;
  allowMulti: boolean;
  allowSym: boolean;
  allowAsym: boolean;
  allowAsymLight: boolean;
  // Boost (cash uniquement) : si boostPct > 0, le moteur ne produit que des cover sets
  // avec UNE issue boostée. L'issue doit être placée sur boostSite. Formule :
  // boostedOdds = 1 + (odds - 1) * (1 + boostPct/100) (boost sur le gain net).
  boostPct?: number;
  boostSite?: string;
}

// ===== STRUCTURES INTERNES (moteur) =====

export interface LegRef {
  eventKey: string;
  marketName: string;
  outcomeName: string;
  betType: 'Back' | 'Lay';
}

export interface LayInfo {
  lGross: number;
  lNet: number;
  c: number;
  k: number;
}

export interface Cover {
  type: 'lay' | 'bk' | 'dc';
  site: string;
  marketName: string;
  outcomeName: string;
  odds: number;       // for math: net odds (Back) / lNet (Lay)
  oddsGross: number;  // for display: gross odds (Back) / lGross (Lay)
  lGross: number | null;
  c: number | null;
  k: number;
}

export interface Leg {
  eventKey: string;
  evName: string;
  evDate: string;
  evComp: string;
  dateTime: number | null;
  marketName: string;
  outcomeName: string;
  betType: 'Back' | 'Lay';
  b: number;          // for math: net Back odds; for Lay: (lGross - c) — keeps T = amount × b / cover.k correct
  bGross: number;     // for display: gross Back odds; for Lay: lGross
  layInfo: LayInfo | null;
  covers: Cover[];
  bestCover: Cover;
  bestK: number;
}

export interface LegWithCover extends Leg {
  cover: Cover;
  stake: number;
  liability: number | null;
}

// ===== DETAIL D'UN PARI =====

export interface BetDetail {
  legs: LegRef[];
  site: string;
  odds: number;       // cote combinée si multi-legs (boostée si boosted=true)
  stake: number;
  betType: BetType;
  role: 'principal' | 'cover';
  seqStep?: number;   // séquentiel uniquement : 0=toujours placé, 1+=conditionnel
  liability?: number; // lay uniquement
  satisfiedMissions?: string[]; // ids des missions que CE pari remplit à lui seul
  boosted?: boolean;        // true si ce pari a reçu le boost
  oddsBase?: number;        // cote avant boost (uniquement si boosted)
}

// ===== RESULTAT UNIFIE =====

export interface CoveringSetResult {
  timing: 'seq' | 'simult';
  placement: 'uni' | 'multi';
  symmetry: 'sym' | 'asym' | 'asym-light';
  bets: BetDetail[];
  eventKeys: string[];
  nMatches: number;
  profit: number;      // signé : positif=gain, négatif=perte
  rate: number;        // profit / mise principale (freebets ou cash selon betType)
  totalCash: number;   // total cash engagé (liability comprise)
  satisfiedMissions: string[]; // ids des missions satisfaites
  profitNoBoost?: number; // profit équivalent sans le boost (mêmes mises) — pour comparaison
  rateNoBoost?: number;   // idem en taux
}

export type AllResults = CoveringSetResult[];

// ===== MESSAGES WORKER =====

export interface WorkerComputePayload {
  data: any;
  opts: EngineOpts;
  shard?: { index: number; count: number };
}

export type WorkerInMessage =
  | { type: 'compute'; payload: WorkerComputePayload };

export type WorkerOutMessage =
  | { type: 'progress'; label: string; detail?: string; pct: number; done?: number; total?: number }
  | { type: 'result'; results: AllResults };

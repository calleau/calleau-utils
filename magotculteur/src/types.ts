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
}

// ===== SITE CONFIGURATION =====

export interface Mission {
  id: string;
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

export interface EngineOpts {
  coverageRules: CoverageRule[];
  betType: BetType;
  sites: Record<string, SiteConfig>; // tous les sites présents dans le JSON
  allowedNLegs: number[];             // ex: [1, 2, 3]
  // Montant de référence (mode simple ou global)
  amountMode: AmountMode;
  amount: number;
  // Cash uniquement
  cashObjective: CashObjective;
  // Filtres globaux (mode simple)
  coteMin: number;
  coteMinParSelection: number;
  // Toggles de méthodes
  allowSeq: boolean;
  allowSimult: boolean;
  allowUni: boolean;
  allowMulti: boolean;
  allowSym: boolean;
  allowAsym: boolean;
  allowAsymLight: boolean;
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
  odds: number;       // cote combinée si multi-legs
  stake: number;
  betType: BetType;
  role: 'principal' | 'cover';
  seqStep?: number;   // séquentiel uniquement : 0=toujours placé, 1+=conditionnel
  liability?: number; // lay uniquement
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
}

export type AllResults = CoveringSetResult[];

// ===== MESSAGES WORKER =====

export interface WorkerComputePayload {
  data: any;
  opts: EngineOpts;
  shard?: { index: number; count: number };
}

export type WorkerInMessage =
  | { type: 'compute'; payload: WorkerComputePayload }
  | { type: 'cancel' };

export type WorkerOutMessage =
  | { type: 'progress'; label: string; detail?: string; pct: number; done?: number; total?: number }
  | { type: 'result'; results: AllResults }
  | { type: 'cancelled' };

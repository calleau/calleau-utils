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

// ===== ENGINE OPTIONS (replaces global state used by engine) =====

export interface EngineOpts {
  coverageRules: CoverageRule[];
  filterMinOdds: number;
  minOddsPerSelection: number;
  asymCov: boolean;
  freebetBySite: Record<string, number>;
  cashObjective: 'miser' | 'gagner' | 'perdre';
}

// ===== DATA STRUCTURES =====

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
  odds: number;
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
  b: number;
  covers: Cover[];
  bestCover: Cover;
  bestK: number;
}

export interface LegWithCover extends Leg {
  cover: Cover;
  stake: number;
  liability: number | null;
  fbCover?: Cover | null;
}

export interface LegRef {
  eventKey: string;
  marketName: string;
  outcomeName: string;
}

export interface RawBet {
  legs: LegRef[];
  site: string;
  odds: number;
}

export interface FinalizedBet extends RawBet {
  stake: number;
}

// ===== RESULT TYPES =====

export interface SeqResult {
  method: 1;
  nLegs: number;
  betType: string;
  _cashObjective?: string;
  B: number;
  profit?: number;
  rate: number;
  loss?: number;
  netIfWins?: number;
  netIfLoses?: number;
  profitFb?: number | null;
  rateFb?: number | null;
  gaps?: number[];
  legs: LegWithCover[];
}

export interface ToutFBResult {
  method: 2 | 4;
  nMatches: number;
  nBets: number;
  betType: string;
  rate: number;
  profit?: number;
  loss?: number;
  bets: FinalizedBet[];
  totalAmount: number;
  eventKeys: string[];
}

export interface HybridFBResult {
  method: 3;
  nMatches: number;
  nBets: number;
  betType: 'fb';
  rate: number;
  profit: number;
  fbBet: FinalizedBet;
  cashBets: FinalizedBet[];
  totalCashAmount: number;
  eventKeys: string[];
}

export type AnyResult = SeqResult | ToutFBResult | HybridFBResult;
export type AllResults = Record<string, AnyResult[]>;

// ===== WORKER MESSAGES =====

export interface WorkerComputePayload {
  data: any;
  opts: EngineOpts;
  fbSite: string;
  amount: number;
  allowedNLegs: number[];
  betType: string;
  hasSeq: boolean;
}

export type WorkerInMessage =
  | { type: 'compute'; payload: WorkerComputePayload }
  | { type: 'cancel' };

export type WorkerOutMessage =
  | { type: 'progress'; label: string; pct: number }
  | { type: 'result'; allResults: AllResults }
  | { type: 'cancelled' };

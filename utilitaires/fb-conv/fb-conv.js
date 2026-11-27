// Freebets combinés couverts — composant React (JSX).
// Chargé par index.html en <script type="text/babel" src="fb-conv.js"> : Babel standalone le récupère
// en HTTP et le compile dans le navigateur. Il faut donc un serveur (pas de file://), comme le reste du site.

const { useState, useMemo } = React;

const OUTCOME_LABELS = ["1", "N", "2"];

// `site` = clé des couleurs de theme.css (--site-<site>-bg / -text, .ff-site-pill[data-site])
const BOOKMAKER_DEFS = [
  { id: 1, name: "PMU",     site: "pmu" },
  { id: 2, name: "Betclic", site: "betclic" },
  { id: 3, name: "Unibet",  site: "unibet" },
  { id: 4, name: "Winamax", site: "winamax" },
  { id: 5, name: "PSEL",    site: "psel" },
];

function makeDefaultBookmakers(numMatches) {
  return BOOKMAKER_DEFS.map((def) => ({
    ...def,
    freebetAmount: "",
    freebetActive: true,
    matches: Array(numMatches).fill(null).map(() => ["", "", ""]),
    guaranteedMatches: Array(numMatches).fill(null).map(() => ["", ""]), // [g1, g2]
  }));
}

function subsets(n, k) {
  const result = [];
  function bt(start, current) {
    if (current.length === k) { result.push([...current]); return; }
    for (let i = start; i < n; i++) { current.push(i); bt(i + 1, current); current.pop(); }
  }
  bt(0, []);
  return result;
}

function generateCombinations(k) {
  const combos = [];
  const total = Math.pow(3, k);
  for (let i = 0; i < total; i++) {
    const combo = [];
    let n = i;
    for (let m = 0; m < k; m++) { combo.push(n % 3); n = Math.floor(n / 3); }
    combos.push(combo.reverse()); // reverse so match 1 is outermost (slowest changing)
  }
  return combos;
}

function getBestOdds(activeBookmakers, matchIndices, combo, useGuaranteed = false) {
  let best = 0, bestBk = null, bestUsedG = [];
  activeBookmakers.forEach((bk) => {
    const usedG = [];
    const valid = combo.every((outcome, pos) => {
      const mi = matchIndices[pos];
      if (useGuaranteed && (outcome === 0 || outcome === 2)) {
        const gIdx = outcome === 0 ? 0 : 1;
        const gVal = bk.guaranteedMatches?.[mi]?.[gIdx];
        if (gVal !== "" && gVal !== undefined && !isNaN(parseFloat(gVal))) {
          usedG.push({ pos, mi, outcome, gIdx });
          return true;
        }
      }
      const val = bk.matches[mi]?.[outcome];
      return val !== "" && val !== null && !isNaN(parseFloat(val));
    });
    if (!valid) return;
    const odds = combo.reduce((prod, outcome, pos) => {
      const mi = matchIndices[pos];
      if (useGuaranteed && (outcome === 0 || outcome === 2)) {
        const gIdx = outcome === 0 ? 0 : 1;
        const gVal = bk.guaranteedMatches?.[mi]?.[gIdx];
        if (gVal !== "" && gVal !== undefined && !isNaN(parseFloat(gVal)))
          return prod * parseFloat(gVal);
      }
      return prod * parseFloat(bk.matches[mi][outcome]);
    }, 1);
    if (odds > best + 0.0001) { best = odds; bestBk = bk; bestUsedG = usedG; }
    else if (Math.abs(odds - best) <= 0.0001 && bestBk === null) { best = odds; bestBk = bk; bestUsedG = usedG; }
  });
  if (!bestBk) return null;
  return { odds: best, bk: bestBk, usedGuaranteed: bestUsedG };
}

function computeConversion(activeBookmakers, matchIndices, freebetType, useGuaranteed = false) {
  const k = matchIndices.length;
  const combos = generateCombinations(k);
  let sumInv = 0, valid = true;
  const details = combos.map((combo) => {
    const result = getBestOdds(activeBookmakers, matchIndices, combo, useGuaranteed);
    if (!result) { valid = false; return { combo, odds: null, bk: null, payout: null, usedGuaranteed: [] }; }
    const { odds, bk, usedGuaranteed } = result;
    const payout = freebetType === "full" ? odds : odds - 1;
    if (payout <= 0) valid = false;
    else sumInv += 1 / payout;
    return { combo, odds, bk, payout, usedGuaranteed };
  });
  if (!valid || sumInv === 0) return { rate: null, details };
  return { rate: 1 / sumInv, details };
}

// Statut d'un montant requis vs disponible : exact / manquant / non utilisé
const statusOf = (diff) => diff === null ? "st-none" : Math.abs(diff) < 0.01 ? "st-ok" : diff > 0 ? "st-miss" : "st-over";

// État d'un match vis-à-vis des sélections optimales (standard / garanties)
const matchStateClass = (std, guar, hasData) =>
  std && guar ? "is-both" : std ? "is-std" : guar ? "is-guar" : hasData ? "has-data" : "";

function SitePill({ bk, dim }) {
  return <span className={"ff-site-pill" + (dim ? " is-dim" : "")} data-site={bk.site}>{bk.name}</span>;
}

function Outcome({ o, dim }) {
  return <span className={`fb-outcome o${o}` + (dim ? " is-dim" : "")}>{OUTCOME_LABELS[o]}</span>;
}

function FreebetOptimizer() {
  const [totalMatches, setTotalMatches] = useState(3);
  const [comboSize, setComboSize]       = useState(3);
  const [bookmakers, setBookmakers]     = useState(() => makeDefaultBookmakers(3));
  const [freebetType, setFreebetType]   = useState("profit");
  const [matchNames, setMatchNames]     = useState(["Match 1", "Match 2", "Match 3"]);
  const [selectedTab, setSelectedTab]   = useState("plan");
  const [stakeMode, setStakeMode]       = useState("standard");
  const [standardStake, setStandardStake] = useState(100);
  const [maxStake, setMaxStake]           = useState("");  // "" = no cap
  const [placedBets, setPlacedBets]       = useState({}); // { [idx]: { stake, payout } }

  const effectiveComboSize = Math.min(comboSize, totalMatches);
  const activeBookmakers = useMemo(() => bookmakers.filter((bk) => bk.freebetActive), [bookmakers]);

  const totalStakeAmount = useMemo(() => {
    if (stakeMode === "standard") return standardStake;
    const raw = bookmakers.reduce((sum, bk) => {
      if (!bk.freebetActive) return sum;
      const v = parseFloat(bk.freebetAmount);
      return sum + (isNaN(v) ? 0 : v);
    }, 0);
    const cap = parseFloat(maxStake);
    return (!isNaN(cap) && cap > 0 && cap < raw) ? cap : raw;
  }, [stakeMode, standardStake, maxStake, bookmakers]);

  // Raw total before cap (for display)
  const rawPersiteTotal = useMemo(() => {
    if (stakeMode !== "persite") return 0;
    return bookmakers.reduce((sum, bk) => {
      if (!bk.freebetActive) return sum;
      const v = parseFloat(bk.freebetAmount);
      return sum + (isNaN(v) ? 0 : v);
    }, 0);
  }, [stakeMode, bookmakers]);

  const isCapped = useMemo(() => {
    if (stakeMode !== "persite") return false;
    const cap = parseFloat(maxStake);
    return !isNaN(cap) && cap > 0 && cap < rawPersiteTotal;
  }, [stakeMode, maxStake, rawPersiteTotal]);

  const allSubsets = useMemo(() => subsets(totalMatches, effectiveComboSize), [totalMatches, effectiveComboSize]);

  // Frozen plan — only updated on manual "Calculer" click
  const [frozenPlan, setFrozenPlan] = useState(null);
  const [frozenPlanGuaranteed, setFrozenPlanGuaranteed] = useState(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [calcSnapshot, setCalcSnapshot] = useState(null); // snapshot of inputs at last calc
  const [showGuaranteed, setShowGuaranteed] = useState(false);
  const [displayMode, setDisplayMode] = useState("standard"); // "standard" | "guaranteed"

  function makeSnapshot() {
    return JSON.stringify({
      bookmakers: bookmakers.map(bk => ({
        id: bk.id, freebetActive: bk.freebetActive,
        matches: bk.matches,
        guaranteedMatches: bk.guaranteedMatches,
      })),
      freebetType, effectiveComboSize, totalMatches,
    });
  }

  // Check if any guaranteed odds are filled
  const hasGuaranteedData = useMemo(() =>
    bookmakers.some(bk => bk.freebetActive &&
      bk.guaranteedMatches?.some(m => m.some(v => v !== "" && !isNaN(parseFloat(v))))
    ), [bookmakers]);

  function runOptimization(useGuaranteed = false) {
    if (activeBookmakers.length === 0) return { best: null, ranking: [] };
    let best = null;
    const ranking = [];
    allSubsets.forEach((matchIndices) => {
      const { rate, details } = computeConversion(activeBookmakers, matchIndices, freebetType, useGuaranteed);
      if (rate === null) return;
      const result = { matchIndices, rate, details };
      if (!best || rate > best.rate) best = result;
      ranking.push(result);
    });
    ranking.sort((a, b) => b.rate - a.rate);
    return { best, ranking };
  }

  const canCalculate = useMemo(() => {
    const hasOdds = bookmakers.some(bk =>
      bk.freebetActive &&
      bk.matches.some(m => m.every(v => v !== "" && !isNaN(parseFloat(v))))
    );
    if (!hasOdds) return false;
    if (calcSnapshot === null) return true;
    return makeSnapshot() !== calcSnapshot;
  }, [bookmakers, freebetType, effectiveComboSize, totalMatches, calcSnapshot]);

  const handleCalculer = () => {
    setCalcSnapshot(makeSnapshot());
    const std  = runOptimization(false);
    const guar = hasGuaranteedData ? runOptimization(true) : null;
    setFrozenPlan(std);
    setFrozenPlanGuaranteed(guar);
    if (guar?.best && std?.best && guar.best.rate > std.best.rate) setDisplayMode("guaranteed");
    else setDisplayMode("standard");
    setPlacedBets({});
    setShowResetConfirm(false);
  };

  const handleRecalcUnplaced = () => {
    const activePlan = displayMode === "guaranteed" ? frozenPlanGuaranteed : frozenPlan;
    if (!activePlan?.best) return;
    const matchIndices = activePlan.best.matchIndices;
    const useG = displayMode === "guaranteed";
    const { rate, details } = computeConversion(activeBookmakers, matchIndices, freebetType, useG);
    if (rate === null) return;
    const newBest = { matchIndices, rate, details };
    const ranking = [];
    allSubsets.forEach((mi) => {
      const r = computeConversion(activeBookmakers, mi, freebetType, useG);
      if (r.rate !== null) ranking.push({ matchIndices: mi, rate: r.rate, details: r.details });
    });
    ranking.sort((a, b) => b.rate - a.rate);
    if (useG) setFrozenPlanGuaranteed({ best: newBest, ranking });
    else setFrozenPlan({ best: newBest, ranking });
    setCalcSnapshot(makeSnapshot());
    setShowResetConfirm(false);
  };

  const handleRecalcReset = () => {
    setCalcSnapshot(makeSnapshot());
    const std  = runOptimization(false);
    const guar = hasGuaranteedData ? runOptimization(true) : null;
    setFrozenPlan(std);
    setFrozenPlanGuaranteed(guar);
    setPlacedBets({});
    setShowResetConfirm(false);
  };

  const optimization = (displayMode === "guaranteed" && frozenPlanGuaranteed ? frozenPlanGuaranteed : frozenPlan) ?? { best: null, ranking: [] };

  const bestPlan = optimization.best;

  const stakes = useMemo(() => {
    if (!bestPlan || totalStakeAmount === 0) return [];
    const gain = totalStakeAmount * bestPlan.rate;
    return bestPlan.details.map(({ payout }) => (payout > 0 ? gain / payout : 0));
  }, [bestPlan, totalStakeAmount]);

  // Gain cible = moyenne des gains réels des paris placés (robuste aux petits écarts)
  const gainTarget = useMemo(() => {
    const entries = Object.entries(placedBets);
    if (entries.length === 0) return null;
    const total = entries.reduce((sum, [, { stake, payout }]) => sum + stake * payout, 0);
    return total / entries.length;
  }, [placedBets]);

  // Mises effectives : locked pour les paris placés, recalculées pour les autres si gainTarget existe
  const effectiveStakes = useMemo(() => {
    if (!bestPlan) return stakes;
    return bestPlan.details.map((detail, i) => {
      if (placedBets[i]) return placedBets[i].stake;
      if (gainTarget !== null && detail.payout > 0) return gainTarget / detail.payout;
      return stakes[i] || 0;
    });
  }, [bestPlan, stakes, gainTarget, placedBets]);

  const bySite = useMemo(() => {
    if (!bestPlan) return [];
    const map = {};
    bestPlan.details.forEach(({ combo, odds, bk }, i) => {
      if (!bk) return;
      if (!map[bk.id]) map[bk.id] = { bk, combos: [], totalStake: 0 };
      map[bk.id].combos.push({ combo, odds, stake: stakes[i], idx: i });
      map[bk.id].totalStake += stakes[i] || 0;
    });
    return Object.values(map).sort((a, b) => b.combos.length - a.combos.length);
  }, [bestPlan, stakes]);

  const updateOdds = (bkId, matchIdx, outcomeIdx, value) => {
    setBookmakers((prev) => prev.map((bk) => {
      if (bk.id !== bkId) return bk;
      const matches = bk.matches.map((m, mi) =>
        mi === matchIdx ? m.map((o, oi) => (oi === outcomeIdx ? value : o)) : m);
      return { ...bk, matches };
    }));
  };

  const updateGuaranteedOdds = (bkId, matchIdx, gIdx, value) => {
    setBookmakers((prev) => prev.map((bk) => {
      if (bk.id !== bkId) return bk;
      const guaranteedMatches = (bk.guaranteedMatches || []).map((m, mi) =>
        mi === matchIdx ? m.map((v, gi) => (gi === gIdx ? value : v)) : m);
      return { ...bk, guaranteedMatches };
    }));
  };

  const updateBkField = (bkId, field, value) =>
    setBookmakers((prev) => prev.map((bk) => bk.id === bkId ? { ...bk, [field]: value } : bk));

  const toggleActive = (bkId) => {
    setBookmakers((prev) => prev.map((bk) => bk.id === bkId ? { ...bk, freebetActive: !bk.freebetActive } : bk));
  };

  const movePriority = (bkId, dir) => {
    setBookmakers((prev) => {
      const idx = prev.findIndex(b => b.id === bkId);
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      return next;
    });
  };

  const togglePlaced = (idx) => {
    setPlacedBets(prev => {
      if (prev[idx]) {
        const next = { ...prev };
        delete next[idx];
        return next;
      }
      const payout = bestPlan?.details[idx]?.payout;
      const odds   = bestPlan?.details[idx]?.odds;
      const stake = effectiveStakes[idx];
      if (!payout || !stake) return prev;
      return { ...prev, [idx]: { stake, payout, odds } };
    });
  };

  const fillTestValues = () => {
    setBookmakers(prev => prev.map(bk => {
      const matches = bk.matches.map(() => [0,1,2].map(() => (2.7 + Math.random() * 0.3).toFixed(2)));
      const guaranteedMatches = matches.map(m => bk.id === 4
        ? ["", ""]  // Winamax: base odds already guaranteed
        : [
            (parseFloat(m[0]) - Math.random() * 0.2).toFixed(2),
            (parseFloat(m[2]) - Math.random() * 0.2).toFixed(2),
          ]
      );
      return { ...bk, matches, guaranteedMatches };
    }));
  };

  const updateTotalMatches = (n) => {
    setTotalMatches(n);
    setBookmakers((prev) => prev.map((bk) => {
      const matches = [...bk.matches];
      while (matches.length < n) matches.push(["", "", ""]);
      const guaranteedMatches = [...(bk.guaranteedMatches || [])];
      while (guaranteedMatches.length < n) guaranteedMatches.push(["", ""]);
      return { ...bk, matches: matches.slice(0, n), guaranteedMatches: guaranteedMatches.slice(0, n) };
    }));
    setMatchNames((prev) => {
      const names = [...prev];
      while (names.length < n) names.push(`Match ${names.length + 1}`);
      return names.slice(0, n);
    });
    if (comboSize > n) setComboSize(n);
  };

  const pct = (r) => `${(r * 100).toFixed(1)}%`;
  const numSubsets = allSubsets.length;
  const numCombosPerSubset = Math.pow(3, effectiveComboSize);
  const validSubsets = optimization.ranking.length;
  const isMatchFilled = (bk, mi) => bk.matches[mi]?.every((v) => v !== "" && !isNaN(parseFloat(v)));
  const isMatchFilledG = (bk, mi) => bk.guaranteedMatches?.[mi]?.some((v) => v !== "" && !isNaN(parseFloat(v)));
  const matchHasAnyData = (mi) => bookmakers.some((bk) => bk.freebetActive && isMatchFilled(bk, mi));
  const hasResult = bestPlan && totalStakeAmount > 0;
  const matchName = (mi) => matchNames[mi] || `Match ${mi + 1}`;
  const placedCountAll = Object.keys(placedBets).length;
  const oddsGridCols = `150px repeat(${totalMatches}, minmax(170px, 1fr))`;

  return (
    <>
      {/* ── Configuration ── */}
      <section className="card fb-config">
        <div className="fb-field">
          <span className="fb-label">① Matchs configurés</span>
          <div className="fb-seg">
            {[2,3,4,5,6,7].map((n) => (
              <button key={n} type="button" className={"fb-seg-btn" + (totalMatches === n ? " is-active" : "")} onClick={() => updateTotalMatches(n)}>{n}</button>
            ))}
          </div>
        </div>
        <div className="fb-arrow">→</div>
        <div className="fb-field">
          <span className="fb-label">② Matchs en combiné</span>
          <div className="fb-seg">
            {[2,3,4,5].filter((n) => n <= totalMatches).map((n) => (
              <button key={n} type="button" className={"fb-seg-btn tone-pos" + (effectiveComboSize === n ? " is-active" : "")} onClick={() => setComboSize(n)}>{n}</button>
            ))}
          </div>
        </div>
        <div className="fb-arrow">→</div>
        <div className="fb-stats">
          <div><strong>{numSubsets}</strong> sélections possibles</div>
          <div><strong className={validSubsets > 0 ? "pos" : "neg"}>{validSubsets}</strong> exploitables</div>
          <div><strong>{numCombosPerSubset}</strong> paris / sélection</div>
        </div>
        <div className="fb-config-sep" />
        <div className="fb-field">
          <span className="fb-label">Type freebet</span>
          <div className="fb-seg">
            {[["profit","Profit seul"],["full","Mise incluse"]].map(([v,l]) => (
              <button key={v} type="button" className={"fb-seg-btn" + (freebetType === v ? " is-active" : "")} onClick={() => setFreebetType(v)}>{l}</button>
            ))}
          </div>
        </div>
        <div className="fb-field">
          <span className="fb-label">Garanties</span>
          <button type="button" className={"fb-toggle" + (showGuaranteed ? " is-on" : "")} onClick={() => setShowGuaranteed(v => !v)}>
            🔒 {showGuaranteed ? "Activées" : "Désactivées"}
          </button>
        </div>
      </section>

      {/* ── Freebets par site + mode de mise ── */}
      <section className="card">
        <div className="fb-stake-head">
          <h2 className="fb-section-title">Freebets disponibles par site</h2>
          <div className="fb-stake-controls">
            <div className="fb-seg">
              <button type="button" className={"fb-seg-btn fb-stake-btn" + (stakeMode === "standard" ? " is-active" : "")} onClick={() => setStakeMode("standard")}>
                Mise standard<span className="fb-seg-sub">Montant total fixe réparti</span>
              </button>
              <button type="button" className={"fb-seg-btn fb-stake-btn tone-pos" + (stakeMode === "persite" ? " is-active" : "")} onClick={() => setStakeMode("persite")}>
                Freebets réels<span className="fb-seg-sub">Montants saisis par site</span>
              </button>
            </div>
            {stakeMode === "standard" && (
              <div className="fb-field">
                <span className="fb-label">Montant</span>
                <div className="numinput">
                  <input type="number" min="1" step="1" value={standardStake} onChange={(e) => setStandardStake(parseFloat(e.target.value) || 0)} />
                  <span className="unit">€</span>
                </div>
              </div>
            )}
            {stakeMode === "persite" && totalStakeAmount > 0 && (
              <div className={"fb-total-badge" + (isCapped ? " is-capped" : "")}>
                {totalStakeAmount.toFixed(0)}€{isCapped && <small>&nbsp;/ {rawPersiteTotal.toFixed(0)}€</small>}
              </div>
            )}
            {stakeMode === "persite" && (
              <div className="fb-field">
                <span className="fb-label">Plafond max</span>
                <div className={"numinput" + (isCapped ? " is-capped" : "")}>
                  <input type="number" min="1" step="1" value={maxStake} placeholder="illimité" onChange={e => setMaxStake(e.target.value)} />
                  <span className="unit">€</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Ordre de priorité */}
        <span className="fb-label">Ordre de priorité en cas d'égalité de cote</span>
        <div className="fb-priority">
          {bookmakers.map((bk, idx) => (
            <div key={bk.id} className={"fb-prio-item" + (bk.freebetActive ? "" : " is-off")}>
              <span className="fb-prio-rank">#{idx+1}</span>
              <SitePill bk={bk} />
              <div className="fb-prio-arrows">
                <button type="button" onClick={() => movePriority(bk.id, -1)} disabled={idx === 0} aria-label={`Monter ${bk.name}`}>▲</button>
                <button type="button" onClick={() => movePriority(bk.id, +1)} disabled={idx === bookmakers.length - 1} aria-label={`Descendre ${bk.name}`}>▼</button>
              </div>
            </div>
          ))}
          <span className="fb-prio-hint">← priorité haute · basse →</span>
        </div>

        {/* Cartes de site */}
        <div className="fb-sites">
          {bookmakers.map((bk) => {
            const active = bk.freebetActive;
            const amount = parseFloat(bk.freebetAmount);
            const hasAmount = !isNaN(amount) && amount > 0;
            const siteData = bySite.find(s => s.bk.id === bk.id);
            const requiredStake = siteData ? siteData.totalStake : 0;
            const showCompare = stakeMode === "persite" && hasAmount && requiredStake > 0 && active;
            const diff = showCompare ? requiredStake - amount : null;
            return (
              <div key={bk.id} data-site={bk.site} className={"fb-site" + (active ? "" : " is-off")}>
                <div><SitePill bk={bk} dim={!active} /></div>
                <div className={"numinput" + (stakeMode === "standard" ? " is-disabled" : "")}>
                  <input type="number" min="0" step="1" value={bk.freebetAmount} placeholder="0" disabled={stakeMode === "standard"} onChange={(e) => updateBkField(bk.id, "freebetAmount", e.target.value)} />
                  <span className="unit">€</span>
                </div>
                {showCompare && (
                  <div className={"fb-note " + statusOf(diff)}>
                    {Math.abs(diff) < 0.01 ? "✓ Montant exact" : diff > 0 ? `⚠ +${diff.toFixed(2)}€ manquant` : `ℹ ${Math.abs(diff).toFixed(2)}€ non utilisé`}
                  </div>
                )}
                <button type="button" className={"fb-include" + (active ? " is-on" : "")} onClick={() => toggleActive(bk.id)}>
                  {active ? "✓ Inclus" : "✗ Exclu"}
                </button>
              </div>
            );
          })}
        </div>

        {/* Barre de synthèse */}
        <div className="fb-summary">
          <div className="fb-summary-sites">
            <span>Sites actifs :</span>
            {bookmakers.filter(b => b.freebetActive).map((bk) => <SitePill key={bk.id} bk={bk} />)}
          </div>
          <div className="fb-summary-figures">
            <div className="fb-figure">
              <span className="fb-label">{stakeMode === "standard" ? "Mise standard" : isCapped ? "Mise plafonnée" : "Freebet total actif"}</span>
              <span className={"fb-figure-value" + (totalStakeAmount > 0 ? (isCapped ? " warn" : "") : " empty")}>
                {totalStakeAmount > 0 ? `${totalStakeAmount.toFixed(2)}€` : "—"}
                {isCapped && <small> / {rawPersiteTotal.toFixed(2)}€</small>}
              </span>
            </div>
            {hasResult && <>
              <div className="fb-arrow" style={{ paddingTop: 0 }}>→</div>
              <div className="fb-figure">
                <span className="fb-label">Cash garanti</span>
                <span className="fb-figure-value pos">{(totalStakeAmount * bestPlan.rate).toFixed(2)}€</span>
              </div>
              <div className="fb-figure">
                <span className="fb-label">Taux</span>
                <span className="fb-figure-value pos">{pct(bestPlan.rate)}</span>
              </div>
            </>}
          </div>
        </div>
      </section>

      {/* ── Meilleur résultat ── */}
      {hasResult ? (() => {
        const stdPlan  = frozenPlan?.best;
        const guarPlan = frozenPlanGuaranteed?.best;
        const showBoth = showGuaranteed && stdPlan && guarPlan;
        const isGuar = displayMode === "guaranteed";
        return (
          <div className="fb-best-wrap">
            {showBoth && (
              <div className="fb-seg" style={{ alignSelf: "flex-start" }}>
                {[["standard","Standard","tone-pos"],["guaranteed","🔒 Avec garanties","tone-guar"]].map(([mode,label,tone]) => (
                  <button key={mode} type="button" className={`fb-seg-btn ${tone}` + (displayMode === mode ? " is-active" : "")} onClick={() => setDisplayMode(mode)}>
                    {label}
                    <span className="fb-seg-rate">{pct(mode === "standard" ? stdPlan.rate : guarPlan.rate)}</span>
                  </button>
                ))}
                {guarPlan.rate > stdPlan.rate && (
                  <span className="fb-gain-hint">+{pct(guarPlan.rate - stdPlan.rate)} avec garanties</span>
                )}
              </div>
            )}
            <section className={"card fb-best" + (isGuar ? " is-guar" : "")}>
              <div>
                <div className="fb-best-title">★ Sélection optimale{isGuar ? " · Cotes garanties" : ""}</div>
                <div className="fb-chips">
                  {bestPlan.matchIndices.map((mi) => <span key={mi} className="fb-chip">{matchName(mi)}</span>)}
                  {Array.from({ length: totalMatches }, (_, i) => i).filter((i) => !bestPlan.matchIndices.includes(i)).map((mi) => (
                    <span key={mi} className="fb-chip is-out">{matchName(mi)}</span>
                  ))}
                </div>
              </div>
              <div className="fb-best-metrics">
                <div>
                  <div className="metric-label">Taux conversion</div>
                  <div className="metric-value accent">{pct(bestPlan.rate)}</div>
                </div>
                <div>
                  <div className="metric-label">Cash garanti</div>
                  <div className="metric-value">{(totalStakeAmount * bestPlan.rate).toFixed(2)}€</div>
                </div>
                {optimization.ranking.length > 1 && (
                  <div>
                    <div className="metric-label">Gain vs pire</div>
                    <div className="metric-value primary">+{(totalStakeAmount * (optimization.ranking[0].rate - optimization.ranking[optimization.ranking.length - 1].rate)).toFixed(2)}€</div>
                  </div>
                )}
              </div>
            </section>
          </div>
        );
      })() : (
        <section className="card fb-empty">
          <div className="fb-empty-icon">📋</div>
          {activeBookmakers.length === 0 ? "Active au moins un site pour calculer le plan."
            : stakeMode === "persite" && totalStakeAmount === 0 ? "Renseigne le montant de freebet d'au moins un site actif."
            : "Saisis les cotes pour obtenir le plan de paris optimal."}
        </section>
      )}

      {/* ── Grille des cotes ── */}
      <section className="card">
        <h2 className="fb-section-title">Cotes par site et par match</h2>

        <div className="fb-match-names">
          {Array(totalMatches).fill(0).map((_, mi) => {
            const isSelectedStd  = frozenPlan?.best?.matchIndices.includes(mi) ?? false;
            const isSelectedGuar = showGuaranteed && (frozenPlanGuaranteed?.best?.matchIndices.includes(mi) ?? false);
            return (
              <label key={mi} className={"fb-match-name " + matchStateClass(isSelectedStd, isSelectedGuar, matchHasAnyData(mi))}>
                <span>M{mi+1}</span>
                <input value={matchName(mi)} onChange={(e) => { const n = [...matchNames]; n[mi] = e.target.value; setMatchNames(n); }} />
              </label>
            );
          })}
        </div>

        <div className="fb-scroll">
          <div className="fb-odds-grid">
            <div className="fb-odds-head" style={{ gridTemplateColumns: oddsGridCols }}>
              <div />
              {Array(totalMatches).fill(0).map((_, mi) => {
                const isSelectedStd  = frozenPlan?.best?.matchIndices.includes(mi) ?? false;
                const isSelectedGuar = showGuaranteed && (frozenPlanGuaranteed?.best?.matchIndices.includes(mi) ?? false);
                const badge = isSelectedStd && isSelectedGuar ? "✓🔒" : isSelectedStd ? "✓" : isSelectedGuar ? "🔒" : null;
                return (
                  <div key={mi} className={"fb-col-head " + matchStateClass(isSelectedStd, isSelectedGuar, matchHasAnyData(mi))}>
                    {matchName(mi).slice(0, 10)}{badge && <span className="badge">{badge}</span>}
                  </div>
                );
              })}
            </div>

            {bookmakers.map((bk) => {
              const active = bk.freebetActive;
              const siteData = bySite.find(s => s.bk.id === bk.id);
              const req = siteData ? siteData.totalStake : 0;
              let meta = null;
              if (!active) meta = <div className="fb-odds-site-meta">exclu</div>;
              else if (req > 0 && stakeMode === "persite") {
                const amt = parseFloat(bk.freebetAmount);
                const hasAmt = !isNaN(amt) && amt > 0;
                const diff = hasAmt ? req - amt : null;
                meta = <div className={"fb-odds-site-meta " + statusOf(diff)}>{`misé ${req.toFixed(0)}€${hasAmt ? " / " + amt.toFixed(0) + "€ dispo" : ""}`}{diff !== null && diff > 0 && " ⚠"}</div>;
              } else if (req > 0) meta = <div className="fb-odds-site-meta">misé {req.toFixed(2)}€</div>;
              return (
                <div key={bk.id} data-site={bk.site} className={"fb-odds-row" + (active ? "" : " is-off")} style={{ gridTemplateColumns: oddsGridCols }}>
                  <div className="fb-odds-site">
                    <SitePill bk={bk} />
                    {meta}
                  </div>
                  {Array(totalMatches).fill(0).map((_, mi) => {
                    const isSelectedStd  = frozenPlan?.best?.matchIndices.includes(mi) ?? false;
                    const isSelectedGuar = frozenPlanGuaranteed?.best?.matchIndices.includes(mi) ?? false;
                    const filled  = isMatchFilled(bk, mi);
                    const filledG = isMatchFilledG(bk, mi);
                    return (
                      <div key={mi} className="fb-odds-cell">
                        {/* Cotes normales — surlignées par le plan standard */}
                        <div className={"fb-odds-group" + (active && isSelectedStd && filled ? " is-sel" : "")}>
                          {[0,1,2].map((oi) => {
                            const val = bk.matches[mi]?.[oi] ?? "";
                            return (
                              <div key={oi} className={`fb-odd o${oi}`}>
                                <span>{OUTCOME_LABELS[oi]}</span>
                                <input type="number" step="0.01" min="1" value={val} placeholder="—" disabled={!active}
                                  className={(val === "" ? "is-empty" : "") + (isSelectedStd ? " is-sel" : "")}
                                  onChange={(e) => updateOdds(bk.id, mi, oi, e.target.value)}
                                  onBlur={(e) => { const v = parseFloat(e.target.value); if (e.target.value !== "" && (isNaN(v) || v < 1)) updateOdds(bk.id, mi, oi, ""); }} />
                              </div>
                            );
                          })}
                        </div>
                        {/* Cotes garanties — surlignées par le plan avec garanties */}
                        {showGuaranteed && bk.id !== 4 && (
                          <div className={"fb-odds-group is-guar" + (active && isSelectedGuar && filledG ? " is-sel" : "")}>
                            {[0,1].map((gIdx) => {
                              const gVal = bk.guaranteedMatches?.[mi]?.[gIdx] ?? "";
                              const isEmpty = gVal === "";
                              return (
                                <React.Fragment key={gIdx}>
                                  {gIdx === 1 && (
                                    <div className="fb-odd is-spacer"><span>N</span><div /></div>
                                  )}
                                  <div className="fb-odd is-g">
                                    <span className={isEmpty ? "is-empty" : ""}>{gIdx === 0 ? "1G" : "2G"}</span>
                                    <input type="number" step="0.01" min="1" value={gVal} placeholder="—" disabled={!active}
                                      className={(isEmpty ? "is-empty" : "") + (isSelectedGuar ? " is-sel" : "")}
                                      onChange={(e) => updateGuaranteedOdds(bk.id, mi, gIdx, e.target.value)}
                                      onBlur={(e) => { const v = parseFloat(e.target.value); if (e.target.value !== "" && (isNaN(v) || v < 1)) updateGuaranteedOdds(bk.id, mi, gIdx, ""); }} />
                                  </div>
                                </React.Fragment>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
        <div className="fb-legend">
          <span>— = cote non renseignée (ignorée)</span>
          <span className="pos">✓ = match retenu dans la sélection optimale</span>
          <span className="guar">1G / 2G = cote garantie (si équipe mène de 2 buts)</span>
        </div>
      </section>

      {/* ── Calcul ── */}
      <div className="fb-calc">
        {placedCountAll === 0 ? (
          <div className="fb-calc-row">
            <button type="button" className="btn btn-primary" onClick={handleCalculer} disabled={!canCalculate}>⚡ Calculer</button>
            {!frozenPlan && !canCalculate && <span className="fb-calc-status">Renseigne les cotes puis lance le calcul</span>}
            {!frozenPlan && canCalculate && <span className="fb-calc-status">Prêt à calculer</span>}
            {frozenPlan && !canCalculate && <span className="fb-calc-status ok">✓ Calcul à jour</span>}
            {frozenPlan && canCalculate && <span className="fb-calc-status warn">⚠ Les paramètres ont changé depuis le dernier calcul</span>}
          </div>
        ) : (
          <>
            <div className="fb-calc-row">
              <button type="button" className="btn btn-secondary" onClick={handleRecalcUnplaced} disabled={!canCalculate}>↻ Recalculer les mises restantes</button>
              <button type="button" className={"btn btn-danger-outline" + (showResetConfirm ? " is-open" : "")} onClick={() => setShowResetConfirm(v => !v)}>⚠ Recalculer et réinitialiser</button>
              <span className="fb-calc-status">
                {placedCountAll} pari{placedCountAll > 1 ? "s" : ""} verrouillé{placedCountAll > 1 ? "s" : ""}
              </span>
            </div>
            {showResetConfirm && (
              <div className="error-box fb-confirm">
                <span>⚠ Cette action va effacer les {placedCountAll} paris déjà marqués comme placés. Cette opération est irréversible.</span>
                <div className="fb-confirm-actions">
                  <button type="button" className="btn btn-ghost" onClick={() => setShowResetConfirm(false)}>Annuler</button>
                  <button type="button" className="btn btn-danger-solid" onClick={handleRecalcReset}>Confirmer la réinitialisation</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Onglets ── */}
      <div className="fb-tabs">
        {[["plan","Plan de paris optimal"],["ranking",`Classement (${validSubsets} sélections valides)`],["all","Tableau complet"]].map(([tab,label]) => (
          <button key={tab} type="button" className={"fb-tab" + (selectedTab === tab ? " is-active" : "")} onClick={() => setSelectedTab(tab)}>{label}</button>
        ))}
      </div>

      {/* Onglet : plan par site */}
      {selectedTab === "plan" && (
        hasResult ? (
          <div className="fb-plan">
            {bySite.map(({ bk, combos, totalStake: siteStake }) => {
              const available = stakeMode === "persite" ? parseFloat(bk.freebetAmount) : null;
              const hasAvail = available !== null && !isNaN(available) && available > 0;
              const diff = hasAvail ? siteStake - available : null;
              const st = statusOf(diff);
              return (
                <div key={bk.id} data-site={bk.site} className="fb-plan-card">
                  <div className="fb-plan-head">
                    <div className="fb-plan-head-top">
                      <SitePill bk={bk} />
                      <span>{combos.length} paris</span>
                    </div>
                    <div className={"fb-plan-progress " + st}>
                      {hasAvail && (
                        <div className="fb-bar"><div style={{ "--w": `${Math.min((siteStake / available) * 100, 100)}%` }} /></div>
                      )}
                      <div className="fb-plan-amount">
                        {siteStake.toFixed(2)}€{hasAvail && <small> / {available.toFixed(2)}€</small>}
                      </div>
                    </div>
                    {diff !== null && Math.abs(diff) > 0.01 && (
                      <div className={"fb-plan-warn " + st}>
                        {diff > 0 ? `⚠ ${diff.toFixed(2)}€ manquant` : `ℹ ${Math.abs(diff).toFixed(2)}€ non utilisé`}
                      </div>
                    )}
                  </div>
                  <div className="fb-plan-list">
                    {combos.map(({ combo, odds, stake, idx }) => (
                      <div key={idx} className="fb-plan-line">
                        <div className="combo">{combo.map((o, i) => <Outcome key={i} o={o} />)}</div>
                        <div className="nums">
                          <span className="odds">×{odds.toFixed(2)}</span>
                          <span className="stake">{stake.toFixed(2)}€</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="fb-tab-empty">
            {activeBookmakers.length === 0 ? "Active au moins un site." : stakeMode === "persite" && totalStakeAmount === 0 ? "Renseigne le montant de freebet d'au moins un site actif." : "Saisis les cotes pour calculer le plan."}
          </div>
        )
      )}

      {/* Onglet : classement */}
      {selectedTab === "ranking" && (
        validSubsets > 0 ? (() => {
          const cols = "44px 1fr 110px 120px 110px";
          return (
            <div className="fb-scroll">
              <div className="fb-table">
                <div className="fb-table-row is-head" style={{ gridTemplateColumns: cols }}>
                  <div>#</div><div>Matchs sélectionnés</div><div>Taux conv.</div><div>Cash garanti</div><div>Δ vs optimal</div>
                </div>
                {optimization.ranking.map(({ matchIndices, rate }, i) => {
                  const gain = totalStakeAmount * rate;
                  const delta = totalStakeAmount * (rate - optimization.ranking[0].rate);
                  const isFirst = i === 0;
                  return (
                    <div key={i} className={"fb-table-row" + (isFirst ? " is-best" : "")} style={{ gridTemplateColumns: cols }}>
                      <div className="rank hl">{isFirst ? "★" : i + 1}</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {matchIndices.map((mi) => <span key={mi} className="fb-match-tag">{matchNames[mi] || `M${mi+1}`}</span>)}
                      </div>
                      <div className="num hl">{pct(rate)}</div>
                      <div className="num hl">{totalStakeAmount > 0 ? `${gain.toFixed(2)}€` : pct(rate)}</div>
                      <div className={"num " + (isFirst ? "muted" : "neg")}>{isFirst ? "—" : totalStakeAmount > 0 ? `−${Math.abs(delta).toFixed(2)}€` : ""}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })() : (
          <div className="fb-tab-empty">Aucune sélection valide pour l'instant.</div>
        )
      )}

      {/* Onglet : tableau complet */}
      {selectedTab === "all" && bestPlan && totalStakeAmount > 0 && (() => {
        const placedCount   = placedCountAll;
        const totalCount    = bestPlan.details.length;
        const gainRef       = gainTarget ?? (totalStakeAmount * bestPlan.rate);
        const totalPlacedStake    = Object.entries(placedBets).reduce((s, [, { stake }]) => s + stake, 0);
        const totalRemainingStake = bestPlan.details.reduce((s, _, i) => placedBets[i] ? s : s + effectiveStakes[i], 0);
        const isGuar = displayMode === "guaranteed";
        const cols = `44px repeat(${effectiveComboSize},52px) minmax(90px,1fr) 80px 110px 90px ${isGuar ? "130px " : ""}90px`;
        return (
          <div>
            {/* Bandeau de progression */}
            <section className={"card fb-progress" + (placedCount === 0 ? "" : placedCount === totalCount ? " is-done" : " is-partial")}>
              <div>
                <div className="fb-progress-title">
                  {placedCount === 0 ? "Aucun pari placé — cliquer sur le statut pour verrouiller" :
                   placedCount === totalCount ? "✓ Tous les paris placés" :
                   `${placedCount} / ${totalCount} paris placés`}
                </div>
                <div className="fb-progress-figures">
                  <span>Gain cible : <strong className="pos">{gainRef.toFixed(2)}€</strong></span>
                  {placedCount > 0 && <span>Misé : <strong>{totalPlacedStake.toFixed(2)}€</strong></span>}
                  {placedCount > 0 && placedCount < totalCount && <span>Reste à miser : <strong className="info">{totalRemainingStake.toFixed(2)}€</strong></span>}
                </div>
              </div>
              {placedCount > 0 && (
                <button type="button" className="btn btn-ghost" style={{ marginLeft: "auto" }} onClick={() => setPlacedBets({})}>Réinitialiser</button>
              )}
            </section>

            <div className="fb-scroll">
              <div className="fb-table">
                <div className="fb-table-row is-head" style={{ gridTemplateColumns: cols }}>
                  <div>#</div>
                  {bestPlan.matchIndices.map((mi) => <div key={mi}>{(matchNames[mi] || `M${mi+1}`).slice(0, 6)}</div>)}
                  <div>Site</div><div>Cote</div><div>Mise €</div><div>Gain €</div>
                  {isGuar && <div className="guar">Jackpot 🎰</div>}
                  <div>Statut</div>
                </div>
                {bestPlan.details.map(({ combo, odds, bk, usedGuaranteed }, i) => {
                  const isPlaced      = !!placedBets[i];
                  const displayOdds   = isPlaced ? placedBets[i].odds : odds;
                  const stake         = effectiveStakes[i];
                  const origStake     = stakes[i];
                  const gain          = stake * (freebetType === "full" ? displayOdds : displayOdds - 1);
                  const isRecalc      = !isPlaced && gainTarget !== null;
                  const stakeDiff     = isRecalc ? stake - origStake : 0;

                  // Scénarios jackpot en mode garanties
                  const jackpotScenarios = [];
                  if (isGuar && usedGuaranteed?.length > 0) {
                    usedGuaranteed.forEach(({ pos, outcome: gOutcome }) => {
                      [0,1,2].filter(o => o !== gOutcome).forEach(finalOutcome => {
                        const jackpotCombo = [...combo]; jackpotCombo[pos] = finalOutcome;
                        const jackpotIdx = bestPlan.details.findIndex(d =>
                          d.combo.length === combo.length && d.combo.every((v, j) => v === jackpotCombo[j])
                        );
                        if (jackpotIdx >= 0 && jackpotIdx !== i) {
                          const jStake = effectiveStakes[jackpotIdx];
                          const jOdds  = bestPlan.details[jackpotIdx].odds;
                          const jGain  = jStake * (freebetType === "full" ? jOdds : jOdds - 1);
                          jackpotScenarios.push({ finalOutcome, total: gain + jGain });
                        }
                      });
                    });
                  }

                  const rowClass = "fb-table-row" + (isPlaced ? " is-placed fb-is-placed" : jackpotScenarios.length > 0 ? " is-jackpot" : "");
                  return (
                    <div key={i} className={rowClass} style={{ gridTemplateColumns: cols }}>
                      <div className="rank">#{String(i + 1).padStart(2, "0")}</div>
                      {combo.map((o, pos) => <div key={pos}><Outcome o={o} dim={isPlaced} /></div>)}
                      <div>{bk && <SitePill bk={bk} dim={isPlaced} />}</div>
                      <div className="num muted">{displayOdds?.toFixed(2)}</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                        <span className={"num" + (isPlaced ? " strike" : "")} style={{ fontWeight: 600 }}>{stake.toFixed(2)}€</span>
                        {isRecalc && Math.abs(stakeDiff) > 0.005 && (
                          <span className={"fb-diff " + (stakeDiff > 0 ? "up" : "down")}>
                            {stakeDiff > 0 ? "▲+" : "▼"}{stakeDiff.toFixed(2)}€ vs initial
                          </span>
                        )}
                      </div>
                      <div className="num pos" style={{ opacity: isPlaced ? 0.5 : 1 }}>{gain.toFixed(2)}€</div>
                      {isGuar && (
                        <div>
                          {jackpotScenarios.length > 0
                            ? jackpotScenarios.map((js, k) => (
                                <div key={k} className="fb-jackpot">🎰 {js.total.toFixed(2)}€ si {OUTCOME_LABELS[js.finalOutcome]}</div>
                              ))
                            : <span className="muted">—</span>
                          }
                        </div>
                      )}
                      <div>
                        <button type="button" className={"fb-status-btn" + (isPlaced ? " is-placed" : "")} onClick={() => togglePlaced(i)}>
                          {isPlaced ? "✓ Placé" : "À placer"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Méthode ── */}
      <section className="card">
        <p className="fb-method">
          <strong>ℹ Méthode</strong> — En mode <strong>Mise standard</strong>, le montant saisi est réparti sur tous les paris.
          En mode <strong>Freebets réels</strong>, le total est la somme des freebets des sites actifs.
          Les mises sont proportionnelles : <code>mise_c = (total × taux) / cote_paiement_c</code>.
        </p>
      </section>

      <div className="fb-test">
        <button type="button" className="btn btn-ghost" onClick={fillTestValues}>🎲 Valeurs tests</button>
      </div>
    </>
  );
}

// Le root React s'insère dans .wrap : on le neutralise pour que ses enfants profitent du gap
const rootEl = document.getElementById("root");
rootEl.style.display = "contents";
ReactDOM.createRoot(rootEl).render(<FreebetOptimizer />);

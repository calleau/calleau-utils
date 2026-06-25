/* global $ */
const STEP = 0.01;
const DEC = 2;

/* Counters are global so IDs stay unique across all calculator instances
   (otherwise duplicating a card could collide with existing IDs). */
let issueCounter = 1;   // I01, I02, ...
let colCounter = 1;     // C01, C02, ...
let detailCounter = 1;  // D01, D02, ...

/* ---------- Helpers (module-level, no per-calc state) ---------- */

function toFixed2(n) { return Number(n).toFixed(DEC); }

function normalize(val) {
	if (val === "" || val == null) return "";
	const safe = String(val).replace(/[^\d.,-]/g, "");
	const parts = safe.replace(",", ".").split(".");
	const joined = parts.length > 2 ? parts[0] + "." + parts.slice(1).join("") : parts.join(".");
	const num = Number(joined);
	return Number.isNaN(num) ? "" : toFixed2(num);
}

function letterFor(idx) { return String.fromCharCode(64 + idx); }

function pad2(n) { const s = String(n); return s.length < 2 ? "0" + s : s; }

function nextIssueId() { return "I" + pad2(issueCounter++); }
/* Returns a new colId — caller is responsible for pushing it into its own colIds array. */
function nextColId() { return "C" + pad2(colCounter++); }
function nextDetailId() { return "D" + pad2(detailCounter++); }

function getDefaultCommission() {
	return ($("#commission-default").val() || "3,00").trim() || "3,00";
}

/* Renvoie le coefficient p ∈ [0,1] de répartition de la perte (paramètre global).
   Si le paramètre n'est pas activé, on retourne 0 (= comportement classique :
   ligne distribuée concentre tout le profit, ligne non distribuée à 0). */
function getLossDistribution() {
	if (!$("#loss-dist-enabled").is(":checked")) return 0;
	const raw = ($("#loss-dist-default").val() || "0").replace(",", ".");
	const v = parseFloat(raw);
	if (Number.isNaN(v)) return 0;
	return Math.max(0, Math.min(100, v)) / 100;
}

function buildOddsCell(colId, issueId, detailId, defaultOdds = "", isLay = false) {
	const defaultComm = isLay ? getDefaultCommission() : "";
	const $cell = $(`<div class='cell' data-odds data-colid="${colId}" data-issueid="${issueId}" data-detailid="${detailId}"></div>`);
	const $stack = $("<div class='odds-input-stack'></div>");
	$stack.append(buildNumberField("", defaultOdds, null));
	const $commWrap = $("<div class='cell-commission'></div>");
	$commWrap.append("<span class='cell-commission-label'>Com.</span>");
	const $commField = buildNumberField("", defaultComm, null, "%");
	$commField.find("input").addClass("commission-input");
	$commWrap.append($commField);
	$stack.append($commWrap);
	$cell.append($stack);
	return $cell;
}

function buildNumberField(ph = "", defaultValue = "", min = null, suffix = "") {
	const suffixHtml = suffix ? `<span class="num-suffix">${suffix}</span>` : "";
	const $el = $(`
	<div class="num">
		<input type="text" inputmode="decimal" placeholder="${ph}" autocomplete="off" spellcheck="false" />
		${suffixHtml}
		<div class="steppers">
			<button type="button" class="step plus" aria-label="Augmenter">+</button>
			<button type="button" class="step minus" aria-label="Diminuer">−</button>
		</div>
	</div>
	`);
	const $input = $el.find("input");
	if (defaultValue !== "") $input.val(defaultValue.replace(".", ","));

	$input.on("input", function () {
		let v = this.value.replace(/[^\d.,-]/g, "");
		const parts = v.replace(",", ".").split(".");
		if (parts.length > 2) v = parts[0] + "." + parts.slice(1).join("");
		this.value = v;
		if (this.value !== "") {
			let num = Number(this.value.replace(",", "."));
			if (min !== null && !isNaN(num) && num < min) {
				this.value = toFixed2(min).replace(".", ",");
			}
		}
		$input.trigger("cote:changed");
	});
	$input.on("blur", function () {
		const f = normalize(this.value);
		let val = f ? f.replace(".", ",") : "";
		if (val !== "") {
			let num = Number(val.replace(",", "."));
			if (min !== null && !isNaN(num) && num < min) {
				val = toFixed2(min).replace(".", ",");
			}
		}
		this.value = val;
		$input.trigger("cote:changed");
	});
	$input.on("focus", function () { this.select(); });
	$el.on("click", function (e) {
		if ($(e.target).closest(".step").length) return;
		if (e.target === $input[0]) return;
		$input[0].focus();
	});
	$el.on("click", ".plus", function () {
		let base = Number(($input.val() || "0").replace(",", "."));
		if (isNaN(base)) base = 0;
		let next = base + STEP;
		if (min !== null && next < min) next = min;
		$input.val(toFixed2(next).replace(".", ",")).trigger("blur").trigger("cote:changed");
	});
	$el.on("click", ".minus", function () {
		let base = Number(($input.val() || "0").replace(",", "."));
		if (isNaN(base)) base = 0;
		let next = base - STEP;
		if (min !== null && next < min) next = min;
		$input.val(toFixed2(next).replace(".", ",")).trigger("blur").trigger("cote:changed");
	});
	return $el;
}

function buildTypeCell(issueId, detailId) {
	return $(`
		<div class="cell" data-type data-issueid="${issueId}" data-detailid="${detailId}">
			<button type="button" class="type-toggle" data-mode="back" aria-label="Basculer Back / Lay">
				<span class="type-inner">
					<span class="type-face type-face-back">+ Back</span>
					<span class="type-face type-face-lay">− Lay</span>
				</span>
			</button>
		</div>
	`);
}

/* Cellule dédiée à la corbeille de suppression d'un détail (colonne sans header
   entre Profit et Fixe détail). Affichée uniquement si l'issue a >=2 détails. */
function buildDelDetailCell(issueId, detailId) {
	return $(`
		<div class="cell del-detail-cell" data-deldetail data-issueid="${issueId}" data-detailid="${detailId}">
			<button class="btn-icon btn btn-danger js-del-detail" data-issueid="${issueId}" data-detailid="${detailId}" title="Supprimer ce détail" style="display:none;">
				<i data-lucide="trash-2" class="icon"></i>
			</button>
		</div>
	`);
}

function buildStakeCell(issueId, detailId, defaultStake = "") {
	const $cell = $(`<div class='cell' data-stake data-issueid="${issueId}" data-detailid="${detailId}"></div>`);
	const $sg = $("<div class='stake-input-group back-stake'><span class='stake-label'>Mise</span></div>")
		.append(buildNumberField("", defaultStake, 0.01, "€"));
	const $lg = $("<div class='stake-input-group liability'><span class='stake-label'>Engagement</span></div>")
		.append(buildNumberField("", "", 0.01, "€"));
	$cell.append($sg).append($lg);
	return $cell;
}

function buildFixeDetailCell(issueId, detailId) {
	return $(`
		<div class="cell" data-fixedetail data-issueid="${issueId}" data-detailid="${detailId}">
			<input type="checkbox" class="check fixe-detail" aria-label="Fixe détail">
		</div>
	`);
}

function buildOddsTotalCell(issueId, detailId) {
	return $(`<div class="cell" data-odds-total data-issueid="${issueId}" data-detailid="${detailId}">—</div>`);
}

function buildProfitCell(issueId, detailId) {
	return $(`<div class="cell right" data-profit data-issueid="${issueId}" data-detailid="${detailId}">—</div>`);
}

function buildIssueActionsCell(issueId) {
	return $(`
		<div class="cell right" data-actions data-issueid="${issueId}">
			<div class="detail-actions">
				<button class="btn-icon btn btn-danger js-del-issue" title="Supprimer l'issue">
					<i data-lucide="trash-2" class="icon"></i>
				</button>
			</div>
		</div>
	`);
}

/* Cellule "Ajouter un détail" / "Ajouter Gain fixe" positionnée en colonne 2
   (sous Type), insérée après la dernière ligne de détail de l'issue.
   width:0 + overflow visible → ne contribue pas au sizing de la colonne. */
function buildAddDetailCell(issueId) {
	return $(`
		<div class="cell add-detail-cell" data-issueid="${issueId}" data-add-detail>
			<button type="button" class="js-add-detail" title="Ajouter un détail">
				<svg class="btn-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 .83.18 2 2 0 0 0 .83-.18l8.58-3.9a1 1 0 0 0 0-1.831z"/><path d="M16 17h6"/><path d="M19 14v6"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 .825.178"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l2.116-.962"/></svg>
				Détail
			</button>
			<button type="button" class="js-add-fixed-gain" title="Ajouter un gain fixe">
				<svg class="btn-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="M9 12h6"/><path d="M12 9v6"/></svg>
				Gain fixe
			</button>
		</div>
	`);
}

/* Cellule "Σ issue" placée sur la même ligne que les boutons + Détail / + Gain fixe,
   dans la colonne Profit. */
function buildIssueSumProfitCell(issueId) {
	return $(`<div class="cell right issue-sum-profit" data-issueid="${issueId}" data-issue-sum-profit></div>`);
}

/* Cellule "Cote moyenne issue" placée sur la même ligne, dans la colonne Cote totale.
   Affichée uniquement quand l'issue a plusieurs détails valides. */
function buildIssueAvgCoteCell(issueId) {
	return $(`<div class="cell issue-avg-cote" data-issueid="${issueId}" data-issue-avg-cote></div>`);
}

/* Cellules d'un détail "Gain fixe" — dans l'ordre des colonnes nouveau layout :
   Type(vide), cotes(vides x N), Cote totale(vide), Mise(vide), Profit(input +
   label "Gain" + corbeille), Fixe détail (cochée + disabled). */
function buildFixedGainDetailCells(issueId, detailId, colIds) {
	const cells = [];
	cells.push($(`<div class="cell fg-empty fg-type" data-issueid="${issueId}" data-detailid="${detailId}"></div>`));
	for (const colId of colIds) {
		cells.push($(`<div class="cell fg-empty fg-cote" data-colid="${colId}" data-issueid="${issueId}" data-detailid="${detailId}"></div>`));
	}
	cells.push($(`<div class="cell fg-empty fg-cote-totale" data-issueid="${issueId}" data-detailid="${detailId}"></div>`));
	cells.push($(`<div class="cell fg-empty" data-stake data-issueid="${issueId}" data-detailid="${detailId}"></div>`));

	// Cellule Profit : contient le label + input (sans corbeille — elle est dans
	// la colonne dédiée juste après). Marqueur data-fixed-gain-input pour
	// countDetails et la collecte recompute.
	const $profit = $(`
		<div class="cell fixed-gain-profit" data-profit data-fixed-gain-input data-issueid="${issueId}" data-detailid="${detailId}">
			<div class="fixed-gain-input-group">
				<span class="fixed-gain-label">Gain</span>
			</div>
		</div>
	`);
	const $field = buildNumberField("0,00", "", null, "€");
	$field.find("input").addClass("fixed-gain-value");
	$profit.find(".fixed-gain-input-group").append($field);
	cells.push($profit);

	// Cellule corbeille (colonne dédiée)
	cells.push(buildDelDetailCell(issueId, detailId));

	cells.push($(`
		<div class="cell" data-fixedetail data-issueid="${issueId}" data-detailid="${detailId}">
			<input type="checkbox" class="check fixe-detail" checked disabled>
		</div>
	`));
	return cells;
}

/* Cellules par détail dans le NOUVEAU ordre des colonnes :
   Type, cotes (xN), Cote totale, Mise.
   Profit et Fixe détail sont insérés par le caller (addIssue / addDetail) AVEC
   le caller — car Profit est par-détail mais Fixe détail aussi, et ils
   s'intercalent dans l'auto-flow entre les cellules issue-level Fixe/Dist. */
function buildDetailCellsArr(colIds, issueId, detailId, opts = {}) {
	const cells = [];
	cells.push(buildTypeCell(issueId, detailId));
	for (let i = 0; i < colIds.length; i++) {
		const colId = colIds[i];
		const defaultOdds = (opts.defaultOdds && i === 0) ? opts.defaultOdds : "";
		cells.push(buildOddsCell(colId, issueId, detailId, defaultOdds, false));
	}
	cells.push(buildOddsTotalCell(issueId, detailId));
	cells.push(buildStakeCell(issueId, detailId, opts.defaultStake || ""));
	return cells;
}

/* ---------- Lecture / écriture ---------- */

function readNum($input) {
	if (!$input || !$input.length) return 0;
	const n = Number(String($input.val() || "0").replace(",", "."));
	return Number.isNaN(n) ? 0 : n;
}

function setStake($stakeCell, value) {
	if (!$stakeCell || !$stakeCell.length) return;
	const $input = $stakeCell.find("input").first();
	if (!$input.length) return;
	// Idem setLiability : on ne touche pas si l'utilisateur édite ce champ.
	if ($input[0] === document.activeElement) return;
	$input.val(value.toFixed(DEC).replace(".", ","));
}

function setLiability($stakeCell, value) {
	if (!$stakeCell || !$stakeCell.length) return;
	const $input = $stakeCell.find(".liability input").first();
	if (!$input.length) return;
	// Si l'utilisateur est en train d'éditer ce champ, on ne l'écrase pas
	// (sinon le curseur saute et la saisie devient impossible).
	if ($input[0] === document.activeElement) return;
	$input.val(value.toFixed(DEC).replace(".", ","));
}

/* ---------- Card HTML template ---------- */

function buildCalcCardHTML(calcId) {
	return `
	<section class="card calc-card" data-calc-id="${calcId}">
		<div class="sb-grid" data-calc-id="${calcId}" data-odds-cols="0" aria-label="Tableau surebet">
			<!-- EN-TÊTES — ordre : Type, Cote totale, Mises, Profit, [Suppr détail], Fixe détail, Fixe, Distribution, Profit total, Actions -->
			<div class="cell head sticky" data-oddslabelhead></div>
			<div class="cell head" data-typehead>Type</div>
			<!-- Pas de colonne de cote par défaut -->
			<div class="cell head" data-oddstotalhead>Cote<br>totale</div>
			<div class="cell head" data-stakehead>Mises</div>
			<div class="cell head" data-profithead>Profit</div>
			<div class="cell head" data-deldetailhead></div>
			<div class="cell head" data-fixedetailhead>Fixe<br>détail</div>
			<div class="cell head" data-fixehead>Fixe</div>
			<div class="cell head" data-distributionhead>Distribution</div>
			<div class="cell head" data-profittotalhead>Profit total</div>
			<div class="cell head right" data-actionshead></div>
			<div class="row-sep"></div>

			<!-- ISSUES -->

			<!-- DIVISEUR -->
			<div class="divider" role="separator" aria-hidden="true"></div>

			<!-- LIGNE TOTALE -->
			<div class="cell rowhead sticky total-label">Total</div>
			<div class="cell" data-type></div>
			<!-- Pas de colonne de cote par défaut -->
			<div class="cell" data-last-odds-total><span class="trj-label">TRJ</span><span class="trj-value">—</span></div>
			<div class="cell" data-stake></div>
			<div class="cell right"></div>
			<div class="cell" data-deldetail></div>
			<div class="cell" data-fixedetail></div>
			<div class="cell">
				<input type="radio" name="fixeChoice-${calcId}" class="radio fixe" aria-label="Fixe total">
			</div>
			<div class="cell">
				<input type="checkbox" class="check dist" aria-label="Distribution total" checked>
			</div>
			<div class="cell right" data-profit-total></div>
			<div class="cell right"></div>
		</div>
		<div class="sb-error" hidden></div>
		<div class="card-actions">
			<button class="btn btn-secondary js-add-col"><svg class="btn-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor"><path d="M160-760v560h240v-560H160ZM80-120v-720h720v160h-80v-80H480v560h240v-80h80v160H80Zm720-240v-80h-80v-80h80v-80h80v80h80v80h-80v80h-80Z"/></svg>Colonne de côte</button>
			<button class="btn btn-primary js-add-row"><svg class="btn-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor"><path d="M200-560h560v-240H200v240Zm-80 400v-720h720v720H680v-80h80v-240H200v240h80v80H120ZM440-80v-80h-80v-80h80v-80h80v80h80v80h-80v80h-80Z"/></svg>Issue</button>
			<button class="btn btn-ghost js-duplicate-calc"><svg class="btn-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="15" x2="15" y1="12" y2="18"/><line x1="12" x2="18" y1="15" y2="15"/><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>Dupliquer</button>
			<button class="btn btn-ghost js-delete-calc"><svg class="btn-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>Supprimer</button>
		</div>
	</section>
	`;
}

/* ---------- Per-calc init (closure) ---------- */

/* Registry of all calculators. Each entry: { $card, recomputeAll, calcId }. */
const calcRegistry = [];

function initCalculator($card, opts = {}) {
	const skipBootstrap = !!opts.skipBootstrap;
	const calcId = $card.attr("data-calc-id");
	const $grid = $card.find(".sb-grid");
	const $err = $card.find(".sb-error");

	// Per-calc state (closure-scoped)
	const colIds = [];
	let nb_odds = 0;
	let nb_issues = 0;
	let recomputing = false;

	function applyGridTemplate() {
		const n = Number($grid.attr("data-odds-cols"));
		$grid[0].style.setProperty('--nb-cotes', n);
	}

	function hydrate() {
		$grid.find("[data-odds]").each(function () {
			if (!$(this).children().length) $(this).append(buildNumberField("", "", null));
		});
		$grid.find("[data-stake]").each(function () {
			if (!$(this).children().length) {
				const isTotal = $(this).prevAll(".total-label").length > 0;
				$(this).append(buildNumberField("", isTotal ? "10,00" : "", 0.01, "€"));
			}
		});
		$grid.find('.check.dist').prop('checked', true);
	}

	function renumberColumnHeaders() {
		$grid.find("[data-oddshead]").each(function (i) {
			const idx = i + 1;
			$(this).attr("data-col", String(idx));
			$(this).find(".col-label").text(letterFor(idx));
		});
	}

	function refreshDeleteButtons() {
		$grid.find(".js-del-col").toggle(nb_odds > 1);
		$grid.find(".js-del-issue").toggle(nb_issues > 2);
		$grid.find("[data-issuelabel]").each(function () {
			const issueId = $(this).attr("data-issueid");
			// Pour un détail Back/Lay : on ne montre la corbeille que s'il existe au
			// moins 2 détails Back/Lay (sinon on autoriserait à laisser l'issue avec
			// uniquement des Gain fixe, qui ne sont pas des paris).
			const nBetDetails = $grid.find(`[data-type][data-issueid="${issueId}"]`).length;
			const showBetDel = nBetDetails > 1;
			$grid.find(`[data-type][data-issueid="${issueId}"]`).each(function () {
				const detailId = $(this).attr("data-detailid");
				$grid.find(`.js-del-detail[data-issueid="${issueId}"][data-detailid="${detailId}"]`)
					.css("display", showBetDel ? "inline-flex" : "none");
			});
			// Pour un détail Gain fixe : toujours supprimable (le Back/Lay d'ancrage
			// reste de toute façon — on ne crée jamais de FG sans Back/Lay préalable).
			$grid.find(`[data-fixed-gain-input][data-issueid="${issueId}"]`).each(function () {
				const detailId = $(this).attr("data-detailid");
				$grid.find(`.js-del-detail[data-issueid="${issueId}"][data-detailid="${detailId}"]`)
					.css("display", "inline-flex");
			});
		});
	}

	function addOddsColumn() {
		let next = Number($grid.attr("data-odds-cols")) + 1;
		$grid.attr("data-odds-cols", String(next));
		applyGridTemplate();

		const colId = nextColId();
		colIds.push(colId);

		const $newHead = $(`
			<div class="cell head colhead" data-oddshead data-col="${next}" data-colid="${colId}">
				<span class="col-label">${letterFor(next)}</span>
				<button class="btn-icon btn btn-danger js-del-col" title="Supprimer cette colonne">
					<i data-lucide="trash-2" class="icon"></i>
				</button>
			</div>
		`);
		const $headerBefore = $grid.find("[data-oddstotalhead]").last();
		$headerBefore.before($newHead);

		// Lignes de détails normaux (Back/Lay) : ajoute une nouvelle cellule de cote
		$grid.find("[data-type]").each(function () {
			const $typeCell = $(this);
			const issueId = $typeCell.attr("data-issueid");
			const detailId = $typeCell.attr("data-detailid");
			if (!issueId || !detailId) return; // skip total row
			const $stakeCell = $grid.find(`[data-stake][data-issueid="${issueId}"][data-detailid="${detailId}"]`);
			const isLay = $stakeCell.hasClass("lay-mode");
			const $oddsTotalCell = $grid.find(`[data-odds-total][data-issueid="${issueId}"][data-detailid="${detailId}"]`);
			const $newOddsCell = buildOddsCell(colId, issueId, detailId, "", isLay);
			$oddsTotalCell.before($newOddsCell);
		});

		// Lignes "Gain fixe" : ajoute une cellule vide marqueur (fg-empty fg-cote)
		// au bon emplacement pour préserver l'alignement de la grille.
		$grid.find("[data-fixed-gain-input]").each(function () {
			const issueId = $(this).attr("data-issueid");
			const detailId = $(this).attr("data-detailid");
			const $coteTotaleEmpty = $grid.find(`.fg-cote-totale[data-issueid="${issueId}"][data-detailid="${detailId}"]`);
			$coteTotaleEmpty.before(`<div class="cell fg-empty fg-cote" data-colid="${colId}" data-issueid="${issueId}" data-detailid="${detailId}"></div>`);
		});

		const $totalBefore = $grid.find("[data-last-odds-total]").last();
		$totalBefore.before(`<div class="cell total-span" colspan data-colid="${colId}"></div>`);

		nb_odds++;
		if (window.lucide) lucide.createIcons();
		refreshDeleteButtons();
	}

	function removeOddsColumnAt(index1) {
		let count = Number($grid.attr("data-odds-cols"));
		if (count <= 1) return;

		const $colHead = $grid.find(`[data-oddshead][data-col='${index1}']`);
		const colId = $colHead.attr("data-colid");

		$colHead.remove();
		$grid.find(`[data-odds][data-colid='${colId}']`).remove();
		$grid.find(`.fg-cote[data-colid='${colId}']`).remove();
		$grid.find(`.total-span[data-colid='${colId}']`).remove();

		const idx = colIds.indexOf(colId);
		if (idx !== -1) colIds.splice(idx, 1);

		$grid.attr("data-odds-cols", String(count - 1));
		applyGridTemplate();
		renumberColumnHeaders();
		nb_odds--;

		recomputeAll();
		refreshDeleteButtons();
	}

	function addIssue() {
		const nextIndex = $grid.find("[data-issuelabel]").length + 1;
		const issueId = nextIssueId();
		const detailId = nextDetailId();

		const frag = $(document.createDocumentFragment());

		frag.append(`<div class="cell rowhead sticky" data-issuelabel data-issueid="${issueId}">${nextIndex}</div>`);

		const detailCells = buildDetailCellsArr(colIds, issueId, detailId, {
			defaultOdds: nextIndex <= 2 ? "2,00" : "",
			defaultStake: nextIndex === 1 ? "5,00" : "",
		});
		for (const c of detailCells) frag.append(c);

		// Nouvel ordre des colonnes : Profit per-detail, Suppr détail per-detail,
		// Fixe détail per-detail, puis cellules issue-level (Fixe, Dist, Profit total, Actions).
		frag.append(buildProfitCell(issueId, detailId));
		frag.append(buildDelDetailCell(issueId, detailId));
		frag.append(buildFixeDetailCell(issueId, detailId));
		frag.append(`
			<div class="cell" data-issueid="${issueId}" data-issuefixe>
				<input type="radio" name="fixeChoice-${calcId}" class="radio fixe" aria-label="Fixe issue ${nextIndex}"${nextIndex === 1 ? " checked" : ""}>
			</div>
		`);
		frag.append(`
			<div class="cell" data-issueid="${issueId}" data-issuedist>
				<input type="checkbox" class="check dist" aria-label="Distribution issue ${nextIndex}" checked>
			</div>
		`);
		frag.append(`<div class="cell right" data-profit-total data-issueid="${issueId}">—</div>`);
		frag.append(buildIssueActionsCell(issueId));
		frag.append(buildAddDetailCell(issueId));
		frag.append(buildIssueAvgCoteCell(issueId));
		frag.append(buildIssueSumProfitCell(issueId));
		frag.append(`<div class="row-sep" data-issueid="${issueId}"></div>`);

		$grid.find(".divider").before(frag);

		nb_issues++;

		if (window.lucide) lucide.createIcons();
		recomputeAll();
		refreshDeleteButtons();
	}

	function deleteIssue($issueLabelCell) {
		const minIssues = 2;
		if ($grid.find("[data-issuelabel]").length <= minIssues) return;
		const issueId = $issueLabelCell.attr("data-issueid");

		// Si l'issue supprimée était l'issue fixe, on transfère le flag "fixe" et la
		// mise vers l'issue suivante (ou la première restante si on supprime la
		// dernière) pour ne pas perdre l'ancrage du calcul.
		const wasFixed = $grid.find(`[data-issuefixe][data-issueid="${issueId}"] .radio.fixe`).is(":checked");
		let stakeToTransfer = null;
		let $nextLabel = $();
		if (wasFixed) {
			const $stakeInput = $grid.find(`[data-stake][data-issueid="${issueId}"] .back-stake input`).first();
			if ($stakeInput.length) stakeToTransfer = $stakeInput.val() || null;
			$nextLabel = $issueLabelCell.nextAll("[data-issuelabel]").first();
			if (!$nextLabel.length) {
				$nextLabel = $grid.find("[data-issuelabel]").not($issueLabelCell).first();
			}
		}

		$grid.find(`[data-issueid="${issueId}"]`).remove();

		if (wasFixed && $nextLabel.length) {
			const nextIssueId = $nextLabel.attr("data-issueid");
			$grid.find(`[data-issuefixe][data-issueid="${nextIssueId}"] .radio.fixe`).prop("checked", true);
			syncFixeIssueToDetails(nextIssueId);
			if (stakeToTransfer != null) {
				$grid.find(`[data-stake][data-issueid="${nextIssueId}"] .back-stake input`).first().val(stakeToTransfer);
			}
		}

		let idx = 1;
		$grid.find("[data-issuelabel]").each(function () { $(this).text(idx++); });
		nb_issues--;
		refreshMultiDetailsClass();
		recomputeAll();
		refreshDeleteButtons();
	}

	function addDetail(issueId) {
		const detailId = nextDetailId();

		const detailCells = buildDetailCellsArr(colIds, issueId, detailId, {});
		const $profitCell = buildProfitCell(issueId, detailId);
		const $delDetailCell = buildDelDetailCell(issueId, detailId);
		const $fixeDetailCell = buildFixeDetailCell(issueId, detailId);

		// La cellule "+ Détail" doit rester en dernier (juste avant row-sep) →
		// on insère les nouvelles cellules de détail JUSTE AVANT elle.
		const $addDetail = $grid.find(`.add-detail-cell[data-issueid="${issueId}"]`);
		const $anchor = $addDetail.length ? $addDetail : $grid.find(`.row-sep[data-issueid="${issueId}"]`);
		for (const c of detailCells) $anchor.before(c);
		$anchor.before($profitCell);
		$anchor.before($delDetailCell);
		$anchor.before($fixeDetailCell);

		updateIssueSpans(issueId);
		refreshMultiDetailsClass();
		autoSetFixeDetailsOnAdd(issueId, detailId);
		syncFixeIssueToDetails(issueId);

		if (window.lucide) lucide.createIcons();
		recomputeAll();
		refreshDeleteButtons();
	}

	/* Quand on passe de 1 à 2 détails sur une issue NON fixée, on coche
	   automatiquement "Fixe détail" sur l'ancien détail (qui devient la
	   référence figée) ; le nouveau détail reste non coché. Pour une issue
	   fixée, syncFixeIssueToDetails s'en occupe (tous cochés + disabled). */
	function autoSetFixeDetailsOnAdd(issueId, newDetailId) {
		const isFixedIssue = $grid.find(`[data-issuefixe][data-issueid="${issueId}"] .radio.fixe`).is(":checked");
		if (isFixedIssue) return;
		if (countDetails(issueId) !== 2) return;
		// Coche tous les détails existants sauf le nouveau
		$grid.find(`[data-type][data-issueid="${issueId}"], [data-fixed-gain-input][data-issueid="${issueId}"]`).each(function () {
			const did = $(this).attr("data-detailid");
			if (did === newDetailId) return;
			$grid.find(`[data-fixedetail][data-issueid="${issueId}"][data-detailid="${did}"] input`).prop("checked", true);
		});
	}

	function removeDetail(issueId, detailId) {
		const total = countDetails(issueId);
		const $target = $grid.find(`[data-issueid="${issueId}"][data-detailid="${detailId}"]`);
		const isFixedGain = $target.filter("[data-fixed-gain-input]").length > 0;
		// Pour un détail normal (Back/Lay) : on garde au moins 1. Pour un fixed-gain :
		// on autorise sa suppression complète sauf si c'est le seul détail de l'issue.
		if (total <= 1) return;
		$target.remove();

		// Si on retombe à K=1, on doit restaurer l'ordre DOM "K=1" : les cellules
		// du détail restant doivent précéder les cellules issue-level (Fixe radio,
		// Dist, Profit total, Actions). Sinon, sans les spans rows, l'auto-flow de
		// la grille place les cellules issue-level dans les colonnes du détail.
		if (countDetails(issueId) === 1) {
			const $issueFixe = $grid.find(`[data-issuefixe][data-issueid="${issueId}"]`);
			if ($issueFixe.length) {
				const $remaining = $grid.find(`[data-issueid="${issueId}"][data-detailid]`);
				$remaining.insertBefore($issueFixe);
			}
		}

		updateIssueSpans(issueId);
		refreshMultiDetailsClass();
		recomputeAll();
		refreshDeleteButtons();
	}

	function addFixedGainDetail(issueId) {
		const detailId = nextDetailId();
		const cells = buildFixedGainDetailCells(issueId, detailId, colIds);

		const $addDetail = $grid.find(`.add-detail-cell[data-issueid="${issueId}"]`);
		const $anchor = $addDetail.length ? $addDetail : $grid.find(`.row-sep[data-issueid="${issueId}"]`);
		for (const c of cells) $anchor.before(c);

		updateIssueSpans(issueId);
		refreshMultiDetailsClass();
		// Pas d'autoSetFixeDetailsOnAdd ici : le Gain fixe est toujours fixe par lui-même,
		// l'ancien détail (Back/Lay) doit rester libre pour s'équilibrer en tenant
		// compte du Gain fixe (target_stake = (K − G) / oddsNet ou layReturnFactor).

		if (window.lucide) lucide.createIcons();
		recomputeAll();
		refreshDeleteButtons();
	}

	function countDetails(issueId) {
		return $grid.find(`[data-type][data-issueid="${issueId}"], [data-fixed-gain-input][data-issueid="${issueId}"]`).length;
	}

	function updateIssueSpans(issueId) {
		const K = countDetails(issueId);
		const spanVal = K > 1 ? `span ${K}` : "";

		const $issueLevel = $grid.find(`[data-issueid="${issueId}"]`).filter(function () {
			const $el = $(this);
			if ($el.attr("data-detailid")) return false;
			if ($el.is(".row-sep")) return false;
			return true;
		});
		$issueLevel.each(function () { $(this).css("grid-row", spanVal || ""); });
	}

	function refreshMultiDetailsClass() {
		let hasMulti = false;
		$grid.find("[data-issuelabel]").each(function () {
			const id = $(this).attr("data-issueid");
			if (countDetails(id) >= 2) { hasMulti = true; return false; }
		});
		$grid.toggleClass("has-multi-details", hasMulti);
		// La colonne "Fixe détail" n'apparaît qu'en mode multi-details. À chaque
		// transition (apparition ou disparition) on resynchronise les checkboxes
		// de TOUTES les issues : celle qui est fixe doit avoir ses détails cochés
		// et désactivés, peu importe où le détail vient d'être ajouté.
		$grid.find("[data-issuefixe]").each(function () {
			const id = $(this).attr("data-issueid");
			if (id) syncFixeIssueToDetails(id);
		});
	}

	function syncFixeIssueToDetails(issueId) {
		const $fixe = $grid.find(`[data-issuefixe][data-issueid="${issueId}"] .radio.fixe`);
		const isFixed = $fixe.is(":checked");
		const $detailChecks = $grid.find(`[data-fixedetail][data-issueid="${issueId}"] input.fixe-detail`);
		if (isFixed) {
			$detailChecks.prop("checked", true).prop("disabled", true);
		} else {
			$detailChecks.prop("disabled", false);
		}
	}

	function recomputeAll(redistribute = true) {
		if (recomputing) return;
		recomputing = true;
		const commissionEnabled = $grid.hasClass("with-commission");

		const issues = [];
		$grid.find("[data-issuelabel]").each(function () {
			const $label = $(this);
			const issueId = $label.attr("data-issueid");
			const $fixeRadio = $grid.find(`[data-issuefixe][data-issueid="${issueId}"] .radio.fixe`);
			const $distCheck = $grid.find(`[data-issuedist][data-issueid="${issueId}"] .check.dist`);
			const $profitTotal = $grid.find(`[data-profit-total][data-issueid="${issueId}"]`);
			const isFixed = $fixeRadio.is(":checked");
			const isDist = $distCheck.is(":checked");

			const details = [];
			$grid.find(`[data-type][data-issueid="${issueId}"]`).each(function () {
				const $typeCell = $(this);
				const detailId = $typeCell.attr("data-detailid");
				const isLay = $typeCell.find(".type-toggle").attr("data-mode") === "lay";

				const $oddsCells = $grid.find(`[data-odds][data-issueid="${issueId}"][data-detailid="${detailId}"]`);
				let hasValue = false;
				let oddsTotal = 1;
				let oddsTotalNet = 1;
				let layNetWinFactor = 1;
				$oddsCells.each(function () {
					const $oc = $(this);
					const v = $oc.find("input").not(".commission-input").first().val();
					if (v && String(v).trim() !== "") hasValue = true;
					const o = Number(String(v).replace(",", "."));
					const oVal = Number.isNaN(o) ? 1 : o;
					oddsTotal *= oVal;
					const c = commissionEnabled ? (readNum($oc.find(".commission-input").first()) / 100) : 0;
					oddsTotalNet *= 1 + (oVal - 1) * (1 - c);
					layNetWinFactor *= (1 - c);
				});
				const layReturnFactor = layNetWinFactor + (oddsTotal - 1);

				const $stakeCell = $grid.find(`[data-stake][data-issueid="${issueId}"][data-detailid="${detailId}"]`);
				const $stakeInput = $stakeCell.find(".back-stake input").first();
				const $liabInput = $stakeCell.find(".liability input").first();
				const stakeVal = readNum($stakeInput.length ? $stakeInput : $stakeCell.find("input").first());
				const engagementVal = readNum($liabInput);

				const $fixeDetailInput = $grid.find(`[data-fixedetail][data-issueid="${issueId}"][data-detailid="${detailId}"] input`);
				const isFixedDetail = $fixeDetailInput.is(":checked");

				const $oddsTotalCell = $grid.find(`[data-odds-total][data-issueid="${issueId}"][data-detailid="${detailId}"]`);
				const $profitCell = $grid.find(`[data-profit][data-issueid="${issueId}"][data-detailid="${detailId}"]`);

				details.push({
					detailId, isLay, isFixedGain: false, hasValue, oddsTotal, oddsTotalNet,
					layNetWinFactor, layReturnFactor,
					stake: stakeVal, engagement: engagementVal,
					fixedGainValue: 0,
					isFixedDetail,
					$stakeCell, $oddsTotalCell, $profitCell,
				});
			});

			// Détails "Gain fixe" — collecte séparée
			$grid.find(`[data-fixed-gain-input][data-issueid="${issueId}"]`).each(function () {
				const $wide = $(this);
				const detailId = $wide.attr("data-detailid");
				const $valInput = $wide.find("input.fixed-gain-value").first();
				const valStr = ($valInput.val() || "").trim();
				const hasValue = valStr !== "";
				const value = readNum($valInput);
				const $profitCell = $grid.find(`[data-profit][data-issueid="${issueId}"][data-detailid="${detailId}"]`);

				details.push({
					detailId,
					isLay: false,
					isFixedGain: true,
					hasValue,
					oddsTotal: 1,
					oddsTotalNet: 1,
					layNetWinFactor: 1,
					layReturnFactor: 0,
					stake: 0,
					engagement: 0,
					fixedGainValue: value,
					isFixedDetail: true,
					$stakeCell: $(),
					$oddsTotalCell: $(),
					$profitCell,
				});
			});

			issues.push({ issueId, $label, $fixeRadio, $distCheck, $profitTotal, isFixed, isDist, details });
		});

		const fmtBrut = (v) => (v !== null && isFinite(v)) ? v.toFixed(2).replace(".", ",") : "—";
		const fmtNet  = (v) => (v !== null && isFinite(v)) ? v.toFixed(3).replace(".", ",") : "—";
		for (const issue of issues) {
			for (const d of issue.details) {
				if (!d.$oddsTotalCell || !d.$oddsTotalCell.length) continue;
				if (!d.hasValue) { d.$oddsTotalCell.text("—"); continue; }
				const hasComm = Math.abs(d.oddsTotal - d.oddsTotalNet) > 1e-9;
				const showLayRow = d.isLay;
				const showNetCol = hasComm;

				if (!showLayRow && !showNetCol) {
					d.$oddsTotalCell.text(d.oddsTotal.toFixed(DEC).replace(".", ","));
					continue;
				}

				let backBrut, backNet, layBrut, layNet;
				if (d.isLay) {
					layBrut = d.oddsTotal;
					layNet = d.oddsTotalNet;
					backBrut = layBrut > 1 ? layBrut / (layBrut - 1) : null;
					// Back-équivalent NET d'un Lay : formule physique (O − c) / (O − 1)
					// = layReturnFactor / (oddsTotal − 1). On obtient bien backNet < backBrut.
					backNet = (layBrut > 1 && d.layReturnFactor > 0) ? d.layReturnFactor / (layBrut - 1) : null;
				} else {
					backBrut = d.oddsTotal;
					backNet = d.oddsTotalNet;
				}

				// Colonnes : Brut (gauche) puis Net (droite). Lignes : Back puis Lay.
				// Plus de labels "Back" / "Lay" — on colore les valeurs avec la teinte
				// correspondante. Les en-têtes "Net"/"Brut" n'apparaissent que si la
				// colonne Net est affichée.
				const showColHeaders = showNetCol;
				const ncols = 1 + (showNetCol ? 1 : 0);

				let html = `<div class="odds-detail" style="grid-template-columns: repeat(${ncols}, auto)">`;
				if (showColHeaders) {
					html += `<span class="odds-detail-head">Brut</span>`;
					html += `<span class="odds-detail-head">Net</span>`;
				}
				html += `<span class="odds-detail-value odds-back-label">${fmtBrut(backBrut)}</span>`;
				if (showNetCol) html += `<span class="odds-detail-value odds-back-label">${fmtNet(backNet)}</span>`;

				if (showLayRow) {
					html += `<span class="odds-detail-value odds-lay-label">${fmtBrut(layBrut)}</span>`;
					if (showNetCol) html += `<span class="odds-detail-value odds-lay-label">${fmtNet(layNet)}</span>`;
				}

				html += `</div>`;
				d.$oddsTotalCell.html(html);
			}
		}

		// Ligne Total
		const $totalLabel = $grid.find(".total-label");
		const $totalStake = $totalLabel.nextAll("[data-stake]").first();
		const $totalFixe = $totalLabel.nextAll(".cell").has(".radio.fixe").first();
		const $totalDist = $totalLabel.nextAll(".cell").has(".check.dist").first();
		const $totalProfitTotal = $totalLabel.nextAll("[data-profit-total]").first();
		const $totalOddsTotal = $totalLabel.nextAll("[data-last-odds-total]").first();
		const totalIsFixed = $totalFixe.find(".radio.fixe").is(":checked");
		const totalIsDist = $totalDist.find(".check.dist").is(":checked");
		const totalStake = readNum($totalStake.find("input").first());

		if (redistribute) {
			for (const issue of issues) {
				if (!issue.isFixed) continue;
				if (issue.details.length !== 1) continue;
				const d = issue.details[0];
				if (d.hasValue && (!d.stake || d.stake <= 0)) {
					setStake(d.$stakeCell, 10);
					d.stake = 10;
					if (d.isLay && d.oddsTotal > 1) {
						const newEng = 10 * (d.oddsTotal - 1);
						setLiability(d.$stakeCell, newEng);
						d.engagement = newEng;
					}
				}
			}
		}

		for (const issue of issues) {
			let sumInvested = 0;
			let returnIfWin = 0;
			let returnIfLose = 0;
			issue.hasValue = false;
			for (const d of issue.details) {
				if (!d.hasValue) continue;
				issue.hasValue = true;
				if (d.isFixedGain) {
					// Gain fixe : ajouté à "returns when issue happens", pas d'investissement.
					returnIfWin += d.fixedGainValue;
				} else if (d.isLay) {
					const liability = d.engagement || d.stake * Math.max(0, d.oddsTotal - 1);
					sumInvested += liability;
					returnIfLose += d.stake * d.layNetWinFactor + liability;
				} else {
					sumInvested += d.stake;
					returnIfWin += d.stake * d.oddsTotalNet;
				}
			}
			issue.sumInvested = sumInvested;
			issue.returnIfIssueWins = returnIfWin;
			issue.returnIfIssueLoses = returnIfLose;
			if (issue.details.length === 1 && issue.details[0].hasValue) {
				const d = issue.details[0];
				if (d.isLay && d.oddsTotal > 1) {
					issue.effectiveOddsNet = d.layReturnFactor / (d.oddsTotal - 1);
				} else {
					issue.effectiveOddsNet = d.oddsTotalNet;
				}
			} else if (sumInvested > 0) {
				issue.effectiveOddsNet = returnIfWin / sumInvested;
			} else {
				issue.effectiveOddsNet = 0;
			}

			// Cote effective POUR LE TRJ : ignore les détails Gain fixe (qui n'ont pas
			// de cote propre — ils ne doivent pas influencer le TRJ).
			const betDetails = issue.details.filter(d => !d.isFixedGain && d.hasValue);
			if (betDetails.length === 1) {
				const d = betDetails[0];
				if (d.isLay && d.oddsTotal > 1) {
					issue.effectiveOddsNetForTRJ = d.layReturnFactor / (d.oddsTotal - 1);
				} else {
					issue.effectiveOddsNetForTRJ = d.oddsTotalNet;
				}
			} else if (betDetails.length > 1) {
				let nsiBet = 0, nrwBet = 0;
				for (const d of betDetails) {
					if (d.isLay) {
						nsiBet += d.engagement || d.stake * Math.max(0, d.oddsTotal - 1);
					} else {
						nsiBet += d.stake;
						nrwBet += d.stake * d.oddsTotalNet;
					}
				}
				issue.effectiveOddsNetForTRJ = nsiBet > 0 ? nrwBet / nsiBet : 0;
			} else {
				issue.effectiveOddsNetForTRJ = 0;
			}
		}

		let sumInv = 0, countValid = 0;
		for (const issue of issues) {
			if (!issue.hasValue || issue.effectiveOddsNetForTRJ <= 0) continue;
			sumInv += 1 / issue.effectiveOddsNetForTRJ;
			countValid++;
		}
		const trj = countValid > 0 ? 1 / sumInv : 0;
		if ($totalOddsTotal && $totalOddsTotal.length) {
			const $trjValue = $totalOddsTotal.find(".trj-value");
			const trjText = countValid === 0 ? "—" : (trj * 100).toFixed(2).replace(".", ",") + " %";
			if ($trjValue.length) $trjValue.text(trjText);
			else $totalOddsTotal.text(trjText);
		}

		const eligibles = issues.filter(it => it.hasValue && it.effectiveOddsNet > 0);
		const sigmaD = eligibles.filter(it => it.isDist).reduce((a, it) => a + 1 / it.effectiveOddsNet, 0);
		const sigmaN = eligibles.filter(it => !it.isDist).reduce((a, it) => a + 1 / it.effectiveOddsNet, 0);

		const fixedIssue = issues.find(it => it.isFixed && it.hasValue && it.sumInvested > 0);
		let K = null, S = null;
		let errorMsg = null;

		if (fixedIssue) {
			if (fixedIssue.isDist) {
				K = fixedIssue.sumInvested * fixedIssue.effectiveOddsNet;
				const denom = 1 - sigmaN;
				if (denom > 0) S = K * sigmaD / denom;
				else errorMsg = "Configuration impossible : trop de lignes non distribuées.";
			} else {
				S = fixedIssue.sumInvested * fixedIssue.effectiveOddsNet;
				if (sigmaD > 0) K = S * (1 - sigmaN) / sigmaD;
				else errorMsg = "Aucune ligne en distribution — cochez au moins une ligne.";
			}
		} else if (totalIsFixed && totalStake > 0) {
			S = totalStake;
			if (sigmaD > 0) K = S * (1 - sigmaN) / sigmaD;
			else if (eligibles.length > 0) errorMsg = "Aucune ligne en distribution — cochez au moins une ligne.";
		}

		if (redistribute && !errorMsg && K !== null && S !== null) {
			for (const it of eligibles) {
				if (it.isFixed) continue;
				// Répartition de la perte : on interpole entre K (profit concentré, p=0)
				// et S (équilibrage des profits totaux, p=1). Si TOUTES les lignes sont
				// distribuées (sigmaN = 0), la répartition n'a pas de sens (pas de ligne
				// non-distribuée vers laquelle "déplacer" du profit) → on garde K.
				const lossP = sigmaN > 0 ? getLossDistribution() : 0;
				const targetReturn = it.isDist ? ((1 - lossP) * K + lossP * S) : S;

				if (it.details.length === 1) {
					const d = it.details[0];
					const target = d.isLay && d.layReturnFactor > 0
						? targetReturn / d.layReturnFactor
						: targetReturn / d.oddsTotalNet;
					setStake(d.$stakeCell, target);
					if (d.isLay && d.oddsTotal > 1) {
						const newEng = target * (d.oddsTotal - 1);
						setLiability(d.$stakeCell, newEng);
						d.engagement = newEng;
						it.sumInvested = newEng;
						it.returnIfIssueLoses = target * d.layNetWinFactor + newEng;
					} else {
						it.sumInvested = target;
						it.returnIfIssueWins = target * d.oddsTotalNet;
					}
					d.stake = target;
				} else {
					// Contribution "win return" de chaque détail FIXÉ :
					//   - Gain fixe : sa valeur littérale
					//   - Back fixe : stake × cote_net
					//   - Lay  fixe : stake × layReturnFactor (= retour quand le Lay gagne)
					let sumFixedReturn = 0;
					const nonFixed = [];
					for (const d of it.details) {
						if (!d.hasValue) continue;
						if (d.isFixedDetail) {
							if (d.isFixedGain) sumFixedReturn += d.fixedGainValue;
							else if (d.isLay) sumFixedReturn += d.stake * d.layReturnFactor;
							else sumFixedReturn += d.stake * d.oddsTotalNet;
						} else {
							nonFixed.push(d);
						}
					}
					// Les détails non-fixes (Back ET Lay) se partagent le retour restant.
					const eligibleNonFixed = nonFixed.filter(d => !d.isFixedGain);
					if (eligibleNonFixed.length > 0) {
						const remaining = targetReturn - sumFixedReturn;
						const perDetail = remaining / eligibleNonFixed.length;
						for (const d of eligibleNonFixed) {
							const denom = d.isLay ? d.layReturnFactor : d.oddsTotalNet;
							const stake = denom > 0 ? Math.max(0, perDetail / denom) : 0;
							setStake(d.$stakeCell, stake);
							d.stake = stake;
						}
					}

					let nsi = 0, nrw = 0, nrl = 0;
					for (const d of it.details) {
						if (!d.hasValue) continue;
						if (d.isFixedGain) {
							nrw += d.fixedGainValue;
						} else if (d.isLay) {
							const liability = d.engagement || d.stake * Math.max(0, d.oddsTotal - 1);
							nsi += liability;
							nrl += d.stake + liability;
						} else {
							nsi += d.stake;
							nrw += d.stake * d.oddsTotalNet;
						}
					}
					it.sumInvested = nsi;
					it.returnIfIssueWins = nrw;
					it.returnIfIssueLoses = nrl;
				}
			}
			if (!totalIsFixed) {
				setStake($totalStake, S);
			}
		}

		for (const issue of issues) {
			for (const d of issue.details) {
				if (!d.isLay || !d.hasValue || d.oddsTotal <= 1) continue;
				const newEng = d.stake * (d.oddsTotal - 1);
				setLiability(d.$stakeCell, newEng);
				d.engagement = newEng;
			}
			let nsi = 0, nrw = 0, nrl = 0;
			for (const d of issue.details) {
				if (!d.hasValue) continue;
				if (d.isFixedGain) {
					nrw += d.fixedGainValue;
				} else if (d.isLay) {
					nsi += d.engagement || 0;
					nrl += d.stake * d.layNetWinFactor + (d.engagement || 0);
				} else {
					nsi += d.stake;
					nrw += d.stake * d.oddsTotalNet;
				}
			}
			issue.sumInvested = nsi;
			issue.returnIfIssueWins = nrw;
			issue.returnIfIssueLoses = nrl;
			// Calcul de effectiveOddsNet en ignorant le gain fixe (qui n'a pas de cote)
			const betDetails = issue.details.filter(d => !d.isFixedGain);
			if (betDetails.length === 1 && betDetails[0].hasValue) {
				const d = betDetails[0];
				if (d.isLay && d.oddsTotal > 1) {
					issue.effectiveOddsNet = d.layReturnFactor / (d.oddsTotal - 1);
				} else {
					issue.effectiveOddsNet = d.oddsTotalNet;
				}
			} else {
				issue.effectiveOddsNet = nsi > 0 ? nrw / nsi : 0;
			}
		}

		let sumInvestedAll = 0;
		for (const it of issues) sumInvestedAll += it.sumInvested;

		for (const issue of issues) {
			const validDetails = issue.details.filter(d => d.hasValue && (d.stake || d.isFixedGain));
			let sumProfitDetails = 0;
			issue.details.forEach((d) => {
				if (!d.$profitCell || !d.$profitCell.length) return;
				if (d.isFixedGain) {
					// La cellule profit contient l'input du Gain fixe — on ne l'écrase
					// PAS (sinon on perdrait le champ). On accumule juste pour Σ issue.
					if (d.hasValue) sumProfitDetails += d.fixedGainValue;
					return;
				}
				if (!d.hasValue || !d.stake) {
					d.$profitCell.text("—");
					return;
				}
				const profit = d.isLay ? d.stake * d.layNetWinFactor : d.oddsTotalNet * d.stake;
				sumProfitDetails += profit;
				d.$profitCell.text(profit.toFixed(DEC).replace(".", ",") + " €");
			});

			// Σ issue : affiché dans la cellule dédiée sur la ligne add-detail,
			// uniquement quand l'issue a plusieurs détails valides.
			const $sumCell = $grid.find(`[data-issue-sum-profit][data-issueid="${issue.issueId}"]`);
			if ($sumCell.length) {
				if (issue.details.length > 1 && validDetails.length > 1) {
					$sumCell.html(`<span class="profit-issue-sum">Total ${sumProfitDetails.toFixed(DEC).replace(".", ",")} €</span>`);
				} else {
					$sumCell.text("");
				}
			}

			// Cote moyenne issue = somme des profits hors Gain fixe / somme des mises
			// (Back stake + Lay stake). Affichée dans la colonne Cote totale,
			// uniquement quand l'issue a plusieurs détails valides.
			const $avgCell = $grid.find(`[data-issue-avg-cote][data-issueid="${issue.issueId}"]`);
			if ($avgCell.length) {
				if (issue.details.length > 1 && validDetails.length > 1) {
					let sumStakes = 0;
					let sumProfitNoFG = 0;
					for (const d of issue.details) {
						if (!d.hasValue || d.isFixedGain) continue;
						if (!d.stake) continue;
						sumStakes += d.stake;
						sumProfitNoFG += d.isLay ? d.stake * d.layNetWinFactor : d.stake * d.oddsTotalNet;
					}
					if (sumStakes > 0) {
						const avgCote = sumProfitNoFG / sumStakes;
						$avgCell.html(`<span class="profit-issue-sum">Moyenne ${avgCote.toFixed(DEC).replace(".", ",")}</span>`);
					} else {
						$avgCell.text("");
					}
				} else {
					$avgCell.text("");
				}
			}

			if (issue.$profitTotal && issue.$profitTotal.length) {
				if (!issue.hasValue) {
					issue.$profitTotal.text("—");
				} else {
					let issueProfitTotal = 0;
					for (const d of issue.details) {
						if (!d.hasValue) continue;
						if (d.isFixedGain) {
							issueProfitTotal += d.fixedGainValue;
						} else if (!d.stake) {
							continue;
						} else if (d.isLay) {
							const eng = d.engagement || d.stake * Math.max(0, d.oddsTotal - 1);
							issueProfitTotal += d.stake * d.layNetWinFactor + eng;
						} else {
							issueProfitTotal += d.stake * d.oddsTotalNet;
						}
					}
					issueProfitTotal -= sumInvestedAll;
					issue.$profitTotal.text(issueProfitTotal.toFixed(DEC).replace(".", ",") + " €");
				}
			}
		}
		if ($totalProfitTotal && $totalProfitTotal.length) {
			if (K !== null && S !== null) $totalProfitTotal.text((K - sumInvestedAll).toFixed(DEC).replace(".", ",") + " €");
			else $totalProfitTotal.text("—");
		}

		if (errorMsg) { $err.text(errorMsg).prop("hidden", false); }
		else { $err.prop("hidden", true).text(""); }

		const trjPct = trj * 100;
		const tierClasses = "trj-tier-red trj-tier-dark-orange trj-tier-light-orange trj-tier-green";
		let tier = "";
		if (countValid > 0) {
			if (trjPct < 90) tier = "trj-tier-red";
			else if (trjPct < 95) tier = "trj-tier-dark-orange";
			else if (trjPct < 100) tier = "trj-tier-light-orange";
			else tier = "trj-tier-green";
		}
		$grid.find("[data-profit-total]").removeClass(tierClasses);
		$grid.find(".trj-value").removeClass(tierClasses);
		if (tier) {
			$grid.find(".trj-value").addClass(tier);
			for (const issue of issues) {
				if (issue.isDist && issue.$profitTotal) issue.$profitTotal.addClass(tier);
			}
			if ($totalProfitTotal && $totalProfitTotal.length) $totalProfitTotal.addClass(tier);
		}

		recomputing = false;
	}

	function bindOddsInputs() {
		$grid.on("input cote:changed", "[data-odds] input:not(.commission-input)", () => recomputeAll(true));
		$grid.on("input cote:changed", ".commission-input", () => recomputeAll(true));
		$grid.on("input cote:changed", ".fixed-gain-value", () => recomputeAll(true));
		$grid.on("blur", ".commission-input", function () {
			const v = Number(String(this.value).replace(",", "."));
			if (!Number.isNaN(v) && v === 0) this.value = "";
		});
		$grid.on("input cote:changed", "[data-stake] input", function () {
			const $input = $(this);
			const $cell = $input.closest("[data-stake]");
			const issueId = $cell.attr("data-issueid");
			const detailId = $cell.attr("data-detailid");

			// Engagement édité par l'utilisateur → on dérive la mise correspondante
			// (mise = engagement / (cote − 1)). La boucle universelle de
			// recomputeAll recalcule ensuite l'engagement à partir de la mise et
			// retombe sur la valeur tapée par l'utilisateur (au rounding près).
			if ($input.closest(".liability").length > 0 && issueId && detailId) {
				const $oddsCells = $grid.find(`[data-odds][data-issueid="${issueId}"][data-detailid="${detailId}"]`);
				let oddsTotal = 1;
				$oddsCells.each(function () {
					const v = $(this).find("input").not(".commission-input").first().val();
					const n = Number(String(v).replace(",", "."));
					if (!Number.isNaN(n)) oddsTotal *= n;
				});
				const eng = Number(String(this.value).replace(",", "."));
				if (!Number.isNaN(eng) && oddsTotal > 1) {
					const newMise = eng / (oddsTotal - 1);
					$cell.find(".back-stake input").first().val(newMise.toFixed(DEC).replace(".", ","));
				}
			}

			if (!issueId) {
				const $label = $cell.prevAll("[data-issuelabel], .total-label").first();
				if ($label.is(".total-label")) {
					const totalIsFixed = $grid.find(".total-label").nextAll(".cell").has(".radio.fixe").first().find(".radio.fixe").is(":checked");
					recomputeAll(totalIsFixed);
					return;
				}
				recomputeAll(false);
				return;
			}

			const isIssueFixed = $grid.find(`[data-issuefixe][data-issueid="${issueId}"] .radio.fixe`).is(":checked");
			const k = $grid.find(`[data-type][data-issueid="${issueId}"]`).length;
			if (k === 1) {
				recomputeAll(isIssueFixed);
			} else {
				const isFixedDetail = $grid.find(`[data-fixedetail][data-issueid="${issueId}"][data-detailid="${detailId}"] input`).is(":checked");
				recomputeAll(isIssueFixed || isFixedDetail);
			}
		});
		$grid.on("change", ".radio.fixe, .check.dist", function () {
			const $cell = $(this).closest(".cell");
			const isTotalDist = $(this).hasClass("dist") && $cell.prevAll(".total-label").length > 0;
			if (isTotalDist) {
				const checked = $(this).is(":checked");
				$grid.find("[data-issuedist] .check.dist").prop("checked", checked);
			}
			if ($(this).hasClass("fixe")) {
				$grid.find("[data-issuefixe]").each(function () {
					const id = $(this).attr("data-issueid");
					if (id) syncFixeIssueToDetails(id);
				});
			}
			recomputeAll(true);
		});
		$grid.on("change", ".check.fixe-detail", function () {
			recomputeAll(true);
		});
	}

	// Card-level button bindings
	$card.find(".js-add-col").on("click", addOddsColumn);
	$card.find(".js-add-row").on("click", addIssue);

	// Delegated handlers on the grid
	$grid.on("click", ".js-del-issue", function () {
		const issueId = $(this).closest("[data-actions]").attr("data-issueid");
		if (!issueId) return;
		const $label = $grid.find(`[data-issuelabel][data-issueid="${issueId}"]`);
		hideHighlight();
		deleteIssue($label);
	});

	$grid.on("click", ".js-del-col", function () {
		const idx = Number($(this).closest("[data-oddshead]").attr("data-col"));
		removeOddsColumnAt(idx);
	});

	$grid.on("click", ".js-add-detail", function () {
		const issueId = $(this).closest("[data-issueid]").attr("data-issueid");
		if (!issueId) return;
		addDetail(issueId);
	});

	$grid.on("click", ".js-add-fixed-gain", function () {
		const issueId = $(this).closest("[data-issueid]").attr("data-issueid");
		if (!issueId) return;
		addFixedGainDetail(issueId);
	});

	$grid.on("click", ".js-del-detail", function () {
		const issueId = $(this).attr("data-issueid");
		const detailId = $(this).attr("data-detailid");
		if (!issueId || !detailId) return;
		hideHighlight();
		removeDetail(issueId, detailId);
	});

	// Overlay de surbrillance lors du hover des corbeilles. Une <div> absolute
	// positionnée à l'intérieur de la grille couvre la bounding box des cellules
	// visées (gaps inclus). Les cellules ont z-index: 1 (cf. CSS) pour rester
	// au-dessus de l'overlay (le contenu reste visible).
	const $overlay = $('<div class="row-highlight-overlay"></div>').prependTo($grid);
	function showHighlight($cells) {
		if (!$cells || !$cells.length) return;
		const gridRect = $grid[0].getBoundingClientRect();
		let minTop = Infinity, maxBottom = -Infinity;
		let minLeft = Infinity, maxRight = -Infinity;
		$cells.each(function () {
			if (this.offsetParent === null) return; // skip hidden cells
			const r = this.getBoundingClientRect();
			const top = r.top - gridRect.top;
			const bottom = r.bottom - gridRect.top;
			const left = r.left - gridRect.left;
			const right = r.right - gridRect.left;
			if (top < minTop) minTop = top;
			if (bottom > maxBottom) maxBottom = bottom;
			if (left < minLeft) minLeft = left;
			if (right > maxRight) maxRight = right;
		});
		if (!isFinite(minTop) || !isFinite(maxBottom) || !isFinite(minLeft) || !isFinite(maxRight)) return;
		// Étend légèrement (moitié des gap : row-gap 0.5em → ~4px ; col-gap 1em → ~8px)
		minTop -= 4;
		maxBottom += 4;
		minLeft -= 8;
		maxRight += 8;
		$overlay.css({
			top: minTop + "px",
			height: (maxBottom - minTop) + "px",
			left: minLeft + "px",
			width: (maxRight - minLeft) + "px",
			right: "auto",
			display: "block",
		});
	}
	function hideHighlight() {
		$overlay.hide();
	}

	$grid.on("mouseenter", ".js-del-detail", function () {
		const issueId = $(this).attr("data-issueid");
		const detailId = $(this).attr("data-detailid");
		if (!issueId || !detailId) return;
		showHighlight($grid.find(`[data-issueid="${issueId}"][data-detailid="${detailId}"]`));
	});
	$grid.on("mouseleave", ".js-del-detail", hideHighlight);

	$grid.on("mouseenter", ".js-del-issue", function () {
		const issueId = $(this).closest("[data-actions]").attr("data-issueid");
		if (!issueId) return;
		showHighlight($grid.find(`[data-issueid="${issueId}"]`));
	});
	$grid.on("mouseleave", ".js-del-issue", hideHighlight);

	$grid.on("click", ".type-toggle", function () {
		const $btn = $(this);
		const newMode = $btn.attr("data-mode") === "back" ? "lay" : "back";
		$btn.attr("data-mode", newMode);
		const $typeCell = $btn.closest("[data-type]");
		const issueId = $typeCell.attr("data-issueid");
		const detailId = $typeCell.attr("data-detailid");
		const $stakeCell = $grid.find(`[data-stake][data-issueid="${issueId}"][data-detailid="${detailId}"]`);
		const $oddsTotalCell = $grid.find(`[data-odds-total][data-issueid="${issueId}"][data-detailid="${detailId}"]`);
		if ($stakeCell.length) $stakeCell.toggleClass("lay-mode", newMode === "lay");

		const $commInputs = $grid.find(`[data-odds][data-issueid="${issueId}"][data-detailid="${detailId}"] .commission-input`);
		if (newMode === "lay") $commInputs.val(getDefaultCommission());
		else $commInputs.val("");

		const $mainInput = $stakeCell.find(".back-stake input").first();
		const $liabInput = $stakeCell.find(".liability input").first();
		const odds = parseFloat(($oddsTotalCell.text() || "").replace(",", "."));
		const currentMain = readNum($mainInput);

		if (currentMain > 0 && !isNaN(odds) && odds > 1) {
			if (newMode === "lay") {
				const liability = currentMain * odds;
				const layStake = liability / (odds - 1);
				$mainInput.val(layStake.toFixed(DEC).replace(".", ","));
				$liabInput.val(liability.toFixed(DEC).replace(".", ","));
			} else {
				const liability = readNum($liabInput) || currentMain * (odds - 1);
				const backStake = liability / odds;
				$mainInput.val(backStake.toFixed(DEC).replace(".", ","));
			}
		}

		recomputeAll(true);
	});

	// Public API stored on the card so global toggles can reach it
	const api = { calcId, $card, $grid, recomputeAll };
	$card.data("calc", api);
	calcRegistry.push(api);

	if (skipBootstrap) {
		// Cloned card: populate per-calc state from the existing DOM.
		// 1) Rebuild colIds from the existing column headers (preserve order).
		$grid.find("[data-oddshead]").each(function () {
			const colId = $(this).attr("data-colid");
			if (colId) colIds.push(colId);
		});
		nb_odds = colIds.length;
		nb_issues = $grid.find("[data-issuelabel]").length;
		applyGridTemplate();
		// Re-attach number-field input bindings for cloned inputs (clone() doesn't carry over JS-attached handlers).
		// Easiest approach: re-wrap every input by re-running buildNumberField on its container? Too invasive.
		// Instead, we rely on the fact that the original handlers were on .num elements via $el.on(...) — which clone() does NOT preserve.
		// We need to re-bind. We do it by replacing every .num wrapper with a freshly built one carrying the current value.
		rebindClonedNumberFields($grid);
		bindOddsInputs();
		refreshMultiDetailsClass();
		refreshDeleteButtons();
		// Render lucide icons that came in via clone
		if (window.lucide) lucide.createIcons();
		recomputeAll(false);
	} else {
		applyGridTemplate();
		hydrate();
		renumberColumnHeaders();

		addOddsColumn();
		addIssue();
		addIssue();

		bindOddsInputs();
		recomputeAll();
	}

	// Apply current global-setting classes
	$grid.toggleClass("with-commission", $("#commission-enabled").is(":checked"));
	$grid.toggleClass("with-details", $("#details-enabled").is(":checked"));
	$grid.toggleClass("with-fixed-gain", $("#fixed-gain-enabled").is(":checked"));

	return api;
}

/* Re-bind number-field handlers for a cloned grid. clone() does not carry over
   jQuery .on() handlers, so we re-create each .num wrapper from scratch
   preserving the current value, suffix, and any input classes (commission-input). */
function rebindClonedNumberFields($grid) {
	$grid.find(".num").each(function () {
		const $oldNum = $(this);
		const $oldInput = $oldNum.find("input").first();
		const value = $oldInput.val() || "";
		const placeholder = $oldInput.attr("placeholder") || "";
		const isCommission = $oldInput.hasClass("commission-input");
		const $suffix = $oldNum.find(".num-suffix");
		const suffix = $suffix.length ? $suffix.text() : "";
		// Determine min based on context: stakes use 0.01, others use null
		const $closestStake = $oldNum.closest("[data-stake]");
		const min = $closestStake.length ? 0.01 : null;
		const $newNum = buildNumberField(placeholder, value, min, suffix);
		if (isCommission) $newNum.find("input").addClass("commission-input");
		$oldNum.replaceWith($newNum);
	});
}

/* ---------- Global init flow ---------- */

let _calcCardCounter = 0;
function addNewCalc() {
	_calcCardCounter++;
	const calcId = String(_calcCardCounter);
	const $card = $(buildCalcCardHTML(calcId));
	$("#calculators-container").append($card);
	initCalculator($card);
	return $card;
}

function duplicateCalc($srcCard) {
	_calcCardCounter++;
	const calcId = String(_calcCardCounter);
	// Serialize the source card to HTML — this captures current values of all
	// inputs (radio/checkbox states need explicit handling below) and strips
	// all JS-attached event handlers, which we re-bind in initCalculator.
	// First, mirror the live state of checkboxes/radios/inputs into their DOM
	// attributes so outerHTML preserves them.
	$srcCard.find('input').each(function () {
		const $i = $(this);
		const type = ($i.attr('type') || '').toLowerCase();
		if (type === 'checkbox' || type === 'radio') {
			if (this.checked) $i.attr('checked', 'checked'); else $i.removeAttr('checked');
		} else {
			$i.attr('value', this.value);
		}
	});
	const snapshot = $srcCard.prop("outerHTML");
	const $fresh = $(snapshot);
	$fresh.attr("data-calc-id", calcId);
	$fresh.find(".sb-grid").attr("data-calc-id", calcId);
	$fresh.find('input[type="radio"][name^="fixeChoice-"]').attr("name", `fixeChoice-${calcId}`);
	// .data("calc") from source isn't copied via outerHTML (good), but ensure clean.
	$fresh.removeData("calc");
	$srcCard.after($fresh);
	initCalculator($fresh, { skipBootstrap: true });
	return $fresh;
}

function deleteCalc($card) {
	if ($("#calculators-container .calc-card").length <= 1) return;
	const api = $card.data("calc");
	if (api) {
		const idx = calcRegistry.indexOf(api);
		if (idx !== -1) calcRegistry.splice(idx, 1);
	}
	$card.remove();
}

/* ---------- Debug ---------- */

let _debugMode = false;

function toggleDebug() {
	_debugMode = !_debugMode;
	const btn = document.getElementById('cc-debug-btn');
	const iconOff = document.getElementById('cc-debug-icon-off');
	const iconOn = document.getElementById('cc-debug-icon-on');
	const stateBtn = document.getElementById('cc-debug-state-btn');
	if (btn) btn.classList.toggle('cc-debug-btn--active', _debugMode);
	if (iconOff) iconOff.hidden = _debugMode;
	if (iconOn) iconOn.hidden = !_debugMode;
	if (stateBtn) stateBtn.hidden = !_debugMode;
}

function collectCalcState($card) {
	const $grid = $card.find(".sb-grid");
	const calcId = $card.attr("data-calc-id");
	const colsOrdered = [];
	$grid.find("[data-oddshead]").each(function () {
		const $h = $(this);
		colsOrdered.push({
			colId: $h.attr("data-colid"),
			label: $h.find(".col-label").text(),
			index: Number($h.attr("data-col")),
		});
	});

	const issues = [];
	$grid.find("[data-issuelabel]").each(function () {
		const $label = $(this);
		const issueId = $label.attr("data-issueid");
		const $fixeRadio = $grid.find(`[data-issuefixe][data-issueid="${issueId}"] .radio.fixe`);
		const $distCheck = $grid.find(`[data-issuedist][data-issueid="${issueId}"] .check.dist`);
		const $profitTotal = $grid.find(`[data-profit-total][data-issueid="${issueId}"]`);

		const details = [];
		$grid.find(`[data-type][data-issueid="${issueId}"]`).each(function () {
			const $typeCell = $(this);
			const detailId = $typeCell.attr("data-detailid");
			const mode = $typeCell.find(".type-toggle").attr("data-mode");
			const cotes = [];
			$grid.find(`[data-odds][data-issueid="${issueId}"][data-detailid="${detailId}"]`).each(function () {
				const $oc = $(this);
				cotes.push({
					colId: $oc.attr("data-colid"),
					cote: ($oc.find("input").not(".commission-input").first().val() || "").toString(),
					commission: ($oc.find(".commission-input").first().val() || "").toString(),
				});
			});
			const $stakeCell = $grid.find(`[data-stake][data-issueid="${issueId}"][data-detailid="${detailId}"]`);
			const $oddsTotalCell = $grid.find(`[data-odds-total][data-issueid="${issueId}"][data-detailid="${detailId}"]`);
			const $profitCell = $grid.find(`[data-profit][data-issueid="${issueId}"][data-detailid="${detailId}"]`);
			const $fixeDetailInput = $grid.find(`[data-fixedetail][data-issueid="${issueId}"][data-detailid="${detailId}"] input`);
			details.push({
				detailId,
				type: mode,
				cotes,
				coteTotale: ($oddsTotalCell.text() || "").trim(),
				mise: ($stakeCell.find(".back-stake input").first().val() || "").toString(),
				engagement: ($stakeCell.find(".liability input").first().val() || "").toString(),
				fixeDetail: $fixeDetailInput.is(":checked"),
				profit: ($profitCell.text() || "").trim(),
			});
		});

		issues.push({
			issueId,
			index: Number($label.text()),
			fixe: $fixeRadio.is(":checked"),
			distribution: $distCheck.is(":checked"),
			profitTotal: ($profitTotal.text() || "").trim(),
			details,
		});
	});

	const $totalLabel = $grid.find(".total-label");
	const $totalStake = $totalLabel.nextAll("[data-stake]").first();
	const $totalFixe = $totalLabel.nextAll(".cell").has(".radio.fixe").first().find(".radio.fixe");
	const $totalDist = $totalLabel.nextAll(".cell").has(".check.dist").first().find(".check.dist");
	const $totalProfitTotal = $totalLabel.nextAll("[data-profit-total]").first();
	const $totalOddsTotal = $totalLabel.nextAll("[data-last-odds-total]").first();

	return {
		calcId,
		grid: {
			nbOddsCols: Number($grid.attr("data-odds-cols")),
			columns: colsOrdered,
			hasMultiDetails: $grid.hasClass("has-multi-details"),
		},
		issues,
		total: {
			mise: ($totalStake.find("input").first().val() || "").toString(),
			fixe: $totalFixe.is(":checked"),
			distribution: $totalDist.is(":checked"),
			trj: ($totalOddsTotal.find(".trj-value").text() || "").trim(),
			profitTotal: ($totalProfitTotal.text() || "").trim(),
		},
	};
}

function collectDebugState() {
	const calculators = [];
	$("#calculators-container .calc-card").each(function () {
		calculators.push(collectCalcState($(this)));
	});
	return {
		_meta: {
			timestamp: new Date().toISOString(),
			version: window.CURRENT_VERSION || "?",
			utility: "calc-couverture",
		},
		global: {
			commissionEnabled: $("#commission-enabled").is(":checked"),
			commissionDefault: ($("#commission-default").val() || "").toString(),
			detailsEnabled: $("#details-enabled").is(":checked"),
		},
		calculators,
	};
}

function downloadDebugStateJson() {
	const payload = collectDebugState();
	const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = `calc-couverture-state-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
	a.click();
	URL.revokeObjectURL(url);
}

window.toggleDebug = toggleDebug;
window.downloadDebugStateJson = downloadDebugStateJson;

/* ---------- Global settings ---------- */

function initGlobalSettings() {
	// Commission
	(function () {
		const KEY_ON = "calcCouv.commissionEnabled";
		const KEY_VAL = "calcCouv.commissionDefault";
		const $enabled = $("#commission-enabled");
		const $detail = $("#commission-detail");
		const $val = $("#commission-default");

		function applyCommissionVisibility() {
			const on = $enabled.is(":checked");
			$detail.prop("hidden", !on);
			$(".calc-card").each(function () {
				const calc = $(this).data("calc");
				if (!calc) return;
				$(this).find(".sb-grid").toggleClass("with-commission", on);
				calc.recomputeAll(true);
			});
		}

		$enabled.prop("checked", localStorage.getItem(KEY_ON) === "true");
		const stored = localStorage.getItem(KEY_VAL);
		if (stored !== null) $val.val(stored);
		$detail.prop("hidden", !$enabled.is(":checked"));

		$enabled.on("change", function () {
			localStorage.setItem(KEY_ON, String($(this).is(":checked")));
			applyCommissionVisibility();
		});
		$val.on("input blur", function () {
			localStorage.setItem(KEY_VAL, this.value);
		});
		$val.on("focus", function () { this.select(); });
	})();

	// Loss distribution (toggle + value applied to all calculators)
	(function () {
		const KEY_ON = "calcCouv.lossDistEnabled";
		const KEY_VAL = "calcCouv.lossDistDefault";
		const $enabled = $("#loss-dist-enabled");
		const $detail = $("#loss-dist-detail");
		const $val = $("#loss-dist-default");

		function applyLossDistVisibility() {
			const on = $enabled.is(":checked");
			$detail.prop("hidden", !on);
			$(".calc-card").each(function () {
				const calc = $(this).data("calc");
				if (calc) calc.recomputeAll(true);
			});
		}

		$enabled.prop("checked", localStorage.getItem(KEY_ON) === "true");
		const stored = localStorage.getItem(KEY_VAL);
		if (stored !== null) $val.val(stored);
		$detail.prop("hidden", !$enabled.is(":checked"));

		$enabled.on("change", function () {
			localStorage.setItem(KEY_ON, String($(this).is(":checked")));
			applyLossDistVisibility();
		});
		$val.on("input blur", function () {
			localStorage.setItem(KEY_VAL, this.value);
			$(".calc-card").each(function () {
				const calc = $(this).data("calc");
				if (calc) calc.recomputeAll(true);
			});
		});
		$val.on("focus", function () { this.select(); });
	})();

	// Details toggle
	(function () {
		const KEY_ON = "calcCouv.detailsEnabled";
		const $enabled = $("#details-enabled");

		function applyDetailsVisibility() {
			const on = $enabled.is(":checked");
			$(".calc-card").each(function () {
				const calc = $(this).data("calc");
				if (!calc) return;
				$(this).find(".sb-grid").toggleClass("with-details", on);
			});
		}

		$enabled.prop("checked", localStorage.getItem(KEY_ON) === "true");

		$enabled.on("change", function () {
			localStorage.setItem(KEY_ON, String($(this).is(":checked")));
			applyDetailsVisibility();
		});
	})();

	// Fixed gain toggle
	(function () {
		const KEY_ON = "calcCouv.fixedGainEnabled";
		const $enabled = $("#fixed-gain-enabled");

		function applyFixedGainVisibility() {
			const on = $enabled.is(":checked");
			$(".calc-card").each(function () {
				const calc = $(this).data("calc");
				if (!calc) return;
				$(this).find(".sb-grid").toggleClass("with-fixed-gain", on);
			});
		}

		$enabled.prop("checked", localStorage.getItem(KEY_ON) === "true");

		$enabled.on("change", function () {
			localStorage.setItem(KEY_ON, String($(this).is(":checked")));
			applyFixedGainVisibility();
		});
	})();
}

/* ---------- Initialisation ---------- */

$(function () {
	initGlobalSettings();

	// Spawn the first calculator
	addNewCalc();

	// Global "+ Ajouter un calculateur"
	$("#add-calculator").on("click", function () {
		addNewCalc();
	});

	// Delegated duplicate / delete handlers (bound once on the container)
	$("#calculators-container").on("click", ".js-duplicate-calc", function () {
		const $card = $(this).closest(".calc-card");
		duplicateCalc($card);
	});
	$("#calculators-container").on("click", ".js-delete-calc", function () {
		const $card = $(this).closest(".calc-card");
		deleteCalc($card);
	});

	if (window.lucide) lucide.createIcons();
});

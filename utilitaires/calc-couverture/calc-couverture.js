/* global $ */
const STEP = 0.01;
const DEC = 2;

let nb_odds = 0;
let nb_issues = 0; // anciennement nb_lines

let issueCounter = 1; // Pour générer I01, I02, ...
let colCounter = 1;   // Pour générer C01, C02, ...
const colIds = [];    // Liste ordonnée des IDs de colonnes (ex: ["C01", "C02, ...])


/**
 * Il faut que cela équilibre les mises, en fonction de quelle ligne est considérée comme "fixe", pour essayer d'avoir un profit égal sur toutes les lignes. Et ça doit se faire dès qu'une cotes est mise à jour, que la ligne "fixe" est changée ou que la mise de la ligne fixe est modifiée.
 */

/* ---------- Helpers ---------- */

/**
 * Arrondit un nombre à 2 décimales (ou DEC).
 */
function toFixed2(n) { return Number(n).toFixed(DEC); }

/**
 * Normalise une chaîne de caractères en nombre décimal (format français/anglais).
 */
function normalize(val) {
	if (val === "" || val == null) return "";
	const safe = String(val).replace(/[^\d.,-]/g, "");
	const parts = safe.replace(",", ".").split(".");
	const joined = parts.length > 2 ? parts[0] + "." + parts.slice(1).join("") : parts.join(".");
	const num = Number(joined);
	return Number.isNaN(num) ? "" : toFixed2(num);
}

/**
 * Retourne la lettre correspondant à l'index (1 => A, 2 => B, ...).
 */
function letterFor(idx) { return String.fromCharCode(64 + idx); }

/**
 * Génère un nouvel identifiant unique pour une issue (ex: I01, I02, ...).
 */
function nextIssueId() {
	let currStrIssueCounter = String(issueCounter++);
	if(issueCounter < 10) currStrIssueCounter = "0" + currStrIssueCounter;
	return "I" + currStrIssueCounter;
}

/**
 * Génère un nouvel identifiant unique pour une colonne (ex: C01, C02, ...).
 */
function nextColId() {
	let currStrOddsCounter = String(colCounter++);
	if(colCounter < 10) currStrOddsCounter = "0" + currStrOddsCounter;
	currStrOddsCounter = "C" + currStrOddsCounter;
	colIds.push(currStrOddsCounter);
	return currStrOddsCounter;
}

/**
 * Construit un champ numérique avec steppers, valeur par défaut et minimum.
 */
/**
 * Construit une cellule de cote ([data-odds]) avec l'input cote et l'input commission
 * empilés verticalement. La commission est cachée tant que le paramètre global n'est pas
 * activé (via la classe .with-commission sur la grille).
 */
function getDefaultCommission() {
	return ($("#commission-default").val() || "3,00").trim() || "3,00";
}

function buildOddsCell(colId, issueId, defaultOdds = "", isLay = false) {
	// Back → commission vide (= 0). Lay → commission par défaut globale.
	const defaultComm = isLay ? getDefaultCommission() : "";
	const $cell = $(`<div class='cell' data-odds data-colid="${colId}" data-issueid="${issueId}"></div>`);
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

	// Gestion de la saisie et du minimum
	$input.on("input", function () {
		let v = this.value.replace(/[^\d.,-]/g, "");
		const parts = v.replace(",", ".").split(".");
		if (parts.length > 2) v = parts[0] + "." + parts.slice(1).join("");
		this.value = v;
		// Correction valeur min (sauf si le champ est vide)
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
	$input.on("focus", function () {
		this.select();
	});
	// Cliquer n'importe où dans le wrapper .num focus + sélectionne l'input
	// (sauf clic sur les steppers + / − qui gardent leur action propre)
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

/**
 * Applique le nombre de colonnes de cotes à la grille CSS.
 */
function applyGridTemplate($grid) {
	const n = Number($grid.attr("data-odds-cols"));
	$grid[0].style.setProperty('--nb-cotes', n);
}

/**
 * Transforme les cellules vides en champs numériques interactifs.
 */
function hydrate() {
	const $grid = $("#surebet-grid");
	$grid.find("[data-odds]").each(function () {
		if (!$(this).children().length) $(this).append(buildNumberField("","", null));
	});
	$grid.find("[data-stake]").each(function () {
		// Si c'est la mise du total, mettre 10 par défaut
		if (!$(this).children().length) {
			const isTotal = $(this).closest(".sb-grid").length && $(this).prevAll(".total-label").length > 0;
			$(this).append(buildNumberField("",isTotal ? "10,00" : "", 0.01, "€"));
		}
	});
	// Cocher toutes les cases de distribution par défaut
	$grid.find('.check.dist').prop('checked', true);
}

/**
 * Met à jour les labels et data-col des en-têtes de colonnes de cotes.
 */
function renumberColumnHeaders() {
	$("#surebet-grid").find("[data-oddshead]").each(function (i) {
		const idx = i + 1;
		$(this).attr("data-col", String(idx));
		$(this).find(".col-label").text(letterFor(idx));
	});
}

/**
 * Ajoute une colonne de cote à la grille, avec identifiant unique.
 */
function addOddsColumn() {
	const $grid = $("#surebet-grid");
	let next = Number($grid.attr("data-odds-cols")) + 1;
	$grid.attr("data-odds-cols", String(next));
	applyGridTemplate($grid);

	// Génère un nouvel ID de colonne
	const colId = nextColId();

	// En-tête avec corbeille
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

	// Pour chaque issue, insérer la nouvelle cellule de cote avec ID unique
	$grid.find("[data-issuelabel]").each(function () {
		const $issueLabel = $(this);
		const issueId = $issueLabel.attr("data-issueid");
		const $coteTotale = $issueLabel.nextAll("[data-odds-total]").first();
		const $stakeCell = $issueLabel.nextAll("[data-stake]").first();
		const isLay = $stakeCell.hasClass("lay-mode");
		const $newOddsCell = buildOddsCell(colId, issueId, "", isLay);
		if ($coteTotale.length) {
			$coteTotale.before($newOddsCell);
		}
	});

	// Ligne Totale : placeholder pour aligner TRJ
	const $totalBefore = $grid.find("[data-last-odds-total]").last();
	$totalBefore.before(`<div class="cell total-span" colspan data-colid="${colId}"></div>`);

	nb_odds++;

	if (window.lucide) {
		lucide.createIcons();
	}
	refreshDeleteButtons();
}

/**
 * Affiche/masque les boutons de suppression selon les minima (1 cote, 2 issues).
 */
function refreshDeleteButtons() {
	const $grid = $("#surebet-grid");
	$grid.find(".js-del-col").toggle(nb_odds > 1);
	$grid.find(".js-del-issue").toggle(nb_issues > 2);
}

/**
 * Supprime une colonne de cote (par son index 1-based), retire les cellules et met à jour les identifiants.
 */
function removeOddsColumnAt(index1) { // index1 = 1-based
	const $grid = $("#surebet-grid");
	let count = Number($grid.attr("data-odds-cols"));
	if (count <= 1) return;

	// Trouver l'ID de colonne à supprimer
	const $colHead = $grid.find(`[data-oddshead][data-col='${index1}']`);
	const colId = $colHead.attr("data-colid");

	// Supprime l'en-tête ciblé
	$colHead.remove();

	// Supprime toutes les cellules de cette colonne dans chaque issue
	$grid.find(`[data-odds][data-colid='${colId}']`).remove();

	// Supprime le placeholder de la ligne totale pour cette colonne
	$grid.find(`.total-span[data-colid='${colId}']`).remove();

	// Retire l'id de la colonne du tableau colIds
	const idx = colIds.indexOf(colId);
	if (idx !== -1) colIds.splice(idx, 1);

	// MAJ compte + template + relabel
	$grid.attr("data-odds-cols", String(count - 1));
	applyGridTemplate($grid);
	renumberColumnHeaders();
	nb_odds--;

	recomputeAll();
	refreshDeleteButtons();
}

/**
 * Ajoute une nouvelle ligne d'issue avec identifiant unique et cellules de cotes.
 */
function addIssue() {
	const $grid = $("#surebet-grid");
	const nOdds = Number($grid.attr("data-odds-cols"));
	const nextIndex = $grid.find("[data-issuelabel]").length + 1;
	const issueId = nextIssueId();

	const frag = $(document.createDocumentFragment());
	frag.append(`<div class="cell rowhead sticky" data-issuelabel data-issueid="${issueId}">${nextIndex}</div>`);
	// Cellule Type (bouton flip Back / Lay)
	frag.append(`
		<div class="cell" data-type>
			<button type="button" class="type-toggle" data-mode="back" aria-label="Basculer Back / Lay">
				<span class="type-inner">
					<span class="type-face type-face-back">+ Back</span>
					<span class="type-face type-face-lay">− Lay</span>
				</span>
			</button>
		</div>
	`);
	// Pour chaque colonne existante, ajoute une cellule de cote avec ID unique
	for (let i = 0; i < colIds.length; i++) {
		const colId = colIds[i];
		frag.append(buildOddsCell(colId, issueId, i === 0 && nextIndex <= 2 ? "2,00" : ""));
	}
	frag.append(`<div class="cell" data-odds-total>—</div>`);
	// Cellule Mises : deux groupes (Mise + Engagement) — Engagement masqué tant que la ligne n'est pas en mode Lay
	const $stakeCell = $("<div class='cell' data-stake></div>");
	const $stakeGroup = $("<div class='stake-input-group back-stake'><span class='stake-label'>Mise</span></div>")
		.append(buildNumberField("", nextIndex === 1 ? "5,00" : "", 0.01, "€"));
	const $liabilityGroup = $("<div class='stake-input-group liability'><span class='stake-label'>Engagement</span></div>")
		.append(buildNumberField("", "", 0.01, "€"));
	$stakeCell.append($stakeGroup).append($liabilityGroup);
	frag.append($stakeCell);
	frag.append(`<div class="cell"><input type="radio" name="fixeChoice" class="radio fixe" aria-label="Fixe issue ${nextIndex}"${nextIndex === 1 ? " checked" : ""}></div>`);
	frag.append(`<div class="cell"><input type="checkbox" class="check dist" aria-label="Distribution issue ${nextIndex}" checked></div>`);
	frag.append(`<div class="cell right" data-profit>—</div>`);
	frag.append(`<div class="cell right" data-profit-total>—</div>`);
	frag.append(`
		<div class="cell right">
			<button class="btn-icon btn btn-danger js-del-issue" title="Supprimer l'issue">
				<i data-lucide="trash-2" class="icon"></i>
			</button>
		</div>
	`);
	frag.append(`<div class="row-sep"></div>`);

	$grid.find(".divider").before(frag);

	nb_issues++;

	if (window.lucide) {
		lucide.createIcons();
	}

	recomputeAll();
	refreshDeleteButtons();
}

/**
 * Supprime une ligne d'issue et ses cellules associées.
 */
function deleteIssue($issueLabelCell) { // anciennement deleteRow
	const $grid = $("#surebet-grid");
	const minIssues = 2;
	const totalIssues = $grid.find("[data-issuelabel]").length;
	if (totalIssues <= minIssues) return;

	// Supprime toutes les cellules jusqu'à la prochaine issuelabel/divider/total-label
	let $ptr = $issueLabelCell;
	const toRemove = [$ptr.get(0)];
	$ptr = $ptr.next();
	while ($ptr.length && !$ptr.is("[data-issuelabel], .divider, .total-label")) {
		toRemove.push($ptr.get(0));
		$ptr = $ptr.next();
	}
	$(toRemove).remove();

	// Re-numérote les étiquettes d'issue
	let idx = 1;
	$grid.find("[data-issuelabel]").each(function () { $(this).text(idx++); });
	nb_issues--;
	recomputeAll();
	refreshDeleteButtons();
}

/**
 * Lit les cellules associées à une ligne (issue ou total) en parcourant les siblings du label
 * jusqu'au prochain séparateur de ligne.
 */
function getRowParts($label) {
	const parts = { $label, $oddsCells: [], $oddsTotal: null, $stake: null, $fixe: null, $dist: null, $profit: null, $profitTotal: null, isLay: false };
	let $ptr = $label.next();
	while ($ptr.length && !$ptr.is("[data-issuelabel], .divider, .total-label, .row-sep")) {
		if ($ptr.is("[data-odds]")) parts.$oddsCells.push($ptr);
		else if ($ptr.is("[data-odds-total], [data-last-odds-total]")) parts.$oddsTotal = $ptr;
		else if ($ptr.is("[data-stake]")) {
			parts.$stake = $ptr;
			parts.isLay = $ptr.hasClass("lay-mode");
		}
		else if ($ptr.is("[data-profit-total]")) parts.$profitTotal = $ptr;
		else if ($ptr.is("[data-profit]")) parts.$profit = $ptr;
		const $r = $ptr.find(".radio.fixe");
		if ($r.length) parts.$fixe = $r;
		const $c = $ptr.find(".check.dist");
		if ($c.length) parts.$dist = $c;
		$ptr = $ptr.next();
	}
	return parts;
}

function readNum($input) {
	if (!$input || !$input.length) return 0;
	const n = Number(String($input.val() || "0").replace(",", "."));
	return Number.isNaN(n) ? 0 : n;
}

function setStake($stakeCell, value) {
	if (!$stakeCell || !$stakeCell.length) return;
	// Cible le 1er input (back-stake pour les issues, l'unique input pour la ligne Total)
	$stakeCell.find("input").first().val(value.toFixed(DEC).replace(".", ","));
}

function setLiability($stakeCell, value) {
	if (!$stakeCell || !$stakeCell.length) return;
	const $input = $stakeCell.find(".liability input").first();
	if ($input.length) $input.val(value.toFixed(DEC).replace(".", ","));
}

let recomputing = false;

/**
 * Recalcule l'ensemble : cotes totales, TRJ, mises distribuées et profits.
 * Déclenché à chaque changement d'input/radio/checkbox.
 */
function recomputeAll(redistribute = true) {
	if (recomputing) return;
	recomputing = true;
	const $grid = $("#surebet-grid");

	// Collecte des issues
	const commissionEnabled = $grid.hasClass("with-commission");
	const issues = [];
	$grid.find("[data-issuelabel]").each(function () {
		const p = getRowParts($(this));
		let hasValue = false;
		let oddsTotal = 1;      // produit des cotes brutes
		let oddsTotalNet = 1;   // produit des cotes nettes (cote − 1) × (1 − commission) + 1
		for (const $c of p.$oddsCells) {
			// Premier input de la cellule = cote (la commission est dans .cell-commission après)
			const v = $c.find("input").not(".commission-input").first().val();
			if (v && String(v).trim() !== "") hasValue = true;
			const o = Number(String(v).replace(",", "."));
			const oVal = Number.isNaN(o) ? 1 : o;
			oddsTotal *= oVal;
			const c = commissionEnabled ? (readNum($c.find(".commission-input").first()) / 100) : 0;
			oddsTotalNet *= 1 + (oVal - 1) * (1 - c);
		}
		const $stakeInput = p.$stake && p.$stake.find(".back-stake input").first();
		const $liabInput = p.$stake && p.$stake.find(".liability input").first();
		const stakeVal = readNum($stakeInput && $stakeInput.length ? $stakeInput : p.$stake && p.$stake.find("input").first());
		const engagementVal = readNum($liabInput);
		issues.push({
			parts: p,
			hasValue,
			oddsTotal,
			oddsTotalNet,
			stake: stakeVal,
			engagement: engagementVal,
			isFixed: !!(p.$fixe && p.$fixe.is(":checked")),
			isDist: !!(p.$dist && p.$dist.is(":checked")),
			isLay: !!p.isLay,
		});
	});

	// Affichage des cotes totales par issue
	// On masque dynamiquement la colonne Net (si pas de commission effective sur la ligne),
	// la ligne Lay (si la ligne est Back), et les labels/headers s'il ne reste qu'une seule
	// colonne ou ligne.
	const fmtBrut = (v) => (v !== null && isFinite(v)) ? v.toFixed(2).replace(".", ",") : "—";
	const fmtNet  = (v) => (v !== null && isFinite(v)) ? v.toFixed(3).replace(".", ",") : "—";
	for (const it of issues) {
		if (!it.parts.$oddsTotal) continue;
		if (!it.hasValue) {
			it.parts.$oddsTotal.text("—");
			continue;
		}

		// Commission effective sur la ligne : net ≠ brut
		const hasComm = Math.abs(it.oddsTotal - it.oddsTotalNet) > 1e-9;
		const showLayRow = it.isLay;
		const showNetCol = hasComm;

		// Cas trivial : pas de Lay et pas de commission → simple valeur brute
		if (!showLayRow && !showNetCol) {
			it.parts.$oddsTotal.text(it.oddsTotal.toFixed(DEC).replace(".", ","));
			continue;
		}

		// Cotes brutes/nettes natives + conversion vers l'autre type
		let backBrut, backNet, layBrut, layNet;
		if (it.isLay) {
			layBrut = it.oddsTotal;
			layNet = it.oddsTotalNet;
			backBrut = layBrut > 1 ? layBrut / (layBrut - 1) : null;
			backNet = layNet > 1 ? layNet / (layNet - 1) : null;
		} else {
			backBrut = it.oddsTotal;
			backNet = it.oddsTotalNet;
		}

		const showColHeaders = showNetCol;  // n'a de sens que s'il y a 2 colonnes
		const showRowLabels = showLayRow;   // n'a de sens que s'il y a 2 lignes
		const ncols = (showRowLabels ? 1 : 0) + (showNetCol ? 1 : 0) + 1;

		let html = `<div class="odds-detail" style="grid-template-columns: repeat(${ncols}, auto)">`;

		// En-têtes de colonnes (si Net affichée)
		if (showColHeaders) {
			if (showRowLabels) html += `<span></span>`;
			html += `<span class="odds-detail-head">Net</span>`;
			html += `<span class="odds-detail-head">Brut</span>`;
		}

		// Ligne Back
		if (showRowLabels) html += `<span class="odds-detail-row-label odds-back-label">Back</span>`;
		if (showNetCol) html += `<span class="odds-detail-value">${fmtNet(backNet)}</span>`;
		html += `<span class="odds-detail-value">${fmtBrut(backBrut)}</span>`;

		// Ligne Lay (seulement si la ligne est Lay)
		if (showLayRow) {
			if (showRowLabels) html += `<span class="odds-detail-row-label odds-lay-label">Lay</span>`;
			if (showNetCol) html += `<span class="odds-detail-value">${fmtNet(layNet)}</span>`;
			html += `<span class="odds-detail-value">${fmtBrut(layBrut)}</span>`;
		}

		html += `</div>`;
		it.parts.$oddsTotal.html(html);
	}

	// Ligne Total
	const $totalLabel = $grid.find(".total-label");
	const totalParts = getRowParts($totalLabel);
	const total = {
		parts: totalParts,
		stake: readNum(totalParts.$stake && totalParts.$stake.find("input").first()),
		isFixed: !!(totalParts.$fixe && totalParts.$fixe.is(":checked")),
		isDist: !!(totalParts.$dist && totalParts.$dist.is(":checked")),
	};

	// TRJ : on prend la cote Back équivalente pour les lignes Lay (O → O/(O−1))
	let sumInv = 0, countValid = 0;
	for (const it of issues) {
		if (!it.hasValue || it.oddsTotal <= 0) continue;
		const effOdds = it.isLay
			? (it.oddsTotal > 1 ? it.oddsTotal / (it.oddsTotal - 1) : null)
			: it.oddsTotal;
		if (effOdds && effOdds > 0 && isFinite(effOdds)) {
			sumInv += 1 / effOdds;
			countValid++;
		}
	}
	const trj = countValid > 0 ? 1 / sumInv : 0;
	if (totalParts.$oddsTotal) {
		const $trjValue = totalParts.$oddsTotal.find(".trj-value");
		const trjText = countValid === 0 ? "—" : (trj * 100).toFixed(2).replace(".", ",") + " %";
		if ($trjValue.length) $trjValue.text(trjText);
		else totalParts.$oddsTotal.text(trjText);
	}

	// Équilibrage avec distribution / non-distribution.
	// Désormais on utilise la cote NETTE pour la redistribution des mises et le calcul
	// de K/S. L'engagement Lay reste basé sur la cote BRUTE (réalité physique du Lay).
	const eligibles = issues.filter(it => it.hasValue && it.oddsTotalNet > 0);
	const sigmaD = eligibles.filter(it => it.isDist).reduce((a, it) => a + 1 / it.oddsTotalNet, 0);
	const sigmaN = eligibles.filter(it => !it.isDist).reduce((a, it) => a + 1 / it.oddsTotalNet, 0);

	const fixedIssue = issues.find(it => it.isFixed && it.hasValue && it.stake > 0);
	let K = null, S = null;
	let errorMsg = null;

	if (fixedIssue) {
		if (fixedIssue.isDist) {
			K = fixedIssue.stake * fixedIssue.oddsTotalNet;
			const denom = 1 - sigmaN;
			if (denom > 0) S = K * sigmaD / denom;
			else errorMsg = "Configuration impossible : trop de lignes non distribuées.";
		} else {
			S = fixedIssue.stake * fixedIssue.oddsTotalNet;
			if (sigmaD > 0) K = S * (1 - sigmaN) / sigmaD;
			else errorMsg = "Aucune ligne en distribution — cochez au moins une ligne.";
		}
	} else if (total.isFixed && total.stake > 0) {
		S = total.stake;
		if (sigmaD > 0) K = S * (1 - sigmaN) / sigmaD;
		else if (eligibles.length > 0) errorMsg = "Aucune ligne en distribution — cochez au moins une ligne.";
	}

	// Application des mises (si redistribution autorisée) — basée sur la cote NETTE
	if (redistribute && !errorMsg && K !== null && S !== null) {
		for (const it of eligibles) {
			if (it.isFixed) continue;
			const target = it.isDist ? K / it.oddsTotalNet : S / it.oddsTotalNet;
			setStake(it.parts.$stake, target);
			// Engagement Lay basé sur la cote BRUTE (réalité du marché)
			if (it.isLay && it.oddsTotal > 1) {
				const newEng = target * (it.oddsTotal - 1);
				setLiability(it.parts.$stake, newEng);
				it.engagement = newEng;
			}
			it.stake = target;
		}
		if (!total.isFixed) {
			setStake(total.parts.$stake, S);
			total.stake = S;
		}
	}

	// Investissement total = somme des fonds réellement engagés.
	//   - Back : stake (mise)
	//   - Lay  : engagement (collatéral). Si l'utilisateur n'a pas saisi d'engagement,
	//            on retombe sur la formule mise × (cote − 1).
	const sumInvested = issues.reduce((a, it) => {
		if (!it.hasValue || !it.stake) return a;
		if (it.isLay) {
			const eng = it.engagement || it.stake * Math.max(0, it.oddsTotal - 1);
			return a + eng;
		}
		return a + it.stake;
	}, 0);

	// Affichage profits & profits totaux — utilisent la cote NETTE
	for (const it of issues) {
		if (it.parts.$profit) {
			if (!it.hasValue || !it.stake) it.parts.$profit.text("—");
			else {
				// Back : profit = mise × cote nette (retour réel après commission).
				// Lay  : profit = mise (gain conservé si l'issue ne se réalise pas).
				const profit = it.isLay ? it.stake : it.oddsTotalNet * it.stake;
				it.parts.$profit.text(profit.toFixed(DEC).replace(".", ",") + " €");
			}
		}
		if (it.parts.$profitTotal) {
			if (!it.hasValue || !it.stake) it.parts.$profitTotal.text("—");
			else {
				// "Retour quand le pari de cette ligne gagne" en valeurs nettes :
				//   Back : stake × cote nette
				//   Lay  : mise + engagement (le collatéral est récupéré sans commission)
				const returnedOnWin = it.isLay
					? it.stake + (it.engagement || it.stake * Math.max(0, it.oddsTotal - 1))
					: it.stake * it.oddsTotalNet;
				const profitTotal = returnedOnWin - sumInvested;
				it.parts.$profitTotal.text(profitTotal.toFixed(DEC).replace(".", ",") + " €");
			}
		}
	}
	if (totalParts.$profitTotal) {
		if (K !== null && S !== null) totalParts.$profitTotal.text((K - sumInvested).toFixed(DEC).replace(".", ",") + " €");
		else totalParts.$profitTotal.text("—");
	}

	// Bannière d'erreur
	const $err = $("#sb-error");
	if (errorMsg) { $err.text(errorMsg).prop("hidden", false); }
	else { $err.prop("hidden", true).text(""); }

	// Couleur selon le TRJ — uniquement sur TRJ et profit_total des lignes distribuées
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
		for (const it of issues) {
			if (it.isDist && it.parts.$profitTotal) it.parts.$profitTotal.addClass(tier);
		}
		if (totalParts.$profitTotal) totalParts.$profitTotal.addClass(tier);
	}

	recomputing = false;
}

/**
 * Lie les événements de changement (cotes, mises, fixe, distribution) au recalcul global.
 */
function bindOddsInputs() {
	const $grid = $("#surebet-grid");
	// Cotes → recalcul complet (avec redistribution des mises)
	// Cotes → recalcul complet (redistribution). Commission → refresh affichage seulement.
	$grid.on("input cote:changed", "[data-odds] input:not(.commission-input)", () => recomputeAll(true));
	$grid.on("input cote:changed", ".commission-input", () => recomputeAll(true));
	// Saisie 0 dans une commission → on vide l'input
	$grid.on("blur", ".commission-input", function () {
		const v = Number(String(this.value).replace(",", "."));
		if (!Number.isNaN(v) && v === 0) this.value = "";
	});
	// Mises → redistribution uniquement si la ligne modifiée est la ligne fixée
	$grid.on("input cote:changed", "[data-stake] input", function () {
		const $cell = $(this).closest("[data-stake]");
		const $label = $cell.prevAll("[data-issuelabel], .total-label").first();
		const parts = getRowParts($label);
		const isFixed = !!(parts.$fixe && parts.$fixe.is(":checked"));
		recomputeAll(isFixed);
	});
	// Changement de ligne fixe ou de distribution → recalcul complet
	$grid.on("change", ".radio.fixe, .check.dist", function () {
		// La checkbox de la ligne Total agit comme un master toggle
		const $cell = $(this).closest(".cell");
		const isTotalDist = $(this).hasClass("dist") && $cell.prevAll(".total-label").length > 0;
		if (isTotalDist) {
			const checked = $(this).is(":checked");
			$grid.find("[data-issuelabel]").each(function () {
				const parts = getRowParts($(this));
				if (parts.$dist) parts.$dist.prop("checked", checked);
			});
		}
		recomputeAll(true);
	});
}

/**
 * Initialisation du module surebet au chargement de la page.
 */
$(function () {
	applyGridTemplate($("#surebet-grid"));
	hydrate();
	renumberColumnHeaders();

	// Ajoute une colonne de cote par défaut au chargement
	addOddsColumn();
	addIssue(); // Ajoute une issue par défaut au chargement
	addIssue();

	bindOddsInputs();
	recomputeAll();

	$("#add-col").on("click", addOddsColumn);
	$("#add-row").on("click", addIssue); // anciennement addRow

	// Délégation suppression issue
	$("#surebet-grid").on("click", ".js-del-issue", function () {
		const $label = $(this).closest(".cell").prevAll("[data-issuelabel]").first();
		deleteIssue($label);
	});

	// Délégation suppression colonne (depuis l'en-tête)
	$("#surebet-grid").on("click", ".js-del-col", function () {
		const idx = Number($(this).closest("[data-oddshead]").attr("data-col"));
		removeOddsColumnAt(idx);
	});

	// Bascule Back / Lay sur le bouton flip
	$("#surebet-grid").on("click", ".type-toggle", function () {
		const $btn = $(this);
		const newMode = $btn.attr("data-mode") === "back" ? "lay" : "back";
		$btn.attr("data-mode", newMode);
		const $typeCell = $btn.closest(".cell");
		const $stakeCell = $typeCell.nextAll("[data-stake]").first();
		const $oddsTotalCell = $typeCell.nextAll("[data-odds-total]").first();
		const $label = $typeCell.prevAll("[data-issuelabel]").first();
		const issueId = $label.attr("data-issueid");
		if ($stakeCell.length) $stakeCell.toggleClass("lay-mode", newMode === "lay");

		// Commission : remplir avec la valeur par défaut en Lay, vider en Back
		const $commInputs = $("#surebet-grid").find(`[data-odds][data-issueid='${issueId}'] .commission-input`);
		if (newMode === "lay") $commInputs.val(getDefaultCommission());
		else $commInputs.val("");

		// Conversion automatique Mise / Engagement à partir de la cote totale courante
		const $mainInput = $stakeCell.find(".back-stake input").first();
		const $liabInput = $stakeCell.find(".liability input").first();
		const odds = parseFloat(($oddsTotalCell.text() || "").replace(",", "."));
		const currentMain = readNum($mainInput);

		if (currentMain > 0 && !isNaN(odds) && odds > 1) {
			if (newMode === "lay") {
				// Back → Lay : liability = stake × odds, lay_stake = liability / (odds - 1)
				const liability = currentMain * odds;
				const layStake = liability / (odds - 1);
				$mainInput.val(layStake.toFixed(DEC).replace(".", ","));
				$liabInput.val(liability.toFixed(DEC).replace(".", ","));
			} else {
				// Lay → Back : back_stake = liability / odds
				const liability = readNum($liabInput) || currentMain * (odds - 1);
				const backStake = liability / odds;
				$mainInput.val(backStake.toFixed(DEC).replace(".", ","));
			}
		}

		recomputeAll(true);
	});

	if (window.lucide) {
		lucide.createIcons();
	}

	// ===== Paramètres globaux : commission Lay (localStorage) =====
	(function () {
		const KEY_ON = "calcCouv.commissionEnabled";
		const KEY_VAL = "calcCouv.commissionDefault";
		const $enabled = $("#commission-enabled");
		const $detail = $("#commission-detail");
		const $val = $("#commission-default");

		function applyCommissionVisibility() {
			const on = $enabled.is(":checked");
			$detail.prop("hidden", !on);
			$("#surebet-grid").toggleClass("with-commission", on);
		}

		$enabled.prop("checked", localStorage.getItem(KEY_ON) === "true");
		const stored = localStorage.getItem(KEY_VAL);
		if (stored !== null) $val.val(stored);
		applyCommissionVisibility();

		$enabled.on("change", function () {
			localStorage.setItem(KEY_ON, String($(this).is(":checked")));
			applyCommissionVisibility();
			recomputeAll(true);
		});
		$val.on("input blur", function () {
			localStorage.setItem(KEY_VAL, this.value);
		});
		$val.on("focus", function () { this.select(); });
	})();
});


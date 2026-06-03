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
	// Cocher le radio "Fixe" sur la ligne totale par défaut
	$grid.find('.total-label').nextAll().find('.radio.fixe').first().prop('checked', true);
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
		const $newOddsCell = $(`<div class='cell' data-odds data-colid="${colId}" data-issueid="${issueId}"></div>`)
			.append(buildNumberField("","", null));
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
	// Pour chaque colonne existante, ajoute une cellule de cote avec ID unique
	for (let i = 0; i < colIds.length; i++) {
		const colId = colIds[i];
		frag.append($(`<div class='cell' data-odds data-colid="${colId}" data-issueid="${issueId}"></div>`)
			.append(buildNumberField("",i === 0 && nextIndex <= 2 ? "2,00" : "", null)));
	}
	frag.append(`<div class="cell" data-odds-total>—</div>`);
	frag.append($("<div class='cell' data-stake></div>").append(buildNumberField("","", 0.01, "€")));
	frag.append(`<div class="cell"><input type="radio" name="fixeChoice" class="radio fixe" aria-label="Fixe issue ${nextIndex}"></div>`);
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
	const parts = { $label, $oddsCells: [], $oddsTotal: null, $stake: null, $fixe: null, $dist: null, $profit: null, $profitTotal: null };
	let $ptr = $label.next();
	while ($ptr.length && !$ptr.is("[data-issuelabel], .divider, .total-label, .row-sep")) {
		if ($ptr.is("[data-odds]")) parts.$oddsCells.push($ptr);
		else if ($ptr.is("[data-odds-total], [data-last-odds-total]")) parts.$oddsTotal = $ptr;
		else if ($ptr.is("[data-stake]")) parts.$stake = $ptr;
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
	const $input = $stakeCell.find("input");
	$input.val(value.toFixed(DEC).replace(".", ","));
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
	const issues = [];
	$grid.find("[data-issuelabel]").each(function () {
		const p = getRowParts($(this));
		let hasValue = false;
		let oddsTotal = 1;
		for (const $c of p.$oddsCells) {
			const v = $c.find("input").val();
			if (v && String(v).trim() !== "") hasValue = true;
			const n = Number(String(v).replace(",", "."));
			oddsTotal *= Number.isNaN(n) ? 1 : n;
		}
		issues.push({
			parts: p,
			hasValue,
			oddsTotal,
			stake: readNum(p.$stake && p.$stake.find("input")),
			isFixed: !!(p.$fixe && p.$fixe.is(":checked")),
			isDist: !!(p.$dist && p.$dist.is(":checked")),
		});
	});

	// Affichage des cotes totales par issue
	for (const it of issues) {
		if (!it.parts.$oddsTotal) continue;
		it.parts.$oddsTotal.text(it.hasValue ? it.oddsTotal.toFixed(DEC).replace(".", ",") : "—");
	}

	// Ligne Total
	const $totalLabel = $grid.find(".total-label");
	const totalParts = getRowParts($totalLabel);
	const total = {
		parts: totalParts,
		stake: readNum(totalParts.$stake && totalParts.$stake.find("input")),
		isFixed: !!(totalParts.$fixe && totalParts.$fixe.is(":checked")),
		isDist: !!(totalParts.$dist && totalParts.$dist.is(":checked")),
	};

	// TRJ
	let sumInv = 0, countValid = 0;
	for (const it of issues) {
		if (it.hasValue && it.oddsTotal > 0) { sumInv += 1 / it.oddsTotal; countValid++; }
	}
	const trj = countValid > 0 ? 1 / sumInv : 0;
	if (totalParts.$oddsTotal) {
		const $trjValue = totalParts.$oddsTotal.find(".trj-value");
		const trjText = countValid === 0 ? "—" : (trj * 100).toFixed(2).replace(".", ",") + " %";
		if ($trjValue.length) $trjValue.text(trjText);
		else totalParts.$oddsTotal.text(trjText);
	}

	// Équilibrage avec distribution / non-distribution
	// - Lignes distribuées : profit_total commun (= K - S)
	// - Lignes non distribuées : profit_total = 0 (stake * odds = S)
	const eligibles = issues.filter(it => it.hasValue && it.oddsTotal > 0);
	const sigmaD = eligibles.filter(it => it.isDist).reduce((a, it) => a + 1 / it.oddsTotal, 0);
	const sigmaN = eligibles.filter(it => !it.isDist).reduce((a, it) => a + 1 / it.oddsTotal, 0);

	const fixedIssue = issues.find(it => it.isFixed && it.hasValue && it.stake > 0);
	let K = null, S = null;
	let errorMsg = null;

	if (fixedIssue) {
		if (fixedIssue.isDist) {
			K = fixedIssue.stake * fixedIssue.oddsTotal;
			const denom = 1 - sigmaN;
			if (denom > 0) S = K * sigmaD / denom;
			else errorMsg = "Configuration impossible : trop de lignes non distribuées.";
		} else {
			S = fixedIssue.stake * fixedIssue.oddsTotal;
			if (sigmaD > 0) K = S * (1 - sigmaN) / sigmaD;
			else errorMsg = "Aucune ligne en distribution — cochez au moins une ligne.";
		}
	} else if (total.isFixed && total.stake > 0) {
		S = total.stake;
		if (sigmaD > 0) K = S * (1 - sigmaN) / sigmaD;
		else if (eligibles.length > 0) errorMsg = "Aucune ligne en distribution — cochez au moins une ligne.";
	}

	// Application des mises (si redistribution autorisée)
	if (redistribute && !errorMsg && K !== null && S !== null) {
		for (const it of eligibles) {
			if (it.isFixed) continue;
			const target = it.isDist ? K / it.oddsTotal : S / it.oddsTotal;
			setStake(it.parts.$stake, target);
			it.stake = target;
		}
		if (!total.isFixed) {
			setStake(total.parts.$stake, S);
			total.stake = S;
		}
	}

	// Somme courante des mises des issues (utilisée pour profit_total = stake*odds - sumStakes)
	const totalStakes = issues.reduce((a, it) => a + (it.stake || 0), 0);

	// Affichage profits & profits totaux
	for (const it of issues) {
		if (it.parts.$profit) {
			if (!it.hasValue || !it.stake) it.parts.$profit.text("—");
			else it.parts.$profit.text((it.oddsTotal * it.stake).toFixed(DEC).replace(".", ",") + " €");
		}
		if (it.parts.$profitTotal) {
			if (!it.hasValue || !it.stake) it.parts.$profitTotal.text("—");
			else it.parts.$profitTotal.text((it.oddsTotal * it.stake - totalStakes).toFixed(DEC).replace(".", ",") + " €");
		}
	}
	if (totalParts.$profitTotal) {
		if (K !== null && S !== null) totalParts.$profitTotal.text((K - S).toFixed(DEC).replace(".", ",") + " €");
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
	$grid.on("input cote:changed", "[data-odds] input", () => recomputeAll(true));
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

	if (window.lucide) {
		lucide.createIcons();
	}
});


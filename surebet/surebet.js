/* global $ */
const STEP = 0.01;
const DEC = 2;

let nb_odds = 0;
let nb_issues = 0; // anciennement nb_lines

let issueCounter = 1; // Pour générer I01, I02, ...
let colCounter = 1;   // Pour générer C01, C02, ...
const colIds = [];    // Liste ordonnée des IDs de colonnes (ex: ["C01", "C02", ...])

/* ---------- Helpers ---------- */
function toFixed2(n) { return Number(n).toFixed(DEC); }
function normalize(val) {
	if (val === "" || val == null) return "";
	const safe = String(val).replace(/[^\d.,]/g, "");
	const parts = safe.replace(",", ".").split(".");
	const joined = parts.length > 2 ? parts[0] + "." + parts.slice(1).join("") : parts.join(".");
	const num = Number(joined);
	return Number.isNaN(num) ? "" : toFixed2(num);
}
function letterFor(idx) { return String.fromCharCode(64 + idx); }
function nextIssueId() {
	let currStrIssueCounter = String(issueCounter++);
	if(issueCounter < 10) currStrIssueCounter = "0" + currStrIssueCounter;
	return "I" + currStrIssueCounter;
}
function nextColId() {
	let currStrOddsCounter = String(colCounter++);
	if(colCounter < 10) currStrOddsCounter = "0" + currStrOddsCounter;
	currStrOddsCounter = "C" + currStrOddsCounter;
	colIds.push(currStrOddsCounter);
	return currStrOddsCounter;
}

/* Champ numérique + steppers */
function buildNumberField(ph = "0,00", defaultValue = "") {
	const $el = $(`
	<div class="num">
		<input type="text" inputmode="decimal" placeholder="${ph}" autocomplete="off" spellcheck="false" />
		<div class="steppers">
			<button type="button" class="step plus" aria-label="Augmenter">+</button>
			<button type="button" class="step minus" aria-label="Diminuer">−</button>
		</div>
	</div>
	`);
	const $input = $el.find("input");
	if (defaultValue !== "") $input.val(defaultValue.replace(".", ","));
	$input.on("input", function () {
		let v = this.value.replace(/[^\d.,]/g, "");
		const parts = v.replace(",", ".").split(".");
		if (parts.length > 2) v = parts[0] + "." + parts.slice(1).join("");
		this.value = v;
	});
	$input.on("blur", function () {
		const f = normalize(this.value);
		this.value = f ? f.replace(".", ",") : "";
	});
	$input.on("focus", function () {
		this.select();
	});
	$el.on("click", ".plus", function () {
		const base = Number(($input.val() || "0").replace(",", "."));
		const next = (Number.isNaN(base) ? 0 : base) + STEP;
		$input.val(toFixed2(next).replace(".", ",")).trigger("blur");
	});
	$el.on("click", ".minus", function () {
		const base = Number(($input.val() || "0").replace(",", "."));
		const next = (Number.isNaN(base) ? 0 : base) - STEP;
		$input.val(toFixed2(next).replace(".", ",")).trigger("blur");
	});
	return $el;
}

/* ---- Grid template selon nb de colonnes de cotes ---- */
function applyGridTemplate($grid) {
	const n = Number($grid.attr("data-odds-cols"));
	$grid[0].style.setProperty('--nb-cotes', n);
}

/* ---- Hydratation des cellules en champs ---- */
function hydrate() {
	const $grid = $("#surebet-grid");
	$grid.find("[data-odds]").each(function () {
		if (!$(this).children().length) $(this).append(buildNumberField());
	});
	$grid.find("[data-stake]").each(function () {
		// Si c'est la mise du total, mettre 10 par défaut
		if (!$(this).children().length) {
			const isTotal = $(this).closest(".sb-grid").length && $(this).prevAll(".total-label").length > 0;
			$(this).append(buildNumberField("0,00", isTotal ? "10" : ""));
		}
	});
	// Cocher toutes les cases de distribution par défaut
	$grid.find('.check.dist').prop('checked', true);
	// Cocher le radio "Fixe" sur la ligne totale par défaut
	$grid.find('.total-label').nextAll().find('.radio.fixe').first().prop('checked', true);
}

/* ---- Re-numérotation des en-têtes A, B, C… et data-col ---- */
function renumberColumnHeaders() {
	$("#surebet-grid").find("[data-oddshead]").each(function (i) {
		const idx = i + 1;
		$(this).attr("data-col", String(idx));
		$(this).find(".col-label").text(letterFor(idx));
	});
}

/* ---- Ajouter / Supprimer colonne de cote ---- */
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
			<span class="col-id">${colId}</span>
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
			.append(buildNumberField());
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
}

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

	// Recalcule toutes les cotes totales après suppression de colonne
	$grid.find("[data-issuelabel]").each(function () {
		updateOddsTotalForIssue($(this));
	});
}

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
			.append(buildNumberField("0,00", i === 0 ? String(nextIndex)+",00" : "")));
	}
	frag.append(`<div class="cell" data-odds-total>—</div>`);
	frag.append($("<div class='cell' data-stake></div>").append(buildNumberField()));
	frag.append(`<div class="cell"><input type="checkbox" class="check dist" aria-label="Distribution issue ${nextIndex}" checked></div>`);
	frag.append(`<div class="cell"><input type="radio" name="fixeChoice" class="radio fixe" aria-label="Fixe issue ${nextIndex}"></div>`);
	frag.append(`<div class="cell right" data-profit>—</div>`);
	frag.append(`
		<div class="cell right">
			<button class="btn-icon btn btn-danger js-del-issue" title="Supprimer l'issue">
				<i data-lucide="trash-2" class="icon"></i>
			</button>
		</div>
	`);

	$grid.find(".divider").before(frag);

	nb_issues++;

	if (window.lucide) {
		lucide.createIcons();
	}

	const $rowLabel = $grid.find("[data-issuelabel]").last();
	updateOddsTotalForIssue($rowLabel);
}

function deleteIssue($issueLabelCell) { // anciennement deleteRow
	const $grid = $("#surebet-grid");
	const minIssues = 1;
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
}

function updateOddsTotalForIssue($rowLabel) {
	// Utilise les IDs pour sélectionner les cellules de cote de la ligne
	const issueId = $rowLabel.attr("data-issueid");
	let odds = [], hasValue = false;
	for (const colId of colIds) {
		const $cell = $(`[data-odds][data-issueid='${issueId}'][data-colid='${colId}']`);
		if ($cell.length) {
			const val = $cell.find("input").val();
			if (val && val.trim() !== "") hasValue = true;
			const num = Number(String(val).replace(",", "."));
			odds.push(Number.isNaN(num) ? 1 : num || 1);
		}
	}
	const $oddsTotal = $rowLabel.nextAll("[data-odds-total]").first();
	if ($oddsTotal.length) {
		if (!hasValue) {
			$oddsTotal.text("—");
		} else {
			const product = odds.reduce((acc, v) => acc * v, 1);
			$oddsTotal.text(product.toFixed(DEC));
		}
	}
}

function bindOddsInputs() {
	const $grid = $("#surebet-grid");
	// Délégation sur tous les champs de cote
	$grid.on("input", "[data-odds] input", function () {
		const $cell = $(this).closest("[data-odds]");
		const issueId = $cell.attr("data-issueid");
		const $rowLabel = $grid.find(`[data-issuelabel][data-issueid='${issueId}']`);
		updateOddsTotalForIssue($rowLabel);
	});
}

/* ---- Init ---- */
$(function () {
	applyGridTemplate($("#surebet-grid"));
	hydrate();
	renumberColumnHeaders();

	// Ajoute une colonne de cote par défaut au chargement
	addOddsColumn();
	addIssue(); // Ajoute une issue par défaut au chargement
	addIssue();

	bindOddsInputs();

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


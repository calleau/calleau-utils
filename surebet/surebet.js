/* global $ */
const STEP = 0.01;
const DEC = 2;

let nb_odds = 0;
let nb_issues = 0; // anciennement nb_lines

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

	// En-tête avec corbeille (identique à la colonne A du HTML)
	const $heads = $grid.find("[data-oddshead]");
	const $newHead = $(`
		<div class="cell head colhead" data-oddshead data-col="${next}">
			<span class="col-label">${letterFor(next)}</span>
			<button class="btn-icon btn btn-danger js-del-col" title="Supprimer cette colonne">
				<i data-lucide="trash-2" class="icon"></i>
			</button>
		</div>
	`);
	// Si aucune colonne de cote n'existe, insérer après la première cellule d'en-tête ("Cotes")
	if ($heads.length === 0) {
		$("#surebet-grid .cell.head.sticky").after($newHead);
	} else {
		$heads.last().after($newHead);
	}

	// Issues de données : insérer la nouvelle cellule de cote juste avant la cellule "Cote totale" (data-total)
	$grid.find("[data-issuelabel]").each(function () {
		const $issueLabel = $(this);
		const $coteTotale = $issueLabel.nextAll("[data-total]").first();
		const $newOddsCell = $("<div class='cell' data-odds></div>").append(buildNumberField());
		if ($coteTotale.length) {
			$coteTotale.before($newOddsCell);
		}
	});

	// Ligne Totale : placeholder pour aligner TRJ
	const $totalLabel = $grid.find(".total-label");
	let $t = $totalLabel.next(), spans = [];
	while ($t.length && !$t.is("[data-total]")) {
		if ($t.is(".total-span")) spans.push($t);
		$t = $t.next();
	}
	// Si aucune colonne de cote n'existe, insérer juste après .total-label, sinon après le dernier .total-span
	if (spans.length === 0) {
		$totalLabel.after(`<div class="cell total-span" colspan></div>`);
	} else {
		spans[spans.length - 1].after(`<div class="cell total-span" colspan></div>`);
	}
	nb_odds++;

	// Met à jour les icônes Lucide pour la nouvelle colonne
	if (window.lucide) {
		lucide.createIcons();
	}
}

function removeOddsColumnAt(index1) { // index1 = 1-based
	const $grid = $("#surebet-grid");
	let count = Number($grid.attr("data-odds-cols"));
	if (count <= 1) return; // minimum 1 colonne

	// Supprime l'en-tête ciblé
	$grid.find(`[data-oddshead][data-col='${index1}']`).remove();

	// Pour chaque issue, retire la N-ième cellule data-odds
	$grid.find("[data-issuelabel]").each(function () {
		// Collecte les cellules de cote de l'issue
		let $ptr = $(this).next(), odds = [];
		while ($ptr.length && !$ptr.is("[data-issuelabel], .divider, .total-label")) {
			if ($ptr.is("[data-odds]")) odds.push($ptr);
			$ptr = $ptr.next();
		}
		const $toRemove = odds[index1 - 1];
		if ($toRemove) $toRemove.remove();
	});

	// Ligne Totale : retirer le N-ième placeholder avant [data-total]
	const $totalLabel = $grid.find(".total-label");
	let $t = $totalLabel.next(), spans = [];
	while ($t.length && !$t.is("[data-total]")) {
		if ($t.is(".total-span")) spans.push($t);
		$t = $t.next();
	}
	const $spanToRemove = spans[index1 - 1];
	if ($spanToRemove) $spanToRemove.remove();

	// MAJ compte + template + relabel
	$grid.attr("data-odds-cols", String(count - 1));
	applyGridTemplate($grid);
	renumberColumnHeaders();
	nb_odds--;
}

/* ---- Ajouter / Supprimer issue ---- */
function addIssue() {
	const $grid = $("#surebet-grid");
	const nOdds = Number($grid.attr("data-odds-cols"));
	const nextIndex = $grid.find("[data-issuelabel]").length + 1;

	const frag = $(document.createDocumentFragment());
	frag.append(`<div class="cell rowhead sticky" data-issuelabel>${nextIndex}</div>`);
	for (let i = 0; i < nOdds; i++) {
		frag.append($("<div class='cell' data-odds></div>").append(buildNumberField()));
	}
	frag.append(`<div class="cell" data-total>—</div>`);
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

	// Met à jour les icônes Lucide pour la nouvelle ligne
	if (window.lucide) {
		lucide.createIcons();
	}
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

/* ---- Init ---- */
$(function () {
	applyGridTemplate($("#surebet-grid"));
	hydrate();
	renumberColumnHeaders();

	// Ajoute une colonne de cote par défaut au chargement
	addOddsColumn();

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


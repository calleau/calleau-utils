/* global $ */
const STEP = 0.01;
const DEC = 2;

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
function buildNumberField(ph = "0,00") {
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
	const tpl = `
    90px
    repeat(${n}, minmax(160px,1fr))
    160px 160px 140px 110px 160px 100px
  `;
	$grid.css("grid-template-columns", tpl);
}

/* ---- Hydratation des cellules en champs ---- */
function hydrate() {
	const $grid = $("#surebet-grid");
	$grid.find("[data-odds]").each(function () {
		if (!$(this).children().length) $(this).append(buildNumberField());
	});
	$grid.find("[data-stake]").each(function () {
		if (!$(this).children().length) $(this).append(buildNumberField());
	});
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

	// En-tête avec corbeille
	const $heads = $grid.find("[data-oddshead]");
	const $newHead = $(`
    <div class="cell head colhead" data-oddshead data-col="${next}">
      <span class="col-label">${letterFor(next)}</span>
      <button class="icon-btn xs danger js-del-col" title="Supprimer cette colonne">🗑️</button>
    </div>`);
	$heads.last().after($newHead);

	// Lignes de données
	$grid.find("[data-rowlabel]").each(function () {
		let $ptr = $(this).next(), lastOdds = null;
		while ($ptr.length && !$ptr.is("[data-rowlabel], .divider, .total-label")) {
			if ($ptr.is("[data-odds]")) lastOdds = $ptr;
			$ptr = $ptr.next();
		}
		if (lastOdds) lastOdds.after($("<div class='cell' data-odds></div>").append(buildNumberField()));
	});

	// Ligne Totale : placeholder pour aligner TRJ
	const $totalLabel = $grid.find(".total-label");
	let $t = $totalLabel.next();
	while ($t.length && !$t.is("[data-total]")) $t = $t.next();
	$t.before(`<div class="cell total-span" colspan></div>`);
}

function removeOddsColumnAt(index1) { // index1 = 1-based
	const $grid = $("#surebet-grid");
	let count = Number($grid.attr("data-odds-cols"));
	if (count <= 1) return; // minimum 1 colonne

	// Supprime l'en-tête ciblé
	$grid.find(`[data-oddshead][data-col='${index1}']`).remove();

	// Pour chaque ligne, retire la N-ième cellule data-odds
	$grid.find("[data-rowlabel]").each(function () {
		// Collecte les cellules de cote de la ligne
		let $ptr = $(this).next(), odds = [];
		while ($ptr.length && !$ptr.is("[data-rowlabel], .divider, .total-label")) {
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
}

/* ---- Ajouter / Supprimer ligne ---- */
function addRow() {
	const $grid = $("#surebet-grid");
	const nOdds = Number($grid.attr("data-odds-cols"));
	const nextIndex = $grid.find("[data-rowlabel]").length + 1;

	const frag = $(document.createDocumentFragment());
	frag.append(`<div class="cell rowhead sticky" data-rowlabel>${nextIndex}</div>`);
	for (let i = 0; i < nOdds; i++) frag.append($("<div class='cell' data-odds></div>").append(buildNumberField()));
	frag.append(`<div class="cell" data-total>—</div>`);
	frag.append($("<div class='cell' data-stake></div>").append(buildNumberField()));
	frag.append(`<div class="cell"><input type="checkbox" class="check dist" aria-label="Distribution ligne ${nextIndex}"></div>`);
	frag.append(`<div class="cell"><input type="radio" name="fixeChoice" class="radio fixe" aria-label="Fixe ligne ${nextIndex}"></div>`);
	frag.append(`<div class="cell right" data-profit>—</div>`);
	frag.append(`<div class="cell right"><button class="icon-btn danger js-del-row" aria-label="Supprimer la ligne">🗑️</button></div>`);

	$grid.find(".divider").before(frag);
}

function deleteRow($rowLabelCell) {
	const $grid = $("#surebet-grid");
	const minRows = 1;
	const totalRows = $grid.find("[data-rowlabel]").length;
	if (totalRows <= minRows) return;

	// Supprime toutes les cellules jusqu'à la prochaine rowlabel/divider/total-label
	let $ptr = $rowLabelCell;
	const toRemove = [$ptr.get(0)];
	$ptr = $ptr.next();
	while ($ptr.length && !$ptr.is("[data-rowlabel], .divider, .total-label")) {
		toRemove.push($ptr.get(0));
		$ptr = $ptr.next();
	}
	$(toRemove).remove();

	// Re-numérote les étiquettes de ligne
	let idx = 1;
	$grid.find("[data-rowlabel]").each(function () { $(this).text(idx++); });
}

/* ---- Init ---- */
$(function () {
	applyGridTemplate($("#surebet-grid"));
	hydrate();
	renumberColumnHeaders();

	$("#add-col").on("click", addOddsColumn);
	$("#add-row").on("click", addRow);

	// Délégation suppression ligne
	$("#surebet-grid").on("click", ".js-del-row", function () {
		const $label = $(this).closest(".cell").prevAll("[data-rowlabel]").first();
		deleteRow($label);
	});

	// Délégation suppression colonne (depuis l'en-tête)
	$("#surebet-grid").on("click", ".js-del-col", function () {
		const idx = Number($(this).closest("[data-oddshead]").attr("data-col"));
		removeOddsColumnAt(idx);
	});
});

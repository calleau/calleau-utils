/* global $ */
const STEP = 0.01;
const DEC = 2;

let nb_odds = 0;
let nb_issues = 0;

let issueCounter = 1;   // I01, I02, ...
let colCounter = 1;     // C01, C02, ...
let detailCounter = 1;  // D01, D02, ...
const colIds = [];

/* ---------- Helpers ---------- */

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
function nextColId() {
	const id = "C" + pad2(colCounter++);
	colIds.push(id);
	return id;
}
function nextDetailId() { return "D" + pad2(detailCounter++); }

function getDefaultCommission() {
	return ($("#commission-default").val() || "3,00").trim() || "3,00";
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

function applyGridTemplate($grid) {
	const n = Number($grid.attr("data-odds-cols"));
	$grid[0].style.setProperty('--nb-cotes', n);
}

function hydrate() {
	const $grid = $("#surebet-grid");
	$grid.find("[data-odds]").each(function () {
		if (!$(this).children().length) $(this).append(buildNumberField("", "", null));
	});
	$grid.find("[data-stake]").each(function () {
		if (!$(this).children().length) {
			const isTotal = $(this).closest(".sb-grid").length && $(this).prevAll(".total-label").length > 0;
			$(this).append(buildNumberField("", isTotal ? "10,00" : "", 0.01, "€"));
		}
	});
	$grid.find('.check.dist').prop('checked', true);
}

function renumberColumnHeaders() {
	$("#surebet-grid").find("[data-oddshead]").each(function (i) {
		const idx = i + 1;
		$(this).attr("data-col", String(idx));
		$(this).find(".col-label").text(letterFor(idx));
	});
}

/* ---------- Construction des cellules par détail ---------- */

function buildTypeCell(issueId, detailId) {
	return $(`
		<div class="cell" data-type data-issueid="${issueId}" data-detailid="${detailId}">
			<button type="button" class="type-toggle" data-mode="back" aria-label="Basculer Back / Lay">
				<span class="type-inner">
					<span class="type-face type-face-back">+ Back</span>
					<span class="type-face type-face-lay">− Lay</span>
				</span>
			</button>
			<button class="btn-icon btn btn-danger js-del-detail" data-issueid="${issueId}" data-detailid="${detailId}" title="Supprimer ce détail" style="margin-left:6px;display:none;">
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
				<button type="button" class="js-add-detail" title="Ajouter une ligne de détail">+ Détail</button>
				<button class="btn-icon btn btn-danger js-del-issue" title="Supprimer l'issue">
					<i data-lucide="trash-2" class="icon"></i>
				</button>
			</div>
		</div>
	`);
}

/* Cellules par détail (Type, cotes, cote totale, mise, fixe détail).
   Renvoie un tableau de jQuery objects à insérer dans le DOM. */
function buildDetailCellsArr(issueId, detailId, opts = {}) {
	const cells = [];
	cells.push(buildTypeCell(issueId, detailId));
	for (let i = 0; i < colIds.length; i++) {
		const colId = colIds[i];
		const defaultOdds = (opts.defaultOdds && i === 0) ? opts.defaultOdds : "";
		cells.push(buildOddsCell(colId, issueId, detailId, defaultOdds, false));
	}
	cells.push(buildOddsTotalCell(issueId, detailId));
	cells.push(buildStakeCell(issueId, detailId, opts.defaultStake || ""));
	cells.push(buildFixeDetailCell(issueId, detailId));
	return cells;
}

/* ---------- Ajout / suppression de colonnes de cotes ---------- */

function addOddsColumn() {
	const $grid = $("#surebet-grid");
	let next = Number($grid.attr("data-odds-cols")) + 1;
	$grid.attr("data-odds-cols", String(next));
	applyGridTemplate($grid);

	const colId = nextColId();

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

	// Pour chaque détail de chaque issue, insérer la nouvelle cellule de cote
	$grid.find("[data-type]").each(function () {
		const $typeCell = $(this);
		const issueId = $typeCell.attr("data-issueid");
		const detailId = $typeCell.attr("data-detailid");
		const $stakeCell = $grid.find(`[data-stake][data-issueid="${issueId}"][data-detailid="${detailId}"]`);
		const isLay = $stakeCell.hasClass("lay-mode");
		const $oddsTotalCell = $grid.find(`[data-odds-total][data-issueid="${issueId}"][data-detailid="${detailId}"]`);
		const $newOddsCell = buildOddsCell(colId, issueId, detailId, "", isLay);
		$oddsTotalCell.before($newOddsCell);
	});

	// Total : placeholder pour aligner TRJ
	const $totalBefore = $grid.find("[data-last-odds-total]").last();
	$totalBefore.before(`<div class="cell total-span" colspan data-colid="${colId}"></div>`);

	nb_odds++;
	if (window.lucide) lucide.createIcons();
	refreshDeleteButtons();
}

function refreshDeleteButtons() {
	const $grid = $("#surebet-grid");
	$grid.find(".js-del-col").toggle(nb_odds > 1);
	$grid.find(".js-del-issue").toggle(nb_issues > 2);
	// Bouton supprimer détail : visible si l'issue a >=2 détails
	$grid.find("[data-issuelabel]").each(function () {
		const issueId = $(this).attr("data-issueid");
		const k = $grid.find(`[data-type][data-issueid="${issueId}"]`).length;
		const $btns = $grid.find(`.js-del-detail[data-issueid="${issueId}"]`);
		if (k > 1) $btns.css("display", "inline-flex");
		else $btns.css("display", "none");
	});
}

function removeOddsColumnAt(index1) {
	const $grid = $("#surebet-grid");
	let count = Number($grid.attr("data-odds-cols"));
	if (count <= 1) return;

	const $colHead = $grid.find(`[data-oddshead][data-col='${index1}']`);
	const colId = $colHead.attr("data-colid");

	$colHead.remove();
	$grid.find(`[data-odds][data-colid='${colId}']`).remove();
	$grid.find(`.total-span[data-colid='${colId}']`).remove();

	const idx = colIds.indexOf(colId);
	if (idx !== -1) colIds.splice(idx, 1);

	$grid.attr("data-odds-cols", String(count - 1));
	applyGridTemplate($grid);
	renumberColumnHeaders();
	nb_odds--;

	recomputeAll();
	refreshDeleteButtons();
}

/* ---------- Ajout / suppression d'issues ---------- */

function addIssue() {
	const $grid = $("#surebet-grid");
	const nextIndex = $grid.find("[data-issuelabel]").length + 1;
	const issueId = nextIssueId();
	const detailId = nextDetailId();

	const frag = $(document.createDocumentFragment());

	// Label issue
	frag.append(`<div class="cell rowhead sticky" data-issuelabel data-issueid="${issueId}">${nextIndex}</div>`);

	// Cellules du premier détail (Type, cotes, cote totale, mise, fixe détail)
	const detailCells = buildDetailCellsArr(issueId, detailId, {
		defaultOdds: nextIndex <= 2 ? "2,00" : "",
		defaultStake: nextIndex === 1 ? "5,00" : "",
	});
	for (const c of detailCells) frag.append(c);

	// Cellules niveau issue : Fixe (radio), Distribution (checkbox)
	frag.append(`
		<div class="cell" data-issueid="${issueId}" data-issuefixe>
			<input type="radio" name="fixeChoice" class="radio fixe" aria-label="Fixe issue ${nextIndex}"${nextIndex === 1 ? " checked" : ""}>
		</div>
	`);
	frag.append(`
		<div class="cell" data-issueid="${issueId}" data-issuedist>
			<input type="checkbox" class="check dist" aria-label="Distribution issue ${nextIndex}" checked>
		</div>
	`);

	// Profit du premier détail (per-detail, va se placer après Dist en row 1)
	frag.append(buildProfitCell(issueId, detailId));

	// Profit total (issue-level, span K)
	frag.append(`<div class="cell right" data-profit-total data-issueid="${issueId}">—</div>`);

	// Actions (issue-level, span K) : + Détail / supprimer issue
	frag.append(buildIssueActionsCell(issueId));

	// Séparateur de ligne (entre issues)
	frag.append(`<div class="row-sep" data-issueid="${issueId}"></div>`);

	$grid.find(".divider").before(frag);

	nb_issues++;

	if (window.lucide) lucide.createIcons();
	recomputeAll();
	refreshDeleteButtons();
}

function deleteIssue($issueLabelCell) {
	const $grid = $("#surebet-grid");
	const minIssues = 2;
	if ($grid.find("[data-issuelabel]").length <= minIssues) return;
	const issueId = $issueLabelCell.attr("data-issueid");

	$grid.find(`[data-issueid="${issueId}"]`).remove();

	// Re-numérote les labels
	let idx = 1;
	$grid.find("[data-issuelabel]").each(function () { $(this).text(idx++); });
	nb_issues--;
	refreshMultiDetailsClass();
	recomputeAll();
	refreshDeleteButtons();
}

/* ---------- Ajout / suppression de détails ---------- */

function addDetail(issueId) {
	const $grid = $("#surebet-grid");
	const detailId = nextDetailId();

	const detailCells = buildDetailCellsArr(issueId, detailId, {});
	const $profitCell = buildProfitCell(issueId, detailId);

	const $rowSep = $grid.find(`.row-sep[data-issueid="${issueId}"]`);
	for (const c of detailCells) $rowSep.before(c);
	$rowSep.before($profitCell);

	updateIssueSpans(issueId);
	refreshMultiDetailsClass();
	// Si l'issue est Fixe, le nouveau détail doit aussi être marqué fixe
	syncFixeIssueToDetails(issueId);

	if (window.lucide) lucide.createIcons();
	recomputeAll();
	refreshDeleteButtons();
}

function removeDetail(issueId, detailId) {
	const $grid = $("#surebet-grid");
	const k = $grid.find(`[data-type][data-issueid="${issueId}"]`).length;
	if (k <= 1) return;
	$grid.find(`[data-issueid="${issueId}"][data-detailid="${detailId}"]`).remove();
	updateIssueSpans(issueId);
	refreshMultiDetailsClass();
	recomputeAll();
	refreshDeleteButtons();
}

function updateIssueSpans(issueId) {
	const $grid = $("#surebet-grid");
	const K = $grid.find(`[data-type][data-issueid="${issueId}"]`).length;
	const spanVal = K > 1 ? `span ${K}` : "";

	const $issueLevel = $grid.find(`[data-issueid="${issueId}"]`).filter(function () {
		const $el = $(this);
		if ($el.attr("data-detailid")) return false;
		if ($el.is(".row-sep")) return false;
		// Inclut : data-issuelabel, data-issuefixe, data-issuedist, data-profit-total, data-actions
		return true;
	});
	$issueLevel.each(function () { $(this).css("grid-row", spanVal || ""); });
}

function refreshMultiDetailsClass() {
	const $grid = $("#surebet-grid");
	let hasMulti = false;
	$grid.find("[data-issuelabel]").each(function () {
		const id = $(this).attr("data-issueid");
		const k = $grid.find(`[data-type][data-issueid="${id}"]`).length;
		if (k >= 2) { hasMulti = true; return false; }
	});
	$grid.toggleClass("has-multi-details", hasMulti);
}

/* Si l'issue est Fixe (radio coché), tous ses détails sont marqués Fixe détail
   et désactivés. Sinon, ils sont réactivés. */
function syncFixeIssueToDetails(issueId) {
	const $grid = $("#surebet-grid");
	const $fixe = $grid.find(`[data-issuefixe][data-issueid="${issueId}"] .radio.fixe`);
	const isFixed = $fixe.is(":checked");
	const $detailChecks = $grid.find(`[data-fixedetail][data-issueid="${issueId}"] input.fixe-detail`);
	if (isFixed) {
		$detailChecks.prop("checked", true).prop("disabled", true);
	} else {
		$detailChecks.prop("disabled", false);
	}
}

/* ---------- Lecture / écriture ---------- */

function readNum($input) {
	if (!$input || !$input.length) return 0;
	const n = Number(String($input.val() || "0").replace(",", "."));
	return Number.isNaN(n) ? 0 : n;
}

function setStake($stakeCell, value) {
	if (!$stakeCell || !$stakeCell.length) return;
	$stakeCell.find("input").first().val(value.toFixed(DEC).replace(".", ","));
}

function setLiability($stakeCell, value) {
	if (!$stakeCell || !$stakeCell.length) return;
	const $input = $stakeCell.find(".liability input").first();
	if ($input.length) $input.val(value.toFixed(DEC).replace(".", ","));
}

/* ---------- Recalcul global ---------- */

let recomputing = false;

function recomputeAll(redistribute = true) {
	if (recomputing) return;
	recomputing = true;
	const $grid = $("#surebet-grid");
	const commissionEnabled = $grid.hasClass("with-commission");

	// Collecte des issues + détails
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
			let oddsTotalNet = 1;       // Back : produit des (1+(O−1)(1−c))
			let layNetWinFactor = 1;    // Lay : produit des (1−c) — coef sur lay_stake après commission
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
			// Pour un Lay, retour total quand le pari gagne (par unité de mise) =
			// mise_net + engagement = mise×(1−c) + mise×(O−1) = mise×(O−c).
			// Généralisation multi-cote : (mise × Π(1−c_i)) + mise × (ΠO_i − 1).
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
				detailId, isLay, hasValue, oddsTotal, oddsTotalNet,
				layNetWinFactor, layReturnFactor,
				stake: stakeVal, engagement: engagementVal,
				isFixedDetail,
				$stakeCell, $oddsTotalCell, $profitCell,
			});
		});

		issues.push({ issueId, $label, $fixeRadio, $distCheck, $profitTotal, isFixed, isDist, details });
	});

	// Affichage de la cote totale pour chaque détail
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
				backNet = layNet > 1 ? layNet / (layNet - 1) : null;
			} else {
				backBrut = d.oddsTotal;
				backNet = d.oddsTotalNet;
			}

			const showColHeaders = showNetCol;
			const showRowLabels = showLayRow;
			const ncols = (showRowLabels ? 1 : 0) + (showNetCol ? 1 : 0) + 1;

			let html = `<div class="odds-detail" style="grid-template-columns: repeat(${ncols}, auto)">`;
			if (showColHeaders) {
				if (showRowLabels) html += `<span></span>`;
				html += `<span class="odds-detail-head">Net</span>`;
				html += `<span class="odds-detail-head">Brut</span>`;
			}
			if (showRowLabels) html += `<span class="odds-detail-row-label odds-back-label">Back</span>`;
			if (showNetCol) html += `<span class="odds-detail-value">${fmtNet(backNet)}</span>`;
			html += `<span class="odds-detail-value">${fmtBrut(backBrut)}</span>`;

			if (showLayRow) {
				if (showRowLabels) html += `<span class="odds-detail-row-label odds-lay-label">Lay</span>`;
				if (showNetCol) html += `<span class="odds-detail-value">${fmtNet(layNet)}</span>`;
				html += `<span class="odds-detail-value">${fmtBrut(layBrut)}</span>`;
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

	// Si la ligne fixée a une cote remplie mais pas de mise, on met 10 € par défaut
	// (uniquement pour les issues mono-détail, et seulement si on a le droit d'écrire).
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

	// Calculs agrégés par issue (pour l'équilibrage et le profit total)
	// Pour chaque issue, on calcule :
	//   - sumInvestedIssue : somme des montants engagés (Back : stake ; Lay : engagement)
	//   - returnIfIssueWins : somme des retours bruts quand l'issue se réalise
	//                         (Back : stake × oddsNet ; Lay : 0)
	//   - effectiveOddsNet : cote nette agrégée pour la redistribution
	// Si l'issue n'a qu'un détail, on retombe exactement sur le comportement classique.
	for (const issue of issues) {
		let sumInvested = 0;
		let returnIfWin = 0;
		let returnIfLose = 0; // somme des retours nets quand l'issue NE se réalise PAS
		issue.hasValue = false;
		for (const d of issue.details) {
			if (!d.hasValue) continue;
			issue.hasValue = true;
			if (d.isLay) {
				// Lay : engagement = mise × (oddsBrut − 1) ; retour si Lay gagne =
				// mise × (1 − c) + engagement = mise × layReturnFactor
				const liability = d.engagement || d.stake * Math.max(0, d.oddsTotal - 1);
				sumInvested += liability;
				returnIfLose += d.stake * d.layNetWinFactor + liability;
			} else {
				// Back : retour si Back gagne = mise × oddsTotalNet
				sumInvested += d.stake;
				returnIfWin += d.stake * d.oddsTotalNet;
			}
		}
		issue.sumInvested = sumInvested;
		issue.returnIfIssueWins = returnIfWin;
		issue.returnIfIssueLoses = returnIfLose;
		if (issue.details.length === 1 && issue.details[0].hasValue) {
			// Mono-détail : on utilise la cote nette back-équivalente comme facteur
			// effectif pour l'équilibrage et le TRJ.
			//   Back : back-équivalent = oddsTotalNet
			//   Lay  : back-équivalent = layReturnFactor / (oddsTotal − 1)
			//          (= (O − c) / (O − 1) en mono-cote)
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
	}

	// TRJ : basé sur la cote nette effective de chaque issue
	let sumInv = 0, countValid = 0;
	for (const issue of issues) {
		if (!issue.hasValue || issue.effectiveOddsNet <= 0) continue;
		sumInv += 1 / issue.effectiveOddsNet;
		countValid++;
	}
	const trj = countValid > 0 ? 1 / sumInv : 0;
	if ($totalOddsTotal && $totalOddsTotal.length) {
		const $trjValue = $totalOddsTotal.find(".trj-value");
		const trjText = countValid === 0 ? "—" : (trj * 100).toFixed(2).replace(".", ",") + " %";
		if ($trjValue.length) $trjValue.text(trjText);
		else $totalOddsTotal.text(trjText);
	}

	// Équilibrage des MISES.
	// On garde le moteur existant (équilibrage entre issues) mais en mode multi-détail
	// on ne redistribue PAS au sein d'une issue multi-détail (l'utilisateur gère ses détails).
	// On ne redistribue qu'au sein des issues mono-détail.
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
			// Retour brut cible quand cette issue se réalise :
			//   - issues distribuées → K (équilibre cible)
			//   - issues non distribuées → S (somme totale investie)
			const targetReturn = it.isDist ? K : S;

			if (it.details.length === 1) {
				// Mono-détail : on alloue tout au seul détail.
				const d = it.details[0];
				// Back : target = K / oddsTotalNet (= mise qui rapporte K si Back gagne).
				// Lay  : target = K / layReturnFactor (= mise telle que mise×(1−c)+engagement = K).
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
				// Multi-détail : on répartit le retour cible entre les détails non-fixe.
				//   - Détails Fixe détail (et tous si l'issue est Fixe) : contribution figée.
				//   - Détails restants : se partagent à parts égales le solde restant.
				//   - Back : stake = part / oddsNet.
				//   - Lay : ne peut pas contribuer positivement quand l'issue gagne (la mise
				//     est perdue) → on laisse tel quel.
				let sumFixedReturn = 0;
				const nonFixed = [];
				for (const d of it.details) {
					if (!d.hasValue) continue;
					if (d.isFixedDetail) {
						sumFixedReturn += d.isLay ? 0 : d.stake * d.oddsTotalNet;
					} else {
						nonFixed.push(d);
					}
				}
				const eligibleBacks = nonFixed.filter(d => !d.isLay);
				if (eligibleBacks.length > 0) {
					const remaining = targetReturn - sumFixedReturn;
					const perDetail = remaining / eligibleBacks.length;
					for (const d of eligibleBacks) {
						const stake = Math.max(0, perDetail / d.oddsTotalNet);
						setStake(d.$stakeCell, stake);
						d.stake = stake;
					}
				}

				// Recalcule les agrégats de l'issue après mise à jour des mises
				let nsi = 0, nrw = 0, nrl = 0;
				for (const d of it.details) {
					if (!d.hasValue) continue;
					if (d.isLay) {
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

	// Engagement Lay = mise × (cote_brute − 1) pour TOUS les détails Lay (y compris
	// les détails Fixe ou mono-détail ignorés par la redistribution).
	for (const issue of issues) {
		for (const d of issue.details) {
			if (!d.isLay || !d.hasValue || d.oddsTotal <= 1) continue;
			const newEng = d.stake * (d.oddsTotal - 1);
			setLiability(d.$stakeCell, newEng);
			d.engagement = newEng;
		}
		// Re-agrège les indicateurs par issue après mise à jour des engagements
		let nsi = 0, nrw = 0, nrl = 0;
		for (const d of issue.details) {
			if (!d.hasValue) continue;
			if (d.isLay) {
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
		if (issue.details.length === 1 && issue.details[0].hasValue) {
			const d = issue.details[0];
			if (d.isLay && d.oddsTotal > 1) {
				issue.effectiveOddsNet = d.layReturnFactor / (d.oddsTotal - 1);
			} else {
				issue.effectiveOddsNet = d.oddsTotalNet;
			}
		} else {
			issue.effectiveOddsNet = nsi > 0 ? nrw / nsi : 0;
		}
	}

	// Recalcule sumInvested global après redistribution
	let sumInvestedAll = 0;
	for (const it of issues) sumInvestedAll += it.sumInvested;

	// Affichage Profit par détail + agrégation issue dans la même colonne
	for (const issue of issues) {
		const validDetails = issue.details.filter(d => d.hasValue && d.stake);
		let sumProfitDetails = 0;
		issue.details.forEach((d, idx) => {
			if (!d.$profitCell || !d.$profitCell.length) return;
			if (!d.hasValue || !d.stake) {
				d.$profitCell.text("—");
				return;
			}
			// Per-detail profit = retour quand cette ligne gagne
			const profit = d.isLay ? d.stake : d.oddsTotalNet * d.stake;
			sumProfitDetails += profit;
			let html = profit.toFixed(DEC).replace(".", ",") + " €";
			// Sur le dernier détail valide : afficher la somme issue (uniquement si >1 détails)
			if (issue.details.length > 1 && idx === issue.details.length - 1 && validDetails.length > 1) {
				html += `<span class="profit-issue-sum">Σ issue : ${sumProfitDetails.toFixed(DEC).replace(".", ",")} €</span>`;
			}
			d.$profitCell.html(html);
		});

		// Profit total de l'issue (cellule unique span K) :
		// P/L quand cette issue se réalise.
		if (issue.$profitTotal && issue.$profitTotal.length) {
			if (!issue.hasValue) {
				issue.$profitTotal.text("—");
			} else {
				// Retour brut quand cette issue se réalise =
				//   Σ retours de ses détails (Back : stake × oddsNet ; Lay : 0)
				// + Σ retours des autres issues quand cette issue se réalise = Σ (autres détails Lay : stake + engagement ; autres détails Back : 0)
				let returnWhenIssueWins = issue.returnIfIssueWins;
				for (const other of issues) {
					if (other === issue) continue;
					returnWhenIssueWins += other.returnIfIssueLoses;
				}
				const profitTotal = returnWhenIssueWins - sumInvestedAll;
				issue.$profitTotal.text(profitTotal.toFixed(DEC).replace(".", ",") + " €");
			}
		}
	}
	if ($totalProfitTotal && $totalProfitTotal.length) {
		if (K !== null && S !== null) $totalProfitTotal.text((K - sumInvestedAll).toFixed(DEC).replace(".", ",") + " €");
		else $totalProfitTotal.text("—");
	}

	// Bannière d'erreur
	const $err = $("#sb-error");
	if (errorMsg) { $err.text(errorMsg).prop("hidden", false); }
	else { $err.prop("hidden", true).text(""); }

	// Couleur selon le TRJ — uniquement sur TRJ et profits totaux des issues distribuées
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

/* ---------- Bindings ---------- */

function bindOddsInputs() {
	const $grid = $("#surebet-grid");
	$grid.on("input cote:changed", "[data-odds] input:not(.commission-input)", () => recomputeAll(true));
	$grid.on("input cote:changed", ".commission-input", () => recomputeAll(true));
	$grid.on("blur", ".commission-input", function () {
		const v = Number(String(this.value).replace(",", "."));
		if (!Number.isNaN(v) && v === 0) this.value = "";
	});
	$grid.on("input cote:changed", "[data-stake] input", function () {
		const $cell = $(this).closest("[data-stake]");
		const issueId = $cell.attr("data-issueid");
		const detailId = $cell.attr("data-detailid");

		// Ligne Total
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

		// Cellule de détail
		const isIssueFixed = $grid.find(`[data-issuefixe][data-issueid="${issueId}"] .radio.fixe`).is(":checked");
		const k = $grid.find(`[data-type][data-issueid="${issueId}"]`).length;
		if (k === 1) {
			// Mono-détail : redistribue uniquement si l'issue est Fixe
			recomputeAll(isIssueFixed);
		} else {
			// Multi-détail : redistribue si l'issue est Fixe OU si ce détail est Fixe détail
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
		// Si une fixe issue change, propage aux détails
		if ($(this).hasClass("fixe")) {
			$grid.find("[data-issuefixe]").each(function () {
				const id = $(this).attr("data-issueid");
				if (id) syncFixeIssueToDetails(id);
			});
		}
		recomputeAll(true);
	});
	// Changement de "Fixe détail" : on redistribue pour répartir le solde restant
	// entre les autres détails de l'issue.
	$grid.on("change", ".check.fixe-detail", function () {
		recomputeAll(true);
	});
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

function collectDebugState() {
	const $grid = $("#surebet-grid");
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
		_meta: {
			timestamp: new Date().toISOString(),
			version: window.CURRENT_VERSION || "?",
			utility: "calc-couverture",
		},
		global: {
			commissionEnabled: $("#commission-enabled").is(":checked"),
			commissionDefault: ($("#commission-default").val() || "").toString(),
			detailsEnabled: $("#details-enabled").is(":checked"),
			hasMultiDetails: $grid.hasClass("has-multi-details"),
		},
		grid: {
			nbOddsCols: Number($grid.attr("data-odds-cols")),
			columns: colsOrdered,
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

/* ---------- Initialisation ---------- */

$(function () {
	applyGridTemplate($("#surebet-grid"));
	hydrate();
	renumberColumnHeaders();

	addOddsColumn();
	addIssue();
	addIssue();

	bindOddsInputs();
	recomputeAll();

	$("#add-col").on("click", addOddsColumn);
	$("#add-row").on("click", addIssue);

	// Suppression issue
	$("#surebet-grid").on("click", ".js-del-issue", function () {
		const issueId = $(this).closest("[data-actions]").attr("data-issueid");
		if (!issueId) return;
		const $label = $(`#surebet-grid [data-issuelabel][data-issueid="${issueId}"]`);
		deleteIssue($label);
	});

	// Suppression colonne
	$("#surebet-grid").on("click", ".js-del-col", function () {
		const idx = Number($(this).closest("[data-oddshead]").attr("data-col"));
		removeOddsColumnAt(idx);
	});

	// Ajout détail
	$("#surebet-grid").on("click", ".js-add-detail", function () {
		const issueId = $(this).closest("[data-actions]").attr("data-issueid");
		if (!issueId) return;
		addDetail(issueId);
	});

	// Suppression détail
	$("#surebet-grid").on("click", ".js-del-detail", function () {
		const issueId = $(this).attr("data-issueid");
		const detailId = $(this).attr("data-detailid");
		if (!issueId || !detailId) return;
		removeDetail(issueId, detailId);
	});

	// Bascule Back / Lay sur le bouton flip (par détail)
	$("#surebet-grid").on("click", ".type-toggle", function () {
		const $btn = $(this);
		const newMode = $btn.attr("data-mode") === "back" ? "lay" : "back";
		$btn.attr("data-mode", newMode);
		const $typeCell = $btn.closest("[data-type]");
		const issueId = $typeCell.attr("data-issueid");
		const detailId = $typeCell.attr("data-detailid");
		const $stakeCell = $("#surebet-grid").find(`[data-stake][data-issueid="${issueId}"][data-detailid="${detailId}"]`);
		const $oddsTotalCell = $("#surebet-grid").find(`[data-odds-total][data-issueid="${issueId}"][data-detailid="${detailId}"]`);
		if ($stakeCell.length) $stakeCell.toggleClass("lay-mode", newMode === "lay");

		const $commInputs = $("#surebet-grid").find(`[data-odds][data-issueid="${issueId}"][data-detailid="${detailId}"] .commission-input`);
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

	if (window.lucide) lucide.createIcons();

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

	// ===== Paramètre global : "Détails issues" (localStorage) =====
	(function () {
		const KEY_ON = "calcCouv.detailsEnabled";
		const $enabled = $("#details-enabled");

		function applyDetailsVisibility() {
			const on = $enabled.is(":checked");
			$("#surebet-grid").toggleClass("with-details", on);
		}

		$enabled.prop("checked", localStorage.getItem(KEY_ON) === "true");
		applyDetailsVisibility();

		$enabled.on("change", function () {
			localStorage.setItem(KEY_ON, String($(this).is(":checked")));
			applyDetailsVisibility();
		});
	})();
});

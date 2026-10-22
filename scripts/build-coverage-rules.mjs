#!/usr/bin/env node
// Génère assets/coverage-rules.json à partir de assets/coverage-rules-src/ :
//   - equivalences.json : issues nommées ("1", "X2"…) → paris Back équivalents + complément
//   - rules.json        : règles. Une entrée { "sides": [...] } est développée ; toute autre
//                         entrée (regex, templates…) est recopiée telle quelle.
// Un côté est soit un nom d'issue, soit un pari brut "Marché|Issue".
// Alternatives d'un côté = Back de ses paris + Lay des paris de son complément
// (complément déclaré, et en 2 issues l'autre côté).
//
//   node scripts/build-coverage-rules.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = resolve(root, 'assets/coverage-rules-src');
const outFile = resolve(root, 'assets/coverage-rules.json');

const equivalences = JSON.parse(readFileSync(resolve(srcDir, 'equivalences.json'), 'utf8'));
const rules = JSON.parse(readFileSync(resolve(srcDir, 'rules.json'), 'utf8'));
const SIDE_KEYS = ['A', 'B', 'C', 'D', 'E'];

const fail = msg => { throw new Error(`coverage-rules : ${msg}`); };

function parseBet(str) {
	const i = str.indexOf('|');
	const market = str.slice(0, i).trim(), issue = str.slice(i + 1).trim();
	if (i < 0 || !market || !issue) fail(`pari "${str}" invalide (attendu "Marché|Issue")`);
	return { market, issue };
}

for (const [name, eq] of Object.entries(equivalences)) {
	if (name.includes('|')) fail(`le nom d'issue "${name}" ne doit pas contenir "|"`);
	if (!Array.isArray(eq.bets) || !eq.bets.length) fail(`l'issue "${name}" n'a aucun pari`);
	eq.bets.forEach(parseBet);
	if (eq.complement !== undefined) {
		const c = equivalences[eq.complement];
		if (!c) fail(`complément "${eq.complement}" de "${name}" inconnu`);
		if (c.complement !== name) fail(`complément non réciproque : "${name}" → "${eq.complement}" → "${c.complement}"`);
	}
}

const isNamed = side => !side.includes('|');

function backBets(side) {
	if (!isNamed(side)) return [parseBet(side)];
	const eq = equivalences[side];
	if (!eq) fail(`issue "${side}" inconnue (ni dans equivalences.json, ni au format "Marché|Issue")`);
	return eq.bets.map(parseBet);
}

function expand(rule, idx) {
	const { sides } = rule;
	if (!Array.isArray(sides) || sides.length < 2 || sides.length > SIDE_KEYS.length)
		fail(`règle n°${idx} : "sides" doit contenir 2 à ${SIDE_KEYS.length} issues`);
	const out = { issues: sides.length };
	sides.forEach((side, i) => {
		const declared = isNamed(side) ? equivalences[side]?.complement : undefined;
		const complement = [];
		if (declared !== undefined) complement.push(...backBets(declared));
		if (sides.length === 2) {
			const other = sides[1 - i];
			const otherBets = backBets(other);
			if (declared !== undefined && isNamed(other) && other !== declared)
				fail(`règle n°${idx} : "${side}" a pour complément "${declared}", pas "${other}"`);
			complement.push(...otherBets);
		}
		const seen = new Set();
		out[SIDE_KEYS[i]] = [
			...backBets(side).map(b => ({ ...b, betType: 'Back' })),
			...complement.map(b => ({ ...b, betType: 'Lay' })),
		].filter(b => {
			const k = `${b.betType}|${b.market}|${b.issue}`;
			return !seen.has(k) && seen.add(k);
		});
	});
	return out;
}

const generated = rules.map((r, i) => (r.sides ? expand(r, i) : r));

// Même mise en forme que le fichier écrit à la main : un pari par ligne.
const alt = a => `{ "market": ${JSON.stringify(a.market)}, "issue": ${JSON.stringify(a.issue)}, "betType": ${JSON.stringify(a.betType)} }`;
const text = '[\n' + generated.map(r => {
	const sides = SIDE_KEYS.filter(k => r[k]).map(k =>
		`\t\t"${k}": [\n${r[k].map(a => `\t\t\t${alt(a)}`).join(',\n')}\n\t\t]`);
	return `\t{\n\t\t"issues": ${r.issues},\n${sides.join(',\n')}\n\t}`;
}).join(',\n') + '\n]\n';

writeFileSync(outFile, text);
console.log(`coverage-rules.json généré : ${generated.length} règles (${rules.filter(r => r.sides).length} développées).`);

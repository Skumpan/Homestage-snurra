// Test av prisberäkningen i Berakning.gs. Kör: node tests/berakning.test.js
// Alla förväntade belopp är handräknade (inte hämtade från koden).
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const kod = fs.readFileSync(path.join(__dirname, '..', 'Berakning.gs'), 'utf8');
const ctx = vm.createContext({});
vm.runInContext(kod, ctx);
const B = vm.runInContext('skapaBerakning()', ctx);

const RADATA = {
  nivaer: { kvm_pris: [250, 300, 350], minimipris: [10000, 14000, 18000], extra_zon: [1500, 2500, 4000] },
  ovrigt: { extra_utezon: 1000, uteyta_kvm_pris_over: 225, zoner_over_sista: 7, refresh_timpris: 995,
            refresh_min_timmar: 2, forlangning_procent_vecka: 10, inkluderade_veckor: 6 },
  zonintervall: [[50, 3], [75, 4], [100, 5], [130, 6]],
  uteyta: [[6, 2000], [20, 4500]]
};
const kopia = (o) => JSON.parse(JSON.stringify(o));
const kp = B.kontrolleraPriser(kopia(RADATA));
if (!kp.ok) { console.error('Standardpriser underkändes: ' + kp.fel.join('; ')); process.exit(1); }
const P = kp.priser;

let ok = 0, fel = 0;
function test(namn, fn) {
  try { fn(); ok++; console.log('GODKÄNT   ' + namn); }
  catch (e) { fel++; console.log('UNDERKÄNT ' + namn + '\n          ' + e.message); }
}
function lika(faktiskt, forvantat, text) {
  if (faktiskt !== forvantat) throw new Error((text || '') + ' förväntat ' + JSON.stringify(forvantat) + ', fick ' + JSON.stringify(faktiskt));
}
function sant(v, text) { if (!v) throw new Error(text || 'förväntat sant'); }

function inm(o) {
  return Object.assign({ niva: 'light', yta: 60, zoner: 3, uteyta: null, utezoner: 0, logistik: null,
    refreshValt: false, refreshTimmar: null, forlangVisa: false, rabattTyp: null, rabattVarde: null,
    extraposter: [], manuellOffert: false, accepteradJustering: null }, o);
}
function rad(r, id) { return r.rader.filter((x) => x.id === id)[0]; }
function total(o) { const r = B.berakna(P, inm(o)); if (r.fel.length) throw new Error('oväntat fel: ' + r.fel.join('; ')); return r.total; }
function harFel(o) { const r = B.berakna(P, inm(o)); sant(r.fel.length > 0, 'förväntade fel men fick inget'); return r; }

// ---- Grundpris och minimipris ----
test('Grundpris = yta x kvm-pris (Light 60 kvm = 15 000)', () => lika(total({ yta: 60 }), 15000));
test('Minimipris gäller under gränsen (Light 20 kvm = 10 000)', () => lika(total({ yta: 20, zoner: 3 }), 10000));
test('Light 40 kvm = exakt minimipris 10 000', () => lika(total({ yta: 40 }), 10000));
test('Light 41 kvm = 10 250 (precis över minimipris)', () => lika(total({ yta: 41 }), 10250));
test('Komp 46,5 kvm: 13 950 < minimum 14 000', () => lika(total({ niva: 'komp', yta: 46.5 }), 14000));
test('Komp 47 kvm = 14 100', () => lika(total({ niva: 'komp', yta: 47 }), 14100));
test('Full 51 kvm: 17 850 < minimum 18 000', () => lika(total({ niva: 'full', yta: 51, zoner: 3 }), 18000));
test('Full 52 kvm = 18 200', () => lika(total({ niva: 'full', yta: 52, zoner: 4 }), 18200));
test('1 kvm ger minimipris', () => lika(total({ yta: 1, zoner: 3 }), 10000));

// ---- Zongränser (upp till och med) ----
test('Inkluderade zoner vid gränserna', () => {
  const f = [[1, 3], [50, 3], [50.1, 4], [75, 4], [75.1, 5], [100, 5], [100.1, 6], [130, 6], [130.1, 7], [131, 7], [500, 7]];
  f.forEach((x) => lika(B.ingaendeZoner(P, x[0]), x[1], x[0] + ' kvm:'));
});
test('Extra zoner x tillägg (Light 60 kvm, 6 zoner: 15 000 + 2x1 500)', () => lika(total({ yta: 60, zoner: 6 }), 18000));
test('Zoner = ingående ger inget tillägg (Full 130 kvm, 6 zoner = 45 500)', () => lika(total({ niva: 'full', yta: 130, zoner: 6 }), 45500));
test('131 kvm har 7 zoner inkluderade, 8 zoner = ett extra (Full: 45 850 + 4 000)', () => lika(total({ niva: 'full', yta: 131, zoner: 8 }), 49850));
test('Komp 200 kvm, 9 zoner: 60 000 + 2x2 500', () => lika(total({ niva: 'komp', yta: 200, zoner: 9 }), 65000));

// ---- Uteyta ----
const ute = (u, z) => total({ uteyta: u, utezoner: z === undefined ? 1 : z }) - 15000;
test('Uteyta 0,1 och 6 kvm = 2 000', () => { lika(ute(0.1), 2000); lika(ute(6), 2000); });
test('Uteyta 6,1 och 20 kvm = 4 500', () => { lika(ute(6.1), 4500); lika(ute(20), 4500); });
test('Uteyta 30 kvm = 4 500 + 10x225 = 6 750', () => lika(ute(30), 6750));
test('Uteyta 20,1 kvm = 4 500 + 22,5 avrundat upp = 4 523', () => lika(ute(20.1), 4523));
test('Extra utezoner: 3 utezoner = 2 x 1 000 extra', () => lika(ute(10, 3), 4500 + 2000));
test('En utezon ingår (ingen extra kostnad)', () => lika(ute(10, 1), 4500));

// ---- Refresh ----
test('Refresh minst 2 tim (1 tim = 1 990)', () => lika(total({ refreshValt: true, refreshTimmar: 1 }) - 15000, 1990));
test('Refresh 3 tim = 2 985', () => lika(total({ refreshValt: true, refreshTimmar: 3 }) - 15000, 2985));
test('Refresh 2,5 tim = 2 487,5 avrundat till 2 488', () => lika(total({ refreshValt: true, refreshTimmar: 2.5 }) - 15000, 2488));
test('Refresh utan antal timmar ger "kräver bedömning", ingen total', () => {
  const r = B.berakna(P, inm({ refreshValt: true, refreshTimmar: null }));
  lika(r.total, null); sant(r.preliminar); lika(r.saknas.length, 1);
});
test('Refresh i fel steg (0,3 tim) och 0 tim ger fel', () => { harFel({ refreshValt: true, refreshTimmar: 0.3 }); harFel({ refreshValt: true, refreshTimmar: 0 }); });

// ---- Rabatt ----
test('Procentrabatt 10 % på hela summan inkl. uteyta (19 500 -> 17 550)', () =>
  lika(total({ uteyta: 10, utezoner: 1, rabattTyp: 'procent', rabattVarde: 10 }), 17550));
test('Procentrabatt gäller även logistik, refresh och extraposter', () =>
  lika(total({ logistik: 1000, refreshValt: true, refreshTimmar: 2, extraposter: [{ text: 'Nyckel', pris: 500 }], rabattTyp: 'procent', rabattVarde: 50 }),
    (15000 + 1000 + 1990 + 500) / 2));
test('Procentrabatt avrundas (12 625 x 10 % = 1 262,5 -> 1 263)', () =>
  lika(total({ yta: 50.5, rabattTyp: 'procent', rabattVarde: 10 }), 12625 - 1263));
test('100 % rabatt ger 0, 100,1 % ger fel, 0 % ger fel', () => {
  lika(total({ rabattTyp: 'procent', rabattVarde: 100 }), 0);
  harFel({ rabattTyp: 'procent', rabattVarde: 100.1 }); harFel({ rabattTyp: 'procent', rabattVarde: 0 });
});
test('Fast rabatt 2 000 dras från totalen', () => lika(total({ rabattTyp: 'belopp', rabattVarde: 2000 }), 13000));
test('Fast rabatt lika med summan ger 0', () => lika(total({ rabattTyp: 'belopp', rabattVarde: 15000 }), 0));
test('Fast rabatt över summan ger fel', () => {
  const r = B.berakna(P, inm({ rabattTyp: 'belopp', rabattVarde: 15001 }));
  sant(r.fel.length > 0, 'inget fel'); lika(r.total, null);
});
test('Fast rabatt 0 eller negativ ger fel', () => { harFel({ rabattTyp: 'belopp', rabattVarde: 0 }); harFel({ rabattTyp: 'belopp', rabattVarde: -5 }); });

// ---- Förlängning ----
test('Förlängning = 10 % av stagingunderlaget före rabatt, ingår inte i totalen', () => {
  const r = B.berakna(P, inm({ uteyta: 10, utezoner: 1, forlangVisa: true, rabattTyp: 'procent', rabattVarde: 10, logistik: 800 }));
  lika(r.stagingunderlag, 19500); lika(r.forlangning.perVecka, 1950); lika(r.forlangning.veckor, 6);
  lika(r.total, 19500 + 800 - 2030, 'total (rabatt 10 % av hela summan 20 300)');
});
test('Extraposter, logistik och refresh ingår inte i stagingunderlaget', () => {
  const r = B.berakna(P, inm({ forlangVisa: true, logistik: 800, refreshValt: true, refreshTimmar: 2, extraposter: [{ text: 'X', pris: 100 }] }));
  lika(r.stagingunderlag, 15000); lika(r.forlangning.perVecka, 1500);
});
test('Förlängning avrundas (12 625 x 10 % = 1 262,5 -> 1 263)', () =>
  lika(B.berakna(P, inm({ yta: 50.5, forlangVisa: true })).forlangning.perVecka, 1263));
test('Ingen förlängning om den inte begärts', () => lika(B.berakna(P, inm({})).forlangning, null));

// ---- Gränshopp ----
test('Gränshoppsvarning: Light 51 kvm med 4 zoner (12 750 mot 14 000 vid 50 kvm)', () => {
  const r = B.berakna(P, inm({ yta: 51, zoner: 4 }));
  lika(r.varningar.length, 1); lika(r.gransforslag.forslag, 14000); lika(r.gransforslag.gransYta, 50);
  lika(r.total, 12750, 'varningen ändrar inte priset'); lika(r.justeringTillampad, false);
});
test('Accepterad gränshoppsjustering ger 14 000', () => {
  const nyckel = B.berakna(P, inm({ yta: 51, zoner: 4 })).gransforslag.nyckel;
  lika(total({ yta: 51, zoner: 4, accepteradJustering: nyckel }), 14000);
});
test('Ingen gränshoppsvarning vid 51 kvm med 3 zoner (12 750 är redan över 12 500)', () =>
  lika(B.berakna(P, inm({ yta: 51, zoner: 3 })).varningar.length, 0));
test('Ingen gränshoppsvarning vid exakt 50 kvm', () => lika(B.berakna(P, inm({ yta: 50, zoner: 4 })).varningar.length, 0));

// ---- Extraposter, logistik, flagga ----
test('Extrapost och logistik ingår i totalen', () =>
  lika(total({ logistik: 700, extraposter: [{ text: 'Lampa', pris: 300 }] }), 16000));
test('Helt tom extrapost ignoreras', () => lika(total({ extraposter: [{ text: '', pris: null }, { text: '  ', pris: null }] }), 15000));
test('Extrapost med bara text, bara pris, pris 0 eller över 10 st ger fel', () => {
  harFel({ extraposter: [{ text: 'Lampa', pris: null }] });
  harFel({ extraposter: [{ text: '', pris: 100 }] });
  harFel({ extraposter: [{ text: 'Lampa', pris: 0 }] });
  const m = []; for (let i = 0; i < 11; i++) m.push({ text: 'p' + i, pris: 10 });
  harFel({ extraposter: m });
});
test('Offertflagga ändrar inte priset', () => {
  const r = B.berakna(P, inm({ manuellOffert: true })); lika(r.flaggad, true); lika(r.total, 15000);
});

// ---- Felaktig inmatning ----
test('Negativ yta ger fel', () => harFel({ yta: -5 }));
test('Negativ uteyta ger fel', () => harFel({ uteyta: -1, utezoner: 1 }));
test('Uteyta utan utezon ger fel', () => harFel({ uteyta: 10, utezoner: 0 }));
test('Utezon utan uteyta ger fel', () => harFel({ uteyta: null, utezoner: 1 }));
test('Två decimaler i yta ger fel, en decimal går bra', () => { harFel({ yta: 50.55 }); lika(total({ yta: 50.5 }), 12625); });
test('0 eller bråkdel som antal zoner ger fel', () => { harFel({ zoner: 0 }); harFel({ zoner: 2.5 }); });
test('Ingen nivå vald ger fel', () => harFel({ niva: null }));
test('Negativ logistik ger fel', () => harFel({ logistik: -1 }));
test('Utan yta men med logistik: ingen stagingdel och inget fel', () => {
  const r = B.berakna(P, inm({ yta: null, logistik: 500 })); lika(r.fel.length, 0); lika(r.total, 500); lika(r.stagingunderlag, null);
});

// ---- Tal, kommatecken, formatering ----
test('tal() tolkar komma, mellanslag och "kr"', () => {
  lika(B.tal('12,5'), 12.5); lika(B.tal('10 000'), 10000); lika(B.tal('995 kr'), 995); lika(B.tal('7'), 7);
  sant(isNaN(B.tal('')), 'tom'); sant(isNaN(B.tal('abc')), 'text'); sant(isNaN(B.tal(null)), 'null');
});
test('normalisera tolkar "50,5" och räknar rätt', () => {
  const n = B.normalisera({ niva: 'light', yta: '50,5', zoner: '3', utezoner: '', extraposter: [{ text: 'a', pris: '1 000' }] });
  lika(n.yta, 50.5); lika(n.zoner, 3); lika(n.extraposter[0].pris, 1000);
  lika(B.berakna(P, n).total, 12625 + 1000);
});
test('normalisera: ogiltig nivå blir null, extraposter begränsas till 20', () => {
  lika(B.normalisera({ niva: 'hacka' }).niva, null);
  const m = []; for (let i = 0; i < 30; i++) m.push({ text: 'a', pris: 1 });
  lika(B.normalisera({ extraposter: m }).extraposter.length, 20);
});
test('kr() och decimal()', () => {
  // kr() använder hårt mellanslag (U+00A0) som tusentalsavgränsare, så att beloppet inte radbryts
  const k = (n) => B.kr(n).replace(/\u00a0/g, ' ');
  lika(k(12500), '12 500'); lika(k(999), '999'); lika(k(1234567), '1 234 567'); lika(k(0), '0');
  lika(B.decimal(50.5), '50,5'); lika(B.decimal(50), '50');
});

// ---- Kontroll av prisark ----
function kpMed(andra) { const r = kopia(RADATA); andra(r); return B.kontrolleraPriser(r); }
test('Korrekt prisark godkänns', () => sant(B.kontrolleraPriser(kopia(RADATA)).ok));
test('Tomt/saknat prisark ger fel', () => { sant(!B.kontrolleraPriser(null).ok); sant(!B.kontrolleraPriser({}).ok); });
test('Negativt eller 0 kvm-pris ger fel', () => {
  sant(!kpMed((r) => { r.nivaer.kvm_pris[0] = -1; }).ok); sant(!kpMed((r) => { r.nivaer.kvm_pris[1] = 0; }).ok);
});
test('Text i stället för tal ger fel', () => sant(!kpMed((r) => { r.nivaer.minimipris[2] = 'abc'; }).ok));
test('Tom cell ger fel', () => sant(!kpMed((r) => { r.ovrigt.refresh_timpris = ''; }).ok));
test('Saknad rad ger fel', () => sant(!kpMed((r) => { delete r.nivaer.extra_zon; }).ok));
test('Ej stigande zongränser ger fel', () => sant(!kpMed((r) => { r.zonintervall[2][0] = 70; }).ok));
test('Bråkdel som antal zoner ger fel', () => sant(!kpMed((r) => { r.zonintervall[0][1] = 2.5; }).ok));
test('Ej stigande uteytegränser ger fel', () => sant(!kpMed((r) => { r.uteyta[1][0] = 5; }).ok));
test('Tomma zonintervall eller uteyta ger fel', () => {
  sant(!kpMed((r) => { r.zonintervall = []; }).ok); sant(!kpMed((r) => { r.uteyta = []; }).ok);
});
test('Förlängningsprocent 0 eller över 100 ger fel', () => {
  sant(!kpMed((r) => { r.ovrigt.forlangning_procent_vecka = 0; }).ok); sant(!kpMed((r) => { r.ovrigt.forlangning_procent_vecka = 101; }).ok);
});
test('Priser som skrivits med komma och "kr" godkänns', () => {
  const r = kpMed((x) => { x.nivaer.kvm_pris[0] = '250 kr'; x.ovrigt.uteyta_kvm_pris_over = '225,5'; });
  sant(r.ok); lika(r.priser.ovrigt.uteyta_kvm_pris_over, 225.5);
});

// ---- Mejl ----
test('byggMejl kräver adress', () => {
  sant(B.byggMejl(P, inm({}), '', '2026-01-01').fel); sant(B.byggMejl(P, inm({}), '   ', '2026-01-01').fel);
});
test('byggMejl kräver nivå', () => sant(B.byggMejl(P, inm({ niva: null }), 'Storgatan 1', 'd').fel));
test('byggMejl vid felaktig inmatning ger fel', () => sant(B.byggMejl(P, inm({ yta: -3 }), 'Storgatan 1', 'd').fel));
test('byggMejl utan innehåll ger fel', () => sant(B.byggMejl(P, inm({ yta: null }), 'Storgatan 1', 'd').fel));
test('byggMejl innehåller adress, vald nivå och de två andra nivåerna med rätt pris', () => {
  const m = B.byggMejl(P, inm({ niva: 'komp', yta: 60, zoner: 3 }), 'Storgatan 1', '2026-01-01');
  sant(!m.fel, 'fel');
  m.text = m.text.replace(/\u00a0/g, ' ');
  ['Storgatan 1', 'Light staging (ej vald)', 'Full staging (ej vald)', 'Kompletterande staging'].forEach((s) => {
    sant(m.text.indexOf(s) >= 0, 'text saknar ' + s); sant(m.html.indexOf(s) >= 0, 'html saknar ' + s);
  });
  sant(m.text.indexOf('TOTALT: 18 000 kr') >= 0, 'komp 60 kvm = 18 000');
  sant(m.text.indexOf('TOTALT: 15 000 kr') >= 0, 'light 60 kvm = 15 000');
  sant(m.text.indexOf('TOTALT: 21 000 kr') >= 0, 'full 60 kvm = 21 000');
});
test('Övriga nivåer i mejlet visas utan rabatt', () => {
  const m = B.byggMejl(P, inm({ niva: 'light', rabattTyp: 'belopp', rabattVarde: 1000 }), 'A 1', 'd');
  lika(m.vald.total, 14000); lika(m.ovriga[0].res.total, 18000); lika(m.ovriga[1].res.total, 21000);
});
test('Adress med specialtecken skyddas i html', () => {
  const m = B.byggMejl(P, inm({}), '<b>x</b> & "y"', 'd');
  sant(m.html.indexOf('<b>x</b>') < 0 && m.html.indexOf('&lt;b&gt;') >= 0, 'ej skyddad');
});
test('Offertflagga syns i mejlet', () => sant(B.byggMejl(P, inm({ manuellOffert: true }), 'A 1', 'd').text.indexOf('FLAGGAD') >= 0));

console.log('\n' + ok + ' godkända, ' + fel + ' underkända (' + (ok + fel) + ' tester)');
process.exit(fel ? 1 : 0);

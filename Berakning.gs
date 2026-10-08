/**
 * Beräkningslogik för räknesnurran (homestaging).
 *
 * All logik ligger i skapaBerakning() så att exakt samma kod körs
 * på servern (kontroll av prisarket) och i räknesidan (beräkning).
 * Räknesidan får koden via berakningskod() i Kod.gs.
 *
 * Inga belopp eller gränser finns här. Allt kommer från prisarket.
 */
function skapaBerakning() {
  var NIVAER = ['light', 'komp', 'full'];
  var NIVANAMN = { light: 'Light staging', komp: 'Kompletterande staging', full: 'Full staging' };
  var EPS = 1e-9;

  // ---------- Hjälpfunktioner ----------

  /** Tolkar ett värde som tal. Klarar "10 000", "12,5" och "995 kr". Tomt ger NaN. */
  function tal(v) {
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    if (v === null || v === undefined) return NaN;
    var s = String(v).replace(/[\s  ]/g, '').replace(/kr$/i, '').replace(',', '.');
    if (s === '') return NaN;
    var n = Number(s);
    return isFinite(n) ? n : NaN;
  }

  function arTal(v) { return typeof v === 'number' && isFinite(v); }
  function arHeltal(v) { return arTal(v) && Math.abs(v - Math.round(v)) < EPS; }
  function arHalvtimme(v) { return arTal(v) && Math.abs(v * 2 - Math.round(v * 2)) < EPS; }
  function enDecimal(v) { return arTal(v) && Math.abs(v * 10 - Math.round(v * 10)) < EPS; }

  /** Avrundning till hela kronor (gränsfall 3). */
  function avrunda(x) { return Math.round(x + EPS); }

  /** 12500 -> "12 500" */
  function kr(n) {
    var neg = n < 0;
    var s = String(Math.abs(Math.round(n)));
    var ut = '';
    while (s.length > 3) { ut = ' ' + s.slice(-3) + ut; s = s.slice(0, -3); }
    return (neg ? '−' : '') + s + ut;
  }

  /** 50.5 -> "50,5" */
  function decimal(n) {
    return String(Math.round(n * 10) / 10).replace('.', ',');
  }

  // ---------- Kontroll av prisarket ----------

  /**
   * Tar emot rådata från prisarket och returnerar { ok, fel, priser }.
   * radata = {
   *   nivaer: { kvm_pris: [L, K, F], minimipris: [...], extra_zon: [...] },
   *   ovrigt: { extra_utezon, refresh_timpris, refresh_min_timmar, forlangning_procent_vecka, inkluderade_veckor },
   *   zonintervall: [[grans, zoner], ...],
   *   uteyta: [[grans, tillagg], ...]
   * }
   */
  function kontrolleraPriser(radata) {
    var fel = [];
    var p = { nivaer: {}, zonintervall: [], uteyta: [], ovrigt: {} };
    radata = radata || {};
    var niv = radata.nivaer || {};

    var nivaNycklar = [
      { nyckel: 'kvm_pris', namn: 'Pris per kvm', min: 0, strikt: true },
      { nyckel: 'minimipris', namn: 'Minimipris', min: 0, strikt: false },
      { nyckel: 'extra_zon', namn: 'Extra stagingzon', min: 0, strikt: false }
    ];
    NIVAER.forEach(function (n) { p.nivaer[n] = {}; });
    nivaNycklar.forEach(function (d) {
      var rad = niv[d.nyckel];
      if (!rad) { fel.push('Fliken "Nivåer": raden "' + d.nyckel + '" saknas.'); return; }
      NIVAER.forEach(function (n, i) {
        var v = tal(rad[i]);
        if (!arTal(v)) fel.push('Fliken "Nivåer": ' + d.namn + ' för ' + NIVANAMN[n] + ' saknas eller är inte ett tal.');
        else if (d.strikt ? v <= d.min : v < d.min) fel.push('Fliken "Nivåer": ' + d.namn + ' för ' + NIVANAMN[n] + ' är orimligt (' + rad[i] + ').');
        else p.nivaer[n][d.nyckel] = v;
      });
    });

    var ovr = radata.ovrigt || {};
    var ovrigtKrav = [
      { nyckel: 'extra_utezon', namn: 'Extra utezon', ok: function (v) { return v >= 0; } },
      { nyckel: 'uteyta_kvm_pris_over', namn: 'Kvm-pris för uteyta över sista nivån', ok: function (v) { return v >= 0; } },
      { nyckel: 'zoner_over_sista', namn: 'Zoner som ingår över sista zonintervallet', ok: function (v) { return v >= 1 && arHeltal(v); } },
      { nyckel: 'refresh_timpris', namn: 'Timpris refresh', ok: function (v) { return v > 0; } },
      { nyckel: 'refresh_min_timmar', namn: 'Minimitid refresh', ok: function (v) { return v >= 0 && arHalvtimme(v); } },
      { nyckel: 'forlangning_procent_vecka', namn: 'Förlängningsprocent per vecka', ok: function (v) { return v > 0 && v <= 100; } },
      { nyckel: 'inkluderade_veckor', namn: 'Inkluderade veckor', ok: function (v) { return v > 0 && arHeltal(v); } }
    ];
    ovrigtKrav.forEach(function (d) {
      var v = tal(ovr[d.nyckel]);
      if (!arTal(v)) fel.push('Fliken "Övrigt": ' + d.namn + ' (' + d.nyckel + ') saknas eller är inte ett tal.');
      else if (!d.ok(v)) fel.push('Fliken "Övrigt": ' + d.namn + ' är orimligt (' + ovr[d.nyckel] + ').');
      else p.ovrigt[d.nyckel] = v;
    });

    var zi = radata.zonintervall || [];
    if (!zi.length) fel.push('Fliken "Zonintervall" saknar intervall.');
    var forra = 0;
    zi.forEach(function (r, i) {
      var g = tal(r[0]), z = tal(r[1]);
      if (!arTal(g) || !arTal(z)) { fel.push('Fliken "Zonintervall", rad ' + (i + 2) + ': värde saknas eller är inte ett tal.'); return; }
      if (g <= forra) fel.push('Fliken "Zonintervall", rad ' + (i + 2) + ': gränserna måste vara stigande.');
      if (!arHeltal(z) || z < 1) fel.push('Fliken "Zonintervall", rad ' + (i + 2) + ': antal zoner måste vara ett heltal, minst 1.');
      forra = g;
      p.zonintervall.push({ grans: g, zoner: z });
    });

    var ut = radata.uteyta || [];
    if (!ut.length) fel.push('Fliken "Uteyta" saknar nivåer.');
    forra = 0;
    ut.forEach(function (r, i) {
      var g = tal(r[0]), t = tal(r[1]);
      if (!arTal(g) || !arTal(t)) { fel.push('Fliken "Uteyta", rad ' + (i + 2) + ': värde saknas eller är inte ett tal.'); return; }
      if (g <= forra) fel.push('Fliken "Uteyta", rad ' + (i + 2) + ': gränserna måste vara stigande.');
      if (t < 0) fel.push('Fliken "Uteyta", rad ' + (i + 2) + ': tillägget kan inte vara negativt.');
      forra = g;
      p.uteyta.push({ grans: g, tillagg: t });
    });

    return { ok: fel.length === 0, fel: fel, priser: fel.length ? null : p };
  }

  // ---------- Regler ----------

  /** Antal zoner som ingår vid en yta. Gränser är "upp till och med". Över sista intervallet gäller zoner_over_sista. */
  function ingaendeZoner(priser, yta) {
    var zi = priser.zonintervall;
    for (var i = 0; i < zi.length; i++) if (yta <= zi[i].grans + EPS) return zi[i].zoner;
    return priser.ovrigt.zoner_over_sista;
  }

  function grundpris(priser, niva, yta) {
    var n = priser.nivaer[niva];
    return avrunda(Math.max(yta * n.kvm_pris, n.minimipris));
  }

  function zontillagg(priser, niva, yta, zoner) {
    var ing = ingaendeZoner(priser, yta);
    return Math.max(0, zoner - ing) * priser.nivaer[niva].extra_zon;
  }

  /** Föreslaget pris vid gränshopp: grundpris + zontillägg vid föregående intervalls övre gräns. */
  function gransforslag(priser, niva, yta, zoner, aktuellt) {
    var forra = null;
    priser.zonintervall.forEach(function (z) { if (z.grans < yta - EPS) forra = z.grans; });
    if (forra === null) return null;
    var forslag = grundpris(priser, niva, forra) + zontillagg(priser, niva, forra, zoner);
    if (forslag <= aktuellt) return null;
    return { gransYta: forra, forslag: forslag, tillagg: forslag - aktuellt };
  }

  function justeringsnyckel(niva, yta, zoner) { return niva + '|' + yta + '|' + zoner; }

  // ---------- Beräkning ----------

  /**
   * in = {
   *   niva: 'light' | 'komp' | 'full',
   *   yta: tal eller null,               // stylad invändig yta
   *   zoner: heltal,                     // totalt antal stagingzoner
   *   uteyta: tal eller null,            // sammanlagd stylad uteyta (0/null = ingen)
   *   utezoner: heltal,
   *   logistik: tal eller null,          // kr inkl. moms
   *   refreshValt: bool, refreshTimmar: tal eller null,
   *   forlangVisa: bool,                 // visa förlängning separat (ingår aldrig i totalen)
   *   rabattTyp: 'procent' | 'belopp' | null, rabattVarde: tal eller null,
   *   extraposter: [{ text, pris }],   // kr inkl. moms, ingår i totalen
   *   manuellOffert: bool,
   *   accepteradJustering: nyckel eller null
   * }
   */
  function berakna(priser, inn) {
    var fel = [];
    var rader = [];
    var varningar = [];
    var res = {
      fel: fel, rader: rader, varningar: varningar,
      gransforslag: null, justeringTillampad: false,
      stagingunderlag: null, stagingKomplett: false,
      delsumma: 0, total: null, saknas: [],
      preliminar: false, flaggad: false,
      ingaendeZoner: null, harInnehall: false, forlangning: null
    };

    var niva = inn.niva;
    if (NIVAER.indexOf(niva) < 0) fel.push('Välj stagingnivå.');
    var yta = arTal(inn.yta) && inn.yta !== 0 ? inn.yta : null;
    var zoner = inn.zoner;
    var uteyta = arTal(inn.uteyta) && inn.uteyta > 0 ? inn.uteyta : 0;
    var utezoner = arTal(inn.utezoner) ? inn.utezoner : 0;
    var logistik = arTal(inn.logistik) ? inn.logistik : 0;

    // Kontroll av inmatning
    if (arTal(inn.yta) && inn.yta < 0) fel.push('Ytan kan inte vara negativ.');
    if (yta !== null && !enDecimal(yta)) fel.push('Ytan kan anges med högst en decimal.');
    if (yta !== null && (!arHeltal(zoner) || zoner < 1)) fel.push('Antal stagingzoner måste vara minst 1.');
    if (arTal(inn.uteyta) && inn.uteyta < 0) fel.push('Uteytan kan inte vara negativ.');
    if (uteyta > 0 && !enDecimal(uteyta)) fel.push('Uteytan kan anges med högst en decimal.');
    if (!arHeltal(utezoner) || utezoner < 0) fel.push('Antal utezoner måste vara ett heltal.');
    if (uteyta > 0 && utezoner < 1) fel.push('Uteyta kräver minst en utezon.');
    if (utezoner > 0 && !(uteyta > 0)) fel.push('Utezoner kräver att uteytan är angiven.');
    if (logistik < 0) fel.push('Logistiktillägget kan inte vara negativt.');
    if (inn.refreshValt && arTal(inn.refreshTimmar) && (inn.refreshTimmar <= 0 || !arHalvtimme(inn.refreshTimmar))) fel.push('Refresh anges i halvtimmar.');
    var rabattTyp = (inn.rabattTyp === 'procent' || inn.rabattTyp === 'belopp') && arTal(inn.rabattVarde) ? inn.rabattTyp : null;
    var rabatt = rabattTyp ? inn.rabattVarde : 0;
    if (rabattTyp === 'procent' && (rabatt <= 0 || rabatt > 100 || !enDecimal(rabatt))) fel.push('Rabatten anges i procent, högst 100 och med högst en decimal.');
    if (rabattTyp === 'belopp' && rabatt <= 0) fel.push('Rabatten måste vara större än 0 kr.');

    // Extraposter: helt tomma rader ignoreras, halvifyllda ger fel
    var extra = [];
    (inn.extraposter || []).forEach(function (e, i) {
      var text = String(e && e.text || '').replace(/\s+/g, ' ').trim();
      var pris = e ? e.pris : null;
      var harPris = arTal(pris);
      if (!text && !harPris) return;
      if (!text) fel.push('Extrapost ' + (i + 1) + ': ange vad posten avser.');
      else if (!harPris) fel.push('Extrapost "' + text + '": ange pris.');
      else if (pris <= 0) fel.push('Extrapost "' + text + '": priset måste vara större än 0 kr.');
      else if (text.length > 80) fel.push('Extrapost ' + (i + 1) + ': texten är för lång.');
      else extra.push({ text: text, pris: pris });
    });
    if (extra.length > 10) fel.push('Högst 10 extraposter.');
    if (fel.length) return res;

    var n = priser.nivaer[niva];
    var stagingDelar = [];  // rader som ingår i stagingunderlaget

    function rad(id, text, belopp, detalj, extra) {
      var r = { id: id, text: text, belopp: belopp, status: belopp === null ? 'bedomning' : 'ok', detalj: detalj || '' };
      if (extra) for (var k in extra) r[k] = extra[k];
      rader.push(r);
      return r;
    }

    // ----- Staging (kräver yta) -----
    if (yta !== null) {
      var gp = grundpris(priser, niva, yta);
      var rakat = avrunda(yta * n.kvm_pris);
      var gpDetalj = decimal(yta) + ' kvm × ' + kr(n.kvm_pris) + ' kr';
      if (gp > rakat) gpDetalj += ' = ' + kr(rakat) + ' kr, minimipris gäller';

      {
        var ing = ingaendeZoner(priser, yta);
        res.ingaendeZoner = ing;
        var zt = zontillagg(priser, niva, yta, zoner);
        var extraZ = Math.max(0, zoner - ing);
        stagingDelar.push(rad('grundpris', 'Grundpris', gp, gpDetalj));
        stagingDelar.push(rad('zoner', 'Extra stagingzoner', zt,
          (extraZ ? extraZ + ' × ' + kr(n.extra_zon) + ' kr' : 'Inga extra') + ' (' + zoner + ' zoner, ' + ing + ' ingår)'));

        var fs = gransforslag(priser, niva, yta, zoner, gp + zt);
        if (fs) {
          fs.nyckel = justeringsnyckel(niva, yta, zoner);
          res.gransforslag = fs;
          if (inn.accepteradJustering === fs.nyckel) {
            res.justeringTillampad = true;
            stagingDelar.push(rad('justering', 'Gränshoppsjustering', fs.tillagg,
              'Till nivån vid ' + decimal(fs.gransYta) + ' kvm med ' + zoner + ' zoner'));
          } else {
            varningar.push({
              typ: 'gransshopp',
              text: 'Vid ' + decimal(yta) + ' kvm ingår ' + ing + ' zoner, mot ' + ingaendeZoner(priser, fs.gransYta) + ' vid ' + decimal(fs.gransYta) +
                ' kvm. Med ' + zoner + ' zoner blir därför grundpris och zoner ' + kr(gp + zt) + ' kr, lägre än ' + kr(fs.forslag) +
                ' kr vid ' + decimal(fs.gransYta) + ' kvm. Föreslaget pris: ' + kr(fs.forslag) + ' kr.'
            });
          }
        }
      }

      // Uteyta
      if (uteyta > 0) {
        var trappa = priser.uteyta;
        var steg = null;
        for (var i = 0; i < trappa.length; i++) if (uteyta <= trappa[i].grans + EPS) { steg = trappa[i]; break; }
        if (!steg) {
          // Över sista nivån: sista nivåns tillägg + kvm-pris för varje kvm därutöver, utan övre gräns
          var sista = trappa[trappa.length - 1], kvmPris = priser.ovrigt.uteyta_kvm_pris_over;
          var over = uteyta - sista.grans;
          stagingDelar.push(rad('uteyta', 'Uteyta', sista.tillagg + avrunda(over * kvmPris),
            decimal(uteyta) + ' kvm: ' + kr(sista.tillagg) + ' kr upp till ' + decimal(sista.grans) + ' kvm + ' + decimal(over) + ' kvm × ' + kr(kvmPris) + ' kr'));
        } else {
          var undre = i > 0 ? trappa[i - 1].grans : 0;
          stagingDelar.push(rad('uteyta', 'Uteyta', steg.tillagg,
            decimal(uteyta) + ' kvm (' + (undre ? 'över ' + decimal(undre) + ' och ' : '') + 'upp till ' + decimal(steg.grans) + ' kvm)'));
        }
        {
          if (utezoner > 1) {
            stagingDelar.push(rad('utezoner', 'Extra utezoner', (utezoner - 1) * priser.ovrigt.extra_utezon,
              (utezoner - 1) + ' × ' + kr(priser.ovrigt.extra_utezon) + ' kr (den första ingår)'));
          }
        }
      }

      var komplett = stagingDelar.every(function (r) { return r.status === 'ok'; });
      res.stagingKomplett = komplett;
      if (komplett) res.stagingunderlag = stagingDelar.reduce(function (s, r) { return s + r.belopp; }, 0);
    }

    // ----- Logistik -----
    if (logistik > 0) rad('logistik', 'Logistiktillägg', avrunda(logistik), 'Bedömt belopp');

    // ----- Visningsrefresh -----
    if (inn.refreshValt) {
      if (!arTal(inn.refreshTimmar)) {
        rad('refresh', 'Visningsrefresh', null, 'Ange antal timmar');
      } else {
        var min = priser.ovrigt.refresh_min_timmar;
        var tim = Math.max(inn.refreshTimmar, min);
        rad('refresh', 'Visningsrefresh', avrunda(tim * priser.ovrigt.refresh_timpris),
          decimal(tim) + ' tim × ' + kr(priser.ovrigt.refresh_timpris) + ' kr' +
          (inn.refreshTimmar < min ? ' (minimitid ' + decimal(min) + ' tim)' : '') + ', dörr till dörr');
      }
    }

    // ----- Extraposter (ingår i totalen, inte i stagingunderlaget) -----
    extra.forEach(function (e, i) { rad('extra' + (i + 1), e.text, avrunda(e.pris), 'Extrapost'); });

    // ----- Rabatt (bara vald nivå, dras från totalen) -----
    var summaFore = 0, allaOk = true;
    rader.forEach(function (r) { if (r.status === 'ok') summaFore += r.belopp; else allaOk = false; });
    var rabattNamn = String(inn.rabattText || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (rabattTyp && rader.length) {
      if (rabattTyp === 'procent') {
        if (allaOk) {
          rad('rabatt', (rabattNamn || 'Rabatt') + ' ' + decimal(rabatt) + ' %', -avrunda(summaFore * rabatt / 100), decimal(rabatt) + ' % av ' + kr(summaFore) + ' kr');
        } else {
          rad('rabatt', (rabattNamn || 'Rabatt') + ' ' + decimal(rabatt) + ' %', null, 'Kräver komplett pris');
        }
      } else {
        if (rabatt > summaFore + EPS) {
          fel.push('Rabatten kan inte vara större än ' + (allaOk ? 'totalen' : 'delsumman') + ' (' + kr(summaFore) + ' kr).');
          rader.length = 0; varningar.length = 0;
          return res;
        }
        rad('rabatt', rabattNamn || 'Rabatt', -avrunda(rabatt), rabattNamn ? 'Rabatt, fast belopp' : 'Fast belopp');
      }
    }

    // ----- Förlängning (separat, ingår aldrig i totalen, före rabatt) -----
    if (inn.forlangVisa && yta !== null) {
      var proc = priser.ovrigt.forlangning_procent_vecka;
      res.forlangning = {
        procent: proc,
        veckor: priser.ovrigt.inkluderade_veckor,
        underlag: res.stagingunderlag,
        perVecka: res.stagingunderlag === null ? null : avrunda(res.stagingunderlag * proc / 100)
      };
    }

    // ----- Summering -----
    res.flaggad = inn.manuellOffert === true;  // offertflagga: påverkar inte priset, syns i mejlet
    res.harInnehall = rader.length > 0;
    rader.forEach(function (r) {
      if (r.status === 'ok') res.delsumma += r.belopp;
      else res.saknas.push(r.text);
    });
    res.total = res.harInnehall && res.saknas.length === 0 ? res.delsumma : null;
    res.preliminar = res.saknas.length > 0;
    return res;
  }

  // ---------- Inmatning från räknesidan ----------

  /** Gör om inmatningen till rätt typer. Servern använder den så att inget okontrollerat räknas. */
  function normalisera(r) {
    r = r || {};
    function num(v) { var x = tal(v); return isNaN(x) ? null : x; }
    return {
      niva: NIVAER.indexOf(r.niva) >= 0 ? r.niva : null,
      yta: num(r.yta),
      zoner: num(r.zoner),
      uteyta: num(r.uteyta),
      utezoner: num(r.utezoner) || 0,
      logistik: num(r.logistik),
      refreshValt: r.refreshValt === true,
      refreshTimmar: num(r.refreshTimmar),
      forlangVisa: r.forlangVisa === true,
      rabattTyp: r.rabattTyp === 'procent' || r.rabattTyp === 'belopp' ? r.rabattTyp : null,
      rabattVarde: num(r.rabattVarde),
      rabattText: String(r.rabattText || '').slice(0, 200),
      extraposter: (Array.isArray(r.extraposter) ? r.extraposter : []).slice(0, 20).map(function (e) {
        return { text: String(e && e.text || '').slice(0, 200), pris: num(e && e.pris) };
      }),
      manuellOffert: r.manuellOffert === true,
      accepteradJustering: typeof r.accepteradJustering === 'string' ? r.accepteradJustering : null
    };
  }

  // ---------- Mejl ----------

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  /** Räknar övriga nivåer med ordinarie pris och automatiskt gränshoppsförslag. */
  function ordinarie(priser, inn, niva) {
    var kopia = {};
    for (var k in inn) kopia[k] = inn[k];
    kopia.niva = niva; kopia.rabattTyp = null; kopia.rabattVarde = null; kopia.accepteradJustering = null;
    var r = berakna(priser, kopia);
    if (r.gransforslag) { kopia.accepteradJustering = r.gransforslag.nyckel; r = berakna(priser, kopia); }
    return r;
  }

  /**
   * Bygger mejlet. Returnerar { fel } eller { amne, html, text }.
   * datum är en färdigformaterad sträng.
   */
  function byggMejl(priser, inn, adress, datum) {
    adress = String(adress || '').replace(/\s+/g, ' ').trim();
    if (!adress) return { fel: ['Ange objektets adress.'] };
    if (adress.length > 200) return { fel: ['Adressen är för lång.'] };
    if (!inn.niva) return { fel: ['Välj stagingnivå.'] };
    var vald = berakna(priser, inn);
    if (vald.fel.length) return { fel: vald.fel };
    if (!vald.harInnehall) return { fel: ['Det finns inget att skicka.'] };

    var ovriga = inn.yta ? NIVAER.filter(function (n) { return n !== inn.niva; }).map(function (n) {
      return { niva: n, res: ordinarie(priser, inn, n) };
    }) : [];

    // --- HTML ---
    // Vald nivå ligger på beige bakgrund. Ej valda nivåer står efter en tydlig avgränsning, utan färg.
    var F = 'font-family:Arial,Helvetica,sans-serif;';
    var GRA = '#7a7268', LINJE = '#e4ddd1', TEXT = '#2a2723', BEIGE = '#f5f1ea', LINJE_BEIGE = '#ddd3c3';

    function block(res, rubrik, vald) {
      var linje = vald ? LINJE_BEIGE : LINJE;
      function td(innehall, stil) { return '<td style="' + F + 'padding:8px 0;border-bottom:1px solid ' + linje + ';vertical-align:top;' + (stil || '') + '">' + innehall + '</td>'; }
      var h = '';
      if (vald) h += '<p style="' + F + 'font-size:11px;letter-spacing:1px;text-transform:uppercase;color:' + GRA + ';margin:0 0 2px;font-weight:bold">Vald nivå</p>';
      h += '<h2 style="font-family:Georgia,serif;font-size:' + (vald ? '20px' : '17px') + ';color:' + (vald ? TEXT : GRA) + ';margin:0 0 10px">' + esc(rubrik) + '</h2>';
      res.varningar.forEach(function (v) {
        h += '<p style="' + F + 'font-size:13px;color:#8a5a12;border-left:3px solid #d9b26a;padding:2px 0 2px 10px;margin:0 0 10px">' + esc(v.text) + ' Förslaget är inte använt.</p>';
      });
      h += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:' + TEXT + '">';
      res.rader.forEach(function (r) {
        var belopp = r.status === 'ok' ? kr(r.belopp) : '<span style="color:#6b4e8a;font-weight:bold">Kräver bedömning</span>';
        h += '<tr>' + td(esc(r.text) + (r.detalj ? '<br><span style="font-size:12px;color:' + GRA + '">' + esc(r.detalj) + '</span>' : '')) +
          td(belopp, 'text-align:right;white-space:nowrap;font-weight:bold;padding-left:12px') + '</tr>';
      });
      if (res.stagingunderlag !== null) {
        h += '<tr>' + td('Stagingunderlag<br><span style="font-size:12px">Grund för förlängning, före rabatt</span>', 'color:' + GRA) + td(kr(res.stagingunderlag), 'text-align:right;color:' + GRA) + '</tr>';
      }
      var summaStil = 'border-top:2px solid ' + TEXT + ';border-bottom:0;font-size:16px';
      if (res.total !== null) {
        h += '<tr>' + td('<b>' + (res.preliminar ? 'Totalt (preliminärt)' : 'Totalt') + '</b>', summaStil) +
          td('<b>' + kr(res.total) + ' kr</b>', 'text-align:right;white-space:nowrap;' + summaStil) + '</tr>';
      } else {
        h += '<tr>' + td('<b>Delsumma, beräknade delar</b><br><span style="font-size:12px;color:' + GRA + '">Saknas: ' + esc(res.saknas.join(', ')) + '</span>', summaStil) +
          td('<b>' + kr(res.delsumma) + ' kr</b>', 'text-align:right;white-space:nowrap;' + summaStil) + '</tr>';
      }
      h += '</table>';
      if (res.forlangning) {
        var f = res.forlangning;
        h += '<p style="' + F + 'font-size:13px;color:' + GRA + ';margin:12px 0 0">Vid förlängning, ingår inte i totalen: ' +
          (f.perVecka === null ? 'kräver komplett stagingunderlag.' : '<b style="color:' + TEXT + '">' + kr(f.perVecka) + ' kr</b> per påbörjad vecka efter ' + f.veckor + ' veckor (' + decimal(f.procent) + ' % av stagingunderlaget, före rabatt).') + '</p>';
      }
      return h;
    }

    var html = '<div style="' + F + 'color:' + TEXT + ';max-width:640px;-webkit-text-size-adjust:100%;text-size-adjust:100%">';
    html += '<p style="' + F + 'font-size:12px;letter-spacing:1px;text-transform:uppercase;color:' + GRA + ';margin:0">Prisberäkning homestaging</p>';
    html += '<h1 style="font-family:Georgia,serif;font-size:24px;margin:4px 0 2px">' + esc(adress) + '</h1>';
    html += '<p style="' + F + 'font-size:13px;color:' + GRA + ';margin:0 0 18px">' + esc(datum) + ' · Alla belopp i kronor inklusive moms</p>';
    if (vald.flaggad) html += '<p style="' + F + 'font-size:14px;font-weight:bold;color:#6b4e8a;border-left:3px solid #b9a0d6;padding:2px 0 2px 10px;margin:0 0 18px">Flaggad: individuell offert ska skrivas</p>';
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr><td style="background:' + BEIGE + ';border-radius:10px;padding:18px 20px">' +
      block(vald, NIVANAMN[inn.niva], true) + '</td></tr></table>';
    if (ovriga.length) {
      html += '<div style="border-top:1px solid ' + LINJE + ';margin:32px 0 0;padding-top:14px">';
      html += '<p style="' + F + 'font-size:11px;letter-spacing:1px;text-transform:uppercase;color:' + GRA + ';margin:0 0 18px;font-weight:bold">Övriga nivåer · ej valda · ordinarie pris utan rabatt</p>';
      ovriga.forEach(function (x, i) {
        html += '<div style="padding:0 20px' + (i ? ';margin-top:28px' : '') + '">' + block(x.res, NIVANAMN[x.niva] + ' (ej vald)', false) + '</div>';
      });
      html += '</div>';
    }
    html += '<p style="' + F + 'font-size:12px;color:' + GRA + ';margin:28px 0 0">Internt underlag från räknesnurran.</p></div>';

    // --- Text ---
    function textblock(res, rubrik) {
      var t = '\n' + rubrik + '\n' + new Array(rubrik.length + 1).join('-') + '\n';
      res.varningar.forEach(function (v) { t += 'Obs: ' + v.text + ' Förslaget är inte använt.\n'; });
      res.rader.forEach(function (r) {
        t += r.text + ': ' + (r.status === 'ok' ? kr(r.belopp) + ' kr' : 'kräver bedömning') + (r.detalj ? ' – ' + r.detalj : '') + '\n';
      });
      if (res.stagingunderlag !== null) t += 'Stagingunderlag: ' + kr(res.stagingunderlag) + ' kr\n';
      t += res.total !== null ? (res.preliminar ? 'TOTALT (preliminärt): ' : 'TOTALT: ') + kr(res.total) + ' kr\n'
        : 'Delsumma, beräknade delar: ' + kr(res.delsumma) + ' kr (saknas: ' + res.saknas.join(', ') + ')\n';
      if (res.forlangning) t += 'Vid förlängning, ingår inte i totalen: ' + (res.forlangning.perVecka === null ? 'kräver komplett stagingunderlag'
        : kr(res.forlangning.perVecka) + ' kr per påbörjad vecka efter ' + res.forlangning.veckor + ' veckor, före rabatt') + '\n';
      return t;
    }
    var text = 'Prisberäkning homestaging\n' + adress + '\n' + datum + '\nAlla belopp i kronor inklusive moms\n';
    if (vald.flaggad) text += 'FLAGGAD: individuell offert ska skrivas\n';
    text += textblock(vald, 'VALD NIVÅ: ' + NIVANAMN[inn.niva]);
    if (ovriga.length) {
      text += '\n\n=== Övriga nivåer, ej valda, ordinarie pris utan rabatt ===\n';
      ovriga.forEach(function (x) { text += textblock(x.res, NIVANAMN[x.niva] + ' (ej vald)'); });
    }

    return { amne: 'Prisberäkning – ' + adress, html: html, text: text, vald: vald, ovriga: ovriga };
  }

  return {
    NIVAER: NIVAER,
    NIVANAMN: NIVANAMN,
    tal: tal,
    kr: kr,
    decimal: decimal,
    kontrolleraPriser: kontrolleraPriser,
    ingaendeZoner: ingaendeZoner,
    berakna: berakna,
    normalisera: normalisera,
    byggMejl: byggMejl
  };
}

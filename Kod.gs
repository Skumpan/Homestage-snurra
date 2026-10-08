/**
 * Räknesnurra för homestaging – serverdel (Google Apps Script).
 *
 * Skriptet ska vara kopplat till prisarket (Tillägg → Apps Script i arket).
 * PIN-koden sätts under Projektinställningar → Skriptegenskaper med
 * egenskapen PIN (sex siffror). Mottagaren av mejl kan bytas med
 * egenskapen MOTTAGARE. Se installationsguiden.
 */

var MAX_FORSOK = 5;          // felaktiga försök innan spärr
var SPARR_MINUTER = 15;      // spärrtid efter för många fel

var STANDARD_MOTTAGARE = 'mats@skumpan.se';  // används om skriptegenskapen MOTTAGARE saknas
var AVSANDARNAMN = 'Prisberäkning';

var FLIK = { nivaer: 'Nivåer', zonintervall: 'Zonintervall', uteyta: 'Uteyta', ovrigt: 'Övrigt' };

/** Visar räknesidan. Inga priser skickas med här. */
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Prisberäkning')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** Lämnar beräkningskoden till räknesidan (samma kod som servern använder). */
function berakningskod() {
  return 'var Berakning = (' + skapaBerakning.toString() + ')();';
}

/**
 * Kontrollerar PIN-koden med försöksbegränsning.
 * Returnerar null om koden är rätt, annars ett svar till räknesidan.
 */
function kontrolleraPin(pin) {
  var las = LockService.getScriptLock();
  las.waitLock(10000);
  try {
    var prop = PropertiesService.getScriptProperties();
    var ratt = String(prop.getProperty('PIN') || '').trim();
    if (!/^\d{6}$/.test(ratt)) {
      return { status: 'ejinstalld', meddelande: 'PIN-koden är inte inställd. Kontakta administratören.' };
    }

    var nu = Date.now();
    var sparrTill = Number(prop.getProperty('SPARR_TILL') || 0);
    if (nu < sparrTill) {
      return { status: 'sparrad', minuter: Math.ceil((sparrTill - nu) / 60000) };
    }

    if (!lika(String(pin || ''), ratt)) {
      var antal = Number(prop.getProperty('FEL_ANTAL') || 0) + 1;
      if (antal >= MAX_FORSOK) {
        prop.setProperties({ FEL_ANTAL: '0', SPARR_TILL: String(nu + SPARR_MINUTER * 60000) });
        return { status: 'sparrad', minuter: SPARR_MINUTER };
      }
      prop.setProperty('FEL_ANTAL', String(antal));
      return { status: 'fel', kvar: MAX_FORSOK - antal };
    }

    prop.setProperties({ FEL_ANTAL: '0', SPARR_TILL: '0' });
    return null;
  } finally {
    las.releaseLock();
  }
}

/** Läser och kontrollerar prisarket. */
function aktuellaPriser() {
  return skapaBerakning().kontrolleraPriser(lasPrisark());
}

/**
 * Anropas från räknesidan. Kontrollerar PIN-koden och lämnar först
 * därefter ut priserna från prisarket.
 */
function hamtaPriser(pin) {
  var nej = kontrolleraPin(pin);
  if (nej) return nej;
  var kontroll = aktuellaPriser();
  if (!kontroll.ok) return { status: 'prisfel', fel: kontroll.fel };
  return { status: 'ok', priser: kontroll.priser };
}

/** Mottagare: skriptegenskapen MOTTAGARE, annars standardadressen. */
function mottagare() {
  var m = String(PropertiesService.getScriptProperties().getProperty('MOTTAGARE') || '').trim();
  return m || STANDARD_MOTTAGARE;
}

/**
 * Anropas från räknesidan. Kontrollerar PIN-koden, räknar om allt från
 * inmatningen med aktuella priser och skickar mejlet till den fasta mottagaren.
 */
function skickaMejl(pin, inmatning, adress) {
  var nej = kontrolleraPin(pin);
  if (nej) return nej;
  var kontroll = aktuellaPriser();
  if (!kontroll.ok) return { status: 'prisfel', fel: kontroll.fel };

  var B = skapaBerakning();
  var datum = Utilities.formatDate(new Date(), 'Europe/Stockholm', 'yyyy-MM-dd HH:mm');
  var mejl = B.byggMejl(kontroll.priser, B.normalisera(inmatning), adress, datum);
  if (mejl.fel) return { status: 'inmatningsfel', fel: mejl.fel };

  var till = mottagare();
  var meddelande = { to: till, subject: mejl.amne, htmlBody: mejl.html, body: mejl.text, name: AVSANDARNAMN };
  try {
    try {
      meddelande.inlineImages = { logga: loggaBlob() };
      MailApp.sendEmail(meddelande);
    } catch (e) {
      // Krånglar loggan ska priset ändå komma fram, då utan logga
      delete meddelande.inlineImages;
      meddelande.htmlBody = mejl.html.replace(/<img src="cid:logga"[^>]*>/, '');
      MailApp.sendEmail(meddelande);
    }
  } catch (e) {
    return { status: 'mejlfel', meddelande: 'Mejlet kunde inte skickas. Kontakta administratören.' };
  }
  return { status: 'ok', mottagare: till };
}

/** Jämför två strängar utan att avslöja var de skiljer sig. */
function lika(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Prisflikarnas uppbyggnad och standardvärden. */
function prisMallar() {
  return [
    { namn: FLIK.nivaer, rader: [
      ['Nyckel', 'Beskrivning', 'Light', 'Kompletterande', 'Full'],
      ['kvm_pris', 'Pris per stylad kvm (kr)', 250, 300, 350],
      ['minimipris', 'Lägsta grundpris (kr)', 10000, 14000, 18000],
      ['extra_zon', 'Tillägg per extra stagingzon (kr)', 1500, 2500, 4000]
    ] },
    { namn: FLIK.zonintervall, rader: [
      ['Övre gräns (kvm)', 'Zoner som ingår'],
      [50, 3], [75, 4], [100, 5], [130, 6]
    ] },
    { namn: FLIK.uteyta, rader: [
      ['Övre gräns (kvm)', 'Tillägg (kr)'],
      [6, 2000], [20, 4500]
    ] },
    { namn: FLIK.ovrigt, rader: [
      ['Nyckel', 'Beskrivning', 'Värde'],
      ['extra_utezon', 'Tillägg per separat utezon utöver den första (kr)', 1000],
      ['uteyta_kvm_pris_over', 'Kvm-pris för uteyta över sista nivån i fliken Uteyta (kr)', 225],
      ['zoner_over_sista', 'Zoner som ingår över sista zonintervallet (antal)', 7],
      ['refresh_timpris', 'Timpris visningsrefresh (kr)', 995],
      ['refresh_min_timmar', 'Minimitid refresh (timmar)', 2],
      ['forlangning_procent_vecka', 'Andel av stagingunderlaget per påbörjad extra vecka (%)', 10],
      ['inkluderade_veckor', 'Hyrestid som ingår (veckor)', 6]
    ] }
  ];
}

/**
 * Lägger till nyckelrader som saknas i befintliga flikar (t.ex. efter en uppdatering),
 * med standardvärden. Befintliga värden ändras aldrig.
 */
function laggTillSaknadeRader(ss) {
  var tillagda = [];
  prisMallar().forEach(function (m) {
    if (m.rader[0][0] !== 'Nyckel') return;
    var blad = ss.getSheetByName(m.namn);
    if (!blad) return;
    var nycklar = blad.getDataRange().getValues().map(function (r) { return String(r[0]).trim(); });
    m.rader.slice(1).forEach(function (rad) {
      if (nycklar.indexOf(rad[0]) < 0) { blad.appendRow(rad); tillagda.push(m.namn + ': ' + rad[0]); }
    });
  });
  return tillagda;
}

/** Läser prisarkets fyra flikar till rådata för kontrolleraPriser(). */
function lasPrisark() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    var id = PropertiesService.getScriptProperties().getProperty('PRISARK_ID');
    if (id) ss = SpreadsheetApp.openById(id);
  }
  var data = { nivaer: {}, ovrigt: {}, zonintervall: [], uteyta: [] };
  if (!ss) return data;
  try { laggTillSaknadeRader(ss); } catch (e) { /* läsningen fortsätter, kontrollen visar vad som saknas */ }

  function rader(namn) {
    var blad = ss.getSheetByName(namn);
    if (!blad) return [];
    return blad.getDataRange().getValues().slice(1); // hoppa över rubrikraden
  }

  rader(FLIK.nivaer).forEach(function (r) {
    var nyckel = String(r[0]).trim();
    if (nyckel) data.nivaer[nyckel] = [r[2], r[3], r[4]];
  });
  rader(FLIK.ovrigt).forEach(function (r) {
    var nyckel = String(r[0]).trim();
    if (nyckel) data.ovrigt[nyckel] = r[2];
  });
  rader(FLIK.zonintervall).forEach(function (r) {
    if (String(r[0]).trim() !== '' || String(r[1]).trim() !== '') data.zonintervall.push([r[0], r[1]]);
  });
  rader(FLIK.uteyta).forEach(function (r) {
    if (String(r[0]).trim() !== '' || String(r[1]).trim() !== '') data.uteyta.push([r[0], r[1]]);
  });
  return data;
}

// ---------------------------------------------------------------------------
// Verktyg för administratören. Körs från skripteditorn (välj funktion → Kör).
// ---------------------------------------------------------------------------

/**
 * Skapar de fyra prisflikarna med dagens värden.
 * Befintliga värden ändras aldrig. I befintliga flikar läggs bara rader till
 * som saknas, så funktionen kan köras utan risk efter en uppdatering.
 */
function skapaPrisflikar() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var mallar = prisMallar();
  var skapade = [], tillagda = [];
  mallar.forEach(function (m) {
    if (ss.getSheetByName(m.namn)) return;
    var blad = ss.insertSheet(m.namn);
    var bredd = m.rader[0].length;
    blad.getRange(1, 1, m.rader.length, bredd).setValues(m.rader);
    blad.getRange(1, 1, 1, bredd).setFontWeight('bold').setBackground('#efe9df');
    blad.setFrozenRows(1);
    blad.autoResizeColumns(1, bredd);
    skapade.push(m.namn);
  });
  tillagda = laggTillSaknadeRader(ss);
  Logger.log((skapade.length ? 'Skapade flikar: ' + skapade.join(', ') : 'Alla flikar fanns redan.') +
    (tillagda.length ? ' Tillagda rader: ' + tillagda.join(', ') + '.' : ''));
}

/** Kontrollerar prisarket och visar eventuella fel i loggen. */
function kontrolleraPrisarket() {
  var k = skapaBerakning().kontrolleraPriser(lasPrisark());
  Logger.log(k.ok ? 'Prisarket är korrekt.' : 'Fel i prisarket:\n- ' + k.fel.join('\n- '));
}

/** Häver en spärr efter för många felaktiga PIN-försök. */
function havSparr() {
  PropertiesService.getScriptProperties().setProperties({ FEL_ANTAL: '0', SPARR_TILL: '0' });
  Logger.log('Spärren är hävd.');
}

/**
 * Skickar ett testmejl till mottagaren. Kör den en gång efter uppdateringen,
 * så att Google frågar om behörighet att skicka mejl.
 */
function skickaTestmejl() {
  var till = mottagare();
  MailApp.sendEmail({ to: till, subject: 'Prisberäkning – testmejl', body: 'Mejlfunktionen i räknesnurran fungerar.', name: AVSANDARNAMN });
  Logger.log('Testmejl skickat till ' + till + '.');
}

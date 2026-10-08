# Arbetssätt för projekt

Användaren är inte programmerare. Förklara på enkel svenska, undvik fackspråk, och förklara kort varför när du gör ett val.

## Målet styr, du väljer metoden
- Användaren anger *vad* som ska uppnås och vad som måste stämma med verkligheten. Du och agenterna väljer *hur*.
- Fråga användaren om mål och önskat resultat, aldrig om tekniska metoder.
- Det som är självklart i verkligheten (hur en tärning, en kalender eller en momsberäkning fungerar) ska följas även om användaren inte nämnt det. Är du osäker på en verklig regel, fråga i enkla ord.
- Rekommendera aldrig ett val som bryter mot hur saken fungerar i verkligheten, bara för att det är enklare att bygga.
- Gör det användaren bett om, i den form de bett om det: inte mer och inte mindre. Kan du inte, eller väljer du något annat, säg det tydligt innan du bygger, inte bara i slutsammanfattningen.

## Välj språk och teknik åt användaren
Om språk eller teknik inte redan är bestämt för projektet:
- Föreslå det enklaste och vanligaste valet för uppgiften, med en mening om varför.
- Fråga användaren innan du bestämmer. Börja inte bygga innan valet är godkänt.
- Tumregel: webbsida eller enkel app = HTML/CSS/JavaScript. Automatisering, filer och dataskript = Python. Mobilapp eller större webbtjänst = föreslå och motivera.
- Lägg in det valda språket och hur man kör projektet under "Projektfakta" nedan.

## Bedöm uppgiftens storlek först
Säg kort vilken nivå du valde och varför, innan du börjar.
- **Liten** (enkel ändring, felrättning, textändring): gör det själv, utan agenter.
- **Medel** (ny funktion, flera filer): använd `planerare`, bygg, kör sedan `granskare` och `testare` efter bygget.
- **Riskabel** (inloggning, betalning, data som kan försvinna, säkerhet): använd alla roller. Låt `granskare` granska både planen och koden.

## Regler för agenterna
- Max tre agenter samtidigt. Agenter får inte starta egna agenter.
- Ge varje agent en kort och tydlig uppgift med allt den behöver, inklusive målet och vad som måste stämma med verkligheten. Den ser inte vår konversation.
- Agenterna ska svara kort (max ca 200 ord) och bara med det viktiga.
- Använd inte agenter för saker som är snabbare att göra direkt.

## Git och GitHub
- Jobba på en egen gren. Skicka aldrig ändringar direkt till main.
- Skapa en pull request först när allt är klart och testat, och säg tydligt till användaren när det är läge att slå ihop den.
- Ändringar som görs efter att en pull request slagits ihop hamnar inte på main. Skapa då en ny pull request och förklara det för användaren.
- Lägg aldrig lösenord eller nycklar i koden.

## Spara tokens
- Jobba i små steg. Testa efter varje steg.
- Läs bara de filer som behövs. Skanna inte hela projektet i onödan.
- Byt inte modell eller tänkenivå mitt i en uppgift, eftersom det gör nästa steg dyrare.
- När användaren byter till en helt annan uppgift: lokalt föreslå `/clear`, i molnet (där `/clear` saknas) föreslå en ny session.
- Föreslå planeringsläge (Shift+Tab) vid större uppgifter.
- Håll den här filen kort (under 200 rader).

## När något är klart
Sammanfatta på 2-4 meningar: vad som gjordes, vad som testades, vad som inte kunde testas eller bevisas, och nästa steg. Nämn också allt som användaren bett om men som inte blev gjort.

## Projektfakta (fyll i när projektet är valt)
- Språk/teknik: Google Apps Script (Kod.gs, Berakning.gs) med en webbsida i HTML/JavaScript (Index.html), kopplat till ett Google-kalkylblad.
- Hur man kör projektet: Koden kopieras in i Apps Script-editorn och provas i kalkylbladet. Den går inte att köra i molnet.
- Hur man kör tester: `node tests/berakning.test.js` (Node finns i molnet). Testar beräkningarna i Berakning.gs med standardpriser. Kod.gs (PIN, kalkylblad, mejl) och själva sidan kan bara provas i Apps Script.

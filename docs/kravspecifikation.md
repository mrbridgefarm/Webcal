# Kravspecifikation: DAV-Sync Cal

## 1. Vision og Mål
At skabe en lynhurtig, tastatur-venlig webkalender (tilgås via browseren), der integrerer problemfrit med Mailcow/SOGo via CalDAV. Appen skal tilbyde de samme kernefunktioner som branchens store spillere (f.eks. Google Kalender), men skille sig ud ved at tilbyde overlegne workflows til personlig planlægning, specifikt via ægte "Copy/Paste"-logik på tværs af dage direkte i webbrowseren.

## 2. "Drysset" (Unikke Web-funktioner)
Dette er de funktioner, der adskiller DAV-Sync Cal fra traditionelle webkalendere:

* **Ægte Copy/Paste-logik:** Mulighed for at markere en eller flere dage/begivenheder i browseren og bruge genvejstaster (`Ctrl+C`, `Ctrl+V`, `Ctrl+X`) til lynhurtig vagtplanlægning og time-blocking. (Løses via globale JavaScript event-listeners).
* **Custom Højrekliksmenu:** En indbygget højrekliksmenu til kopiering og redigering, som elegant overskriver browserens standardmenu (`e.preventDefault()`), præcis som i Google Docs.
* **Lokal Fortryd (Ctrl+Z) & Papirkurv:** Et indbygget sikkerhedsnet, der tillader brugeren at fortryde sletninger og forkerte indsættelser øjeblikkeligt. Slettede elementer gemmes i en lokal papirkurv (via browserens hukommelse) i f.eks. 30 dage.
* **Offline Caching (PWA):** Fuld læse- og skriveadgang til kalenderen uden internetadgang via Service Workers og IndexedDB. Lokale ændringer sættes i kø og skubbes automatisk til proxy-serveren/Mailcow i baggrunden, når forbindelsen genoprettes.
* **Øjeblikkelig Lokal Søgning:** Søgning sker mod et lokalt opbygget indeks i browseren for at sikre millisekund-respons, fremfor at vente på serveropslag.

## 3. Kernemotoren (Mailcow & CalDAV Integration)
* **Direkte Identitetslogin:** Login foretages sikkert via web-appens frontend, som sender oplysningerne til vores backend-proxy, der validerer dem direkte mod Mailcow (understøtter App-adgangskoder).
* **Delte SOGo Kalendere:** Fuld integration af kalendere delt af kolleger/familie.
* **Intelligent Rettighedsstyring:** Appen registrerer, om en delt kalender er "Read-Only" og låser automatisk for redigering, Træk-og-Slip og `Ctrl+V` på disse.
* **Spam-beskyttelse / Mødesikkerhed:** `Ctrl+C` (Kopiering) deaktiveres automatisk for begivenheder, der indeholder andre inviterede deltagere.
* **RSVP & Mødehåndtering:** Håndtering af indgående invitationer. Brugeren kan svare "Deltager", "Måske" eller "Afvis".
* **Tidszonestyring (VTIMEZONE):** Robust og præcis konvertering af iCal-tidszoner for at forhindre forskydninger ved sommertid og rejser.

## 4. Brugergrænseflade & Dagligt Workflow
* **Skalerbar Månedsvisning (Standard):** Overskueligt gitter med plads til op til 7 synlige begivenheder pr. dag. Yderligere begivenheder samles under en "+ X flere"-knap, som åbner en hurtig oversigtsmenu (popover).
* **Uge- og Dagsvisning:** Mulighed for at skifte til detaljeret time-planlægning. `Ctrl+C`/`V` genvejene fungerer også her.
* **Træk-og-Slip (Drag & Drop):** Flyt begivenheder frit med musen, eller juster varigheden.
* **Farvestyring:** Synkronisering af SOGo's serverfarver med mulighed for at overskrive disse lokalt.
* **Browser Notifikationer:** Påmindelser (VALARM) udløser web-notifikationer, der integrerer med OS (Windows/Linux), når browseren er åben.
* **Rige Begivenhedsdata:** Understøttelse af klikbare lokationer, links til videomøder og fulde tekst-beskrivelser.
* **Kollisions-advarsler:** Visuel feedback ved dobbeltbookinger på tværs af kalendere.

## 5. Teknologisk Stack (Web-Arkitektur)
For at omgå browserens sikkerhedsbegrænsninger (CORS) opdeles systemet i to:
* **Backend (Mellemmanden):** En letvægts Node.js (Express) proxy-server, der håndterer login og den direkte CalDAV-kommunikation med Mailcow.
* **Frontend (Klienten):** Bygget i Vue.js (eller React) med et kalender-bibliotek som FullCalendar for at styre den avancerede "Excel-lignende" copy/paste-logik og UI.
* **Fremtidssikring:** Da frontenden er rent webbaseret, kan den på et senere tidspunkt uden problemer pakkes ind i Tauri eller Electron, hvis en dedikeret desktop-app (exe/AppImage) ønskes.

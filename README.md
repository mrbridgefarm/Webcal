# DAV-Sync Cal

En lynhurtig, tastatur-venlig webkalender med **Mailcow / SOGo CalDAV**-integration og "Excel-lignende" **Copy/Paste workflows** (`Ctrl+C`, `Ctrl+X`, `Ctrl+V`, `Ctrl+Z`) direkte i webbrowseren.

Designet til at køre i **Docker på både x86 (`linux/amd64`) og ARM (`linux/arm64`)**.

---

## Funktioner ("Drysset" & Kernemotoren)

* **Ægte Copy/Paste på tværs af dage (`Ctrl+C`, `Ctrl+X`, `Ctrl+V`):** Markér én eller flere begivenheder (eller en hel dag), kopiér med `Ctrl+C`, klik på en ny dato og indsæt med `Ctrl+V` (bevarer klokkeslæt og varighed).
* **Mødesikkerhed (Spam-beskyttelse):** `Ctrl+C` blokeres automatisk for møder, der indeholder andre inviterede deltagere (`ATTENDEE`).
* **Intelligent Read-Only styring:** Registrerer automatisk skrivebeskyttede delte SOGo-kalendere og låser redigering, Træk-og-Slip og `Ctrl+V` på disse.
* **Custom Højrekliksmenu:** Indbygget højrekliksmenu (`e.preventDefault()`) på både begivenheder og datoer.
* **Lokal Fortryd (`Ctrl+Z`) & 30-dages Papirkurv:** Fortryd øjeblikkeligt oprettelser, flytninger og sletninger. Slettede begivenheder opbevares lokalt i IndexedDB i 30 dage.
* **Offline Caching (PWA) & Sync-kø:** Fuld læse- og skriveadgang uden internet via Service Worker og IndexedDB (`Dexie.js`). Ændringer sættes i kø og synkroniseres automatisk med Mailcow, når forbindelsen genoprettes.
* **Øjeblikkelig Lokal Søgning & Kollisions-advarsler:** Millisekund-søgning mod lokalt indeks samt visuel markering af dobbeltbookinger på tværs af kalendere.
* **RSVP, VTIMEZONE & VALARM:** Svar *Deltager*, *Måske* eller *Afvis* på møder, præcis tidszonehåndtering via `ical.js` og OS-notifikationer i browseren.
* **Indbygget Demo/Mock-tilstand:** Kan testes øjeblikkeligt uden en live Mailcow-server.

---

## Kørsel i Docker (x86_64 & ARM64)

Projektet bruger `node:22-alpine` uden native C++-afhængigheder og bygger derfor 100 % identisk på både **x86 (`linux/amd64`)** og **ARM (`linux/arm64`)**.

### Metode 1: Klon fra dit private GitHub repo på din VM og byg lokalt

På din VM (uanset om den kører x86_64 eller ARM64):

```bash
git clone git@github.com:<dit-brugernavn>/<dit-repo>.git
cd <dit-repo>

# Valgfrit: Kopiér .env.example til .env og tilpas port / standard Mailcow URL
cp .env.example .env

# Sørg for at dit "pangolin" Docker-netværk findes (hvis Pangolin ikke allerede har oprettet det):
docker network inspect pangolin >/dev/null 2>&1 || docker network create pangolin

# Byg og start containeren i baggrunden (bruger compose.yaml)
docker compose up -d --build
```

I **Pangolin** kan du nu oprette en ressource, der peger direkte på container-navnet **`http://dav-sync-cal:3000`** på `pangolin`-netværket (eller tilgå den via `http://<din-vm-ip>:3000`). Se også [`compose.example.yaml`](compose.example.yaml) for flere detaljer.

### Metode 2: Multi-Arch Image via GitHub Actions (`ghcr.io`)

Repoet indeholder [`.github/workflows/docker-multiarch.yml`](.github/workflows/docker-multiarch.yml), som automatisk bygger et kombineret **`linux/amd64` + `linux/arm64`** Docker-image via Docker Buildx og skubber det til GitHub Container Registry (`ghcr.io/<dit-brugernavn>/<dit-repo>:latest`), når du pusher til `main`.

---

## Miljøvariabler (`.env` / `docker-compose.yml`)

| Variabel | Standard | Beskrivelse |
| :--- | :--- | :--- |
| `PORT` | `3000` | Porten som webkalenderen og CalDAV-proxyen lytter på |
| `DEFAULT_CALDAV_URL` | *(tom)* | Valgfri standard Mailcow URL (f.eks. `https://mail.ditdomæne.dk/SOGo/dav/`) |
| `ALLOW_INSECURE_TLS` | `false` | Sæt til `true` hvis din Mailcow VM bruger et selv-signeret certifikat på LAN |

# DAV-Sync Cal

En lynhurtig, tastatur-venlig webkalender med **Mailcow / SOGo CalDAV**-integration og "Excel-lignende" **Copy/Paste workflows** (`Ctrl+C`, `Ctrl+X`, `Ctrl+V`, `Ctrl+Z`) direkte i webbrowseren.

Bygges automatisk som et **Multi-Arch Docker-image (`linux/amd64` & `linux/arm64`)** på GitHub Container Registry:
**`ghcr.io/mrbridgefarm/webcal:latest`**

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

## Kørsel i Docker på din VM (x86_64 & ARM64)

GitHub Actions ([`.github/workflows/docker-multiarch.yml`](.github/workflows/docker-multiarch.yml)) bygger automatisk imaget `ghcr.io/mrbridgefarm/webcal:latest` til både **x86 (`linux/amd64`)** og **ARM (`linux/arm64`)**, så din VM slipper for selv at bygge koden.

### 1. Log ind på GHCR på din VM (kun nødvendigt hvis pakken er privat)
Opret en GitHub Personal Access Token (Classic) med `read:packages`-rettighed og kør på VM'en:
```bash
echo <DIT_GITHUB_TOKEN> | docker login ghcr.io -u mrbridgefarm --password-stdin
```

### 2. Start med `compose.yaml` (bruger `pangolin`-netværket)
På din VM behøver du kun `compose.yaml` (og evt. `.env`):
```bash
# Sørg for at dit "pangolin" Docker-netværk findes:
docker network inspect pangolin >/dev/null 2>&1 || docker network create pangolin

# Hent nyeste image fra GHCR og start containeren:
docker compose pull
docker compose up -d
```

I **Pangolin** kan du nu oprette en ressource, der peger direkte på **`http://dav-sync-cal:3000`** på `pangolin`-netværket (eller tilgå den via `http://<din-vm-ip>:3000`). Se også [`compose.example.yaml`](compose.example.yaml) for flere detaljer.

---

## Miljøvariabler (`.env` / `compose.yaml`)

| Variabel | Standard | Beskrivelse |
| :--- | :--- | :--- |
| `PORT` | `3000` | Porten som webkalenderen og CalDAV-proxyen lytter på |
| `DEFAULT_CALDAV_URL` | *(tom)* | Valgfri standard Mailcow URL (f.eks. `https://mail.ditdomæne.dk/SOGo/dav/`) |
| `ALLOW_INSECURE_TLS` | `false` | Sæt til `true` hvis din Mailcow VM bruger et selv-signeret certifikat på LAN |

# Kjørebok

A full-stack driving-logbook (Norwegian *kjørebok*) for tracking trips for
mileage and tax purposes — available on both web and mobile, backed by a shared
API. Built as a production-style monorepo with CI/CD, containerized local
development, and end-to-end mobile tests.

> **[Try the interactive demo — no account needed](https://kjorebok.nguyenchu.com/demo)** · [Project walkthrough](https://nguyenchu.com/prosjekter/kjorebok.html) · [Live app](https://kjorebok.nguyenchu.com)

## Explore in two minutes

1. Open the demo, select a fictional trip, and inspect its example route.
2. Change its purpose between work and private and watch the totals update.
3. Filter the log and export the visible trips as CSV. Reset to restore the examples.

The demo uses invented data and the existing web map component. It keeps edits in memory and makes no trip API calls. It does not demonstrate background GPS recording, authentication, or API-backed reports.

For implementation details, start with [GPS processing](apps/api/src/lib/track), [shared domain types](packages/shared/src), and the [web demo](apps/web/src/app/demo).

## Technical decisions and tradeoffs

- **Expo for mobile, Next.js for web:** shared domain types support different interfaces for recording trips and reviewing history. Background location and permissions still require platform-specific device testing.
- **Shared TypeScript package:** domain changes become visible across clients, but tighter coupling means changes need coordination. Runtime inputs are validated with Zod in the API; static types do not validate network data.
- **GPS processing:** filtering, smoothing, stop detection, and map-line simplification address noisy raw positions. Aggressive filtering can hide genuine movement; permissive filtering retains drift. Track-processing tests exercise these behaviors.
- **Separate API and database:** web and mobile use the same persisted domain. The tradeoff is operating the API, database, migrations, and deployments alongside the clients.


## Architecture

A [Turborepo](https://turbo.build) monorepo with three apps and a shared package,
so domain types are shared across the clients and API:

```
apps/
  api      Fastify + Prisma + PostgreSQL — REST API with JWT auth
  web      Next.js (React) + Leaflet maps
  mobile   Expo / React Native (iOS + Android)
packages/
  shared   Domain types and mileage rates shared across api, web and mobile
```

## Tech stack

| Layer     | Tech |
|-----------|------|
| **API**   | Fastify, Prisma ORM, PostgreSQL, JWT auth (`@fastify/jwt`, `bcryptjs`), Zod validation |
| **Web**   | Next.js, React, React-Leaflet (trip maps), date-fns |
| **Mobile**| Expo, React Native, Expo Router |
| **Shared**| TypeScript domain types + mileage rates reused across apps |
| **Infra** | Turborepo, Docker Compose (local Postgres), GitHub Actions (deploy web/API + build & publish Android APK), Maestro (mobile E2E) |

## Highlights

- **Shared domain types** — one `shared` package feeds API, web, and mobile; the API uses Zod for runtime input validation.
- **Real CI/CD** — GitHub Actions builds and deploys web + API and produces a downloadable Android APK, versioned independently of the visible semver.
- **Containerized local dev** — `docker compose up` gives a real Postgres; Prisma migrations are checked in.
- **Automated mobile testing** — Maestro E2E flows (see `docs/maestro-mobile-testing.md`).

## Lokal utvikling

Bruk Node 22 lokalt for dette repoet.

Start med å aktivere riktig Node-versjon:

```bash
nvm use
```

Hvis du får `zsh: command not found: nvm`, installer `nvm`, last shell-oppsettet på nytt og prøv igjen:

```bash
source ~/.zprofile
nvm install
nvm use
```

```bash
corepack pnpm install
corepack pnpm --filter @kjorebok/api exec prisma generate
```

Start databasen med Docker:

```bash
docker compose up -d
```

Kjør migrasjonene:

```bash
corepack pnpm --filter @kjorebok/api exec prisma migrate deploy
```

Hvis Prisma feiler lokalt med en uklar `Schema engine error`, sjekk først at du faktisk kjører Node 22 og ikke Node 24+.

Lag lokale miljøfiler fra eksemplene:

- `apps/api/.env`
- `apps/web/.env.local`
- `apps/mobile/.env`

Anbefalt lokal flyt for web:

- web: `http://localhost:3021`
- API: `http://localhost:3020`

I production brukes `https://kjorebok.nguyenchu.com/api`.

For Android-emulator bør mobilappen bruke:

```bash
EXPO_PUBLIC_API_URL=http://10.0.2.2:3020
```

## Anbefalt oppstart

Etter at `nvm use` er kjørt:

```bash
corepack pnpm dev:local
```

Det starter:

- web på `http://localhost:3021`

Merk:

- web og mobil bruker lokal API i development som standard
- production-bygg bruker `https://kjorebok.nguyenchu.com/api`
- du kan fortsatt overstyre med `NEXT_PUBLIC_API_URL` eller `EXPO_PUBLIC_API_URL`

Start mobilappen i en egen terminal:

```bash
corepack pnpm dev:mobile
```

Trykk `a` i Expo-terminalen for å åpne appen i Android-emulator.

## Android-emulator

Hvis du vil kjøre den native Android-byggede dev-klienten direkte:

```bash
corepack pnpm dev:mobile:android
```

For fysisk Android-enhet med kabel:

Lokal API via `adb reverse`:

```bash
corepack pnpm dev:mobile:android:local
```

Offentlig server for virkelighetsnær testing:

```bash
corepack pnpm dev:mobile:android:server
```

## iPhone

Bygg og installer direkte på en tilkoblet iPhone via Xcode:

```bash
corepack pnpm --filter @kjorebok/mobile ios:device:server
```

Det bygger i `Release` mot produksjons-API-et, slik at appen virker frittstående
uten at Metro kjører på maskinen.

`ios/`-mappen er en lokal `expo prebuild`-artefakt og er ikke sjekket inn.
Ikke kjør `expo prebuild --clean` uten grunn — signeringsoppsettet
(`DEVELOPMENT_TEAM`) ligger der og må settes på nytt i Xcode etterpå.

Hvis `pod install` feiler med `Unicode Normalization not appropriate for
ASCII-8BIT`, mangler shellet UTF-8-locale:

```bash
export LANG=en_US.UTF-8
```

List tilkoblede enheter med:

```bash
xcrun devicectl list devices
```

## Android APK

Anbefalt flyt er å la GitHub Actions bygge og publisere Android-APK fra
`Deploy Production`-workflowen i GitHub.

Kort flyt:

1. push endringene til `main`
2. åpne GitHub Actions
3. kjør `Deploy Production`
4. velg `android` hvis du bare vil publisere APK
5. velg `both` hvis du også vil deploye web/API

Publisert APK blir tilgjengelig her:

```text
https://kjorebok.nguyenchu.com/download/android.apk
```

Tilgjengelig metadata blir publisert her:

```text
https://kjorebok.nguyenchu.com/download/android-latest.json
```

Versjonering:

- sett `apps/mobile/app.json` til den synlige appversjonen du vil publisere, for eksempel `1.0.33` eller `1.1.0`
- GitHub Actions bruker denne som Android `versionName`
- Android `versionCode` settes separat fra workflow-run-nummeret, så det kan fortsette å stige uten å påvirke den synlige semver-versjonen

Hvis du vil bygge lokalt i tillegg:

```bash
export ANDROID_VERSION_CODE=$(date +%s)
export APP_VERSION=1.0.33
cd apps/mobile/android
EXPO_PUBLIC_API_URL=https://kjorebok.nguyenchu.com/api ./gradlew assembleRelease
```

APK-en havner normalt her:

```bash
apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```

Når APK-en er bygget, publiser den til serveren med:

```bash
bash deploy/publish-android-apk.sh apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```

Nyttige kommandoer:

```bash
emulator -list-avds
emulator @Pixel_7
adb devices
```

Hvis `adb`, `emulator`, `node` eller `pnpm` ikke finnes i terminalen, last shell-oppsettet på nytt:

```bash
source ~/.zprofile
```

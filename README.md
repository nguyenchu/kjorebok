# Kjørebok

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
- API: `https://kjorebok.nguyenchu.com/api`

Hvis du vil utvikle API-et lokalt i stedet, kan du sette `NEXT_PUBLIC_API_URL=http://localhost:3020`.

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

- web er normalt satt opp mot `https://kjorebok.nguyenchu.com/api`
- du trenger derfor ikke starte lokal API bare for å teste web
- hvis du vil jobbe lokalt med backend også, endre `apps/web/.env.local` til `http://localhost:3020`

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

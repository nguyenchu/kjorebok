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

Anbefalte porter lokalt:

- API: `http://localhost:3020`
- web: `http://localhost:3021`

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

- API på `http://localhost:3020`
- web på `http://localhost:3021`

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

Vanlig flyt er nå å la GitHub Actions bygge og publisere Android-APK automatisk når mobilendringer pushes til `main`.

Hvis du vil bygge lokalt i tillegg, bruk en eksplisitt versjon:

```bash
export ANDROID_VERSION_CODE=$(date +%s)
export APP_VERSION=1.0.$ANDROID_VERSION_CODE
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

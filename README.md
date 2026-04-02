# Kjørebok

## Lokal utvikling

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

## Android uten datakabel

Hvis du vil teste på fysisk Android-enhet uten USB-data, bygg en installérbar APK med EAS:

```bash
cd apps/mobile
npx eas-cli login
EXPO_PUBLIC_API_URL=https://kjorebok.nguyenchu.com/api npx eas-cli build -p android --profile preview
```

`preview`-profilen lager en `.apk` som kan åpnes direkte på telefonen fra EAS-lenken når bygget er ferdig.

For Google Play / ordinær release:

```bash
cd apps/mobile
EXPO_PUBLIC_API_URL=https://kjorebok.nguyenchu.com/api npx eas-cli build -p android --profile production
```

Da får du en production Android App Bundle (`.aab`).

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

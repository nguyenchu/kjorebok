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
pnpm dev:local
```

Det starter:

- API på `http://localhost:3020`
- web på `http://localhost:3021`

Start mobilappen i en egen terminal:

```bash
pnpm dev:mobile
```

Trykk `a` i Expo-terminalen for å åpne appen i Android-emulator.

## Android-emulator

Hvis du vil kjøre den native Android-byggede dev-klienten direkte:

```bash
pnpm dev:mobile:android
```

Nyttige kommandoer:

```bash
emulator -list-avds
emulator @Pixel_7
adb devices
```

Hvis `adb`, `emulator`, `node` eller `pnpm` ikke finnes i terminalen, last shell-oppsettet på nytt:

```bash
source ~/.zshrc
```

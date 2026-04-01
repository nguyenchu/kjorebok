# Kjørebok

Lokal utvikling:

```bash
corepack pnpm install
corepack pnpm --filter @kjorebok/api exec prisma generate
```

Start databasen med Docker:

```bash
docker compose up -d
```

Lag lokale miljofiler fra eksemplene:

- `apps/api/.env`
- `apps/web/.env.local`
- `apps/mobile/.env`

Anbefalte porter lokalt:

- API: `http://localhost:3020`
- web: `http://localhost:3021`

For Android-emulator bor mobilappen bruke:

```bash
EXPO_PUBLIC_API_URL=http://10.0.2.2:3020
```

Hvis databasen er tom, bruk den eksisterende SQL-migrasjonen:

```bash
docker exec -i kjorebok-postgres psql -U postgres -d kjorebok < apps/api/prisma/migrations/20260323120005/migration.sql
```

Start API og web:

```bash
./run-local.sh
```

Start mobilappen i egen terminal:

```bash
corepack pnpm --filter @kjorebok/mobile dev
```

Trykk `a` i Expo-terminalen for a apne appen i Android-emulator.

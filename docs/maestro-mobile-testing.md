# Maestro for mobilappen

Dette repoet har en liten `Maestro`-rigg for smoke-testing av Android-appen.

## Filer

- `.maestro/flows/login.yaml`
- `.maestro/tests/login-smoke.yaml`
- `.maestro/tests/tracking-smoke.yaml`
- `.maestro/tests/delete-account-dialog-smoke.yaml`

## Forutsetninger

- `Maestro` må være installert på maskinen din
- Android-appen må være bygget og installert på en telefon eller emulator
- devserver/Metro bør kjøre når du tester development builden

## Miljøvariabler

Flowene bruker en ekte testkonto. Sett disse før du kjører testene:

```bash
export MAESTRO_TEST_EMAIL="din-testbruker@example.com"
export MAESTRO_TEST_PASSWORD="ditt-testpassord"
```

## Kjør alle smoke-tester

Fra repo-roten:

```bash
maestro test .maestro/tests
```

Eller via npm-script:

```bash
corepack pnpm test:mobile:maestro
```

## Hva som testes

- login-flyt
- at sporingssiden åpner og viser feilsøking
- at slett-konto-dialogen åpner uten å bekrefte sletting

## Viktig

`delete-account-dialog-smoke.yaml` stopper på bekreftelsesdialogen og trykker `Avbryt`. Den sletter ikke kontoen.

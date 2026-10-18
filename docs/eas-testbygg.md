# Testbygg for batterisparing og turstart

Denne instruksen gjelder batterisparingen og turstarten fra PR #10–#13 (hvile med geofence, bevegelsessensor, Bluetooth-turstart og iOS-snarveien). Alt ligger i `main`. Delene har native-kode som CI ikke bygger, så det første ekte testsignalet er et bygg for telefonen. Android bygges med EAS. iOS kan bygges lokalt i Xcode på en Mac, eller med EAS.

Bygg fra `main`.

## Forutsetninger

- `eas-cli` 16.17 eller nyere (`npm i -g eas-cli`), og innlogget med `eas login`. Trengs ikke for iOS hvis du bygger lokalt i Xcode.
- iOS: Apple Developer-konto. Med EAS må iPhonen i tillegg være registrert for intern distribusjon (se under).
- Med EAS: bruk profilen `preview`, ikke `development`. Development-bygget henter JS fra Metro på maskinen din, og da fungerer ikke bakgrunnstestene når telefonen er ute og kjører.

`preview`, og det lokale Release-bygget under, peker mot produksjonsserveren (`https://kjorebok.nguyenchu.com/api`). Turer du kjører under testen, havner derfor i den ekte kjøreboka di.

## 1. Hent koden og sjekk den lokalt

Fra repo-roten:

```bash
git fetch origin
git checkout main
git pull
corepack pnpm install
cd apps/mobile
npx tsc --noEmit
```

## 2. Android

```bash
corepack pnpm build:android:apk
```

- `android/` ligger i repoet, så EAS bruker den mappa direkte og kjører ikke prebuild. Manifestene til de lokale modulene (`modules/motion-activity`, `modules/car-bluetooth`) slås sammen automatisk.
- Når bygget er ferdig, åpner du lenken eller QR-koden fra EAS på telefonen og installerer APK-en. Avinstaller en eventuell Play-versjon først hvis signaturen er en annen.

## 3. iOS

### Lokalt i Xcode (anbefalt når du har en Mac)

Raskest å iterere med: kompileringsfeil i Swift vises med en gang i Xcode, og du slipper EAS-køen.

`ios/` ligger ikke i repoet. Den genereres med `expo prebuild`, og det er da config pluginen `modules/car-shortcut/plugin/withCarShortcut.js` legger Snarveier-handlingene inn i app-målet, og de lokale modulene (`motion-activity`, `car-shortcut`) kommer med i Podfile. En gammel `ios/`-mappe fra før disse endringene mangler alt dette, så lag den på nytt:

Fortsatt fra `apps/mobile`:

```bash
npx expo prebuild --platform ios --clean
corepack pnpm ios:device:server
```

- `ios:device:server` bygger i **Release** mot produksjonsserveren og installerer på iPhonen som er koblet til Macen. Release er viktig: JS-koden ligger da inne i appen. Et Debug-bygg henter JS fra Metro på Macen og fungerer ikke når du er ute og kjører.
- Vil du heller bygge fra Xcode: åpne `ios/*.xcworkspace` etter prebuild, og velg Release under Product → Scheme → Edit Scheme → Run. Release-bygg bruker produksjonsserveren som standard.
- Sjekk etter installasjon at «Sitter i bilen» og «Gått ut av bilen» dukker opp under Kjørebok i Snarveier-appen.
- Kjør `prebuild --clean` på nytt når native-kode, `app.json` eller config plugins endres. Ellers holder det å bygge på nytt.

### Med EAS

Brukes når du skal bygge uten Mac eller dele appen med andre testere.

Første gang må telefonen registreres:

```bash
corepack pnpm device:register
```

Bygg deretter:

```bash
corepack pnpm build:ios:preview
```

- iOS kjører prebuild på EAS. Config pluginen `modules/car-shortcut/plugin/withCarShortcut.js` legger da Snarveier-handlingene inn i app-målet.
- Vil du sjekke pluginen før du laster opp, kan du kjøre `npx expo prebuild --platform ios --no-install`, se at `ios/*/KjorebokCarIntents.swift` finnes, og så slette `ios/` igjen. Mappa er ignorert av git.

## 4. Hvis bygget feiler

- Android: åpne steget «Run gradlew» i EAS-loggen.
- iOS med EAS: åpne steget «Run fastlane» i EAS-loggen, og se etter den første linjen med `error:`.
- iOS lokalt: Xcode viser feilen i Issue navigator (⌘5). Fra terminalen står den over «BUILD FAILED».

Kopier feilmeldingen med filnavn og linjenummer. Filstien viser hvilken modul feilen hører til, og hvilken PR modulen kom fra:

| Filsti inneholder | Kom fra |
| --- | --- |
| `modules/motion-activity` | #11 |
| `modules/car-bluetooth` | #12 |
| `modules/car-shortcut` eller `KjorebokCarIntents.swift` | #13 |

## 5. Første oppstart

Gi alle tillatelsene appen ber om:

- **Posisjon:** «Tillat hele tiden» (Android) eller «Alltid» (iOS).
- **Varsler.**
- **Fysisk aktivitet** (Android) eller **Bevegelse og trening** (iOS).
- **Enheter i nærheten** (Android): spørres om først når du kobler en bil til Bluetooth.

All status finnes under **Profil → Sporing → Feilsøking**. Disse feltene er nyttige under testen:

- **Status:** «Hviler – GPS er av», «Ser etter kjøring», «Registrerer tur» eller «Sjekker om turen er avsluttet».
- **Bevegelsessensor** og **Siste aktivitet.**
- **Bilens Bluetooth.**
- **Sist bakgrunnsoppgave kjørte.**
- **Siste hendelser:** den viktigste. Den forteller hva trackeren gjorde og hvorfor.

## 6. Testplan

| Test | Slik gjør du | Forventet i «Siste hendelser» |
| --- | --- | --- |
| Hvile etter tur (#10) | Kjør en kort tur og parker. | «Tur fullført …». Status går til «Hviler – GPS er av». |
| Oppvåkning fra hvile (#10) | Med appen i bakgrunnen: kjør ut fra parkeringen. | «Forlot hvilesonen. Starter GPS.», deretter «Tur startet automatisk.» |
| Startpunkt (#10) | Se på turen etterpå. | Starter der bilen sto, ikke ca. 200 m unna. |
| Gåtur (#10/#11) | Fra hvile: gå mer enn 200 m. | «Ingen kjøring oppdaget. GPS hviler igjen.» etter ca. 90 s (5 min uten bevegelsessensor). |
| Bevegelsessensor (#11) | Fra hvile: sett deg i bilen og kjør. | «Bevegelsessensoren ser kjøring. Starter GPS.», ofte før geofencen slår til. |
| Rask turslutt (#11) | Parker og gå ut av bilen. | Turen avsluttes etter ca. 1 min i stedet for 3. |
| Rødlys (#11) | Vent lenge på rødt lys. | Turen fortsetter; ingen avslutning. |
| Bluetooth, Android (#12) | Mine kjøretøy → Koble til Bluetooth → velg bilen. Lukk appen, sett deg i bilen. | «Koblet til <bilnavn>.», deretter turstart på det koblede kjøretøyet. |
| Hodetelefoner (#12) | Koble til hodetelefoner. | Ingenting. «Sist bakgrunnsoppgave kjørte» endrer seg ikke. |
| Snarvei, iOS (#13) | Sett opp automasjonen fra kortet på «Mine kjøretøy», og velg kjøretøy. Sett deg i bilen. | «Koblet til bilen (Snarveier).», deretter turstart på valgt kjøretøy. |
| Snarvei etter tvungen lukking (#13) | Sveip appen bort, og sett deg i bilen. | Samme som over. |
| Slettet kjøretøy (#13) | Slett det koblede kjøretøyet, og kjør. | «Kjøretøyet finnes ikke lenger …». Turen registreres på standardkjøretøyet. |

## 7. Batteri

Det er hele poenget, så mål det:

- Bruk telefonen som vanlig i ett døgn med det nye bygget, og noter Kjørebok sin andel i batteriinnstillingene (Android: Innstillinger → Batteri → Batteribruk; iOS: Innstillinger → Batteri).
- Sammenlign med et døgn på dagens versjon. Mest mulig like døgn gir best sammenligning.

## 8. Logger ved feil

Android, med telefonen koblet til via USB:

```bash
adb logcat -s ReactNativeJS TaskService MotionTransitionConsumer
```

iOS: åpne Console.app på en Mac med telefonen tilkoblet, og filtrer på «Kjørebok».

Send med det som står i «Siste hendelser» og loggen når noe ikke oppfører seg som forventet. Sjekklistene i PR #10–#13 viser hva hver del skal klare, hvis du vil krysse av underveis.

# Google Play: personvern og bakgrunnslokasjon

Dette er arbeidsnotater for publisering av Kjørebok i Google Play.

## Personvernerklæring

Publiser denne siden:

- `https://kjorebok.nguyenchu.com/privacy`

Siden ligger i webappen på:

- `apps/web/src/app/privacy/page.tsx`

## Foreslått begrunnelse for bakgrunnslokasjon

Bruk denne som utgangspunkt i Play Console:

Kjørebok bruker bakgrunnslokasjon for å oppdage når en kjøretur starter og stopper automatisk, også når appen ikke er åpen. Dette er appens kjernefunksjon. Uten bakgrunnslokasjon må brukeren starte og stoppe turer manuelt, og turhistorikken blir mindre pålitelig.

## Kort tekst til appbeskrivelse eller tillatelsesforklaring

Kjørebok bruker lokasjon for å registrere turer automatisk og vise dem i kjøreboken din. Hvis du gir tilgang til bakgrunnslokasjon, kan appen oppdage turer selv når appen er lukket.

## Datatyper som sannsynligvis må oppgis i Data safety

Disse bør dobbeltsjekkes før innsending:

- Personlig informasjon: navn, e-postadresse
- Appaktivitet / appinformasjon: konto- og bruksrelatert metadata
- Sted: presis lokasjon

## Ting som fortsatt må fylles ut manuelt i Play Console

- Privacy policy URL
- Background location declaration
- Data safety-skjema
- Kontaktinfo for personvern/support
- Eventuell video eller skjermbilder som viser hvorfor bakgrunnslokasjon er nødvendig

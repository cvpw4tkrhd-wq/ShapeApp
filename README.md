# ShapeApp

Personlig webbapp (PWA) för kost, styrketräning, kondition och hälsologg. Svenskt gränssnitt, metriska enheter och mål som går att redigera. All data lagras lokalt på enheten (IndexedDB). Om du vill kan du även ha en krypterad backup i ett privat GitHub-repo.

> ShapeApp ställer inga diagnoser och ersätter inte vården. Mål, progression och menyer är förslag, inte medicinska ordinationer.

## Filer

| Fil | Innehåll |
|---|---|
| `index.html` | Gränssnitt och stil |
| `app.js` | All logik |
| `livsmedel.json` | Livsmedelsverkets livsmedelsdatabas: 2 606 livsmedel med näringsvärden och ingredienslistor |
| `manifest.json` | PWA-manifest (namn, färger, ikoner 192/512) |
| `sw.js` | Service worker som gör att appen fungerar offline |
| `apple-touch-icon.png` | Hemskärmsikon för iPhone (180×180) |
| `icon.svg`, `favicon.png` | Favicon |
| `icon-192.png`, `icon-512.png` | Ikoner i manifestet |
| `icon-1024.png` | Högupplöst original (används inte i koden) |

## Publicera via GitHub (webbgränssnittet)

1. Skapa ett **publikt** repo som heter `ShapeApp`. Det behövs för gratis GitHub Pages. Appens kod innehåller ingen personlig data.
2. Välj **Add file → Upload files** och dra in alla filer ovan till repots rot. Klicka sedan på **Commit changes**.
3. Gå till **Settings → Pages → Build and deployment**. Välj Source: *Deploy from a branch* och Branch: `main` / `(root)`. Klicka **Save**.
4. Efter någon minut ligger appen på `https://<användarnamn>.github.io/ShapeApp/`.

> Om du använder fine-grained tokens i dina andra projekt: token för backupen ska **bara** ha åtkomst till det privata data-repot, inte till `ShapeApp`.

## Lägga till på iPhone

1. Öppna adressen i **Safari**.
2. Tryck på **Dela** och välj **Lägg till på hemskärmen**.
3. Appen startar i helskärm med ShapeApp-ikonen (`apple-touch-icon.png`).

Om du har lagt till en äldre version tidigare: ta bort den från hemskärmen och lägg till den igen. iOS sparar ikonen från första gången.

## Backup till privat repo

1. Skapa ett **privat** repo, t.ex. `shapeapp-data`, och kryssa i "Add a README".
2. Gå till **Settings → Developer settings → Fine-grained tokens → Generate new token**.
   - Repository access: *Only select repositories* → `shapeapp-data`
   - Repository permissions: **Contents: Read and write**
3. Öppna ShapeApp och gå till **Inställningar (kugghjulet) → Backup till GitHub**. Fyll i användarnamn, repo, token och en lösenfras.

Datan krypteras i telefonen (AES-256-GCM, nyckel via PBKDF2 med 250 000 iterationer) innan den laddas upp. Token och lösenfras sparas bara på enheten och följer aldrig med i export eller backup. Varje backup blir en commit, så äldre versioner finns kvar i repots historik.

**Glömmer du lösenfrasen går backupen inte att läsa.** Exportera därför gärna en JSON-fil då och då, via Inställningar → Exportera allt.

## Uppdatera appen

1. Ladda upp de nya filerna.
2. Höj `VERSION` i `sw.js`, till exempel till `shapeapp-v1.0.1`.

Din data på telefonen påverkas inte av uppdateringar.

## Källa för näringsvärden

Livsmedelsverkets livsmedelsdatabas, version 2026-06, under licensen [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Värdena är uppskattningar. Portionsstorlek, tillagning och märke påverkar det verkliga innehållet. Filtret för livsmedel du inte äter bygger på namn, livsmedelsgrupp och ingredienslistor, och kan missa saker. Kontrollera alltid förpackningen.

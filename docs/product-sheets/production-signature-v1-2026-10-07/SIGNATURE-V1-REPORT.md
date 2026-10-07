# Verdanza Signature V1 — revue locale des 12 fiches

Statut : **PASS technique local, en attente de validation graphique finale et BAT imprimeur**. Aucune mise en production, aucun commit ou push. Le master est décrit dans `VERDANZA-SIGNATURE-V1.md` ; toutes les valeurs produit viennent des JSON modernes validés, sans modification de ces données.

| Produit | Statut | Intensité | Photo effective (ppp) | WebP 320 / 640 (Ko) | QA |
| --- | --- | --- | ---: | ---: | --- |
| Blue Dream | available | Douce | 207,3 | 18,1 / 58,1 | PASS |
| Cookie Kush Indoor | available | Douce | 207,3 | 12,0 / 36,9 | PASS |
| Harlequin Greenhouse | available | Douce | 207,3 | 13,4 / 40,6 | PASS |
| Mandarine | available | Douce | 207,3 | 13,9 / 43,8 | PASS |
| Mango Haze | available | Douce | 207,3 | 14,9 / 48,5 | PASS |
| OG Kush | available | Douce | 207,0 | 12,0 / 37,1 | PASS |
| Golden Static | available | Douce | 207,3 | 6,8 / 17,9 | PASS |
| Suprême 50 % CBD | available | Douce | 207,3 | 11,0 / 34,2 | PASS |
| Skittle Plus | planned | Forte | 297,7 | 18,6 / 62,8 | PASS |
| Black Afghan | planned | Moyenne | 174,4 | 10,0 / 29,8 | PASS |
| Ice-o-Lator | planned | Moyenne | 174,4 | 12,3 / 40,7 | PASS |
| Mousseux Skywalker | planned | Forte | 297,7 | 18,4 / 65,7 | PASS |

## Livrables et contrôle

- Pour chaque produit : `flowers/<slug>` ou `resins/<slug>` contient le recto et le verso PNG, les vignettes 320/640 WebP, le PDF standard, le PDF print-safe et `report/qa.json`. Les 12 standards sont copiés aux URL publiques **versionnées** `/fiches-produits/<slug>/verdanza-<slug>-signature-v1.pdf` ; 24 WebP sont copiés dans `/images/fiches-produits/signature-v1/`. Les anciens fichiers et les URL déclarées dans `src/data/productSheets.ts` ne sont pas réécrits.
- Sept planches : `SIGNATURE-V1-AVAILABLE-FRONTS.png`, `SIGNATURE-V1-AVAILABLE-BACKS.png`, `SIGNATURE-V1-PLANNED-FRONTS.png`, `SIGNATURE-V1-PLANNED-BACKS.png`, `SIGNATURE-V1-ALL-WEB-CARDS.png`, `SIGNATURE-V1-ALL-12-FRONTS.png`, `SIGNATURE-V1-ALL-12-BACKS.png` ; comparaison actuel/Signature : `SIGNATURE-V1-BEFORE-AFTER.png` (Blue Dream, Golden Static, Ice-o-Lator, Mousseux Skywalker).
- Noms longs : une ligne conservée avec adaptation de taille contrôlée. Minimum observé au recto : 113 px (Harlequin Greenhouse), au verso : 113 px, sur Web : 63 px. Aucun étirement/compression horizontale. Le long profil aromatique d'OG Kush passe sur deux lignes sur sa vignette afin de conserver 27 px de corps à 640 px.
- Blue Dream : trois aperçus strictement identiques aux images `D-VERDANZA-SIGNATURE-FINAL` validées (différence pixel = 0). Rendu PDF standard comparé aux mêmes images : erreur absolue moyenne 3,66/255 au recto et 6,01/255 au verso, sous le seuil de 10/255.
- Golden Static : source photo `Composition-ezgif.com-resize.webp`, SHA-256 `8cc588388bd397e14ac8f02e025737109332a5ad0eeb6a8b80cbe7d16e3f2436` ; l'ancienne macro n'est pas utilisée.
- QA typographique/géométrique : boîtes calculées à partir des largeurs réelles des polices, zéro overflow, clipping ou collision sur les 36 compositions. Aucun texte sous les minima de titre.
- PDF : 24/24 fichiers à 2 pages ; MediaBox/BleedBox 111 × 154 mm et TrimBox/ArtBox 105 × 148 mm. Standard : texte extractible et polices incorporées. Print-safe : 0 police, 0 Type 3, textes et monogramme vectoriels. Une photographie matricielle au recto, zéro au verso ; aucun raster pleine page. Poppler **24/24 PASS**, PDFium **24/24 PASS**.
- Mock local `/fiches-produits` : 390 et 1280 px PASS ; 12 aperçus chargés, 12 PDF versionnés HTTP 200 en prévisualisation locale, onglets Fleurs/Résines et section À venir conservés, zéro overflow horizontal et zéro erreur navigateur. Captures dans `web-mock/`.
- Déterminisme : deux générations complètes consécutives avec manifeste SHA-256 identique ; résultats détaillés dans `SIGNATURE-V1-QA.json` et `SIGNATURE-V1-SHA256SUMS.txt`.

**Avant BAT imprimeur : photos HD à confirmer ou fournir.** Plusieurs sources sont autour de 174–207 ppp effectifs à la taille du nouveau grand visuel ; le QA technique ne constitue pas une validation de qualité d'impression.

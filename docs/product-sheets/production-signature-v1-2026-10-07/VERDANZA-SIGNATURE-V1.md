# VERDANZA SIGNATURE V1 — master graphique

Statut : master local pour validation humaine, sans publication. La référence visuelle normative est le triptyque Blue Dream `D-VERDANZA-SIGNATURE-FINAL-front.png`, `D-VERDANZA-SIGNATURE-FINAL-back.png`, `D-VERDANZA-SIGNATURE-FINAL-web.webp` dans `docs/product-sheets/blue-dream-directions-2026-10-07`. Ses SHA-256 sont vérifiés par le générateur et les trois aperçus Blue Dream de cette collection en sont des copies exactes.

## Langage visuel

- A6 portrait 105 × 148 mm, avec 3 mm de fond perdu dans les PDF (MediaBox/BleedBox 111 × 154 mm). Fond ivoire `#FAF8F2`, vert profond `#0B3D2E`, champagne discret `#C9A45C`, encre `#171717`.
- Rail vert vertical de 66 px sur le master 1240 × 1748 px, soit environ 5,6 mm au format fini ; monogramme V officiel en ivoire. Aucune ombre, capsule, bordure décorative, filigrane végétal ni second bloc vert.
- Cormorant Garamond pour le nom et les accents éditoriaux ; Inter pour les micro-labels, textes courants et la signature. Composition asymétrique et photographie non retouchée, contenue sans déformation ni recadrage significatif.
- Une seule grammaire pour fleur et résine : seuls `FLEUR / VERDANZA` ou `RÉSINE / VERDANZA` et `ASPECT` ou `TEXTURE & APPARENCE` changent.

## Recto

Rail et V ; micro-label de catégorie ; nom dominant ; photographie occupant le champ central ; arômes spécifiques validés séparés par `·` ; `INTENSITÉ / DOUCE`, `MOYENNE` ou `FORTE` ; petite signature V + `verdanza.fr` intégrée au bas. Aucun autre bloc.

## Verso

Rail et V ; `FICHE PRODUIT / FLEUR` ou `RÉSINE` ; nom ; trois blocs éditoriaux numérotés en champagne : `01 PROFIL AROMATIQUE` (description et arômes validés), `02 INTENSITÉ`, `03 ASPECT` ou `03 TEXTURE & APPARENCE` (texte validé). Espace négatif volontaire, aucune capsule ni cadre. Signature identique au recto.

## Vignette Web

Composition indépendante 4:5, non issue d'un PDF réduit. Rail de 36 px à 640 px, V, photographie sur 67 % de la hauteur, nom, arômes courts et intensité uniquement. Formats 320 × 400 et 640 × 800 WebP ; chargement différé dans le mock. Le badge `À venir` appartient à l'interface, jamais aux visuels ou PDF.

## Noms longs et QA

Le nom reste sur une ligne tant qu'il tient dans 1000 px au recto/verso et 555 px sur Web. Taille initiale 139 px recto, 132 px verso, 82 px Web ; baisse progressive sans compression horizontale jusqu'à 110, 105 et 60 px respectivement. Un nom qui ne tient pas à ces minima provoque un échec plutôt qu'un débordement silencieux. Les lignes de description et d'aspect sont composées à leur largeur réelle ; QA obligatoire sur les boîtes, collisions, coupures et taille. Aucun contenu validé n'est réécrit.

## Sources, statut et publication différée

Source de vérité : les 12 `data/product.json` et leurs photographies référencées dans `production-modern-2026-10-07`. Huit références `available`, quatre `planned`. Golden Static utilise impérativement `public/Fiche produit/Golden static/Composition-ezgif.com-resize.webp` (SHA-256 `8cc588388bd397e14ac8f02e025737109332a5ad0eeb6a8b80cbe7d16e3f2436`). Les photos demeurent telles quelles ; une photo basse résolution ne devient pas HD par le rendu PDF.

Les nouveaux PDF standards sont préparés localement sous `/fiches-produits/<slug>/verdanza-<slug>-signature-v1.pdf`, et les WebP sous `/images/fiches-produits/signature-v1/<slug>-signature-v1-{320,640}.webp`. Les PDF print-safe restent uniquement dans le dossier documentaire. Les anciennes URL publiques et `src/data/productSheets.ts` restent inchangées jusqu'à validation et phase de publication distincte.

Génération locale : `scripts/buildVerdanzaSignatureV1.py`. Les contrôles PDF incluent 2 pages, boîtes, texte extractible et polices incorporées en standard, zéro police/Type 3 en print-safe, seule photographie matricielle, rendus Poppler et PDFium. Le manifeste SHA-256 est `SIGNATURE-V1-SHA256SUMS.txt`.

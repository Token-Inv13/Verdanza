import React from "react";
import { Link } from "react-router-dom";
import type { BlogArticle } from "../types/blog";

// Blog editorial rule: keep guides evergreen, category-first, and independent from live stock,
// prices, promos, or transient availability.
export const blogArticles: BlogArticle[] = [
  {
    slug: "comment-lire-analyse-cbd",
    title: "Comment lire une analyse de CBD ?",
    seoTitle: "Comment lire une analyse de CBD ? Guide pratique | Verdanza",
    description:
      "Apprenez à lire une analyse de CBD : cannabinoïdes, THC, unités, numéro de lot, date, laboratoire et limites du document.",
    excerpt:
      "Un guide simple pour comprendre un certificat d’analyse, repérer les informations mesurées et distinguer les données techniques du texte commercial.",
    category: "Guide qualité",
    authorName: "Rédaction Verdanza",
    datePublished: "2026-07-14T09:00:00+02:00",
    dateModified: "2026-07-14T09:00:00+02:00",
    readingTime: "8 min",
    status: "published",
    images: {
      square: "/images/blog/comment-lire-analyse-cbd-1x1.webp",
      landscape: "/images/blog/comment-lire-analyse-cbd-4x3.webp",
      wide: "/images/blog/comment-lire-analyse-cbd-16x9.webp",
    },
    relatedSlugs: [
      "fleur-cbd-ou-resine-cbd-differences",
      "indoor-greenhouse-hydroponique-differences",
    ],
    links: [
      { to: "/qualite-conformite", label: "Découvrir la démarche qualité" },
      { to: "/fleurs-cbd", label: "Consulter les fleurs CBD" },
      { to: "/resines-cbd", label: "Consulter les résines CBD" },
      { to: "/blog/fleur-cbd-ou-resine-cbd-differences", label: "Fleur ou résine" },
      {
        to: "/blog/indoor-greenhouse-hydroponique-differences",
        label: "Indoor, greenhouse ou hydroponique",
      },
    ],
    blocks: [
      {
        type: "paragraph",
        text: (
          <>
            Une analyse de CBD, ou certificat d’analyse, sert à lire un lot à un
            instant donné. Le document ne raconte pas toute l’histoire d’un
            produit : il indique surtout ce qui a été mesuré, quand cela a été
            mesuré, et dans quel cadre. Pour le lire correctement, commencez par
            identifier le document avant de regarder les chiffres.
          </>
        ),
      },
      {
        type: "heading",
        id: "identifier-document",
        text: "Identifier le document",
      },
      {
        type: "paragraph",
        text: (
          <>
            Avant de regarder les valeurs, vérifiez que le document décrit bien
            le produit concerné. Les repères utiles sont généralement le nom de
            la référence, le numéro de lot, la date du document, le laboratoire
            mentionné et, quand il existe, le type d’échantillon.
          </>
        ),
      },
      {
        type: "list",
        items: [
          "nom du produit ou de l’échantillon ;",
          "numéro de lot ;",
          "date d’émission ou d’analyse ;",
          "laboratoire indiqué sur le document ;",
          "nature de l’échantillon lorsqu’elle est précisée.",
        ],
      },
      {
        type: "heading",
        id: "cannabinoides",
        text: "Lire les cannabinoïdes",
      },
      {
        type: "paragraph",
        text: (
          <>
            Les lignes consacrées aux cannabinoïdes indiquent les composés
            mesurés dans l’échantillon. Selon la présentation du document, vous
            pouvez voir des formes actives, des formes acides ou une valeur
            totale. L’important est de lire l’intitulé exact plutôt que de
            supposer que toutes les lignes décrivent la même chose.
          </>
        ),
      },
      {
        type: "table",
        table: {
          caption: "Repères de lecture fréquents dans une analyse.",
          headers: ["Mention", "Lecture simple", "Point d’attention"],
          rows: [
            [
              "CBD",
              "Valeur mesurée ou annoncée pour le cannabidiol.",
              "Lire l’unité et l’intitulé complet du document.",
            ],
            [
              "CBDA",
              "Forme acide du CBD lorsqu’elle est affichée.",
              "Ne pas la confondre avec la valeur totale.",
            ],
            [
              "THC",
              "Valeur mesurée pour le tétrahydrocannabinol.",
              "L’intitulé exact peut varier selon le laboratoire.",
            ],
            [
              "Total",
              "Addition ou estimation globale présentée par le document.",
              "Vérifier ce que le total inclut réellement.",
            ],
          ],
        },
      },
      {
        type: "heading",
        id: "thc",
        text: "Repérer le THC",
      },
      {
        type: "paragraph",
        text: (
          <>
            Le THC mérite une lecture attentive, parce que le document peut
            afficher plusieurs variantes d’écriture. Il peut s’agir d’un THC
            mesuré, d’un THC total ou d’une autre formulation liée au mode de
            calcul. Le bon réflexe consiste à lire l’unité, le libellé et le
            contexte du résultat avant toute conclusion.
          </>
        ),
      },
      {
        type: "heading",
        id: "unites",
        text: "Comprendre les unités",
      },
      {
        type: "paragraph",
        text: (
          <>
            Les analyses n’utilisent pas toutes la même unité. Une valeur peut
            apparaître en pourcentage, en milligrammes par gramme ou dans une
            unité plus technique selon la méthode utilisée. Il faut donc garder
            la ligne complète sous les yeux et éviter de comparer deux documents
            si les unités ne sont pas identiques.
          </>
        ),
      },
      {
        type: "table",
        table: {
          caption: "Unités et mentions courantes.",
          headers: ["Mention", "Ce que cela indique", "Lecture utile"],
          rows: [
            [
              "%",
              "Proportion du composé dans l’échantillon.",
              "Comparer uniquement des valeurs exprimées dans la même unité.",
            ],
            [
              "mg/g",
              "Quantité mesurée par gramme d’échantillon.",
              "Lire la valeur avec la méthode et le contexte du document.",
            ],
            [
              "ppm",
              "Part par million, selon le format du rapport.",
              "Éviter de comparer directement avec un pourcentage sans conversion.",
            ],
            [
              "N.D.",
              "Non détecté dans la condition de mesure affichée.",
              "Ne signifie pas absence absolue.",
            ],
            [
              "LOD / LOQ",
              "Limites de détection ou de quantification.",
              "Aident à comprendre jusqu’où la mesure reste lisible.",
            ],
          ],
        },
      },
      {
        type: "heading",
        id: "lot-date-methode",
        text: "Lot, date et méthode",
      },
      {
        type: "paragraph",
        text: (
          <>
            Un certificat utile ne se lit pas seulement sur ses résultats. La
            méthode de mesure, la date, le lot et le type d’échantillon donnent
            le contexte du résultat. Sans ces éléments, il devient difficile de
            savoir à quoi correspond exactement le document.
          </>
        ),
      },
      {
        type: "list",
        items: [
          "vérifier que le lot affiché correspond bien au produit consulté ;",
          "repérer la date du document pour situer la mesure ;",
          "identifier la méthode employée si elle est mentionnée ;",
          "noter les limites de détection ou de quantification ;",
          "garder le type d’échantillon en tête si le rapport le précise.",
        ],
      },
      {
        type: "heading",
        id: "limites",
        text: "Comprendre les limites de détection",
      },
      {
        type: "paragraph",
        text: (
          <>
            Les mentions “non détecté”, “inférieur à la limite de détection” ou
            “inférieur à la limite de quantification” indiquent qu’une valeur
            n’a pas été lisible dans le cadre de la méthode utilisée. Cela ne
            veut pas dire que la substance est absente en toute circonstance ;
            cela veut dire que le document ne la mesure pas au-delà du seuil
            affiché.
          </>
        ),
      },
      {
        type: "heading",
        id: "ce-que-l-analyse-ne-dit-pas",
        text: "Ce que l’analyse ne dit pas toujours",
      },
      {
        type: "list",
        items: [
          "le profil aromatique complet ;",
          "la texture réelle du produit ;",
          "la qualité globale au sens large ;",
          "la valeur du lot suivant ;",
          "une conclusion pratique ou réglementaire.",
        ],
      },
      {
        type: "paragraph",
        text: (
          <>
            Une analyse est donc un repère technique, pas une promesse globale.
            Pour une lecture cohérente avec le reste du site, vous pouvez aussi{" "}
            <Link to="/qualite-conformite">consulter la démarche qualité</Link>,
            puis comparer les catégories{" "}
            <Link to="/fleurs-cbd">fleurs CBD</Link> et{" "}
            <Link to="/resines-cbd">résines CBD</Link>.
          </>
        ),
      },
      {
        type: "heading",
        id: "checklist",
        text: "Checklist avant de lire un rapport",
      },
      {
        type: "list",
        items: [
          "le produit est correctement identifié ;",
          "le lot est visible ;",
          "la date est lisible ;",
          "le laboratoire est mentionné ;",
          "les unités sont comprises ;",
          "le THC et les autres cannabinoïdes sont repérés ;",
          "les limites de détection ou de quantification sont lues ;",
          "les mesures sont distinguées du texte commercial.",
        ],
      },
      {
        type: "links",
        title: "Poursuivre la lecture",
        links: [
          { to: "/blog/fleur-cbd-ou-resine-cbd-differences", label: "Fleur ou résine" },
          {
            to: "/blog/indoor-greenhouse-hydroponique-differences",
            label: "Indoor, greenhouse ou hydroponique",
          },
          { to: "/qualite-conformite", label: "Démarche qualité" },
        ],
      },
    ],
  },
  {
    slug: "fleur-cbd-ou-resine-cbd-differences",
    title: "Fleur CBD ou résine CBD : quelles différences ?",
    seoTitle:
      "Fleur CBD ou résine CBD : différences et critères de choix | Verdanza",
    description:
      "Comprendre les différences entre fleur CBD et résine CBD : présentation, texture, profils, fiches produit et critères de comparaison sans promesse médicale.",
    excerpt:
      "Un guide factuel pour comparer une fleur CBD et une résine CBD selon leur forme, leur texture, leurs profils et les informations visibles sur les fiches produit.",
    category: "Guide produits",
    authorName: "Rédaction Verdanza",
    datePublished: "2026-07-11T21:00:00+02:00",
    dateModified: "2026-07-11T21:00:00+02:00",
    readingTime: "7 min",
    status: "published",
    images: {
      square: "/images/blog/fleur-cbd-ou-resine-cbd-1x1.webp",
      landscape: "/images/blog/fleur-cbd-ou-resine-cbd-4x3.webp",
      wide: "/images/blog/fleur-cbd-ou-resine-cbd-16x9.webp",
    },
    relatedSlugs: [
      "indoor-greenhouse-hydroponique-differences",
      "comment-lire-analyse-cbd",
    ],
    links: [
      { to: "/fleurs-cbd", label: "Voir les fleurs CBD" },
      { to: "/resines-cbd", label: "Voir les résines CBD" },
      { to: "/blog/comment-lire-analyse-cbd", label: "Lire une analyse" },
      { to: "/qualite-conformite", label: "Qualité et conformité" },
      { to: "/livraison-postale", label: "Livraison postale" },
      { to: "/livraison-express-aix", label: "Livraison locale Aix" },
      { to: "/boutique", label: "Parcourir la boutique" },
    ],
    blocks: [
      {
        type: "paragraph",
        text: (
          <>
            Dans un catalogue CBD, la différence entre une fleur et une résine ne
            se limite pas au nom de la catégorie. Elle concerne la présentation
            du produit, sa texture, les informations disponibles sur la fiche et
            la manière de comparer deux références. Ce guide reste volontairement
            factuel : les caractéristiques varient selon chaque produit, chaque
            lot et les informations disponibles pour la référence.
          </>
        ),
      },
      {
        type: "heading",
        id: "fleur-cbd",
        text: "Qu’est-ce qu’une fleur CBD ?",
      },
      {
        type: "paragraph",
        text: (
          <>
            Une fleur CBD correspond à la partie végétale présentée comme telle
            sur une fiche produit. Elle peut être décrite par son origine, son
            mode de culture, son aspect, sa structure et son profil aromatique.
            La page <Link to="/fleurs-cbd">fleurs CBD</Link> réunit les
            références du moment, tandis qu’un certificat d’analyse permet de
            lire les taux mesurés indépendamment du texte commercial.
          </>
        ),
      },
      {
        type: "heading",
        id: "resine-cbd",
        text: "Qu’est-ce qu’une résine CBD ?",
      },
      {
        type: "paragraph",
        text: (
          <>
            Une résine CBD est une préparation dont la texture, la présentation
            et les informations déclarées dépendent de la référence. Certaines
            fiches mettent en avant une texture compacte, souple, crémeuse ou
            plus friable. La page{" "}
            <Link to="/resines-cbd">résines CBD</Link> permet de comparer ces
            profils sans présumer qu’une résine ressemble automatiquement à une
            autre.
          </>
        ),
      },
      {
        type: "heading",
        id: "principales-differences",
        text: "Les principales différences",
      },
      {
        type: "table",
        table: {
          caption:
            "Comparaison factuelle entre une fleur CBD et une résine CBD.",
          headers: ["Critère", "Fleur CBD", "Résine CBD"],
          rows: [
            [
              "Forme du produit",
              "Matière végétale présentée en fleurs ou petites têtes selon la référence.",
              "Préparation présentée en morceau, mousse ou texture compacte selon la fiche.",
            ],
            [
              "Texture",
              "Structure végétale plus ou moins dense, compacte ou aérée.",
              "Texture variable : souple, friable, crémeuse ou compacte selon la référence.",
            ],
            [
              "Présentation",
              "La fiche insiste souvent sur la culture, l’origine et le profil aromatique.",
              "La fiche peut détailler la texture, la composition déclarée et les taux mesurés.",
            ],
            [
              "Diversité aromatique",
              "Notes végétales, fruitées, boisées ou gourmandes selon la fleur.",
              "Notes végétales, terreuses, épicées ou plus rondes selon la résine.",
            ],
            [
              "Disponibilité",
              "La disponibilité est indiquée par la fiche de la référence.",
              "Ne pas généraliser à toute la catégorie.",
            ],
            [
              "Liens utiles",
              "Consulter la catégorie fleurs et chaque fiche produit.",
              "Consulter la catégorie résines et chaque fiche produit.",
            ],
          ],
        },
      },
      {
        type: "heading",
        id: "aspect-texture",
        text: "Aspect et texture",
      },
      {
        type: "paragraph",
        text: (
          <>
            L’aspect est souvent le premier repère visuel. Une fleur comme{" "}
            <Link to="/produits/cookie-kush-indoor">Cookie Kush Indoor</Link>{" "}
            illustre une présentation végétale, tandis que{" "}
            <Link to="/produits/golden-static">Golden Static</Link> montre une
            résine à la texture crémeuse indiquée sur sa fiche. Ces exemples
            servent à comprendre les catégories, pas à établir une hiérarchie.
          </>
        ),
      },
      {
        type: "heading",
        id: "profils-aromatiques",
        text: "Profils aromatiques",
      },
      {
        type: "paragraph",
        text: (
          <>
            Les profils aromatiques doivent être lus référence par référence. Une
            fleur peut être décrite comme gourmande, boisée, fraîche ou fruitée.
            Une résine peut afficher des notes végétales, terreuses ou épicées.
            La fiche produit reste la source la plus précise, car les données ne
            sont pas génériques à toute une catégorie.
          </>
        ),
      },
      {
        type: "heading",
        id: "fiches-produit",
        text: "Informations affichées sur les fiches produit",
      },
      {
        type: "list",
        items: [
          "nom de la référence et catégorie ;",
          "origine lorsqu’elle est indiquée ;",
          "mode de culture ou méthode de présentation lorsqu’ils sont connus ;",
          "taux disponibles, uniquement lorsqu’ils sont renseignés pour la référence ;",
          "statut de la fiche et informations de lecture utiles.",
        ],
      },
      {
        type: "heading",
        id: "prix-disponibilite",
        text: "Lecture et disponibilité",
      },
      {
        type: "paragraph",
        text: (
          <>
            Le prix ne suffit pas à comparer deux produits. Il doit être lu avec
            la disponibilité, la catégorie, les informations produit et le
            statut de la fiche. Pour lire correctement les valeurs mesurées,
            <Link to="/blog/comment-lire-analyse-cbd"> l’analyse de CBD</Link>
            reste le bon point de départ.
          </>
        ),
      },
      {
        type: "heading",
        id: "comparer-preferences",
        text: "Comment comparer selon ses préférences ?",
      },
      {
        type: "paragraph",
        text: (
          <>
            Pour comparer sans raccourci, partez de critères concrets : texture,
            profil aromatique, origine, culture et disponibilité. Si vous
            hésitez entre catégories, ouvrez une fiche fleur et une fiche résine
            côte à côte, puis vérifiez les informations affichées plutôt que de
            raisonner à partir d’idées générales.
          </>
        ),
      },
      {
        type: "links",
        title: "Consulter les fleurs et résines Verdanza",
        links: [
          { to: "/fleurs-cbd", label: "Comparer les fleurs CBD" },
          { to: "/resines-cbd", label: "Comparer les résines CBD" },
          { to: "/qualite-conformite", label: "Lire les engagements qualité" },
          { to: "/livraison-postale", label: "Voir la livraison postale" },
          { to: "/livraison-express-aix", label: "Voir la livraison locale" },
        ],
      },
      {
        type: "heading",
        id: "points-a-retenir",
        text: "Points à retenir",
      },
      {
        type: "list",
        items: [
          "une fleur CBD et une résine CBD ne se comparent pas sur un seul critère ;",
          "la texture et la présentation changent selon chaque référence ;",
          "les taux et indications ne doivent pas être généralisés ;",
          "la fiche produit reste la référence avant tout choix.",
        ],
      },
    ],
  },
  {
    slug: "indoor-greenhouse-hydroponique-differences",
    title:
      "Indoor, greenhouse ou hydroponique : comprendre les méthodes de culture",
    seoTitle: "Indoor, greenhouse et hydroponique : quelles différences ? | Verdanza",
    description:
      "Guide factuel pour comprendre indoor, greenhouse et hydroponique sur les fiches CBD Verdanza, avec distinction entre environnement et méthode de culture.",
    excerpt:
      "Indoor, greenhouse et hydroponique ne décrivent pas toujours le même niveau d’information. Ce guide aide à lire ces termes dans les fiches produit.",
    category: "Guide culture",
    authorName: "Rédaction Verdanza",
    datePublished: "2026-07-11T21:00:00+02:00",
    dateModified: "2026-07-11T21:00:00+02:00",
    readingTime: "8 min",
    status: "published",
    images: {
      square: "/images/blog/indoor-greenhouse-hydroponique-1x1.webp",
      landscape: "/images/blog/indoor-greenhouse-hydroponique-4x3.webp",
      wide: "/images/blog/indoor-greenhouse-hydroponique-16x9.webp",
    },
    relatedSlugs: [
      "fleur-cbd-ou-resine-cbd-differences",
      "comment-lire-analyse-cbd",
    ],
    links: [
      { to: "/fleurs-cbd", label: "Voir les fleurs CBD" },
      { to: "/qualite-conformite", label: "Qualité et conformité" },
      { to: "/blog/fleur-cbd-ou-resine-cbd-differences", label: "Fleur ou résine" },
      { to: "/blog/comment-lire-analyse-cbd", label: "Lire une analyse" },
      { to: "/blog", label: "Tous les guides" },
      { to: "/boutique", label: "Parcourir la boutique" },
    ],
    blocks: [
      {
        type: "paragraph",
        text: (
          <>
            Les termes indoor, greenhouse et hydroponique apparaissent souvent
            dans les catalogues CBD. Ils ne décrivent pas tous exactement la
            même chose. Indoor et greenhouse parlent d’abord de l’environnement
            de culture ; hydroponique décrit une méthode sans sol classique,
            avec une solution nutritive et un support adapté.
          </>
        ),
      },
      {
        type: "heading",
        id: "pourquoi-termes-fiches",
        text: "Pourquoi ces termes apparaissent-ils sur les fiches CBD ?",
      },
      {
        type: "paragraph",
        text: (
          <>
            Ces informations aident à situer une référence dans le catalogue.
            Elles peuvent éclairer la manière dont le lot est présenté,
            mais elles ne garantissent pas à elles seules une qualité, une
            richesse en CBD ou un profil aromatique précis. Les informations
            doivent toujours être lues avec le reste de la fiche.
          </>
        ),
      },
      {
        type: "heading",
        id: "culture-indoor",
        text: "La culture indoor",
      },
      {
        type: "paragraph",
        text: (
          <>
            Indoor désigne une culture en environnement intérieur. Cette mention
            indique que les paramètres comme la lumière, l’air ou l’organisation
            de l’espace sont gérés dans un cadre fermé.{" "}
            <Link to="/produits/cookie-kush-indoor">Cookie Kush Indoor</Link>{" "}
            illustre cette catégorie dans le catalogue Verdanza.
          </>
        ),
      },
      {
        type: "heading",
        id: "culture-greenhouse",
        text: "La culture greenhouse",
      },
      {
        type: "paragraph",
        text: (
          <>
            Greenhouse correspond à une culture sous serre. Elle s’appuie sur un
            environnement protégé, souvent associé à une part de lumière
            naturelle selon les conditions de production. Les fiches{" "}
            <Link to="/produits/petites-tetes-og-kush">Petites Têtes OG Kush</Link>{" "}
            et <Link to="/produits/harlequin-greenhouse">Harlequin Greenhouse</Link>{" "}
            sont des exemples sous serre.
          </>
        ),
      },
      {
        type: "heading",
        id: "culture-hydroponique",
        text: "La culture hydroponique",
      },
      {
        type: "paragraph",
        text: (
          <>
            Hydroponique décrit une méthode de culture sans sol classique. La
            plante repose sur un support adapté et reçoit son alimentation via
            une solution nutritive. Ce terme ne s’oppose pas toujours strictement
            à indoor ou greenhouse : une culture hydroponique peut être conduite
            dans différents environnements.
          </>
        ),
      },
      {
        type: "table",
        table: {
          caption:
            "Différence entre environnement de culture et méthode de culture.",
          headers: ["Terme", "Ce que le terme décrit", "Point de lecture"],
          rows: [
            [
              "Indoor",
              "Un environnement intérieur.",
              "Indique le cadre de culture, pas une garantie automatique.",
            ],
            [
              "Greenhouse",
              "Un environnement sous serre.",
              "Indique une culture protégée, avec des conditions variables selon la référence.",
            ],
            [
              "Hydroponique",
              "Une méthode sans sol classique avec solution nutritive.",
              "Peut exister dans plusieurs environnements de culture.",
            ],
          ],
        },
      },
      {
        type: "heading",
        id: "distinction-utile",
        text: "Environnement de culture et méthode de culture : une distinction utile",
      },
      {
        type: "paragraph",
        text: (
          <>
            La distinction évite de présenter les trois termes comme des cases
            parfaitement exclusives. Indoor et greenhouse situent le lieu ou le
            cadre de production. Hydroponique décrit davantage la façon dont la
            plante est alimentée et soutenue pendant sa culture. Pour vérifier
            ce qu’un document mesure réellement,{" "}
            <Link to="/blog/comment-lire-analyse-cbd">lire une analyse de CBD</Link>{" "}
            aide à séparer les données techniques des descriptions de culture.
          </>
        ),
      },
      {
        type: "heading",
        id: "ce-que-ces-methodes-peuvent-modifier",
        text: "Ce que ces méthodes peuvent modifier",
      },
      {
        type: "list",
        items: [
          "le niveau de contrôle de l’environnement ;",
          "la part de lumière naturelle ou artificielle ;",
          "le support de culture utilisé ;",
          "la manière dont l’eau et les nutriments sont apportés ;",
          "la régularité potentielle d’un lot.",
        ],
      },
      {
        type: "heading",
        id: "ce-quelles-ne-garantissent-pas",
        text: "Ce qu’elles ne permettent pas de garantir",
      },
      {
        type: "paragraph",
        text: (
          <>
            Une méthode ne garantit pas automatiquement qu’un produit sera
            meilleur, plus travaillé, plus riche en CBD ou plus aromatique qu’un
            autre. La lecture doit rester globale : origine, fiche produit,
            informations mesurées et aspect sont à considérer ensemble.
          </>
        ),
      },
      {
        type: "heading",
        id: "lire-fiche-verdanza",
        text: "Comment lire une fiche produit Verdanza",
      },
      {
        type: "paragraph",
        text: (
          <>
            Sur une fiche, commencez par la catégorie, puis regardez le mode de
            culture, l’origine, les arômes déclarés, les taux lorsqu’ils sont
            communiqués et la disponibilité. Quand un lot comporte aussi une
            analyse, reliez la lecture du document au reste de la fiche et{" "}
            <Link to="/blog/comment-lire-analyse-cbd">vérifiez les valeurs</Link>{" "}
            avant de conclure.
          </>
        ),
      },
      {
        type: "heading",
        id: "exemples-catalogue",
        text: "Exemples présents dans le catalogue",
      },
      {
        type: "links",
        title: "Exemples à comparer",
        links: [
          { to: "/produits/cookie-kush-indoor", label: "Cookie Kush Indoor" },
          { to: "/produits/harlequin-greenhouse", label: "Harlequin Greenhouse" },
          { to: "/produits/mango-haze-cbd", label: "Mango Haze CBD" },
          { to: "/produits/plutonium-cbd-hydroponique", label: "Plutonium CBD" },
          { to: "/fleurs-cbd", label: "Voir toutes les fleurs" },
        ],
      },
      {
        type: "heading",
        id: "points-a-retenir",
        text: "Points à retenir",
      },
      {
        type: "list",
        items: [
          "indoor décrit une culture en intérieur ;",
          "greenhouse décrit une culture sous serre ;",
          "hydroponique décrit une méthode sans sol classique ;",
          "ces termes ne sont pas toujours exclusifs ;",
          "la fiche produit complète reste la source de comparaison.",
        ],
      },
    ],
  },
];

export const publishedBlogArticles = blogArticles.filter(
  (article) => article.status === "published",
);

export function getBlogArticleBySlug(slug: string) {
  return blogArticles.find((article) => article.slug === slug);
}

export function getPublishedBlogArticleBySlug(slug: string) {
  return publishedBlogArticles.find((article) => article.slug === slug);
}

export function blogArticlePath(article: Pick<BlogArticle, "slug">) {
  return `/blog/${article.slug}`;
}

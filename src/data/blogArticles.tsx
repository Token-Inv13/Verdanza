import React from "react";
import { Link } from "react-router-dom";
import type { BlogArticle } from "../types/blog";

// Règle éditoriale du blog: garder des guides durables, centrés sur les catégories, et
// indépendants du stock, des prix, des promos ou des disponibilités temporaires.
export const blogArticles: BlogArticle[] = [
  {
    slug: "etiquette-numero-lot-cbd-tracabilite",
    title: "Étiquette et numéro de lot CBD : comment vérifier la traçabilité ?",
    seoTitle: "Étiquette et numéro de lot CBD : guide | Verdanza",
    description:
      "Savoir repérer le numéro de lot, relier l'étiquette à l'analyse CBD et vérifier la cohérence des informations de traçabilité avant de comparer un produit.",
    excerpt:
      "Numéro de lot, dénomination, analyse et coordonnées : ce guide aide à relier les informations utiles sans confondre emballage soigné et preuve de conformité.",
    category: "Guide qualité",
    authorName: "Rédaction Verdanza",
    datePublished: "2026-08-13T15:30:00+02:00",
    dateModified: "2026-08-13T15:30:00+02:00",
    readingTime: "7 min",
    status: "published",
    images: {
      square: "/images/blog/etiquette-numero-lot-cbd-tracabilite-1x1.webp",
      landscape: "/images/blog/etiquette-numero-lot-cbd-tracabilite-4x3.webp",
      wide: "/images/blog/etiquette-numero-lot-cbd-tracabilite-16x9.webp",
    },
    relatedSlugs: [
      "comment-lire-analyse-cbd",
      "denominations-cbd-cbn-cbg",
      "conserver-fleurs-resines-cbd",
    ],
    links: [
      { to: "/qualite-conformite", label: "Qualité et conformité" },
      {
        to: "/blog/comment-lire-analyse-cbd",
        label: "Lire une analyse CBD",
      },
      {
        to: "/blog/denominations-cbd-cbn-cbg",
        label: "Comprendre CBD, CBN et CBG",
      },
      {
        to: "/blog/conserver-fleurs-resines-cbd",
        label: "Conserver fleurs et résines CBD",
      },
    ],
    blocks: [
      {
        type: "paragraph",
        text: (
          <>
            Une étiquette de produit CBD rassemble plusieurs repères :
            dénomination, numéro de lot, composition annoncée, responsable du
            produit et parfois un lien vers une analyse. Les lire ensemble aide
            à identifier le produit consulté et à retrouver les informations
            qui correspondent réellement au lot.
          </>
        ),
      },
      {
        type: "note",
        text: (
          <>
            Repère Verdanza : la présentation de l'emballage ne prouve pas à
            elle seule la composition ou la conformité. La vérification repose
            sur la cohérence entre l'étiquette, la fiche, le numéro de lot et
            l'analyse disponible.
          </>
        ),
      },
      {
        type: "heading",
        id: "role-numero-lot",
        text: "À quoi sert le numéro de lot ?",
      },
      {
        type: "paragraph",
        text: (
          <>
            Le numéro de lot est un identifiant attribué à un ensemble de
            produits issus d'une même série. Il permet de rattacher un
            emballage à des documents et à un suivi précis. Deux sachets portant
            le même nom commercial peuvent provenir de lots différents : leurs
            photographies, leurs dates ou leurs valeurs mesurées ne doivent donc
            pas être supposées identiques.
          </>
        ),
      },
      {
        type: "table",
        table: {
          caption: "Les principaux repères à croiser sur un produit CBD.",
          headers: ["Information", "Ce qu'elle permet de vérifier", "Point d'attention"],
          rows: [
            [
              "Dénomination",
              "Le type et le nom du produit présenté.",
              "Ne pas la confondre avec une mesure de composition.",
            ],
            [
              "Numéro de lot",
              "Le rattachement à une série et à son analyse.",
              "L'identifiant doit être lisible et cohérent entre les supports.",
            ],
            [
              "Composition annoncée",
              "Les ingrédients ou caractéristiques déclarés.",
              "Vérifier les unités et la portée exacte des valeurs.",
            ],
            [
              "Responsable du produit",
              "L'interlocuteur indiqué pour une demande de vérification.",
              "Chercher des coordonnées suffisamment précises.",
            ],
            [
              "Conditions de conservation",
              "Les précautions prévues pour préserver le produit.",
              "Les appliquer sans les remplacer par une règle générale.",
            ],
          ],
        },
      },
      {
        type: "heading",
        id: "retrouver-identifiant",
        text: "Où chercher l'identifiant de lot ?",
      },
      {
        type: "paragraph",
        text: (
          <>
            Selon le conditionnement, l'identifiant peut être imprimé sur une
            étiquette, apposé près d'une fermeture, inscrit au dos du sachet ou
            associé à un code donnant accès à un document. Les mentions
            « lot », « batch » ou une suite alphanumérique sont fréquentes. Un
            code QR n'est toutefois qu'un moyen d'accès : il faut encore
            vérifier le document ouvert et le lot auquel il se rapporte.
          </>
        ),
      },
      {
        type: "heading",
        id: "relier-analyse",
        text: "Relier l'étiquette à l'analyse correspondante",
      },
      {
        type: "paragraph",
        text: (
          <>
            Une analyse utile doit pouvoir être rapprochée du produit consulté.
            Commencez par comparer l'identifiant de lot, puis la dénomination et
            les dates lorsqu'elles sont indiquées. Le guide sur la{" "}
            <Link to="/blog/comment-lire-analyse-cbd">
              lecture d'une analyse CBD
            </Link>{" "}
            détaille ensuite les unités, les cannabinoïdes recherchés et les
            limites de mesure.
          </>
        ),
      },
      {
        type: "list",
        items: [
          "comparer le numéro de lot de l'emballage et celui du document ;",
          "vérifier que la dénomination correspond au produit consulté ;",
          "identifier la date de l'analyse et le laboratoire mentionné ;",
          "lire les unités avant de rapprocher deux valeurs ;",
          "distinguer une valeur mesurée d'une simple mention commerciale.",
        ],
      },
      {
        type: "heading",
        id: "coherence-denominations-unites",
        text: "Dénominations et unités : contrôler la cohérence",
      },
      {
        type: "paragraph",
        text: (
          <>
            Les sigles CBD, CBN, CBG ou THC désignent des cannabinoïdes
            différents. Une valeur associée à l'un ne décrit pas les autres.
            De même, un pourcentage et une valeur en milligrammes ne se
            comparent pas directement sans connaître la base de calcul. Le
            guide sur les{" "}
            <Link to="/blog/denominations-cbd-cbn-cbg">
              dénominations CBD, CBN et CBG
            </Link>{" "}
            aide à séparer les sigles de leurs valeurs mesurées.
          </>
        ),
      },
      {
        type: "heading",
        id: "informations-divergentes",
        text: "Que faire si les informations ne correspondent pas ?",
      },
      {
        type: "paragraph",
        text: (
          <>
            Si le lot est absent, illisible ou différent de celui de l'analyse,
            il vaut mieux suspendre la comparaison et demander une précision au
            vendeur. Conserver une photo de l'étiquette, du produit et du
            document consulté permet de formuler une demande factuelle. Une
            différence n'explique pas à elle seule son origine : elle signale
            d'abord qu'une vérification est nécessaire.
          </>
        ),
      },
      {
        type: "note",
        text: (
          <>
            Un nom commercial identique ne garantit pas que deux documents
            concernent le même lot. L'identifiant du lot reste le point de
            rapprochement prioritaire.
          </>
        ),
      },
      {
        type: "heading",
        id: "checklist-reception",
        text: "Checklist de traçabilité à la réception",
      },
      {
        type: "list",
        items: [
          "repérer la dénomination exacte et le numéro de lot ;",
          "vérifier que l'emballage est lisible et correspond à la commande ;",
          "retrouver l'analyse associée lorsque celle-ci est fournie ;",
          "croiser le lot, les dates, les unités et les cannabinoïdes indiqués ;",
          "conserver l'emballage et l'identifiant en cas de question ;",
          "contacter le vendeur si un repère manque ou reste incohérent.",
        ],
      },
      {
        type: "paragraph",
        text: (
          <>
            Après cette vérification, les indications propres au produit
            restent prioritaires pour son stockage. Le guide consacré à la{" "}
            <Link to="/blog/conserver-fleurs-resines-cbd">
              conservation des fleurs et résines CBD
            </Link>{" "}
            permet de compléter ces repères sans remplacer les mentions de
            l'emballage.
          </>
        ),
      },
      {
        type: "links",
        title: "Compléter la vérification",
        links: [
          { to: "/blog/comment-lire-analyse-cbd", label: "Lire une analyse CBD" },
          {
            to: "/blog/denominations-cbd-cbn-cbg",
            label: "Comprendre CBD, CBN et CBG",
          },
          {
            to: "/blog/conserver-fleurs-resines-cbd",
            label: "Conserver fleurs et résines CBD",
          },
          { to: "/qualite-conformite", label: "Qualité et conformité" },
        ],
      },
    ],
  },
  {
    slug: "aspect-resine-cbd-texture-couleur",
    title: "Résine CBD : comment lire texture, couleur et présentation ?",
    seoTitle: "Aspect d'une résine CBD : texture et couleur | Verdanza",
    description:
      "Apprendre à décrire une résine CBD par sa texture, sa couleur et son grain, sans confondre apparence, composition mesurée et qualité du lot.",
    excerpt:
      "Souple, friable, crémeuse, claire ou foncée : l'apparence d'une résine donne des repères descriptifs, mais ne remplace ni la fiche du produit ni l'analyse du lot.",
    category: "Guide produits",
    authorName: "Rédaction Verdanza",
    datePublished: "2026-08-10T11:00:00+02:00",
    dateModified: "2026-08-10T11:00:00+02:00",
    readingTime: "7 min",
    status: "published",
    images: {
      square: "/images/blog/aspect-resine-cbd-texture-couleur-1x1.webp",
      landscape: "/images/blog/aspect-resine-cbd-texture-couleur-4x3.webp",
      wide: "/images/blog/aspect-resine-cbd-texture-couleur-16x9.webp",
    },
    relatedSlugs: [
      "fleur-cbd-ou-resine-cbd-differences",
      "conserver-fleurs-resines-cbd",
      "comment-lire-analyse-cbd",
    ],
    links: [
      { to: "/resines-cbd", label: "Voir les résines CBD" },
      { to: "/qualite-conformite", label: "Qualité et conformité" },
      {
        to: "/blog/comment-lire-analyse-cbd",
        label: "Lire une analyse CBD",
      },
      {
        to: "/blog/conserver-fleurs-resines-cbd",
        label: "Conserver fleurs et résines CBD",
      },
    ],
    blocks: [
      {
        type: "paragraph",
        text: (
          <>
            L'aspect d'une <Link to="/resines-cbd">résine CBD</Link> peut être
            décrit avec des mots simples : couleur, grain, souplesse, caractère
            friable ou surface plus homogène. Ces observations aident à comparer
            des présentations. Elles ne suffisent pas à déterminer la composition,
            la conformité ou la qualité globale d'un lot.
          </>
        ),
      },
      {
        type: "note",
        text: (
          <>
            Repère Verdanza : une photo montre la présentation d'un produit à un
            instant donné. Les teneurs annoncées et les informations de
            traçabilité doivent être vérifiées sur la fiche et l'analyse du lot.
          </>
        ),
      },
      {
        type: "heading",
        id: "pourquoi-aspect-varie",
        text: "Pourquoi l'aspect d'une résine CBD varie-t-il ?",
      },
      {
        type: "paragraph",
        text: (
          <>
            La matière végétale utilisée, le tamisage ou la filtration annoncée,
            la pression, la température de travail et la conservation participent
            à la présentation finale. Une même référence peut aussi évoluer
            légèrement d'un lot à l'autre. La température ambiante compte : une
            résine peut paraître plus ferme au frais et plus souple lorsqu'elle se
            réchauffe.
          </>
        ),
      },
      {
        type: "table",
        table: {
          caption: "Repères pour décrire une résine sans conclure trop vite.",
          headers: ["Élément observé", "Ce qu'il décrit", "Ce qu'il ne prouve pas"],
          rows: [
            [
              "Couleur",
              "Une teinte claire, dorée, brune, sombre ou nuancée.",
              "La teneur en CBD ou la conformité du lot.",
            ],
            [
              "Texture",
              "Un aspect friable, souple, dense, malléable ou crémeux.",
              "La méthode de fabrication exacte à elle seule.",
            ],
            [
              "Grain",
              "Une structure fine, poudreuse, granuleuse ou homogène.",
              "La pureté ou la concentration mesurée.",
            ],
            [
              "Surface",
              "Un rendu mat, satiné, lisse ou irrégulier.",
              "Un profil aromatique ou une qualité supérieure.",
            ],
          ],
        },
      },
      {
        type: "heading",
        id: "couleur-nuances",
        text: "Couleur et nuances : tenir compte de la lumière",
      },
      {
        type: "paragraph",
        text: (
          <>
            Une résine peut présenter des tons beige, blond, doré, caramel ou
            brun, parfois avec un cœur différent de la surface. L'éclairage, la
            balance des blancs et l'écran changent fortement le rendu d'une
            photo. Une couleur claire n'établit pas automatiquement une
            filtration plus fine, pas plus qu'une couleur sombre ne signale à
            elle seule un défaut.
          </>
        ),
      },
      {
        type: "heading",
        id: "vocabulaire-texture",
        text: "Friable, souple ou crémeuse : un vocabulaire descriptif",
      },
      {
        type: "paragraph",
        text: (
          <>
            Les mots employés sur une fiche servent d'abord à décrire la façon
            dont la résine se présente. Ils ne constituent ni une échelle de
            qualité universelle ni une mesure de laboratoire. Pour comparer deux
            références, il faut vérifier que les descriptions portent sur des
            produits conservés dans des conditions proches.
          </>
        ),
      },
      {
        type: "list",
        items: [
          "friable : le bloc se divise facilement en fragments ;",
          "souple ou malléable : la forme change sous une légère pression ;",
          "dense ou compacte : la matière présente peu d'espaces visibles ;",
          "poudreuse ou granuleuse : le grain reste perceptible en surface ;",
          "crémeuse : la présentation paraît lisse et très souple.",
        ],
      },
      {
        type: "note",
        text: (
          <>
            Ces termes décrivent un état observé, sensible notamment à la
            température et au stockage. Ils ne permettent pas d'estimer un taux
            de cannabinoïdes.
          </>
        ),
      },
      {
        type: "heading",
        id: "fabrication-et-apparence",
        text: "Ce que l'apparence dit de la fabrication — et ses limites",
      },
      {
        type: "paragraph",
        text: (
          <>
            Des mentions comme tamisage, filtration, pressage ou affinage
            décrivent des étapes annoncées par le fabricant. L'aspect peut être
            cohérent avec ce vocabulaire, mais il ne permet pas de reconstituer
            seul le procédé. Une information de fabrication fiable doit rester
            rattachée à la fiche, au fournisseur et au lot concerné.
          </>
        ),
      },
      {
        type: "heading",
        id: "variation-ou-alteration",
        text: "Variation normale ou signe d'altération ?",
      },
      {
        type: "paragraph",
        text: (
          <>
            Une variation de couleur ou de fermeté peut être naturelle ou liée à
            la température. En revanche, une zone cotonneuse, un dépôt inhabituel,
            une odeur anormale ou une humidité manifestement excessive appellent
            à ne pas utiliser le produit et à contacter le vendeur. Conserver
            l'emballage et le numéro de lot facilite alors la vérification.
          </>
        ),
      },
      {
        type: "heading",
        id: "croiser-informations",
        text: "Croiser l'aspect, la fiche et l'analyse du lot",
      },
      {
        type: "paragraph",
        text: (
          <>
            Une lecture complète combine la photo pour la présentation, la fiche
            pour le vocabulaire de texture et de fabrication, puis l'analyse pour
            les valeurs mesurées. Le guide sur la{" "}
            <Link to="/blog/comment-lire-analyse-cbd">lecture d'une analyse CBD</Link>{" "}
            aide à vérifier le lot, les unités et les limites de mesure. Celui sur
            la{" "}
            <Link to="/blog/conserver-fleurs-resines-cbd">
              conservation des fleurs et résines
            </Link>{" "}
            détaille les précautions de stockage utiles après réception.
          </>
        ),
      },
      {
        type: "heading",
        id: "checklist-visuelle",
        text: "Checklist pour lire une résine sans surinterpréter",
      },
      {
        type: "list",
        items: [
          "décrire la couleur sans lui attribuer automatiquement un niveau de qualité ;",
          "noter la texture à température comparable ;",
          "distinguer le grain visible d'une mesure de pureté ;",
          "vérifier que la photo correspond bien à la référence consultée ;",
          "croiser l'apparence avec la fiche, le lot et l'analyse disponible ;",
          "signaler au vendeur tout dépôt, odeur ou humidité inhabituels.",
        ],
      },
      {
        type: "links",
        title: "Compléter vos repères",
        links: [
          { to: "/blog/comment-lire-analyse-cbd", label: "Lire une analyse CBD" },
          {
            to: "/blog/fleur-cbd-ou-resine-cbd-differences",
            label: "Comparer fleur et résine",
          },
          {
            to: "/blog/conserver-fleurs-resines-cbd",
            label: "Bien conserver fleurs et résines",
          },
          { to: "/qualite-conformite", label: "Qualité et conformité" },
        ],
      },
    ],
  },
  {
    slug: "aspect-fleur-cbd-couleur-structure",
    title: "Fleur CBD : comment lire son aspect sans surinterpréter ?",
    seoTitle: "Aspect d'une fleur CBD : couleur et structure | Verdanza",
    description:
      "Apprendre à observer une fleur CBD : couleur, structure, manucure et densité apparente, sans confondre aspect visuel et preuve de qualité.",
    excerpt:
      "Couleur, forme, feuilles et densité donnent des repères descriptifs. Ce guide aide à les lire sans en tirer de conclusions que seule une analyse de lot peut confirmer.",
    category: "Guide produits",
    authorName: "Rédaction Verdanza",
    datePublished: "2026-08-03T11:00:00+02:00",
    dateModified: "2026-08-03T11:00:00+02:00",
    readingTime: "7 min",
    status: "published",
    images: {
      square: "/images/blog/aspect-fleur-cbd-couleur-structure-1x1.webp",
      landscape: "/images/blog/aspect-fleur-cbd-couleur-structure-4x3.webp",
      wide: "/images/blog/aspect-fleur-cbd-couleur-structure-16x9.webp",
    },
    relatedSlugs: [
      "indoor-greenhouse-hydroponique-differences",
      "comment-lire-analyse-cbd",
      "conserver-fleurs-resines-cbd",
    ],
    links: [
      { to: "/fleurs-cbd", label: "Voir les fleurs CBD" },
      { to: "/qualite-conformite", label: "Qualité et conformité" },
      {
        to: "/blog/comment-lire-analyse-cbd",
        label: "Lire une analyse CBD",
      },
      {
        to: "/blog/conserver-fleurs-resines-cbd",
        label: "Conserver fleurs et résines CBD",
      },
    ],
    blocks: [
      {
        type: "paragraph",
        text: (
          <>
            L'aspect d'une <Link to="/fleurs-cbd">fleur CBD</Link> donne des
            repères utiles pour la décrire : couleur dominante, forme,
            présence de petites feuilles, densité apparente ou régularité de la
            manucure. Ces observations restent visuelles. Elles ne permettent
            pas, à elles seules, de connaître la composition, la conformité ou
            la qualité globale d'un lot.
          </>
        ),
      },
      {
        type: "note",
        text: (
          <>
            Repère Verdanza : une photo et un examen visuel décrivent un produit.
            Pour vérifier des teneurs en cannabinoïdes ou la conformité d'un
            lot, il faut consulter les informations de traçabilité et l'analyse
            correspondante.
          </>
        ),
      },
      {
        type: "heading",
        id: "pourquoi-aspect-varie",
        text: "Pourquoi l'aspect d'une fleur CBD varie-t-il ?",
      },
      {
        type: "paragraph",
        text: (
          <>
            Deux fleurs peuvent présenter des silhouettes très différentes sans
            que l'une soit automatiquement meilleure que l'autre. La variété,
            l'environnement de culture, la position de la fleur sur la plante,
            le séchage, le tri et la conservation participent à l'aspect final.
            Des écarts peuvent également exister entre deux lots d'une même
            référence, car il s'agit d'un produit végétal.
          </>
        ),
      },
      {
        type: "table",
        table: {
          caption: "Repères pour décrire une fleur sans conclure trop vite.",
          headers: ["Élément observé", "Ce qu'il décrit", "Ce qu'il ne prouve pas"],
          rows: [
            [
              "Couleur",
              "La teinte dominante et ses nuances.",
              "Le taux de CBD ou la conformité du lot.",
            ],
            [
              "Structure",
              "Une fleur compacte, allongée, aérée ou irrégulière.",
              "La méthode de culture à elle seule.",
            ],
            [
              "Manucure",
              "La quantité visible de petites feuilles et de tiges.",
              "La composition mesurée du produit.",
            ],
            [
              "Aspect résineux",
              "La présence visible de trichomes en surface.",
              "Une teneur précise en cannabinoïdes ou en terpènes.",
            ],
          ],
        },
      },
      {
        type: "heading",
        id: "couleur-nuances",
        text: "Couleur et nuances : décrire avant d'interpréter",
      },
      {
        type: "paragraph",
        text: (
          <>
            Une fleur peut aller du vert clair au vert profond, avec parfois des
            nuances violettes, orangées, brunes ou dorées. Les pistils peuvent
            aussi créer des contrastes. L'éclairage, la balance des couleurs de
            l'appareil et l'écran modifient fortement le rendu : une photo de
            catalogue ne doit donc pas servir de référence colorimétrique
            absolue.
          </>
        ),
      },
      {
        type: "heading",
        id: "structure-densite",
        text: "Structure et densité apparente",
      },
      {
        type: "paragraph",
        text: (
          <>
            Une structure compacte rassemble les parties de la fleur dans un
            volume serré. Une structure plus aérée laisse davantage d'espace
            entre elles. Cette différence peut accompagner la morphologie de la
            variété ou son environnement de culture. Elle ne permet pas de
            déduire un taux de CBD, une intensité aromatique ou une méthode de
            culture avec certitude.
          </>
        ),
      },
      {
        type: "heading",
        id: "manucure-trichomes",
        text: "Manucure, petites feuilles et trichomes",
      },
      {
        type: "paragraph",
        text: (
          <>
            La manucure désigne le retrait des feuilles et des tiges les plus
            visibles autour de la fleur. Une présentation très nette et une
            présentation plus végétale peuvent toutes deux être décrites sans
            jugement automatique. Les trichomes, qui donnent parfois un aspect
            poudré ou brillant, restent eux aussi un indice visuel : leur
            présence ne remplace pas une mesure de laboratoire.
          </>
        ),
      },
      {
        type: "list",
        items: [
          "observer la proportion de fleur, de petites feuilles et de tige ;",
          "distinguer un détail naturel d'un signe d'altération ;",
          "éviter d'estimer une teneur à partir d'une surface brillante ;",
          "tenir compte du cadrage et du grossissement de la photo ;",
          "comparer des images prises dans des conditions proches.",
        ],
      },
      {
        type: "heading",
        id: "fraicheur-alteration",
        text: "Aspect normal ou signe d'altération ?",
      },
      {
        type: "paragraph",
        text: (
          <>
            Les variations naturelles ne doivent pas être confondues avec une
            altération. Une zone cotonneuse, un dépôt inhabituel, une odeur
            anormale ou une humidité manifestement excessive appellent à ne pas
            utiliser le produit et à contacter le vendeur. À l'inverse, une
            teinte sombre ou une structure irrégulière n'est pas, isolément, une
            preuve de défaut.
          </>
        ),
      },
      {
        type: "note",
        text: (
          <>
            En cas de doute à la réception, conservez l'emballage et les
            informations de lot, prenez des photos sous une lumière neutre et
            contactez Verdanza avant toute autre manipulation.
          </>
        ),
      },
      {
        type: "heading",
        id: "croiser-informations",
        text: "Croiser l'image avec la fiche et l'analyse",
      },
      {
        type: "paragraph",
        text: (
          <>
            La lecture la plus fiable combine plusieurs niveaux d'information :
            la photo pour la présentation, la fiche pour la variété, le profil
            aromatique et la culture annoncée, puis l'analyse pour les données
            mesurées. Le guide sur les{" "}
            <Link to="/blog/indoor-greenhouse-hydroponique-differences">
              méthodes de culture
            </Link>{" "}
            aide à comprendre le vocabulaire, tandis que celui sur la{" "}
            <Link to="/blog/comment-lire-analyse-cbd">lecture d'une analyse CBD</Link>{" "}
            détaille les unités, le lot et les limites de mesure.
          </>
        ),
      },
      {
        type: "heading",
        id: "checklist-visuelle",
        text: "Checklist de lecture visuelle",
      },
      {
        type: "list",
        items: [
          "décrire la couleur sans l'associer automatiquement à la qualité ;",
          "noter si la structure paraît compacte, aérée ou irrégulière ;",
          "observer la manucure sans en déduire la composition ;",
          "vérifier que la photo correspond bien à la référence consultée ;",
          "croiser l'aspect avec la fiche, le lot et l'analyse disponible ;",
          "appliquer de bonnes conditions de conservation après réception.",
        ],
      },
      {
        type: "links",
        title: "Compléter vos repères",
        links: [
          { to: "/blog/comment-lire-analyse-cbd", label: "Lire une analyse CBD" },
          {
            to: "/blog/conserver-fleurs-resines-cbd",
            label: "Bien conserver fleurs et résines",
          },
          { to: "/qualite-conformite", label: "Qualité et conformité" },
        ],
      },
    ],
  },
  {
    slug: "terpenes-profils-aromatiques-cbd",
    title: "Terpènes et profils aromatiques CBD : comment les lire ?",
    seoTitle: "Terpènes CBD et profils aromatiques : guide de lecture | Verdanza",
    description:
      "Comprendre les terpènes et les profils aromatiques d'une fleur ou d'une résine CBD : notes, intensité, équilibre et limites de lecture.",
    excerpt:
      "Un guide simple pour lire les notes aromatiques d'une fiche CBD sans confondre description sensorielle, qualité globale et promesse d'effet.",
    category: "Guide produits",
    authorName: "Rédaction Verdanza",
    datePublished: "2026-07-30T09:00:00+02:00",
    dateModified: "2026-07-30T09:00:00+02:00",
    readingTime: "7 min",
    status: "published",
    images: {
      square: "/images/blog/terpenes-profils-aromatiques-cbd-1x1.webp",
      landscape: "/images/blog/terpenes-profils-aromatiques-cbd-4x3.webp",
      wide: "/images/blog/terpenes-profils-aromatiques-cbd-16x9.webp",
    },
    relatedSlugs: [
      "choisir-fleur-cbd-profil-aromatique",
      "fleur-cbd-ou-resine-cbd-differences",
      "comment-lire-analyse-cbd",
    ],
    links: [
      { to: "/fleurs-cbd", label: "Voir les fleurs CBD" },
      { to: "/resines-cbd", label: "Voir les résines CBD" },
      {
        to: "/blog/choisir-fleur-cbd-profil-aromatique",
        label: "Choisir une fleur par profil aromatique",
      },
      { to: "/blog/comment-lire-analyse-cbd", label: "Lire une analyse CBD" },
      { to: "/qualite-conformite", label: "Qualité et conformité" },
    ],
    blocks: [
      {
        type: "paragraph",
        text: (
          <>
            Sur une fiche CBD, les terpènes et les notes aromatiques servent à
            décrire l'identité sensorielle d'une référence. Ils aident à lire un
            produit avec plus de précision, mais ils ne remplacent ni une analyse
            de lot, ni l'observation de la texture, ni les informations de
            conformité. Ce guide explique comment utiliser ces indications sans
            leur donner un rôle qu'elles n'ont pas.
          </>
        ),
      },
      {
        type: "note",
        text: (
          <>
            Repère Verdanza : un profil aromatique décrit des odeurs, des notes
            et un équilibre général. Il ne doit pas être lu comme une promesse
            d'effet, une garantie de qualité ou une indication médicale.
          </>
        ),
      },
      {
        type: "heading",
        id: "terpenes-definition",
        text: "Que sont les terpènes ?",
      },
      {
        type: "paragraph",
        text: (
          <>
            Les terpènes sont des composés aromatiques présents dans de nombreux
            végétaux. Dans l'univers du chanvre, ils participent aux notes
            perçues autour d'une fleur ou d'une résine : agrumes, pin, épices,
            fruits, notes végétales, terreuses ou gourmandes selon les lots et
            les références.
          </>
        ),
      },
      {
        type: "heading",
        id: "profil-aromatique",
        text: "Qu'est-ce qu'un profil aromatique ?",
      },
      {
        type: "paragraph",
        text: (
          <>
            Un profil aromatique rassemble les impressions principales d'une
            référence. Il peut être court, avec deux ou trois notes dominantes,
            ou plus détaillé lorsqu'une fiche distingue l'attaque, le fond et
            l'équilibre global. Pour comparer deux produits, il faut lire ces
            mots comme une description, pas comme une mesure scientifique.
          </>
        ),
      },
      {
        type: "table",
        table: {
          caption: "Exemples de familles aromatiques souvent utilisées.",
          headers: ["Famille", "Exemples de notes", "Lecture utile"],
          rows: [
            [
              "Fruitée",
              "agrumes, fruits jaunes, fruits mûrs",
              "Souvent utilisée pour décrire une impression vive ou ronde.",
            ],
            [
              "Végétale",
              "herbe fraîche, chlorophylle, chanvre",
              "À lire avec l'aspect et le mode de culture indiqués.",
            ],
            [
              "Boisée",
              "pin, résineux, bois sec",
              "Peut apparaître sur des fleurs comme sur certaines résines.",
            ],
            [
              "Épicée",
              "poivre, notes chaudes, fond plus marqué",
              "Ne signifie pas automatiquement intensité globale plus forte.",
            ],
            [
              "Gourmande",
              "crémeux, biscuité, douceur aromatique",
              "Dépend beaucoup de la référence et du vocabulaire de fiche.",
            ],
          ],
        },
      },
      {
        type: "heading",
        id: "intensite-equilibre",
        text: "Intensité, équilibre et dominante",
      },
      {
        type: "paragraph",
        text: (
          <>
            Trois mots reviennent souvent : intensité, équilibre et dominante.
            L'intensité indique qu'une note est plus ou moins présente.
            L'équilibre décrit la manière dont les notes se répondent. La
            dominante signale l'axe principal de lecture, par exemple fruité,
            végétal ou boisé.
          </>
        ),
      },
      {
        type: "list",
        items: [
          "une dominante ne résume pas tout le produit ;",
          "une note secondaire peut changer la lecture générale ;",
          "une intensité aromatique n'est pas un taux de CBD ;",
          "deux fiches peuvent utiliser des mots proches pour des profils différents ;",
          "le lot, la conservation et la présentation influencent aussi la perception.",
        ],
      },
      {
        type: "heading",
        id: "fleurs-resines",
        text: "Fleurs et résines : même logique de lecture ?",
      },
      {
        type: "paragraph",
        text: (
          <>
            Les <Link to="/fleurs-cbd">fleurs CBD</Link> sont souvent décrites à
            partir de leur variété, de leur aspect, de leur culture et de leurs
            notes dominantes. Les <Link to="/resines-cbd">résines CBD</Link>{" "}
            peuvent mettre davantage l'accent sur la texture, la préparation et
            une impression aromatique plus compacte ou plus ronde. Dans les deux
            cas, la fiche reste la référence principale.
          </>
        ),
      },
      {
        type: "heading",
        id: "limites",
        text: "Ce que les terpènes ne disent pas",
      },
      {
        type: "paragraph",
        text: (
          <>
            Un profil terpénique ou aromatique ne suffit pas à conclure sur la
            qualité globale d'un produit. Il ne remplace pas la{" "}
            <Link to="/blog/comment-lire-analyse-cbd">lecture d'une analyse CBD</Link>,
            les informations de conformité, l'origine, le mode de culture ou la
            présentation réelle du lot.
          </>
        ),
      },
      {
        type: "heading",
        id: "lire-fiche",
        text: "Comment lire une fiche Verdanza",
      },
      {
        type: "list",
        items: [
          "repérer la catégorie : fleur, résine ou autre format ;",
          "lire les notes aromatiques comme une description sensorielle ;",
          "distinguer les arômes des taux mesurés ;",
          "vérifier les informations de lot quand elles sont disponibles ;",
          "comparer les références avec le même niveau de prudence.",
        ],
      },
      {
        type: "links",
        title: "Compléter la lecture",
        links: [
          {
            to: "/blog/choisir-fleur-cbd-profil-aromatique",
            label: "Choisir une fleur par profil aromatique",
          },
          {
            to: "/blog/fleur-cbd-ou-resine-cbd-differences",
            label: "Comparer fleur et résine",
          },
          { to: "/qualite-conformite", label: "Qualité et conformité" },
        ],
      },
    ],
  },
  {
    slug: "cbd-conduite-france",
    title: "CBD et conduite en France : ce qu'il faut savoir",
    seoTitle: "CBD et conduite en France : loi, THC et précautions - Verdanza",
    description:
      "Le CBD est-il compatible avec la conduite en France ? Comprendre la réglementation, le risque lié au THC et les précautions avant de prendre le volant.",
    excerpt:
      "Un produit CBD peut être légal à la vente, mais la conduite reste risquée si du THC est détecté lors d'un contrôle. Voici les repères à connaître avant de prendre le volant.",
    category: "Guide CBD",
    authorName: "Rédaction Verdanza",
    datePublished: "2026-07-23T16:27:36+02:00",
    dateModified: "2026-07-23T16:27:36+02:00",
    readingTime: "7 min",
    status: "published",
    images: {
      square: "/images/blog/cbd-conduite-france-1x1.webp",
      landscape: "/images/blog/cbd-conduite-france-4x3.webp",
      wide: "/images/blog/cbd-conduite-france-16x9.webp",
    },
    relatedSlugs: [
      "denominations-cbd-cbn-cbg",
      "comment-lire-analyse-cbd",
      "conserver-fleurs-resines-cbd",
    ],
    links: [
      { to: "/qualite-conformite", label: "Qualité et conformité" },
      { to: "/blog/denominations-cbd-cbn-cbg", label: "Comprendre CBD, CBN et CBG" },
      { to: "/blog/comment-lire-analyse-cbd", label: "Lire une analyse CBD" },
      { to: "/contact", label: "Contacter Verdanza" },
    ],
    blocks: [
      {
        type: "paragraph",
        text: (
          <>
            La question revient souvent : le CBD est-il compatible avec la
            conduite ? La réponse doit rester prudente. En France, un produit CBD
            peut être légal à la vente sous certaines conditions, mais cela ne
            signifie pas que conduire après consommation soit sans risque. Le
            droit routier s'intéresse notamment à la détection de substances
            classées comme stupéfiants, dont le THC.
          </>
        ),
      },
      {
        type: "note",
        text: (
          <>
            Repère simple : CBD légal ne veut pas dire conduite sans risque. Si
            du THC est détecté lors d'un contrôle, la situation peut devenir
            juridiquement sensible, même lorsque le produit consommé était
            présenté comme un produit CBD conforme.
          </>
        ),
      },
      {
        type: "heading",
        id: "cbd-legal-france",
        text: "Le CBD est-il légal en France ?",
      },
      {
        type: "paragraph",
        text: (
          <>
            Les produits issus du chanvre peuvent être commercialisés sous
            conditions. L'arrêté du 30 décembre 2021 fixe notamment un seuil
            maximal de 0,30 % de delta-9-THC pour les extraits de chanvre et les
            produits qui les intègrent. Ce seuil concerne la conformité du
            produit. Il ne doit pas être confondu avec une autorisation de
            conduire après consommation.
          </>
        ),
      },
      {
        type: "heading",
        id: "pourquoi-conduite-probleme",
        text: "Pourquoi la conduite sous CBD peut poser problème ?",
      },
      {
        type: "paragraph",
        text: (
          <>
            Certains produits CBD peuvent contenir des traces de THC. Même en
            présence d'un produit conforme à la réglementation commerciale, un
            contrôle routier peut rechercher la présence de THC. Il ne faut donc
            pas confondre deux sujets : la légalité d'un produit à la vente et la
            sécurité juridique du conducteur au moment d'un contrôle.
          </>
        ),
      },
      {
        type: "list",
        items: [
          "un produit CBD conforme peut contenir des traces de THC ;",
          "un test routier ne sert pas à valider une fiche produit ;",
          "le conducteur reste exposé si l'usage de stupéfiants est établi par analyse ;",
          "aucun délai universel ne permet de garantir l'absence de risque.",
        ],
      },
      {
        type: "heading",
        id: "code-route",
        text: "Que dit le Code de la route ?",
      },
      {
        type: "paragraph",
        text: (
          <>
            L'article L235-1 du Code de la route vise la conduite lorsqu'il
            résulte d'une analyse sanguine ou salivaire que la personne a fait
            usage de substances ou plantes classées comme stupéfiants. Le texte
            prévoit des sanctions importantes, notamment jusqu'à trois ans
            d'emprisonnement et 9 000 euros d'amende. Le refus de se soumettre
            aux vérifications prévues par l'article L235-2 est sanctionné
            distinctement : jusqu'à deux ans d'emprisonnement et 4 500 euros
            d'amende.
          </>
        ),
      },
      {
        type: "table",
        table: {
          caption: "Repères à connaître en cas de contrôle routier.",
          headers: ["Sujet", "Point de vigilance"],
          rows: [
            [
              "Dépistage",
              "Les contrôles peuvent commencer par des épreuves de dépistage.",
            ],
            [
              "Confirmation",
              "L'usage peut être établi par analyse salivaire ou sanguine selon le cadre prévu.",
            ],
            [
              "Sanctions",
              "Les sanctions peuvent inclure amende, retrait de points, suspension ou autres peines selon la situation.",
            ],
            [
              "Refus",
              "Le refus de vérification peut être sanctionné distinctement.",
            ],
          ],
        },
      },
      {
        type: "heading",
        id: "justice-cbd-thc",
        text: "CBD légal et THC détecté : ce qu'a rappelé la justice",
      },
      {
        type: "paragraph",
        text: (
          <>
            Dans une décision du 21 juin 2023, la Cour de cassation a rappelé
            que l'autorisation de commercialisation de certains produits à base de
            CBD contenant une teneur admise en THC est sans incidence sur
            l'incrimination de conduite après usage de stupéfiants lorsque
            l'infraction est constituée par la présence de THC. Autrement dit, le
            seuil réglementaire applicable aux produits CBD n'est pas un seuil
            d'incrimination routière, et le fait d'avoir consommé un produit
            présenté comme CBD légal ne suffit pas nécessairement à écarter le
            risque juridique.
          </>
        ),
      },
      {
        type: "heading",
        id: "risques-controle",
        text: "Quels risques en cas de contrôle ?",
      },
      {
        type: "paragraph",
        text: (
          <>
            En cas de contrôle positif ou de procédure, les conséquences peuvent
            être sérieuses : retrait de points, immobilisation possible du
            véhicule, suspension du permis, amende ou autres suites selon le
            dossier. Chaque situation dépend des faits, des analyses et de la
            procédure. En cas de poursuites, il faut demander conseil à un
            professionnel du droit.
          </>
        ),
      },
      {
        type: "heading",
        id: "conseils-prudence",
        text: "Nos conseils de prudence",
      },
      {
        type: "list",
        items: [
          "ne pas conduire après avoir consommé un produit CBD ;",
          "éviter toute consommation avant un trajet prévu ;",
          "ne pas mélanger CBD, alcool ou médicaments ;",
          "lire les informations produit et les données de conformité disponibles ;",
          "ne pas prendre le volant en cas de somnolence, gêne, baisse de vigilance ou doute ;",
          "reporter le trajet si la situation n'est pas claire.",
        ],
      },
      {
        type: "heading",
        id: "a-retenir",
        text: "À retenir",
      },
      {
        type: "list",
        items: [
          "CBD légal ne veut pas dire conduite sans risque ;",
          "le THC, même en traces, peut poser problème lors d'un contrôle ;",
          "la prudence consiste à ne pas conduire après consommation ;",
          "il ne faut pas se fier à un délai garanti avant de reprendre le volant ;",
          "en cas de doute, il vaut mieux reporter le trajet.",
        ],
      },
      {
        type: "paragraph",
        text: (
          <>
            Chez Verdanza, nous privilégions une information claire : les produits
            CBD sont destinés à des adultes, dans un cadre responsable. Pour la
            conduite, la règle de prudence est simple : ne prenez pas le volant
            après consommation.
          </>
        ),
      },
      {
        type: "heading",
        id: "sources-officielles",
        text: "Sources officielles",
      },
      {
        type: "paragraph",
        text: "Sources consultées le 23 juillet 2026.",
      },
      {
        type: "list",
        items: [
          <a
            href="https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000044793213"
            target="_blank"
            rel="noopener noreferrer"
          >
            Légifrance - Arrêté du 30 décembre 2021 relatif au chanvre
          </a>,
          <a
            href="https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000051877265"
            target="_blank"
            rel="noopener noreferrer"
          >
            Légifrance - Code de la route, article L235-1
          </a>,
          <a
            href="https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006074228/LEGISCTA000006159522/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Légifrance - Code de la route, articles L235-1 à L235-5
          </a>,
          <a
            href="https://www.courdecassation.fr/publications/bulletin-des-arrets-de-la-chambre-criminelle/numero-6-juin-2023/circulation-routiere"
            target="_blank"
            rel="noopener noreferrer"
          >
            Cour de cassation - Chambre criminelle, 21 juin 2023
          </a>,
          <a
            href="https://www.service-public.fr/particuliers/vosdroits/F2886"
            target="_blank"
            rel="noopener noreferrer"
          >
            Service Public - Drogue au volant : sanctions
          </a>,
          <a
            href="https://ansm.sante.fr/actualites/melanger-cbd-et-medicaments-ce-nest-jamais-anodin"
            target="_blank"
            rel="noopener noreferrer"
          >
            ANSM - CBD et médicaments : précautions d'usage
          </a>,
        ],
      },
    ],
  },
  {
    slug: "denominations-cbd-cbn-cbg",
    title: "CBD, CBN, CBG : comprendre les dénominations",
    seoTitle: "CBD, CBN, CBG : comprendre les dénominations | Verdanza",
    description:
      "Guide simple pour comprendre les principales dénominations du CBD : CBD, CBG, CBN, THC, formes acides, terpènes et lecture des fiches produits.",
    excerpt:
      "CBD, CBN, CBG, THC, CBDA ou THCA : ces sigles ne disent pas tous la même chose. Voici comment les lire sans confondre nom, taux et promesse d'effet.",
    category: "Guide CBD",
    authorName: "Rédaction Verdanza",
    datePublished: "2026-07-21T09:00:00+02:00",
    dateModified: "2026-07-21T09:00:00+02:00",
    readingTime: "6 min",
    status: "published",
    images: {
      square: "/images/blog/comment-lire-analyse-cbd-1x1.webp",
      landscape: "/images/blog/comment-lire-analyse-cbd-4x3.webp",
      wide: "/images/blog/comment-lire-analyse-cbd-16x9.webp",
    },
    relatedSlugs: [
      "comment-lire-analyse-cbd",
      "fleur-cbd-ou-resine-cbd-differences",
      "indoor-greenhouse-hydroponique-differences",
    ],
    links: [
      { to: "/qualite-conformite", label: "Démarche qualité Verdanza" },
      { to: "/blog/comment-lire-analyse-cbd", label: "Lire une analyse CBD" },
      { to: "/fleurs-cbd", label: "Voir les fleurs CBD" },
      { to: "/resines-cbd", label: "Voir les résines CBD" },
    ],
    blocks: [
      {
        type: "paragraph",
        text: (
          <>
            Les produits CBD utilisent souvent des sigles courts : CBD, CBG,
            CBN, THC, CBDA ou THCA. Ils peuvent impressionner au premier regard,
            alors qu'ils servent surtout à identifier des familles de molécules,
            des valeurs mesurées ou des repères présents sur une fiche produit.
            L'objectif est de comprendre ce que ces dénominations indiquent, sans
            leur faire dire plus que ce qu'elles montrent réellement.
          </>
        ),
      },
      {
        type: "heading",
        id: "pourquoi-autant-sigles",
        text: "Pourquoi autant de sigles ?",
      },
      {
        type: "paragraph",
        text: (
          <>
            Le chanvre contient naturellement plusieurs cannabinoïdes. Chaque
            sigle désigne une molécule ou une forme associée. Dans une boutique,
            ces noms aident à lire une fiche produit, à comparer des références
            et à comprendre les analyses quand elles sont disponibles. Ils ne
            doivent pas être lus comme une promesse d'effet.
          </>
        ),
      },
      {
        type: "table",
        table: {
          caption: "Repères simples pour lire les principales dénominations.",
          headers: ["Sigle", "Nom courant", "Comment le lire"],
          rows: [
            [
              "CBD",
              "Cannabidiol",
              "Le repère le plus courant sur les produits CBD. Il peut être affiché en pourcentage, en mg/g ou simplement comme caractéristique principale.",
            ],
            [
              "CBG",
              "Cannabigérol",
              "Un autre cannabinoïde. Il est parfois mis en avant dans certaines fleurs ou résines lorsque le fournisseur communique une valeur.",
            ],
            [
              "CBN",
              "Cannabinol",
              "Un cannabinoïde que l'on peut retrouver dans certains profils. Sa présence ne suffit pas à conclure sur l'usage ou le ressenti d'un produit.",
            ],
            [
              "THC",
              "Tétrahydrocannabinol",
              "Le cannabinoïde encadré par la réglementation. Côté client, le point important reste le respect du seuil légal applicable.",
            ],
            [
              "CBDA / THCA",
              "Formes acides",
              "Des formes que l'on peut voir sur certaines analyses. Elles se lisent comme des données techniques du lot.",
            ],
            [
              "Terpènes",
              "Composés aromatiques",
              "Ils ne sont pas des cannabinoïdes. Ils servent surtout à décrire le profil aromatique : fruité, boisé, épicé, floral ou résineux.",
            ],
          ],
        },
      },
      {
        type: "note",
        text: (
          <>
            Un sigle n'est pas une promesse. Il indique une information de
            composition ou de lecture produit. Pour choisir, il faut aussi
            regarder l'origine, la culture, l'état du lot, le statut de stock et
            les informations de conformité disponibles.
          </>
        ),
      },
      {
        type: "heading",
        id: "nom-taux-profil",
        text: "Nom, taux et profil : trois choses différentes",
      },
      {
        type: "paragraph",
        text: (
          <>
            Le nom d'un cannabinoïde indique la famille de molécule concernée. Le
            taux indique une mesure, lorsqu'elle est communiquée. Le profil, lui,
            décrit l'ensemble du produit : aspect, texture, arômes, culture,
            origine et présentation. Deux produits peuvent donc afficher le même
            sigle sans avoir le même profil aromatique ni la même lecture en
            boutique.
          </>
        ),
      },
      {
        type: "heading",
        id: "fiche-produit",
        text: "Ce qu'il faut regarder sur une fiche produit",
      },
      {
        type: "list",
        items: [
          "la catégorie : fleur CBD, résine CBD ou autre format ;",
          "le ou les cannabinoïdes annoncés par le fournisseur ;",
          "le THC, qui doit rester sous le seuil légal applicable ;",
          "l'origine et le mode de culture lorsqu'ils sont renseignés ;",
          "le statut du produit : disponible, stock limité, victime de son succès ou en arrivage ;",
          "les arômes décrits, qui aident souvent davantage au choix que les seuls sigles.",
        ],
      },
      {
        type: "heading",
        id: "rester-prudent",
        text: "Pourquoi rester prudent avec les effets annoncés ?",
      },
      {
        type: "paragraph",
        text: (
          <>
            Les dénominations comme CBD, CBN ou CBG ne suffisent pas à prédire un
            ressenti. Les autorités sanitaires rappellent aussi que les produits à
            base de CBD peuvent poser question lorsqu'ils sont mélangés avec
            certains médicaments ou lorsqu'ils contiennent d'autres substances non
            attendues. En cas de doute, il vaut mieux demander un avis
            professionnel plutôt que se fier à une promesse commerciale.
          </>
        ),
      },
      {
        type: "heading",
        id: "choisir-simplement",
        text: "Choisir plus simplement",
      },
      {
        type: "paragraph",
        text: (
          <>
            Pour un achat en boutique, la meilleure lecture reste souvent la plus
            simple : commencer par la catégorie, vérifier le statut du produit,
            lire le profil aromatique, puis consulter les informations techniques
            disponibles. Les sigles apportent un repère utile, mais ils ne
            remplacent pas une fiche produit claire.
          </>
        ),
      },
      {
        type: "links",
        title: "Poursuivre la lecture",
        links: [
          { to: "/blog/comment-lire-analyse-cbd", label: "Comment lire une analyse CBD" },
          {
            to: "/blog/fleur-cbd-ou-resine-cbd-differences",
            label: "Fleur CBD ou résine CBD",
          },
          { to: "/qualite-conformite", label: "Qualité et conformité" },
        ],
      },
    ],
  },
  {
    slug: "conserver-fleurs-resines-cbd",
    title: "Comment conserver fleurs et résines CBD ?",
    seoTitle: "Conserver fleurs et résines CBD : guide pratique | Verdanza",
    description:
      "Guide pratique pour conserver fleurs et résines CBD : lumière, air, humidité, contenant, manipulation et signes d’altération à surveiller.",
    excerpt:
      "Lumière, air, humidité et manipulations influencent l’état d’une fleur ou d’une résine CBD. Voici les repères utiles pour organiser leur conservation.",
    category: "Guide qualité",
    authorName: "Rédaction Verdanza",
    datePublished: "2026-07-20T22:00:00+02:00",
    dateModified: "2026-07-20T22:00:00+02:00",
    readingTime: "7 min",
    status: "published",
    images: {
      square: "/images/blog/conserver-fleurs-resines-cbd-1x1.webp",
      landscape: "/images/blog/conserver-fleurs-resines-cbd-4x3.webp",
      wide: "/images/blog/conserver-fleurs-resines-cbd-16x9.webp",
    },
    relatedSlugs: [
      "comment-lire-analyse-cbd",
      "fleur-cbd-ou-resine-cbd-differences",
      "choisir-fleur-cbd-profil-aromatique",
    ],
    links: [
      { to: "/qualite-conformite", label: "Découvrir la démarche qualité" },
      { to: "/fleurs-cbd", label: "Consulter les fleurs CBD" },
      { to: "/resines-cbd", label: "Consulter les résines CBD" },
      { to: "/blog/comment-lire-analyse-cbd", label: "Lire une analyse" },
      { to: "/livraison-postale", label: "Informations de livraison" },
    ],
    blocks: [
      {
        type: "paragraph",
        text: (
          <>
            Conserver une fleur ou une résine CBD consiste surtout à limiter les
            variations inutiles autour du produit. La lumière directe, l’air,
            l’humidité et les manipulations répétées peuvent faire évoluer son
            aspect, sa texture ou son profil aromatique. Une routine simple aide
            à garder des repères stables, sans transformer la conservation en
            protocole compliqué.
          </>
        ),
      },
      {
        type: "heading",
        id: "pourquoi-conservation-compte",
        text: "Pourquoi la conservation compte-t-elle ?",
      },
      {
        type: "paragraph",
        text: (
          <>
            Une fiche décrit un produit et un lot à un moment donné. Après
            réception, les conditions de rangement peuvent modifier ce que vous
            observez : une matière peut sécher, devenir plus souple ou perdre en
            netteté aromatique. L’objectif n’est pas de figer le produit, mais
            d’éviter les expositions répétées qui accélèrent ces changements.
          </>
        ),
      },
      {
        type: "heading",
        id: "quatre-facteurs",
        text: "Les quatre facteurs à surveiller",
      },
      {
        type: "table",
        table: {
          caption: "Repères simples pour organiser le rangement d’un produit CBD.",
          headers: ["Facteur", "Ce qui peut se passer", "Repère pratique"],
          rows: [
            [
              "Lumière",
              "Une exposition directe et prolongée peut faire évoluer l’aspect du produit.",
              "Choisir un rangement fermé, à l’écart du soleil direct.",
            ],
            [
              "Air",
              "Des ouvertures fréquentes renouvellent l’air autour du produit.",
              "Refermer le contenant après chaque vérification.",
            ],
            [
              "Humidité",
              "Un environnement trop humide ou très variable peut altérer la matière.",
              "Conserver dans un endroit sec et surveiller tout changement inhabituel.",
            ],
            [
              "Chaleur",
              "Une source chaude ou des écarts répétés peuvent modifier la texture.",
              "Éloigner le contenant des radiateurs, fenêtres et surfaces chauffées.",
            ],
          ],
        },
      },
      {
        type: "heading",
        id: "choisir-contenant",
        text: "Choisir et utiliser le contenant",
      },
      {
        type: "paragraph",
        text: (
          <>
            Le contenant doit d’abord rester propre, sec et correctement fermé.
            L’emballage reçu peut convenir lorsqu’il est refermable et intact.
            Si vous utilisez un autre contenant, choisissez un format adapté au
            volume afin de limiter les manipulations et gardez une étiquette qui
            permet d’identifier la référence et le lot.
          </>
        ),
      },
      {
        type: "list",
        items: [
          "vérifier que le contenant est propre et parfaitement sec ;",
          "conserver le nom de la référence et le numéro de lot lorsqu’il est disponible ;",
          "éviter de mélanger plusieurs produits ou plusieurs lots ;",
          "refermer sans laisser de matière sur la zone de fermeture ;",
          "ranger le contenant hors de portée des enfants et des animaux.",
        ],
      },
      {
        type: "heading",
        id: "fleurs-resines-differences",
        text: "Fleurs et résines : mêmes principes, points d’attention différents",
      },
      {
        type: "table",
        table: {
          caption: "Différences de surveillance entre fleurs et résines CBD.",
          headers: ["Format", "À observer", "À éviter"],
          rows: [
            [
              "Fleurs CBD",
              "Structure, souplesse, odeur habituelle et éventuelles traces anormales.",
              "Écrasements répétés et ouvertures inutiles du contenant.",
            ],
            [
              "Résines CBD",
              "Texture, homogénéité, surface et évolution inhabituelle de l’odeur.",
              "Contact prolongé avec une source de chaleur ou manipulation excessive.",
            ],
          ],
        },
      },
      {
        type: "paragraph",
        text: (
          <>
            Une fleur et une résine ne vieillissent pas visuellement de la même
            manière. Il est donc plus utile de comparer chaque produit à son état
            initial que d’appliquer un seul critère à toute la catégorie. Le guide
            <Link to="/blog/fleur-cbd-ou-resine-cbd-differences"> fleur ou résine CBD</Link>{" "}
            détaille les différences de présentation et de texture.
          </>
        ),
      },
      {
        type: "heading",
        id: "routine-simple",
        text: "Une routine de conservation simple",
      },
      {
        type: "list",
        items: [
          "identifier le produit et son lot à la réception ;",
          "choisir un emplacement sec, stable et protégé de la lumière directe ;",
          "limiter les ouvertures à ce qui est nécessaire ;",
          "utiliser des mains propres et sèches lors de la manipulation ;",
          "refermer puis remettre le contenant au même endroit ;",
          "contrôler l’aspect et l’odeur en cas de changement notable.",
        ],
      },
      {
        type: "heading",
        id: "signes-alteration",
        text: "Quels signes d’altération surveiller ?",
      },
      {
        type: "paragraph",
        text: (
          <>
            Un changement léger de texture n’a pas la même portée qu’une trace
            anormale ou une odeur franchement différente. Avant toute conclusion,
            observez le produit à la lumière naturelle, sans le mélanger à un autre
            lot. En cas de doute, isolez le contenant et contactez le vendeur avec
            le nom de la référence, le lot et des photos lisibles.
          </>
        ),
      },
      {
        type: "list",
        items: [
          "présence de taches, filaments ou dépôts inhabituels ;",
          "odeur nettement différente de celle observée à la réception ;",
          "humidité visible à l’intérieur du contenant ;",
          "emballage endommagé ou fermeture qui ne joue plus son rôle ;",
          "mélange accidentel entre références ou lots.",
        ],
      },
      {
        type: "note",
        text: (
          <>
            Une photo, une description commerciale ou un taux ne permettent pas
            à eux seuls d’évaluer l’état réel d’un produit. Le lot, son emballage
            et les conditions observées restent des éléments essentiels.
          </>
        ),
      },
      {
        type: "heading",
        id: "reception-et-livraison",
        text: "À la réception d’une livraison",
      },
      {
        type: "paragraph",
        text: (
          <>
            À l’ouverture du colis, vérifiez que l’emballage est intact et que la
            référence reçue correspond à la commande. Notez le lot lorsqu’il est
            indiqué, puis rangez le produit sans le laisser durablement dans un
            véhicule, sur un rebord de fenêtre ou près d’une source de chaleur.
            Les modalités générales sont détaillées sur la page{" "}
            <Link to="/livraison-postale">livraison postale</Link>.
          </>
        ),
      },
      {
        type: "heading",
        id: "points-a-retenir",
        text: "Points à retenir",
      },
      {
        type: "list",
        items: [
          "protéger le produit de la lumière directe, de la chaleur et de l’humidité ;",
          "utiliser un contenant propre, sec, fermé et correctement identifié ;",
          "ne pas mélanger les références ou les lots ;",
          "comparer l’évolution du produit à son état initial ;",
          "isoler le contenant et contacter le vendeur en cas d’anomalie visible.",
        ],
      },
      {
        type: "links",
        title: "Compléter vos repères qualité",
        links: [
          { to: "/qualite-conformite", label: "Démarche qualité Verdanza" },
          { to: "/blog/comment-lire-analyse-cbd", label: "Lire une analyse CBD" },
          { to: "/fleurs-cbd", label: "Voir les fleurs CBD" },
          { to: "/resines-cbd", label: "Voir les résines CBD" },
        ],
      },
    ],
  },
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
      { to: "/livraison-locale", label: "Livraison locale Aix" },
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
            La page <Link to="/fleurs-cbd">fleurs CBD</Link> rassemble les
            fiches de la catégorie, tandis qu’un certificat d’analyse permet de
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
              "Lecture complémentaire",
              "La fiche précise les informations communiquées pour cette référence.",
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
          "taux mesurés ou indiqués, uniquement lorsqu’ils sont renseignés pour la référence ;",
          "statut de la fiche et informations de lecture utiles.",
        ],
      },
      {
        type: "heading",
        id: "lecture-des-fiches",
        text: "Lecture des fiches",
      },
      {
        type: "paragraph",
        text: (
          <>
            Pour comparer deux produits, regardez d’abord la catégorie, la
            description, les taux mesurés lorsqu’ils sont indiqués et le
            certificat d’analyse. La lecture doit partir de la fiche, pas d’un
            raccourci commercial.
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
            profil aromatique, origine, culture et lecture des fiches. Si vous
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
          { to: "/livraison-locale", label: "Voir la livraison locale" },
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
    slug: "choisir-fleur-cbd-profil-aromatique",
    title: "Comment choisir une fleur CBD selon son profil aromatique ?",
    seoTitle:
      "Comment choisir une fleur CBD selon son profil aromatique ? | Verdanza",
    description:
      "Guide pour lire un profil aromatique de fleur CBD : familles de notes, intensité, texture, culture et fiche produit avant de comparer.",
    excerpt:
      "Comprendre les familles aromatiques aide à choisir une fleur CBD selon ses préférences, sans réduire la décision au taux ou au discours commercial.",
    category: "Guide fleurs",
    authorName: "Rédaction Verdanza",
    datePublished: "2026-07-14T19:22:37+02:00",
    dateModified: "2026-07-14T19:22:37+02:00",
    readingTime: "7 min",
    status: "published",
    images: {
      square: "/images/blog/choisir-fleur-cbd-profil-aromatique-1x1.webp",
      landscape: "/images/blog/choisir-fleur-cbd-profil-aromatique-4x3.webp",
      wide: "/images/blog/choisir-fleur-cbd-profil-aromatique-16x9.webp",
    },
    relatedSlugs: [
      "fleur-cbd-ou-resine-cbd-differences",
      "comment-lire-analyse-cbd",
      "indoor-greenhouse-hydroponique-differences",
    ],
    links: [
      { to: "/fleurs-cbd", label: "Voir les fleurs CBD" },
      { to: "/blog/fleur-cbd-ou-resine-cbd-differences", label: "Comparer fleur et résine" },
      { to: "/blog/comment-lire-analyse-cbd", label: "Lire une analyse" },
      { to: "/qualite-conformite", label: "Qualité et conformité" },
    ],
    blocks: [
      {
        type: "paragraph",
        text: (
          <>
            Le profil aromatique d’une fleur CBD décrit l’ensemble des notes que
            l’on perçoit au premier nez puis à l’ouverture de la fiche produit.
            Il ne s’agit pas d’une promesse abstraite : la lecture se fait
            référence par référence, avec des nuances qui peuvent varier selon
            la culture, la présentation et le lot affiché.
          </>
        ),
      },
      {
        type: "heading",
        id: "comprendre-le-profil-aromatique",
        text: "Comprendre le profil aromatique",
      },
      {
        type: "paragraph",
        text: (
          <>
            Un profil aromatique regroupe plusieurs familles de notes. Une fleur
            peut être décrite comme agrumée, florale, boisée, terreuse, résineuse
            ou plus gourmande. L’intérêt n’est pas de classer les fleurs dans un
            ordre de valeur, mais de savoir quelle direction aromatique vous
            recherchez avant de comparer deux fiches.
          </>
        ),
      },
      {
        type: "heading",
        id: "grandes-familles-aromatiques",
        text: "Les grandes familles aromatiques",
      },
      {
        type: "table",
        table: {
          caption: "Repères simples pour lire un profil aromatique de fleur CBD.",
          headers: ["Famille", "Ce que l’on perçoit souvent", "Ce que cela aide à comparer"],
          rows: [
            [
              "Agrumée",
              "Des notes fraîches, vives et parfois zestées.",
              "Utile si vous cherchez une impression légère et dynamique.",
            ],
            [
              "Florale",
              "Des nuances douces, rondes ou délicates.",
              "Permet de repérer des fleurs plus aériennes ou élégantes.",
            ],
            [
              "Boisée",
              "Des accents secs, nets ou plus profonds.",
              "Aide à comparer les fleurs au caractère plus structuré.",
            ],
            [
              "Terreuse",
              "Des notes plus sombres, minérales ou végétales.",
              "Donne une idée d’un profil plus ancré et moins sucré.",
            ],
            [
              "Gourmande",
              "Des sensations rondes, sucrées ou plus enveloppantes.",
              "Intéressant pour comparer les fleurs au rendu plus ample.",
            ],
          ],
        },
      },
      {
        type: "heading",
        id: "intensite-et-equilibre",
        text: "Intensité et équilibre",
      },
      {
        type: "paragraph",
        text: (
          <>
            Deux fleurs peuvent partager une même famille aromatique tout en
            offrant des intensités différentes. L’une peut paraître nette et
            directe, l’autre plus complexe et progressive. Pour choisir
            correctement, il faut donc regarder l’équilibre global, la finesse
            des notes et la manière dont elles sont décrites sur la fiche.
          </>
        ),
      },
      {
        type: "heading",
        id: "lire-les-indications",
        text: "Lire les indications de la fiche",
      },
      {
        type: "list",
        items: [
          "la famille aromatique mise en avant ;",
          "la description textuelle du rendu ;",
          "le mode de culture ou la méthode de présentation ;",
          "les taux ou mesures seulement lorsqu’ils sont explicitement indiqués ;",
          "la cohérence entre le texte, la catégorie et le certificat d’analyse.",
        ],
      },
      {
        type: "heading",
        id: "texture-et-sensation",
        text: "Texture et sensation d’ensemble",
      },
      {
        type: "paragraph",
        text: (
          <>
            La perception aromatique ne se résume pas au parfum. La texture, la
            densité visuelle et la structure du produit influencent aussi la
            lecture de la fiche. Une fleur plus compacte, plus aérée ou plus
            résineuse n’évoque pas le même ensemble sensoriel, même si la famille
            aromatique reste proche.
          </>
        ),
      },
      {
        type: "heading",
        id: "comparer-deux-fleurs",
        text: "Comparer deux fleurs sans se tromper",
      },
      {
        type: "paragraph",
        text: (
          <>
            Pour comparer proprement, ouvrez deux fiches côte à côte et vérifiez
            d’abord ce qui est écrit, puis ce qui est mesuré. La catégorie
            <Link to="/fleurs-cbd"> fleurs CBD</Link> donne le point d’entrée,
            tandis que <Link to="/blog/comment-lire-analyse-cbd">l’analyse de CBD</Link>
            aide à distinguer les données techniques du texte commercial.
          </>
        ),
      },
      {
        type: "links",
        title: "Aller plus loin",
        links: [
          { to: "/fleurs-cbd", label: "Comparer les fleurs CBD" },
          { to: "/blog/comment-lire-analyse-cbd", label: "Lire une analyse" },
          { to: "/blog/fleur-cbd-ou-resine-cbd-differences", label: "Fleur ou résine" },
          { to: "/qualite-conformite", label: "Qualité et conformité" },
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
          "le profil aromatique se lit référence par référence ;",
          "les grandes familles aident à comparer sans simplifier à l’excès ;",
          "la fiche produit et l’analyse restent les meilleures bases de lecture ;",
          "la texture complète la perception, mais ne remplace pas la description.",
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
            communiqués. Quand un lot comporte aussi une analyse, reliez la
            lecture du document au reste de la fiche et{" "}
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

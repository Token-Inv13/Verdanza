# Guide UTM Verdanza

Objectif : standardiser les liens de campagne afin de comparer proprement acquisition, visites utiles, clics CTA, produits consultés, paniers et commandes soumises dans GA4.

## Paramètres obligatoires

Chaque lien de campagne doit contenir :

- `utm_source` : origine précise du trafic.
- `utm_medium` : type de levier.
- `utm_campaign` : nom stable de la campagne.

Paramètres facultatifs :

- `utm_content` : variante créative, emplacement ou CTA.
- `utm_term` : mot-clé ou segment, seulement si utile.

## Conventions

Utiliser des valeurs courtes, en minuscules, sans accents, sans espace et séparées par des underscores.

Sources recommandées :

- `instagram`
- `facebook`
- `google`
- `tiktok`
- `whatsapp`
- `google`
- `newsletter`
- `sms`
- `qr`
- `partner`

Mediums recommandés :

- `social`
- `cpc`
- `organic`
- `email`
- `sms`
- `messaging`
- `offline`
- `referral`

Campagnes recommandées :

- `lancement_fleurs_premium`
- `livraison_aix`
- `blog_cbd`
- `promotion_mango_haze`
- `flyer_aix_ete_2026`
- `google_business_profile`

Contenus recommandés :

- `bio`
- `story`
- `reel`
- `publication`
- `flyer`
- `carte_visite`
- `qr_emballage`

## Exemples

Instagram bio vers la boutique :

```text
https://verdanza.fr/boutique?utm_source=instagram&utm_medium=social&utm_campaign=lancement_fleurs_premium&utm_content=bio
```

Facebook publication vers les résines :

```text
https://verdanza.fr/resines-cbd?utm_source=facebook&utm_medium=social&utm_campaign=promotion_mango_haze&utm_content=publication
```

TikTok reel vers une fiche produit :

```text
https://verdanza.fr/produits/mango-haze-cbd?utm_source=tiktok&utm_medium=social&utm_campaign=promotion_mango_haze&utm_content=reel
```

WhatsApp vers la livraison locale :

```text
https://verdanza.fr/livraison-locale?utm_source=whatsapp&utm_medium=messaging&utm_campaign=livraison_aix&utm_content=message
```

Fiche Google vers la livraison locale :

```text
https://verdanza.fr/livraison-locale?utm_source=google&utm_medium=organic&utm_campaign=google_business_profile&utm_content=profile
```

QR code boutique physique ou flyer :

```text
https://verdanza.fr/fleurs-cbd?utm_source=qr&utm_medium=offline&utm_campaign=flyer_aix_ete_2026&utm_content=qr_emballage
```

Newsletter vers un article :

```text
https://verdanza.fr/blog/fleur-cbd-ou-resine-cbd-differences?utm_source=newsletter&utm_medium=email&utm_campaign=blog_cbd&utm_content=article_link
```

## Règles de sécurité

Ne jamais mettre dans un UTM :

- email ;
- téléphone ;
- nom ou prénom ;
- identifiant client ;
- adresse ;
- message libre ;
- montant de commande ;
- information de paiement.

## Lecture GA4

Les UTM doivent être analysés avec :

- `Session source / medium` pour le trafic.
- `Session campaign` pour la campagne.
- `Landing page + query string` pour la page d'entrée.
- `Event name` pour relier les sessions aux événements `cta_click`, `view_item`, `add_to_cart`, `view_cart`, `begin_checkout` et `order_submitted`.

Le signal de commande prioritaire côté client reste `order_submitted`. Le `purchase` serveur n'est pas un indicateur d'acquisition prioritaire dans cette phase.

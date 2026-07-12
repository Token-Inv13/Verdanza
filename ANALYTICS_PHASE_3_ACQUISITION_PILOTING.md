# Phase Analytics 3 - Acquisition et pilotage

Date : 2026-07-12  
Branche : `main`  
Base technique : consentement GTM/GA4 validé, événements client envoyés via `gtag`, `purchase` serveur séparé.

## Objectif

Mesurer prioritairement :

- acquisition et pages d'entrée ;
- visites utiles ;
- clics CTA utiles ;
- listes et produits consultés ;
- ajouts panier ;
- panier consulté ;
- checkout commencé ;
- commandes soumises.

Le paiement Analytics serveur reste hors priorité de cette phase.

## État technique

Événements client actifs :

- `page_view`
- `view_item_list`
- `select_item`
- `view_item`
- `add_to_cart`
- `remove_from_cart`
- `view_cart`
- `add_to_wishlist`
- `begin_checkout`
- `add_shipping_info`
- `delivery_method_selected`
- `local_delivery_zone_selected`
- `payment_method_selected`
- `order_submitted`
- `login`
- `sign_up`
- `contact_click`
- `cta_click`
- `blog_article_view`
- `blog_read_progress`

`cta_click` est réservé aux liens utiles de navigation et de conversion. Il n'est pas envoyé en doublon sur les actions déjà couvertes par `select_item` ou `add_to_cart`.

Paramètres `cta_click` :

- `cta_id`
- `cta_location`
- `destination_path`
- `page_path`
- `cta_category`

Ces paramètres n'incluent pas de donnée personnelle, pas d'URL externe complète et pas de saisie utilisateur.

## Événements clés GA4 recommandés

À marquer comme événement clé principal dans GA4 :

- `order_submitted`

Conserver `purchase` sans modification. Ne pas marquer comme événements clés dans cette phase : `page_view`, `view_item`, `add_to_cart`, `view_cart`, `blog_read_progress`, `cta_click` et `payment_method_selected`.

## Dimensions personnalisées recommandées

Créer dans GA4, portée événement, uniquement lorsque les paramètres sont observés dans DebugView :

- Article du blog : `article_slug`
- Méthode de contact : `contact_method`
- Emplacement du contact : `link_location`
- Mode de livraison : `delivery_method`
- Identifiant du CTA : `cta_id`
- Emplacement du CTA : `cta_location`
- Catégorie du CTA : `cta_category`

Dimensions déjà disponibles nativement à utiliser en priorité :

- `Session source / medium`
- `Session campaign`
- `Landing page + query string`
- `Page path and screen class`
- `Event name`
- `Device category`
- `Item ID`
- `Item name`
- `Item category`

## Explorations GA4 recommandées

### Acquisition vers commande soumise

Dimensions :

- `Session source / medium`
- `Session campaign`
- `Landing page + query string`
- `Device category`

Métriques :

- sessions ;
- utilisateurs ;
- événements `cta_click` ;
- événements `view_item` ;
- événements `add_to_cart` ;
- événements `begin_checkout` ;
- événements `order_submitted`.

### Clics CTA utiles

Dimensions :

- `cta_location`
- `cta_id`
- `cta_category`

Métriques :

- nombre d'événements ;
- utilisateurs ;
- sessions ;
- taux de conversion vers `order_submitted` dans la même session.

### Produits et catégories

Dimensions :

- `item_list_id`
- `item_list_name`
- `item_name`
- `item_category`

Métriques :

- `view_item_list` ;
- `select_item` ;
- `view_item` ;
- `add_to_cart` ;
- `view_cart` ;
- `begin_checkout` ;
- `order_submitted`.

### Blog vers boutique

Dimensions :

- `article_slug`
- `article_category`
- `progress_percent`
- `cta_id`
- `destination_path`

Métriques :

- `blog_article_view` ;
- `blog_read_progress` ;
- `cta_click` ;
- `view_item` ;
- `add_to_cart` ;
- `order_submitted`.

## Procédure GA4 UI

Statut de cette phase : l'accès navigateur a redirigé vers l'écran d'accueil Google Analytics `Commencer à mesurer` au lieu de la propriété Verdanza. Aucune modification GA4 n'a été effectuée automatiquement afin d'éviter de créer une nouvelle propriété ou une configuration incorrecte.

1. Ouvrir GA4, propriété `G-E9XNP7BJ2Y`.
2. Vérifier que le flux Web Verdanza reçoit les événements en DebugView après consentement.
3. Aller dans `Admin > Data display > Events` et marquer les événements clés recommandés.
4. Aller dans `Admin > Data display > Custom definitions`.
5. Créer les dimensions personnalisées listées ci-dessus, toutes en portée événement, seulement si le paramètre est déjà visible en DebugView.
6. Créer les explorations recommandées dans `Explore`.
7. Vérifier que les rapports n'utilisent aucune donnée personnelle.

Si GA4 demande une validation, une reconnexion ou une publication manuelle, arrêter l'automatisation et effectuer l'action directement dans l'interface.

## Association Search Console

Statut : non effectuée automatiquement dans cette session, faute d'accès direct à la propriété GA4 Verdanza.

Étapes manuelles :

1. Ouvrir GA4, propriété `G-E9XNP7BJ2Y`.
2. Aller dans `Administration > Associations de produits > Associations à Search Console`.
3. Vérifier qu'aucune association correcte avec `sc-domain:verdanza.fr` n'existe déjà.
4. Cliquer `Associer`.
5. Sélectionner la propriété Search Console `sc-domain:verdanza.fr`.
6. Sélectionner le flux Web Verdanza `https://verdanza.fr`.
7. Valider.
8. Aller dans `Rapports > Bibliothèque`.
9. Publier la collection Search Console si elle est disponible et non publiée.

Ne pas supprimer une association existante correcte.

## Routine de lecture

Chaque semaine :

- vérifier les sources et campagnes qui amènent le plus de sessions utiles ;
- comparer `cta_click`, `view_item`, `add_to_cart` et `order_submitted` par source ;
- repérer les landing pages avec beaucoup de sessions mais peu de clics utiles ;
- vérifier les articles qui génèrent des clics vers boutique ou catégories.

Chaque mois :

- nettoyer les UTM incohérents ;
- consolider les campagnes performantes ;
- ajuster les CTA faibles ;
- vérifier que les dimensions personnalisées restent renseignées.

## Limites

- GA4 peut mettre plusieurs heures avant d'afficher les nouvelles dimensions dans les rapports standards.
- DebugView et temps réel peuvent montrer les événements avant les rapports définitifs.
- L'association Search Console doit être confirmée dans GA4 si elle n'est pas déjà active.
- Le conteneur GTM ne doit pas être publié depuis cette phase sans validation séparée.
- Aucun IndexNow et aucune demande d'indexation Google ne sont nécessaires pour cette phase.

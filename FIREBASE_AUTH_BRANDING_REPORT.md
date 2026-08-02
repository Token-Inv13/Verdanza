# Finalisation de l’identité Firebase Auth Verdanza

Date du contrôle : 2 août 2026

## Résultat

Le gestionnaire public d’actions Firebase Auth est livré en production sur
`https://verdanza.fr/auth/action`. Il prend en charge `resetPassword`,
`verifyEmail` et `recoverEmail`, sans age gate, sans indexation et sans collecte
Analytics.

Les quatre modèles Firebase Auth ont été personnalisés avec :

- nom de l’expéditeur : `Verdanza` ;
- adresse de réponse : `contact@verdanza.fr` ;
- langue : français ;
- domaine d’expédition affiché : `noreply@auth-email.verdanza.fr`.

Aucun e-mail d’authentification réel n’a été envoyé pendant l’intervention.

## Parcours applicatif livré

- Route publique dédiée : `/auth/action`.
- Modes autorisés uniquement : `resetPassword`, `verifyEmail`, `recoverEmail`.
- Validation obligatoire de `oobCode` et rejet des modes inconnus.
- `continueUrl` limitée à l’origine exacte `https://verdanza.fr`.
- Suppression immédiate des paramètres sensibles de la barre d’adresse.
- Aucun log des codes, e-mails ou paramètres d’action.
- États explicites : chargement, succès, code expiré, code invalide, erreur
  réseau et action non prise en charge.
- Mot de passe d’au moins huit caractères avec confirmation.
- Retour sûr vers `/connexion` ou vers un chemin Verdanza validé.
- Métadonnées `noindex,nofollow`, canonical dédiée et exclusion du sitemap.
- Désactivation explicite de Google Analytics et Google Tag Manager sur cette
  route.
- Langue du SDK Firebase fixée à `fr`.
- Réinitialisation de mot de passe configurée avec
  `url: https://verdanza.fr/connexion` et `handleCodeInApp: false`.

## Configuration Firebase Auth

État avant intervention : les modèles utilisaient un nom d’expéditeur non
indiqué, une adresse de réponse `noreply` et l’URL d’action générique Firebase.

État après intervention :

| Modèle | Expéditeur | Réponse | Langue |
| --- | --- | --- | --- |
| Validation de l’adresse e-mail | Verdanza | contact@verdanza.fr | français |
| Réinitialisation du mot de passe | Verdanza | contact@verdanza.fr | français |
| Modification de l’adresse e-mail | Verdanza | contact@verdanza.fr | français |
| Activation de l’authentification multifacteur | Verdanza | contact@verdanza.fr | français |

La configuration a été relue directement dans la réponse Identity Toolkit :
les quatre entrées contiennent bien `senderDisplayName: Verdanza` et
`replyTo: contact@verdanza.fr`.

### Limitation Firebase restante

L’enregistrement de `https://verdanza.fr/auth/action` comme URL d’action globale
a été refusé par l’API Firebase avec HTTP 400 :

`EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED`

L’URL actuellement enregistrée reste donc :

`https://verdanza-1f621.firebaseapp.com/__/auth/action`

La configuration Firebase indique parallèlement pour le domaine personnalisé
`auth-email.verdanza.fr` : `useCustomDomain: true`, mais
`customDomainState: NOT_STARTED`. Les enregistrements TXT Firebase et SPF sont
présents dans le DNS ; aucun CNAME ni MX n’a été trouvé sur ce sous-domaine.
Cette incohérence est une cause probable du refus, mais l’erreur Firebase ne la
documente pas explicitement. La finalisation ou la réinitialisation de la
validation DNS du domaine d’e-mail doit être traitée séparément avant une
nouvelle tentative, ou transmise au support Firebase si l’état reste bloqué.

Le domaine `verdanza.fr` figure déjà parmi les domaines Firebase Auth autorisés.
Le compte `contact@verdanza.fr` dispose des rôles nécessaires dans le projet ;
le refus n’est donc pas expliqué par un manque de droits IAM observé.

## Tests

| Contrôle | Résultat |
| --- | --- |
| `npm run test:firebase-auth-actions` | réussi |
| `npm run lint` | réussi |
| `npm run build` | réussi |
| `npm run typecheck:api` | réussi |
| `npm run audit:runtime` | réussi |
| `npm run audit:analytics` | réussi |
| `npm run audit:performance` | réussi |
| `npm run audit:prerender` | échec préexistant documenté |

L’audit prerender valide bien `/auth/action` (fichier, titre, canonical,
`noindex`, H1 et absence du sitemap). Son échec global reste limité aux pages
404 de test qui n’exposent volontairement ni canonical ni `og:url`, limitation
préexistante du harnais déjà documentée.

Les contrôles navigateur locaux à 390 et 1280 pixels confirment l’absence d’age
gate, de débordement global et de collecte Analytics. Les paramètres sensibles
sont retirés de l’URL après chargement.

## Production

- Commit applicatif : `4939ead5c0e1837f12f30fbcc22680c50a75688d`
- Message : `feat: brand firebase auth email actions`
- Déploiement Vercel : `dpl_Gzk2LAcM1aiqUznBdJcjrjqrfSY8`
- Statut : `READY`
- Route : HTTP 200 sur `https://verdanza.fr/auth/action`
- Robots : `noindex,nofollow`
- Canonical : `https://verdanza.fr/auth/action`
- Sitemap : route absente du sitemap public

## Périmètre préservé

Aucune donnée métier, commande, paiement, configuration Firestore, méthode de
connexion Google, rôle administrateur, configuration GTM, Search Console ou
IndexNow n’a été modifié. Les fichiers locaux préexistants hors mission sont
restés intacts et exclus des commits.

# Règles projet Verdanza

## Dépôt et Git

- `main` est la branche de production.
- Déterminer systématiquement la racine courante avec `git rev-parse --show-toplevel`, puis vérifier la branche, le worktree courant et `git status --short` avant toute modification.
- Ne jamais supposer qu'un worktree temporaire est le checkout canonique du projet.
- Conserver tout travail local existant et limiter chaque intervention au périmètre demandé.

## Limites d'exécution

- Catégorie locale : lint, typecheck, tests avec mocks ou fixtures, build et audits locaux.
- Catégorie distante ou externe : Vercel, Firebase Production, Search Console, soumission IndexNow, Resend, Twilio, commandes réelles et paiement.
- Ne jamais passer de la catégorie locale à la catégorie distante sans demande explicite.

Ne jamais exécuter automatiquement :

- `seed:*` ;
- `migrate:*:apply` ;
- `repair:*` ;
- `cleanup:*` ;
- `reconcile:*` ;
- une soumission IndexNow réelle ;
- une commande de production ;
- un envoi Resend ou Twilio réel ;
- une commande ou opération de paiement réelle.

## Validation locale

- Les tests de commande utilisent des mocks ou fixtures tant qu'une action réelle n'est pas explicitement demandée.
- Le build historique peut écrire des fichiers : inspecter son comportement avant de le lancer et ne jamais le qualifier de totalement read-only par défaut.
- Préférer les commandes `npm run verify` et `npm run verify:full`, dont les garde-fous locaux doivent rester actifs.

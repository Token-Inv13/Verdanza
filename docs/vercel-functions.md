# Fonctions Vercel

Verdanza utilise Vercel Pro pour son exploitation commerciale. L'architecture n'est donc plus
contrainte par l'ancienne limite de fonctions du plan Hobby. La consolidation temporaire en
onze fonctions, mise en place pour respecter cette limite, a été retirée au profit de seize
fonctions explicites alignées sur leurs responsabilités métier.

Les points d'entrée publics, administratifs et personnels sont désormais séparés. Les URLs API
historiques correspondent directement aux fichiers sous `api/`, sans dispatcher ni rewrite de
consolidation. La logique métier partagée reste centralisée sous `api/_server/`, notamment les
transactions, les contrôles d'autorisation et les intégrations externes.

Le tirage Concours V1 est atomique : le concours passe directement de `closed` à
`winner_pending` dans la transaction qui enregistre le snapshot et le gagnant. Le statut
`drawing` reste disponible conceptuellement dans le modèle, mais n'est pas exposé comme une
étape persistante pendant ce tirage atomique.

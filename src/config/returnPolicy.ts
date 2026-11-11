export const RETURN_POLICY_PATH = "/retours";
export const WITHDRAWAL_NOTICE_DAYS = 14;
export const RETURN_DISPATCH_DAYS = 14;
export const WITHDRAWAL_REFUND_DAYS = 14;

export function returnPolicySections(contactEmail: string) {
  return [
    {
      heading: "Votre droit de rétractation",
      items: [
        `Pour vos achats à distance de produits Verdanza, vous disposez de ${WITHDRAWAL_NOTICE_DAYS} jours calendaires à compter du lendemain de la réception pour nous informer de votre décision de vous rétracter, sans avoir à la justifier. Pour une commande livrée en plusieurs fois, ce délai commence après réception du dernier produit. Vous pouvez aussi vous rétracter avant la livraison.`,
        "Vous pouvez vous rétracter de toute la commande ou seulement de certains produits. Si le dernier jour du délai est un samedi, un dimanche ou un jour férié ou chômé, le délai est prolongé jusqu’au premier jour ouvrable suivant.",
      ],
    },
    {
      heading: "Comment déclarer votre rétractation",
      items: [
        `Utilisez le formulaire « Renoncer au contrat ici » sur cette page, ou envoyez une déclaration claire à ${contactEmail}. Indiquez vos nom et prénom ainsi que la référence de commande ou des informations permettant de l’identifier. Précisez les produits concernés si le retour est partiel.`,
        "Votre déclaration est prise en compte dès son envoi dans le délai applicable : elle ne dépend pas d’une autorisation préalable de Verdanza. Le formulaire vous permet de vérifier votre déclaration avant de confirmer. L’accusé de réception horodaté est proposé au téléchargement et envoyé à l’adresse e-mail indiquée ; en cas d’échec de cet envoi, conservez la copie téléchargeable.",
      ],
    },
    {
      heading: "Adresse et expédition du retour",
      items: [
        "L’adresse exacte de retour vous est communiquée directement par Verdanza lors du traitement de votre demande. Ce contact sert à organiser l’envoi ; il ne conditionne pas l’exercice de votre droit de rétractation. Si vous n’avez pas reçu l’adresse, contactez-nous à nouveau. Un retard imputable à la transmission de nos instructions ne vous sera pas opposé.",
        `Après avoir déclaré votre rétractation, renvoyez les produits sans retard excessif et au plus tard dans les ${RETURN_DISPATCH_DAYS} jours suivants, à l’adresse communiquée. Emballez-les de manière à les protéger pendant le transport. Nous vous conseillons de conserver une preuve d’expédition.`,
        "En cas de changement d’avis, les coûts directs du renvoi sont à votre charge et sont réglés au transporteur de votre choix. Verdanza ne facture ni frais de dossier ni frais forfaitaires de remise en stock.",
      ],
    },
    {
      heading: "Sachets zip et état des produits",
      items: [
        "Les produits Verdanza sont conditionnés dans des sachets à fermeture zip de différentes formes. L’ouverture ou la refermeture d’un simple zip ne constitue pas, à elle seule, une raison de refuser une rétractation.",
        "Vous pouvez examiner le produit dans la mesure nécessaire pour en établir la nature et les caractéristiques. Une consommation, une transformation ou des manipulations allant au-delà de cet examen peuvent entraîner une dépréciation justifiée et proportionnée, appréciée selon l’état réel du produit, sans retenue automatique. Conservez si possible le sachet et les éléments reçus pour faciliter le retour.",
      ],
    },
    {
      heading: "Remboursement",
      items: [
        `Verdanza rembourse les sommes dues au plus tard dans les ${WITHDRAWAL_REFUND_DAYS} jours suivant la notification de votre rétractation. Pour une vente de biens, le remboursement peut être différé jusqu’à la récupération des produits ou la réception d’une preuve de leur expédition, la première de ces dates étant retenue.`,
        "Le remboursement est effectué par le même moyen de paiement que l’achat, sauf accord exprès de votre part pour un autre moyen sans frais supplémentaires. En cas de rétractation de toute la commande, les frais de livraison initiaux sont remboursés dans la limite du mode standard le moins coûteux proposé lors de l’achat. Le supplément d’une livraison plus coûteuse choisie par le client reste à sa charge.",
        "En cas de retour partiel, le prix des produits concernés et la part des frais de livraison initiaux qui leur est imputable sont remboursés. Une éventuelle dépréciation est expliquée et justifiée individuellement.",
      ],
    },
    {
      heading: "Produit abîmé, erreur ou non-conformité",
      items: [
        `Si un produit est endommagé, différent de celui commandé ou présente un défaut, contactez ${contactEmail} avec les éléments permettant d’identifier votre commande. Des photos peuvent faciliter le traitement, sans conditionner vos droits légaux. Verdanza vous indique la procédure et prend en charge les frais de retour nécessaires lorsqu’une erreur ou une non-conformité lui est imputable.`,
        "Le délai de rétractation de 14 jours ne limite pas les garanties légales de conformité et des vices cachés. Leur mise en œuvre et les solutions de réparation, remplacement ou remboursement suivent les conditions prévues par la loi. Ne consommez pas un produit dont l’état vous paraît anormal.",
      ],
    },
    {
      heading: "Modèle de déclaration par e-mail",
      items: [
        `À l’attention du service client Verdanza — ${contactEmail}.`,
        "Je vous notifie ma rétractation du contrat portant sur les produits suivants : [produits concernés ou totalité de la commande]. Commande : [référence ou éléments d’identification]. Commandée le : [date]. Reçue le : [date, si livrée]. Nom et prénom : [à compléter]. Adresse : [à compléter]. E-mail pour l’accusé de réception : [à compléter]. Date : [à compléter]. Signature uniquement en cas d’envoi sur papier.",
        "Ce modèle facilite votre démarche. Toute autre déclaration claire exprimant votre volonté de vous rétracter peut être utilisée.",
      ],
    },
  ];
}

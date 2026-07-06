import type { BillingSettings, Invoice, Order, OrderStatus } from "../../src/types/index.js";

export type EmailResult =
  | { status: "sent"; id?: string; recipients?: EmailRecipientResults }
  | { status: "partial"; reason: string; recipients: EmailRecipientResults }
  | { status: "skipped"; reason: string; recipients?: EmailRecipientResults }
  | { status: "failed"; reason: string; statusCode?: number; recipients?: EmailRecipientResults };

type EmailRecipientResults = Record<
  string,
  { status: "sent" | "skipped" | "failed"; reason?: string; providerId?: string }
>;

type TransactionalEmailKind =
  | "order_confirmation"
  | "admin_new_order"
  | "order_status_update"
  | "contact_message"
  | "invoice"
  | "payment_link";

const statusLabels: Record<OrderStatus, string> = {
  new: "Nouvelle commande",
  contact_required: "Client à contacter",
  confirmed: "Confirmée",
  preparing: "En préparation",
  out_for_delivery: "En livraison",
  shipped: "Expédiée",
  delivered: "Livrée",
  cancelled: "Annulée",
};

export async function sendOrderConfirmationEmail(order: Order) {
  if (!order.customerEmail) {
    console.info("Email client ignore", {
      kind: "order_confirmation",
      orderId: order.id,
      reason: "customer_email_absent",
    });
    return { status: "skipped", reason: "customer_email_absent" } satisfies EmailResult;
  }

  return sendManualOrderConfirmationEmail(order);
}

export async function sendAdminNewOrderEmail(order: Order) {
  const adminEmails = adminNotificationEmails();
  if (!adminEmails.length) return { status: "skipped", reason: "ADMIN_NOTIFICATION_EMAILS absent" } satisfies EmailResult;

  return sendAdminNotificationEmails({
    kind: "admin_new_order",
    orderId: order.id,
    to: adminEmails,
    subject: `${orderEmailTitle(order)} Verdanza #${shortOrderId(order.id)}`,
    html: adminOrderEmailHtml(order),
    text: adminOrderEmailText(order),
    idempotencyKey: `admin-new-order-${order.id}`,
  });
}

export async function sendManualOrderConfirmationEmail(order: Order) {
  if (!order.customerEmail) {
    console.info("Email client ignore", {
      kind: "order_confirmation",
      orderId: order.id,
      reason: "customer_email_absent",
    });
    return { status: "skipped", reason: "customer_email_absent" } satisfies EmailResult;
  }

  return sendTransactionalEmail({
    kind: "order_confirmation",
    orderId: order.id,
    to: order.customerEmail,
    subject:
      order.orderType === "preorder"
        ? "Votre précommande Verdanza a bien été reçue"
        : "Votre commande Verdanza a bien été reçue",
    html: customerManualOrderEmailHtml(order),
    text: customerManualOrderEmailText(order),
    idempotencyKey: `manual-order-confirmation-${order.id}`,
  });
}

export async function sendAdminManualOrderEmail(order: Order) {
  const adminEmails = adminNotificationEmails();
  if (!adminEmails.length) return { status: "skipped", reason: "ADMIN_NOTIFICATION_EMAILS absent" } satisfies EmailResult;

  return sendAdminNotificationEmails({
    kind: "admin_new_order",
    orderId: order.id,
    to: adminEmails,
    subject: `${orderEmailTitle(order)} Verdanza #${shortOrderId(order.id)}`,
    html: adminOrderEmailHtml(order),
    text: adminOrderEmailText(order),
    idempotencyKey: `admin-manual-order-${order.id}`,
  });
}

async function sendAdminNotificationEmails(input: {
  kind: TransactionalEmailKind;
  orderId: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
}): Promise<EmailResult> {
  const recipients: EmailRecipientResults = {};
  const validRecipients = input.to.filter(isValidEmail);

  for (const email of input.to) {
    if (!isValidEmail(email)) {
      recipients[email] = { status: "skipped", reason: "invalid_email" };
      console.warn("Email admin ignore: adresse invalide", {
        orderId: input.orderId,
        to: redactEmail(email),
      });
    }
  }

  await Promise.all(
    validRecipients.map(async (email) => {
      const result = await sendTransactionalEmail({
        ...input,
        to: email,
        idempotencyKey: `${input.idempotencyKey}-${email.toLowerCase().replace(/[^a-z0-9]/g, "-")}`,
      });
      if (result.status === "sent") {
        recipients[email] = { status: "sent", providerId: result.id };
        return;
      }
      recipients[email] = {
        status: result.status === "skipped" ? "skipped" : "failed",
        reason: result.reason,
      };
    }),
  );

  const values = Object.values(recipients);
  const sentCount = values.filter((entry) => entry.status === "sent").length;
  const failedCount = values.filter((entry) => entry.status === "failed").length;
  const skippedCount = values.filter((entry) => entry.status === "skipped").length;
  console.info("Synthese notification admin", {
    orderId: input.orderId,
    sentCount,
    failedCount,
    skippedCount,
  });

  if (sentCount === validRecipients.length && failedCount === 0 && skippedCount === 0) {
    return { status: "sent", recipients };
  }
  if (sentCount > 0) {
    return { status: "partial", reason: "admin_notification_partial", recipients };
  }
  if (skippedCount > 0 && failedCount === 0) {
    return { status: "skipped", reason: "admin_notification_skipped", recipients };
  }
  return { status: "failed", reason: "admin_notification_failed", recipients };
}

export async function sendOrderStatusUpdateEmail(
  order: Order,
  previousStatus: OrderStatus,
  nextStatus: OrderStatus,
) {
  const subject = `Commande Verdanza ${shortOrderId(order.id)} : ${statusLabels[nextStatus]}`;
  return sendTransactionalEmail({
    kind: "order_status_update",
    orderId: order.id,
    to: order.customerEmail,
    subject,
    html: orderEmailHtml(
      order,
      `Votre commande passe de "${statusLabels[previousStatus]}" a "${statusLabels[nextStatus]}".`,
    ),
    text: orderEmailText(
      order,
      `Votre commande passe de "${statusLabels[previousStatus]}" a "${statusLabels[nextStatus]}".`,
    ),
    idempotencyKey: `order-status-${order.id}-${nextStatus}`,
  });
}

export async function sendContactMessageEmail(input: {
  name: string;
  email: string;
  phone?: string;
  subject: string;
  message: string;
}) {
  const adminEmails = adminNotificationEmails();
  if (!adminEmails.length) {
    return { status: "skipped", reason: "ADMIN_NOTIFICATION_EMAILS absent" } satisfies EmailResult;
  }

  const safeSubject = input.subject || "Message contact Verdanza";
  return sendTransactionalEmail({
    kind: "contact_message",
    orderId: "contact",
    to: adminEmails,
    subject: `Contact Verdanza - ${safeSubject}`,
    html: contactEmailHtml(input),
    text: contactEmailText(input),
    idempotencyKey: `contact-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  });
}

export async function sendInvoiceToCustomerEmail(
  invoice: Invoice,
  settings: BillingSettings,
  pdfBuffer: Buffer,
) {
  if (!invoice.customerEmail) {
    return { status: "skipped", reason: "customer_email_absent" } satisfies EmailResult;
  }
  return sendTransactionalEmail({
    kind: "invoice",
    orderId: invoice.orderId || invoice.id,
    to: invoice.customerEmail,
    subject: `Votre facture Verdanza ${invoice.invoiceNumber}`,
    html: invoiceEmailHtml(invoice, settings),
    text: invoiceEmailText(invoice, settings),
    idempotencyKey: `invoice-${invoice.id}-${invoice.status}-${invoice.sentAt || "send"}`,
    attachments: [
      {
        filename: `${invoice.invoiceNumber}.pdf`,
        content: pdfBuffer.toString("base64"),
      },
    ],
  });
}

export async function sendPaymentLinkEmail(
  order: Order,
  input: { paymentLinkUrl: string; paymentLinkLabel: string },
) {
  if (!order.customerEmail) {
    return { status: "skipped", reason: "customer_email_absent" } satisfies EmailResult;
  }
  return sendTransactionalEmail({
    kind: "payment_link",
    orderId: order.id,
    to: order.customerEmail,
    subject: `Lien de paiement Verdanza pour votre commande ${shortOrderId(order.id)}`,
    html: paymentLinkEmailHtml(order, input),
    text: paymentLinkEmailText(order, input),
    idempotencyKey: `payment-link-${order.id}-${input.paymentLinkLabel}-${Date.now()}`,
  });
}

async function sendTransactionalEmail(input: {
  kind: TransactionalEmailKind;
  orderId: string;
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
  attachments?: Array<{ filename: string; content: string }>;
}): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    console.info("Email transactionnel ignore", {
      kind: input.kind,
      orderId: input.orderId,
      to: redactRecipients(input.to),
      reason: "email_not_configured",
    });
    return { status: "skipped", reason: "email_not_configured" };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        attachments: input.attachments,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!response.ok) {
      const reason = classifyResendError(response.status, payload.message);
      console.warn("Email transactionnel non envoye", {
        kind: input.kind,
        orderId: input.orderId,
        to: redactRecipients(input.to),
        status: response.status,
        reason,
      });
      return { status: "failed", reason, statusCode: response.status };
    }
    console.info("Email transactionnel envoye", {
      kind: input.kind,
      orderId: input.orderId,
      to: redactRecipients(input.to),
      providerId: payload.id,
    });
    return { status: "sent", id: payload.id };
  } catch (error) {
    console.warn("Email transactionnel en erreur", {
      kind: input.kind,
      orderId: input.orderId,
      to: redactRecipients(input.to),
      reason: error instanceof Error ? error.message : "email_failed",
    });
    return {
      status: "failed",
      reason: error instanceof Error ? error.message : "email_failed",
    };
  }
}

function classifyResendError(status: number, message?: string) {
  if (
    status === 403 &&
    message?.includes("You can only send testing emails to your own email address")
  ) {
    return "resend_testing_recipient_blocked";
  }
  return message || `HTTP ${status}`;
}

function redactEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "invalid_email";
  return `${local.slice(0, 2)}***@${domain}`;
}

function redactRecipients(to: string | string[]) {
  return Array.isArray(to) ? to.map(redactEmail).join(",") : redactEmail(to);
}

function adminNotificationEmails() {
  const raw =
    process.env.ADMIN_NOTIFICATION_EMAILS ||
    process.env.ADMIN_NOTIFICATION_EMAIL ||
    "contact@verdanza.fr,verdanza.1@gmail.com";
  return Array.from(new Set(raw
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean)
    .map((email) => email.toLowerCase())));
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function orderEmailHtml(order: Order, intro: string) {
  const rows = order.items
    .map(
      (item) =>
        `<li>${escapeHtml(item.name)} x ${item.quantity} - ${formatMoney(
          item.unitPrice * item.quantity,
        )}</li>`,
    )
    .join("");
  const accountUrl = process.env.VITE_APP_URL
    ? `${process.env.VITE_APP_URL}/compte/commandes`
    : "";
  return `
    <div style="font-family:Arial,sans-serif;color:#183c2f;line-height:1.5">
      <h1>Verdanza</h1>
      <p>${escapeHtml(intro)}</p>
      <p><strong>Type :</strong> ${escapeHtml(orderTypeLabel(order))}</p>
      <p><strong>Commande :</strong> ${escapeHtml(shortOrderId(order.id))}</p>
      <ul>${rows}</ul>
      ${promoEmailHtml(order)}
      <p><strong>Total estimé :</strong> ${formatMoney(Number(order.total || 0))}</p>
      <p><strong>Livraison :</strong> ${escapeHtml(order.deliveryZone || order.deliveryMethod)}</p>
      <p><strong>Information livraison :</strong> ${escapeHtml(deliveryInfoText(order))}</p>
      <p><strong>Mode de règlement souhaité :</strong> ${escapeHtml(preferredPaymentMethodLabel(order.preferredPaymentMethod))}</p>
      <p>Votre commande est en attente de confirmation par l'équipe Verdanza. Après vérification des disponibilités et du mode de livraison, nous vous confirmerons le montant final. Si vous avez choisi ou souhaitez un paiement par carte bancaire, un lien de paiement vous sera envoyé par email et/ou message.</p>
      <p><strong>Contact Verdanza :</strong> ${escapeHtml(contactPhone())} - ${escapeHtml(contactEmail())}</p>
      ${accountUrl ? `<p><a href="${accountUrl}">Voir mes commandes</a></p>` : ""}
    </div>
  `;
}

function orderEmailText(order: Order, intro: string) {
  const items = order.items
    .map((item) => `${item.name} x ${item.quantity} - ${formatMoney(item.unitPrice * item.quantity)}`)
    .join("\n");
  return [
    "Verdanza",
    intro,
    `Type: ${orderTypeLabel(order)}`,
    `Commande: ${shortOrderId(order.id)}`,
    items,
    ...promoEmailTextLines(order),
    `Total estimé: ${formatMoney(Number(order.total || 0))}`,
    `Livraison: ${order.deliveryZone || order.deliveryMethod}`,
    `Information livraison: ${deliveryInfoText(order)}`,
    `Mode de reglement souhaite: ${preferredPaymentMethodLabel(order.preferredPaymentMethod)}`,
    "Votre commande est en attente de confirmation par l'equipe Verdanza. Apres verification des disponibilites et du mode de livraison, nous vous confirmerons le montant final. Si vous avez choisi ou souhaitez un paiement par carte bancaire, un lien de paiement vous sera envoye par email et/ou message.",
    `Contact Verdanza: ${contactPhone()} - ${contactEmail()}`,
  ].join("\n");
}

function promoEmailHtml(order: Order) {
  const code = order.couponCode || order.promoCode;
  const hasPromo = Boolean(order.promoApplied || code || Number(order.discountAmount || 0) > 0);
  if (!hasPromo) return "";
  const subtotal = Number(order.subtotalBeforeDiscount || order.subtotal || 0);
  const discount = Number(order.discountAmount || 0);
  const discountLabel =
    order.discountType === "free_shipping" && discount <= 0
      ? "Livraison postale offerte"
      : `-${formatMoney(discount)}`;
  return `
    <p><strong>Sous-total avant remise :</strong> ${formatMoney(subtotal)}</p>
    <p><strong>Code promo ${escapeHtml(code || "")} :</strong> ${escapeHtml(discountLabel)}</p>
  `;
}

function promoEmailTextLines(order: Order) {
  const code = order.couponCode || order.promoCode;
  const hasPromo = Boolean(order.promoApplied || code || Number(order.discountAmount || 0) > 0);
  if (!hasPromo) return [];
  const subtotal = Number(order.subtotalBeforeDiscount || order.subtotal || 0);
  const discount = Number(order.discountAmount || 0);
  const discountLabel =
    order.discountType === "free_shipping" && discount <= 0
      ? "Livraison postale offerte"
      : `-${formatMoney(discount)}`;
  return [
    `Sous-total avant remise: ${formatMoney(subtotal)}`,
    `Code promo ${code || ""}: ${discountLabel}`,
  ];
}

function customerManualOrderEmailHtml(order: Order) {
  return orderEmailHtml(
    order,
    order.orderType === "preorder"
      ? "Votre précommande a bien été transmise à Verdanza. Nous vous contacterons rapidement afin de confirmer les disponibilités, la livraison et le règlement."
      : "Votre commande a bien été transmise à Verdanza. Nous vous contacterons rapidement par téléphone ou par email afin de confirmer les disponibilités, la livraison et le règlement.",
  );
}

function customerManualOrderEmailText(order: Order) {
  return [
    "Bonjour,",
    "",
    order.orderType === "preorder"
      ? "Votre précommande a bien été transmise à Verdanza."
      : "Votre commande a bien été transmise à Verdanza.",
    "",
    "Votre commande est en attente de confirmation par l'equipe Verdanza. Apres verification des disponibilites et du mode de livraison, nous vous confirmerons le montant final. Si vous avez choisi ou souhaitez un paiement par carte bancaire, un lien de paiement vous sera envoye par email et/ou message.",
    "",
    "Contact Verdanza:",
    `Téléphone: ${contactPhone()}`,
    `Email: ${contactEmail()}`,
    "",
    `Type: ${orderTypeLabel(order)}`,
    `Mode de reglement souhaite: ${preferredPaymentMethodLabel(order.preferredPaymentMethod)}`,
    "Résumé de votre commande:",
    order.items
      .map((item) => `${item.name} x ${item.quantity} g - ${formatMoney(item.unitPrice * item.quantity)}`)
      .join("\n"),
    ...promoEmailTextLines(order),
    `Total estimé: ${formatMoney(Number(order.total || 0))}`,
    "",
    "Merci,",
    "Verdanza",
  ].join("\n");
}

function adminOrderEmailHtml(order: Order) {
  const address = order.deliveryAddress;
  return `
    <div style="font-family:Arial,sans-serif;color:#183c2f;line-height:1.5">
      <h1>${escapeHtml(orderEmailTitle(order))} Verdanza</h1>
      <p><strong>Type :</strong> ${escapeHtml(orderTypeLabel(order))}</p>
      <p><strong>Commande :</strong> ${escapeHtml(shortOrderId(order.id))}</p>
      <p><strong>Client :</strong> ${escapeHtml(order.customerName || "Client")}</p>
      <p><strong>Téléphone :</strong> ${escapeHtml(order.customerPhone || "")}</p>
      <p><strong>Email :</strong> ${escapeHtml(order.customerEmail || "")}</p>
      <p><strong>Adresse :</strong> ${escapeHtml(formatAddress(address))}</p>
      <p><strong>Livraison :</strong> ${escapeHtml(order.deliveryZone || order.deliveryMethod)}</p>
      <p><strong>Minimum appliqué :</strong> ${escapeHtml(String(order.deliveryMinimumApplied ?? (order.deliveryMethod === "postal" ? 15 : 20)))} €</p>
      <p><strong>Livraison postale offerte :</strong> ${order.deliveryMethod === "postal" && order.postalFreeShippingApplied ? "Oui" : "Non"}</p>
      <p><strong>Frais postaux à confirmer :</strong> ${order.deliveryMethod === "postal" && !order.postalFreeShippingApplied ? "Oui" : "Non"}</p>
      <p><strong>Mode de règlement souhaité :</strong> ${escapeHtml(preferredPaymentMethodLabel(order.preferredPaymentMethod))}</p>
      <p><strong>Action paiement :</strong> Lien de paiement à envoyer si CB souhaitée.</p>
      <p><strong>Produits :</strong></p>
      <ul>${order.items
        .map((item) => `<li>${escapeHtml(item.name)} x ${item.quantity} g</li>`)
        .join("")}</ul>
      ${promoEmailHtml(order)}
      <p><strong>Total estimé :</strong> ${formatMoney(Number(order.total || 0))}</p>
      ${order.customerMessage ? `<p><strong>Message client :</strong> ${escapeHtml(order.customerMessage)}</p>` : ""}
      ${adminUrl() ? `<p><a href="${adminUrl()}">Ouvrir le cockpit admin</a></p>` : ""}
    </div>
  `;
}

function adminOrderEmailText(order: Order) {
  return [
    `${orderEmailTitle(order)} Verdanza`,
    `Type: ${orderTypeLabel(order)}`,
    `Commande: ${shortOrderId(order.id)}`,
    `Client: ${order.customerName || "Client"}`,
    `Téléphone: ${order.customerPhone || ""}`,
    `Email: ${order.customerEmail || ""}`,
    `Adresse: ${formatAddress(order.deliveryAddress)}`,
    `Livraison: ${order.deliveryZone || order.deliveryMethod}`,
    `Minimum applique: ${order.deliveryMinimumApplied ?? (order.deliveryMethod === "postal" ? 15 : 20)} EUR`,
    `Livraison postale offerte: ${order.deliveryMethod === "postal" && order.postalFreeShippingApplied ? "Oui" : "Non"}`,
    `Frais postaux a confirmer: ${order.deliveryMethod === "postal" && !order.postalFreeShippingApplied ? "Oui" : "Non"}`,
    `Mode de reglement souhaite: ${preferredPaymentMethodLabel(order.preferredPaymentMethod)}`,
    "Action paiement: lien de paiement a envoyer si CB souhaitee.",
    "Produits:",
    order.items.map((item) => `${item.name} x ${item.quantity} g`).join("\n"),
    ...promoEmailTextLines(order),
    `Total estimé: ${formatMoney(Number(order.total || 0))}`,
    order.customerMessage ? `Message client: ${order.customerMessage}` : "",
    adminUrl() ? `Admin: ${adminUrl()}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function invoiceEmailHtml(invoice: Invoice, settings: BillingSettings) {
  return `
    <div style="font-family:Arial,sans-serif;color:#183c2f;line-height:1.5">
      <h1>Votre facture Verdanza ${escapeHtml(invoice.invoiceNumber)}</h1>
      <p>Bonjour ${escapeHtml(invoice.customerName || "Client")},</p>
      <p>Vous trouverez votre facture Verdanza en pièce jointe.</p>
      <p><strong>Total :</strong> ${formatMoney(Number(invoice.total || 0))}</p>
      <p><strong>Statut du règlement :</strong> ${escapeHtml(invoice.paymentStatus)}</p>
      ${invoice.orderId ? `<p><strong>Commande :</strong> ${escapeHtml(shortOrderId(invoice.orderId))}</p>` : ""}
      <p>Pour toute question : ${escapeHtml(settings.phone)} - ${escapeHtml(settings.email)}</p>
      <p>Merci,<br>Verdanza</p>
    </div>
  `;
}

function invoiceEmailText(invoice: Invoice, settings: BillingSettings) {
  return [
    `Votre facture Verdanza ${invoice.invoiceNumber}`,
    "",
    `Bonjour ${invoice.customerName || "Client"},`,
    "Vous trouverez votre facture Verdanza en pièce jointe.",
    invoice.orderId ? `Commande: ${shortOrderId(invoice.orderId)}` : "",
    `Total: ${formatMoney(Number(invoice.total || 0))}`,
    `Statut du règlement: ${invoice.paymentStatus}`,
    "",
    `Téléphone: ${settings.phone}`,
    `Email: ${settings.email}`,
    "",
    "Merci,",
    "Verdanza",
  ].filter(Boolean).join("\n");
}

function paymentLinkEmailHtml(
  order: Order,
  input: { paymentLinkUrl: string; paymentLinkLabel: string },
) {
  return `
    <div style="font-family:Arial,sans-serif;color:#183c2f;line-height:1.5">
      <h1>Lien de paiement Verdanza</h1>
      <p>Bonjour ${escapeHtml(customerFirstName(order))},</p>
      <p>Votre commande Verdanza ${escapeHtml(shortOrderId(order.id))} est confirmée.</p>
      <p>Vous pouvez effectuer le règlement par carte bancaire via le lien suivant :</p>
      <p><a href="${escapeHtml(input.paymentLinkUrl)}">${escapeHtml(input.paymentLinkUrl)}</a></p>
      <p><strong>Total estimé / confirmé :</strong> ${formatMoney(Number(order.total || 0))}</p>
      <p><strong>Mode de livraison :</strong> ${escapeHtml(order.deliveryZone || order.deliveryMethod)}</p>
      <p>Dès réception du règlement, nous préparerons votre commande.</p>
      <p>Pour toute question :<br>Téléphone : ${escapeHtml(contactPhone())}<br>Email : ${escapeHtml(contactEmail())}</p>
      <p>Merci,<br>Verdanza</p>
    </div>
  `;
}

function paymentLinkEmailText(
  order: Order,
  input: { paymentLinkUrl: string; paymentLinkLabel: string },
) {
  return [
    `Bonjour ${customerFirstName(order)},`,
    "",
    `Votre commande Verdanza ${shortOrderId(order.id)} est confirmee.`,
    "",
    "Vous pouvez effectuer le reglement par carte bancaire via le lien suivant :",
    input.paymentLinkUrl,
    "",
    "Resume :",
    `Total estime / confirme : ${formatMoney(Number(order.total || 0))}`,
    `Mode de livraison : ${order.deliveryZone || order.deliveryMethod}`,
    "",
    "Des reception du reglement, nous preparerons votre commande.",
    "",
    "Pour toute question :",
    `Telephone : ${contactPhone()}`,
    `Email : ${contactEmail()}`,
    "",
    "Merci,",
    "Verdanza",
  ].join("\n");
}

function contactEmailHtml(input: {
  name: string;
  email: string;
  phone?: string;
  subject: string;
  message: string;
}) {
  return `
    <div style="font-family:Arial,sans-serif;color:#183c2f;line-height:1.5">
      <h1>Nouveau message Verdanza</h1>
      <p><strong>Nom :</strong> ${escapeHtml(input.name)}</p>
      <p><strong>Email :</strong> ${escapeHtml(input.email)}</p>
      ${input.phone ? `<p><strong>Téléphone :</strong> ${escapeHtml(input.phone)}</p>` : ""}
      <p><strong>Sujet :</strong> ${escapeHtml(input.subject)}</p>
      <p><strong>Message :</strong></p>
      <p>${escapeHtml(input.message).replaceAll("\n", "<br>")}</p>
    </div>
  `;
}

function contactEmailText(input: {
  name: string;
  email: string;
  phone?: string;
  subject: string;
  message: string;
}) {
  return [
    "Nouveau message Verdanza",
    `Nom: ${input.name}`,
    `Email: ${input.email}`,
    input.phone ? `Téléphone: ${input.phone}` : "",
    `Sujet: ${input.subject}`,
    "Message:",
    input.message,
  ]
    .filter(Boolean)
    .join("\n");
}

function shortOrderId(orderId: string) {
  return orderId.slice(0, 8).toUpperCase();
}

function formatMoney(value: number) {
  return `${value.toFixed(2).replace(".", ",")} EUR`;
}

function formatAddress(address?: Order["deliveryAddress"]) {
  if (!address) return "Adresse non renseignée";
  return [
    address.line1,
    address.line2,
    `${address.postalCode} ${address.city}`.trim(),
    address.country,
  ]
    .filter(Boolean)
    .join(", ");
}

function contactPhone() {
  return process.env.VERDANZA_CONTACT_PHONE || "07 80 81 41 37";
}

function contactEmail() {
  return process.env.VITE_CONTACT_EMAIL || "contact@verdanza.fr";
}

function customerFirstName(order: Order) {
  return (order.customerName || order.customerEmail || "Bonjour").split(" ")[0] || "Bonjour";
}

function orderTypeLabel(order: Order) {
  return order.orderType === "preorder" ? "Précommande" : "Commande";
}

function preferredPaymentMethodLabel(method?: Order["preferredPaymentMethod"]) {
  if (method === "card_payment_link") {
    return "Carte bancaire via lien de paiement après confirmation";
  }
  if (method === "bank_transfer") return "Virement bancaire";
  if (method === "local_delivery_payment") return "Paiement à la livraison locale";
  return "À confirmer avec Verdanza";
}

function deliveryInfoText(order: Order) {
  if (order.deliveryMethod === "postal") {
    if (order.postalFreeShippingApplied) {
      return "Livraison postale offerte.";
    }
    return "Livraison postale à partir de 15 € d'achat. Elle est offerte à partir de 60 €. Si votre commande est inférieure à 60 €, les frais postaux seront confirmés avec vous après validation.";
  }
  return "Livraison locale à partir de 20 € d'achat.";
}

function orderEmailTitle(order: Order) {
  return order.orderType === "preorder" ? "Nouvelle précommande" : "Nouvelle commande";
}

function adminUrl() {
  return process.env.VITE_APP_URL ? `${process.env.VITE_APP_URL}/admin` : "";
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

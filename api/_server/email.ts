import type { BillingSettings, Invoice, Order, OrderStatus } from "../../src/types/index.js";

export type EmailResult =
  | { status: "sent"; id?: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string; statusCode?: number };

type TransactionalEmailKind =
  | "order_confirmation"
  | "admin_new_order"
  | "order_status_update"
  | "contact_message"
  | "invoice";

const statusLabels: Record<OrderStatus, string> = {
  new: "Nouvelle commande",
  contact_required: "Client a contacter",
  confirmed: "Confirmee",
  preparing: "En preparation",
  out_for_delivery: "En livraison",
  shipped: "Expediee",
  delivered: "Livree",
  cancelled: "Annulee",
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

  return sendTransactionalEmail({
    kind: "admin_new_order",
    orderId: order.id,
    to: adminEmails,
    subject: `Nouvelle commande Verdanza #${shortOrderId(order.id)}`,
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
    subject: "Votre commande Verdanza a bien ete recue",
    html: customerManualOrderEmailHtml(order),
    text: customerManualOrderEmailText(order),
    idempotencyKey: `manual-order-confirmation-${order.id}`,
  });
}

export async function sendAdminManualOrderEmail(order: Order) {
  const adminEmails = adminNotificationEmails();
  if (!adminEmails.length) return { status: "skipped", reason: "ADMIN_NOTIFICATION_EMAILS absent" } satisfies EmailResult;

  return sendTransactionalEmail({
    kind: "admin_new_order",
    orderId: order.id,
    to: adminEmails,
    subject: `Nouvelle commande Verdanza #${shortOrderId(order.id)}`,
    html: adminOrderEmailHtml(order),
    text: adminOrderEmailText(order),
    idempotencyKey: `admin-manual-order-${order.id}`,
  });
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
  return raw
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);
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
      <p><strong>Commande :</strong> ${escapeHtml(shortOrderId(order.id))}</p>
      <ul>${rows}</ul>
      <p><strong>Total estime :</strong> ${formatMoney(Number(order.total || 0))}</p>
      <p><strong>Livraison :</strong> ${escapeHtml(order.deliveryZone || order.deliveryMethod)}</p>
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
    `Commande: ${shortOrderId(order.id)}`,
    items,
    `Total estime: ${formatMoney(Number(order.total || 0))}`,
    `Livraison: ${order.deliveryZone || order.deliveryMethod}`,
    `Contact Verdanza: ${contactPhone()} - ${contactEmail()}`,
  ].join("\n");
}

function customerManualOrderEmailHtml(order: Order) {
  return orderEmailHtml(
    order,
    "Votre commande a bien ete transmise a Verdanza. Nous vous contacterons rapidement par telephone ou par email afin de confirmer les disponibilites, la livraison et le reglement.",
  );
}

function customerManualOrderEmailText(order: Order) {
  return [
    "Bonjour,",
    "",
    "Votre commande a bien ete transmise a Verdanza.",
    "",
    "Nous vous contacterons rapidement par telephone ou par email afin de confirmer les disponibilites, la livraison et le reglement.",
    "",
    "Contact Verdanza:",
    `Telephone: ${contactPhone()}`,
    `Email: ${contactEmail()}`,
    "",
    "Resume de votre commande:",
    order.items
      .map((item) => `${item.name} x ${item.quantity} g - ${formatMoney(item.unitPrice * item.quantity)}`)
      .join("\n"),
    `Total estime: ${formatMoney(Number(order.total || 0))}`,
    "",
    "Merci,",
    "Verdanza",
  ].join("\n");
}

function adminOrderEmailHtml(order: Order) {
  const address = order.deliveryAddress;
  return `
    <div style="font-family:Arial,sans-serif;color:#183c2f;line-height:1.5">
      <h1>Nouvelle commande Verdanza</h1>
      <p><strong>Commande :</strong> ${escapeHtml(shortOrderId(order.id))}</p>
      <p><strong>Client :</strong> ${escapeHtml(order.customerName || "Client")}</p>
      <p><strong>Telephone :</strong> ${escapeHtml(order.customerPhone || "")}</p>
      <p><strong>Email :</strong> ${escapeHtml(order.customerEmail || "")}</p>
      <p><strong>Adresse :</strong> ${escapeHtml(formatAddress(address))}</p>
      <p><strong>Livraison :</strong> ${escapeHtml(order.deliveryZone || order.deliveryMethod)}</p>
      <p><strong>Produits :</strong></p>
      <ul>${order.items
        .map((item) => `<li>${escapeHtml(item.name)} x ${item.quantity} g</li>`)
        .join("")}</ul>
      <p><strong>Total estime :</strong> ${formatMoney(Number(order.total || 0))}</p>
      ${order.customerMessage ? `<p><strong>Message client :</strong> ${escapeHtml(order.customerMessage)}</p>` : ""}
      ${adminUrl() ? `<p><a href="${adminUrl()}">Ouvrir le cockpit admin</a></p>` : ""}
    </div>
  `;
}

function adminOrderEmailText(order: Order) {
  return [
    "Nouvelle commande Verdanza",
    `Commande: ${shortOrderId(order.id)}`,
    `Client: ${order.customerName || "Client"}`,
    `Telephone: ${order.customerPhone || ""}`,
    `Email: ${order.customerEmail || ""}`,
    `Adresse: ${formatAddress(order.deliveryAddress)}`,
    `Livraison: ${order.deliveryZone || order.deliveryMethod}`,
    "Produits:",
    order.items.map((item) => `${item.name} x ${item.quantity} g`).join("\n"),
    `Total estime: ${formatMoney(Number(order.total || 0))}`,
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
      <p>Vous trouverez votre facture Verdanza en piece jointe.</p>
      <p><strong>Total :</strong> ${formatMoney(Number(invoice.total || 0))}</p>
      <p><strong>Statut du reglement :</strong> ${escapeHtml(invoice.paymentStatus)}</p>
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
    "Vous trouverez votre facture Verdanza en piece jointe.",
    invoice.orderId ? `Commande: ${shortOrderId(invoice.orderId)}` : "",
    `Total: ${formatMoney(Number(invoice.total || 0))}`,
    `Statut du reglement: ${invoice.paymentStatus}`,
    "",
    `Telephone: ${settings.phone}`,
    `Email: ${settings.email}`,
    "",
    "Merci,",
    "Verdanza",
  ].filter(Boolean).join("\n");
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
      ${input.phone ? `<p><strong>Telephone :</strong> ${escapeHtml(input.phone)}</p>` : ""}
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
    input.phone ? `Telephone: ${input.phone}` : "",
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
  if (!address) return "Adresse non renseignee";
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

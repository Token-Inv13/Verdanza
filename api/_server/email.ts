import type { Order, OrderStatus } from "../../src/types/index.js";

export type EmailResult =
  | { status: "sent"; id?: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string; statusCode?: number };

type TransactionalEmailKind =
  | "order_confirmation"
  | "admin_new_order"
  | "order_status_update"
  | "refund_notification"
  | "contact_message";

const statusLabels: Record<OrderStatus, string> = {
  pending: "En attente",
  paid: "Payee",
  preparing: "En preparation",
  ready: "Prete",
  shipped: "Expediee",
  out_for_delivery: "En livraison",
  delivered: "Livree",
  cancelled: "Annulee",
  refunded: "Remboursee",
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

  const subject = `Confirmation de commande Verdanza ${shortOrderId(order.id)}`;
  return sendTransactionalEmail({
    kind: "order_confirmation",
    orderId: order.id,
    to: order.customerEmail,
    subject,
    html: orderEmailHtml(order, "Votre paiement est confirme. Nous preparons votre commande."),
    text: orderEmailText(order, "Votre paiement est confirme. Nous preparons votre commande."),
    idempotencyKey: `order-confirmation-${order.id}`,
  });
}

export async function sendAdminNewOrderEmail(order: Order) {
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL;
  if (!adminEmail) return { status: "skipped", reason: "ADMIN_NOTIFICATION_EMAIL absent" } satisfies EmailResult;

  return sendTransactionalEmail({
    kind: "admin_new_order",
    orderId: order.id,
    to: adminEmail,
    subject: `Nouvelle commande Verdanza ${shortOrderId(order.id)}`,
    html: orderEmailHtml(order, "Nouvelle commande payee a traiter dans l'administration."),
    text: orderEmailText(order, "Nouvelle commande payee a traiter dans l'administration."),
    idempotencyKey: `admin-new-order-${order.id}`,
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

export async function sendRefundNotificationEmail(order: Order) {
  return sendTransactionalEmail({
    kind: "refund_notification",
    orderId: order.id,
    to: order.customerEmail,
    subject: `Remboursement Verdanza ${shortOrderId(order.id)}`,
    html: orderEmailHtml(order, "Le remboursement de votre commande a ete initie."),
    text: orderEmailText(order, "Le remboursement de votre commande a ete initie."),
    idempotencyKey: `order-refund-${order.id}`,
  });
}

export async function sendContactMessageEmail(input: {
  name: string;
  email: string;
  phone?: string;
  subject: string;
  message: string;
}) {
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL;
  if (!adminEmail) {
    return { status: "skipped", reason: "ADMIN_NOTIFICATION_EMAIL absent" } satisfies EmailResult;
  }

  const safeSubject = input.subject || "Message contact Verdanza";
  return sendTransactionalEmail({
    kind: "contact_message",
    orderId: "contact",
    to: adminEmail,
    subject: `Contact Verdanza - ${safeSubject}`,
    html: contactEmailHtml(input),
    text: contactEmailText(input),
    idempotencyKey: `contact-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  });
}

async function sendTransactionalEmail(input: {
  kind: TransactionalEmailKind;
  orderId: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
}): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    console.info("Email transactionnel ignore", {
      kind: input.kind,
      orderId: input.orderId,
      to: redactEmail(input.to),
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
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!response.ok) {
      const reason = classifyResendError(response.status, payload.message);
      console.warn("Email transactionnel non envoye", {
        kind: input.kind,
        orderId: input.orderId,
        to: redactEmail(input.to),
        status: response.status,
        reason,
      });
      return { status: "failed", reason, statusCode: response.status };
    }
    console.info("Email transactionnel envoye", {
      kind: input.kind,
      orderId: input.orderId,
      to: redactEmail(input.to),
      providerId: payload.id,
    });
    return { status: "sent", id: payload.id };
  } catch (error) {
    console.warn("Email transactionnel en erreur", {
      kind: input.kind,
      orderId: input.orderId,
      to: redactEmail(input.to),
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
      <p><strong>Total :</strong> ${formatMoney(Number(order.total || 0))}</p>
      <p><strong>Livraison :</strong> ${escapeHtml(order.deliveryZone || order.deliveryMethod)}</p>
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
    `Total: ${formatMoney(Number(order.total || 0))}`,
    `Livraison: ${order.deliveryZone || order.deliveryMethod}`,
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

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

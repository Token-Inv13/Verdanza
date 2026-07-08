import { FormEvent, useEffect, useState } from "react";
import { getCustomerOrders, type CustomerOrderRow } from "../../services/ordersService";
import { useAuth } from "../../context/AuthContext";
import {
  createProductReview,
  getUserReviews,
  reviewDocumentId,
} from "../../services/reviewsService";
import type { OrderItem, ProductReview } from "../../types";
import {
  orderStatusLabel,
  paymentStatusLabel,
  visibleOrderSteps,
} from "../../utils/orderStatus";

export function AccountOrdersPage() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<CustomerOrderRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [reviews, setReviews] = useState<ProductReview[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function loadOrders() {
      if (!user) return;
      setIsLoading(true);
      setError("");
      try {
        const [result, reviewResult] = await Promise.all([
          getCustomerOrders(user.uid),
          getUserReviews(user.uid),
        ]);
        if (!cancelled) {
          setOrders(result);
          setReviews(reviewResult);
        }
      } catch (ordersError) {
        if (!cancelled) {
          setError(
            ordersError instanceof Error
              ? ordersError.message
              : "Chargement des commandes impossible.",
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void loadOrders();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (isLoading) return <p className="text-forest/70">Chargement des commandes...</p>;

  return (
    <section className="rounded-lg border border-forest/10 bg-ivory p-6">
      <h2 className="font-display text-3xl text-forest">Mes commandes</h2>
      {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
      {!error && orders.length === 0 && (
        <p className="mt-4 text-sm text-ink/65">
          Aucune commande rattachée à ce compte pour le moment.
        </p>
      )}
      <div className="mt-5 grid gap-4">
        {orders.map((order) => (
          <article key={order.id} className="rounded-lg border border-forest/10 bg-cream p-4">
            <div className="flex flex-col justify-between gap-2 md:flex-row">
              <div>
                <p className="font-medium text-forest">Commande {order.id.slice(0, 8)}</p>
                <p className="text-xs text-ink/50">{formatDate(order.createdAt)}</p>
              </div>
              <strong>{order.total.toFixed(2).replace(".", ",")} EUR</strong>
            </div>
            <div className="mt-3 grid gap-2 text-sm text-ink/70">
              <p>Règlement : {paymentStatusLabel(order.paymentStatus)}</p>
              <p>Statut : {orderStatusLabel(order.orderStatus)}</p>
              <p>Livraison : {order.deliveryMethod}</p>
              {order.trackingNumber && <p>Suivi postal : {order.trackingNumber}</p>}
              <p>
                Produits :{" "}
                {order.items
                  .map((item) => `${item.name} x ${item.quantity}`)
                  .join(", ")}
              </p>
            </div>
            <OrderProgress order={order} />
            {order.orderStatus === "delivered" && user && (
              <div className="mt-5 border-t border-forest/10 pt-4">
                <h3 className="font-display text-2xl text-forest">
                  Votre avis sur les produits
                </h3>
                <p className="mt-1 text-sm leading-6 text-ink/60">
                  Votre avis aide Verdanza à améliorer sa sélection. Il n’est pas
                  publié pour le moment.
                </p>
                <div className="mt-4 grid gap-3">
                  {order.items.map((item) => {
                    const id = reviewDocumentId(user.uid, order.id, item.productId);
                    const existing = reviews.find((review) => review.id === id);
                    return existing ? (
                      <p
                        key={item.productId}
                        className="rounded-md border border-forest/10 bg-ivory px-4 py-3 text-sm text-forest"
                      >
                        Avis enregistré pour {item.name} : {existing.rating}/5.
                      </p>
                    ) : (
                      <ReviewForm
                        key={item.productId}
                        userId={user.uid}
                        customerEmail={user.email || undefined}
                        orderId={order.id}
                        item={item}
                        onCreated={async () => {
                          setReviews(await getUserReviews(user.uid));
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function ReviewForm({
  userId,
  customerEmail,
  orderId,
  item,
  onCreated,
}: {
  userId: string;
  customerEmail?: string;
  orderId: string;
  item: OrderItem;
  onCreated: () => Promise<void>;
}) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setIsSubmitting(true);
    try {
      await createProductReview({
        userId,
        customerEmail,
        orderId,
        item,
        rating,
        comment,
      });
      await onCreated();
      setMessage("Merci, votre avis a bien été enregistré.");
    } catch (reviewError) {
      setMessage(
        reviewError instanceof Error
          ? reviewError.message
          : "Impossible d’enregistrer votre avis. Réessayez.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-md border border-forest/10 bg-ivory p-4"
    >
      <h4 className="font-semibold text-forest">{item.name}</h4>
      <div className="mt-3 grid gap-3 sm:grid-cols-[140px_1fr]">
        <label className="text-sm text-forest">
          Note
          <select
            className="mt-1 w-full rounded-md border border-forest/15 bg-white px-3 py-2"
            value={rating}
            onChange={(event) => setRating(Number(event.target.value))}
          >
            {[5, 4, 3, 2, 1].map((value) => (
              <option key={value} value={value}>
                {value}/5
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-forest">
          Commentaire
          <textarea
            className="mt-1 min-h-24 w-full rounded-md border border-forest/15 bg-white px-3 py-2"
            value={comment}
            maxLength={1000}
            required
            onChange={(event) => setComment(event.target.value)}
          />
        </label>
      </div>
      <button className="btn-primary mt-3" disabled={isSubmitting}>
        {isSubmitting ? "Enregistrement..." : "Enregistrer mon avis"}
      </button>
      {message && <p className="mt-3 text-sm text-forest">{message}</p>}
    </form>
  );
}

function OrderProgress({ order }: { order: CustomerOrderRow }) {
  const exceptional = order.orderStatus === "cancelled";
  const activeIndex = visibleOrderSteps.indexOf(order.orderStatus);

  return (
    <div className="mt-4 border-t border-forest/10 pt-4">
      {exceptional ? (
        <p className="rounded-md bg-ivory px-3 py-2 text-sm text-forest">
          Statut final : {orderStatusLabel(order.orderStatus)}.
        </p>
      ) : (
        <ol className="grid gap-2 text-xs text-ink/60 md:grid-cols-4">
          {visibleOrderSteps.map((status, index) => {
            const isDone = activeIndex >= index;
            return (
              <li
                key={status}
                className={`rounded-md border px-3 py-2 ${
                  isDone
                    ? "border-forest/30 bg-ivory text-forest"
                    : "border-forest/10 bg-transparent"
                }`}
              >
                {orderStatusLabel(status)}
              </li>
            );
          })}
        </ol>
      )}
      {order.statusHistory?.length ? (
        <div className="mt-3 grid gap-1 text-xs text-ink/55">
          {order.statusHistory.slice(-3).map((entry, index) => (
            <p key={`${entry.status}-${entry.changedAt}-${index}`}>
              {formatDate(entry.changedAt)} - {orderStatusLabel(entry.status)}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function formatDate(value?: unknown) {
  if (!value) return "Date en cours de synchronisation";
  const date =
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof value.toDate === "function"
      ? value.toDate()
      : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "Date en cours de synchronisation";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

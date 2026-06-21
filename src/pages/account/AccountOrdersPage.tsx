import { useEffect, useState } from "react";
import { getCustomerOrders, type CustomerOrderRow } from "../../services/ordersService";
import { useAuth } from "../../context/AuthContext";
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

  useEffect(() => {
    let cancelled = false;
    async function loadOrders() {
      if (!user) return;
      setIsLoading(true);
      setError("");
      try {
        const result = await getCustomerOrders(user.uid);
        if (!cancelled) setOrders(result);
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
          Aucune commande rattachee a ce compte pour le moment.
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
              <p>Paiement : {paymentStatusLabel(order.paymentStatus)}</p>
              <p>Statut : {orderStatusLabel(order.orderStatus)}</p>
              <p>Livraison : {order.deliveryMethod}</p>
              <p>
                Produits :{" "}
                {order.items
                  .map((item) => `${item.name} x ${item.quantity}`)
                  .join(", ")}
              </p>
            </div>
            <OrderProgress order={order} />
          </article>
        ))}
      </div>
    </section>
  );
}

function OrderProgress({ order }: { order: CustomerOrderRow }) {
  const exceptional = order.orderStatus === "cancelled" || order.orderStatus === "refunded";
  const activeIndex = visibleOrderSteps.indexOf(order.orderStatus);

  return (
    <div className="mt-4 border-t border-forest/10 pt-4">
      {exceptional ? (
        <p className="rounded-md bg-ivory px-3 py-2 text-sm text-forest">
          Statut final : {orderStatusLabel(order.orderStatus)}.
        </p>
      ) : (
        <ol className="grid gap-2 text-xs text-ink/60 md:grid-cols-5">
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

import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { updateCustomerProfile } from "../../services/customersService";

export function AccountProfilePage() {
  const { user, customerProfile, refreshCustomerProfile } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setDisplayName(customerProfile?.displayName || user?.displayName || "");
    setPhone(customerProfile?.phone || user?.phoneNumber || "");
  }, [customerProfile, user]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    setMessage("");
    setError("");
    try {
      await updateCustomerProfile(user.uid, { displayName, phone });
      await refreshCustomerProfile();
      setMessage("Profil mis a jour.");
    } catch (profileError) {
      setError(
        profileError instanceof Error
          ? profileError.message
          : "Mise a jour impossible.",
      );
    }
  }

  return (
    <section className="rounded-lg border border-forest/10 bg-ivory p-6">
      <h2 className="font-display text-3xl text-forest">Profil</h2>
      <p className="mt-2 text-sm text-ink/60">{user?.email}</p>
      <form onSubmit={handleSubmit} className="mt-6 grid max-w-xl gap-4">
        <label className="text-sm font-medium text-forest">
          Nom affiche
          <input
            className="input-field mt-2"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>
        <label className="text-sm font-medium text-forest">
          Telephone
          <input
            className="input-field mt-2"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        </label>
        {message && <p className="text-sm text-forest">{message}</p>}
        {error && <p className="text-sm text-red-700">{error}</p>}
        <button className="btn-primary w-fit">Enregistrer</button>
      </form>
    </section>
  );
}

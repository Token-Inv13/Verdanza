import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, CircleSlash2, Gift, Plus, RefreshCw, Search, Shuffle } from "lucide-react";
import {
  createAdminContest,
  cancelAdminContestPrize,
  drawAdminContest,
  getAdminContestDetail,
  invalidateAdminContestWinner,
  listAdminContests,
  resendAdminContestPrizeInvitation,
  transitionAdminContest,
  updateAdminContest,
  validateAdminContestWinner,
  type ContestAdminDetail,
} from "../../services/contestsService";
import type { Contest, ContestInput, ContestStatus } from "../../types/contests";

const statusLabels: Record<ContestStatus, string> = {
  draft: "Brouillon",
  scheduled: "Programmé",
  active: "Actif",
  closed: "Clôturé",
  drawing: "Tirage en cours",
  winner_pending: "Gagnant à valider",
  completed: "Terminé",
  cancelled: "Annulé",
};

function defaultContestInput(): ContestInput {
  const now = new Date();
  const start = new Date(now.getTime() + 60 * 60_000);
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60_000);
  const draw = new Date(end.getTime() + 60 * 60_000);
  return {
    title: "Verdanza Weekly",
    slug: "verdanza-weekly",
    description: "Participez gratuitement au tirage au sort Verdanza Weekly.",
    prizeValue: 30,
    prizeType: "store_credit",
    startAt: localDateTime(start),
    endAt: localDateTime(end),
    drawAt: localDateTime(draw),
    rulesUrl: "",
    rulesText:
      "Participation gratuite et sans obligation d'achat. Une participation par personne et par adresse e-mail. Le gagnant est tiré au sort après la clôture puis validé par Verdanza.",
    eligibilityConditions:
      "Être majeur, résider en France métropolitaine et disposer d'une adresse e-mail valide.",
    prizeExpirationDays: 30,
  };
}

export default function AdminContestsPage() {
  const [contests, setContests] = useState<Contest[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<ContestAdminDetail | null>(null);
  const [mode, setMode] = useState<"list" | "form" | "detail">("list");
  const [form, setForm] = useState<ContestInput>(defaultContestInput);
  const [editingId, setEditingId] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadList = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const result = await listAdminContests();
      setContests(result.contests);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Chargement impossible.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (contestId: string, nextPage = page, nextSearch = search) => {
    setIsLoading(true);
    setError("");
    try {
      const result = await getAdminContestDetail({
        contestId,
        page: nextPage,
        pageSize: 50,
        search: nextSearch,
      });
      setDetail(result);
      setSelectedId(contestId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Détail du concours indisponible.");
    } finally {
      setIsLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  async function openDetail(contestId: string) {
    setMode("detail");
    setPage(1);
    setSearch("");
    setMessage("");
    await loadDetail(contestId, 1, "");
  }

  function openCreate() {
    setEditingId("");
    setForm(defaultContestInput());
    setMode("form");
    setMessage("");
    setError("");
  }

  function openEdit(contest: Contest) {
    setEditingId(contest.id);
    setForm({
      title: contest.title,
      slug: contest.slug,
      description: contest.description,
      prizeValue: contest.prizeValue,
      prizeType: contest.prizeType,
      startAt: localDateTime(new Date(contest.startAt)),
      endAt: localDateTime(new Date(contest.endAt)),
      drawAt: localDateTime(new Date(contest.drawAt)),
      rulesUrl: contest.rulesUrl || "",
      rulesText: contest.rulesText || "",
      eligibilityConditions: contest.eligibilityConditions,
      prizeExpirationDays: contest.prizeExpirationDays,
    });
    setMode("form");
    setError("");
    setMessage("");
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError("");
    try {
      const payload = {
        ...form,
        startAt: new Date(form.startAt).toISOString(),
        endAt: new Date(form.endAt).toISOString(),
        drawAt: new Date(form.drawAt).toISOString(),
      };
      const result = editingId
        ? await updateAdminContest(editingId, payload)
        : await createAdminContest(payload);
      setMessage(editingId ? "Concours mis à jour." : "Concours créé en brouillon.");
      await loadList();
      await openDetail(result.contest.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Enregistrement impossible.");
    } finally {
      setIsSaving(false);
    }
  }

  async function changeStatus(status: ContestStatus) {
    if (!detail) return;
    if (!window.confirm(`Confirmer le passage vers « ${statusLabels[status]} » ?`)) return;
    await runAction(async () => {
      await transitionAdminContest(detail.contest.id, status);
      setMessage(`Statut mis à jour : ${statusLabels[status]}.`);
    });
  }

  async function runDraw() {
    if (!detail) return;
    const confirmation = window.prompt(
      `Action irréversible : saisissez TIRAGE pour tirer au sort parmi ${detail.entryTotal} participation(s).`,
    );
    if (confirmation !== "TIRAGE") return;
    await runAction(async () => {
      const result = await drawAdminContest(detail.contest.id);
      setMessage(`Tirage enregistré. Gagnant : ${result.winnerPublicId}.`);
    });
  }

  async function validateWinner() {
    if (!detail || !window.confirm("Valider définitivement ce gagnant et créer son bon unique ?")) return;
    await runAction(async () => {
      const result = await validateAdminContestWinner(detail.contest.id);
      const emailState = result.emailDelivery
        ? ` E-mail : ${result.emailDelivery.status}.`
        : "";
      const claimLink = result.claimUrl ? ` Lien généré : ${result.claimUrl}` : "";
      setMessage(`Gagnant validé, code ${result.prize.code}.${emailState}${claimLink}`);
    });
  }

  async function invalidateWinner() {
    if (!detail) return;
    const reason = window.prompt("Motif obligatoire de l’invalidation :")?.trim() || "";
    if (reason.length < 3) {
      setError("Un motif d’invalidation explicite est obligatoire.");
      return;
    }
    await runAction(async () => {
      await invalidateAdminContestWinner(detail.contest.id, reason);
      setMessage("Gagnant invalidé. Un nouveau tirage peut être lancé sans l’ancien gagnant.");
    });
  }

  async function resendPrizeInvitation() {
    const prize = detail?.prizes[0];
    if (!detail || !prize) return;
    if (!window.confirm("Renvoyer l’invitation ? L’ancien lien personnel sera immédiatement invalidé.")) return;
    await runAction(async () => {
      const result = await resendAdminContestPrizeInvitation(detail.contest.id, prize.id);
      const reason = result.emailDelivery.reason ? ` (${result.emailDelivery.reason})` : "";
      setMessage(`Invitation renouvelée. E-mail : ${result.emailDelivery.status}${reason}. Lien : ${result.claimUrl}`);
    });
  }

  async function cancelPrize() {
    if (!detail?.prizes[0]) return;
    const reason = window.prompt("Motif obligatoire de l’annulation du gain :")?.trim() || "";
    if (reason.length < 3) {
      setError("Un motif d’annulation explicite est obligatoire.");
      return;
    }
    await runAction(async () => {
      await cancelAdminContestPrize(detail.contest.id, detail.prizes[0].id, reason);
      setMessage("Gain annulé et coupon désactivé.");
    });
  }

  async function runAction(action: () => Promise<void>) {
    if (!detail) return;
    setIsSaving(true);
    setError("");
    setMessage("");
    try {
      await action();
      await Promise.all([loadDetail(detail.contest.id, page, search), loadList()]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Action impossible.");
    } finally {
      setIsSaving(false);
    }
  }

  const pageCount = useMemo(
    () => Math.max(1, Math.ceil((detail?.entryTotal || 0) / (detail?.pageSize || 50))),
    [detail],
  );

  return (
    <section className="grid min-w-0 gap-6">
      <header className="admin-card flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-champagne">Acquisition & fidélisation</p>
          <h1 className="font-display text-4xl text-forest md:text-5xl">Jeux-concours</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-ink/60">
            Configurez les périodes, contrôlez les participants, réalisez le tirage sécurisé et suivez le gain.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {mode !== "list" && (
            <button className="btn-secondary min-h-10 px-4 py-2" type="button" onClick={() => setMode("list")}>
              <ArrowLeft size={16} /> Liste
            </button>
          )}
          <button className="btn-primary min-h-10 px-4 py-2" type="button" onClick={openCreate}>
            <Plus size={16} /> Nouveau concours
          </button>
        </div>
      </header>

      {message && <div className="rounded-md border border-forest/15 bg-cream px-4 py-3 text-sm text-forest" role="status">{message}</div>}
      {error && <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{error}</div>}

      {mode === "list" && (
        <ContestList contests={contests} isLoading={isLoading} onOpen={openDetail} onEdit={openEdit} onRefresh={loadList} />
      )}
      {mode === "form" && (
        <ContestForm form={form} editing={Boolean(editingId)} isSaving={isSaving} onChange={setForm} onSubmit={handleSave} />
      )}
      {mode === "detail" && detail && (
        <div className="grid min-w-0 gap-6">
          <ContestConfiguration
            detail={detail}
            isSaving={isSaving}
            onEdit={() => openEdit(detail.contest)}
            onStatus={changeStatus}
          />
          <ParticipantsPanel
            detail={detail}
            search={search}
            pageCount={pageCount}
            onSearch={setSearch}
            onApplySearch={() => {
              setPage(1);
              void loadDetail(selectedId, 1, search);
            }}
            onPage={(nextPage) => {
              setPage(nextPage);
              void loadDetail(selectedId, nextPage, search);
            }}
          />
          <DrawPanel detail={detail} isSaving={isSaving} onDraw={runDraw} onValidate={validateWinner} onInvalidate={invalidateWinner} onResendPrizeInvitation={resendPrizeInvitation} onCancelPrize={cancelPrize} />
          <AuditPanel detail={detail} />
        </div>
      )}
    </section>
  );
}

function ContestList({ contests, isLoading, onOpen, onEdit, onRefresh }: {
  contests: Contest[];
  isLoading: boolean;
  onOpen: (id: string) => void;
  onEdit: (contest: Contest) => void;
  onRefresh: () => Promise<void>;
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-forest/10 bg-ivory">
      <div className="flex items-center justify-between border-b border-forest/10 bg-cream/70 p-4">
        <p className="text-sm text-ink/60">{contests.length} concours</p>
        <button className="btn-secondary min-h-9 px-3 py-2" type="button" onClick={() => void onRefresh()}>
          <RefreshCw size={15} /> Rafraîchir
        </button>
      </div>
      {isLoading && <Empty title="Chargement..." />}
      {!isLoading && !contests.length && <Empty title="Aucun concours" description="Créez le premier concours Verdanza." />}
      {!!contests.length && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead className="bg-cream text-xs uppercase tracking-[0.12em] text-forest/70">
              <tr>{["Concours", "Statut", "Période", "Participants", "Lot", "Tirage / gagnant", "Actions"].map((item) => <th key={item} className="px-4 py-3 font-medium">{item}</th>)}</tr>
            </thead>
            <tbody>
              {contests.map((contest) => (
                <tr key={contest.id} className="border-t border-forest/10 align-top">
                  <td className="px-4 py-4"><strong className="block text-forest">{contest.title}</strong><span className="text-xs text-ink/50">{contest.slug}</span></td>
                  <td className="px-4 py-4"><StatusBadge status={contest.status} /></td>
                  <td className="px-4 py-4 text-xs leading-5">{formatDate(contest.startAt)}<br />{formatDate(contest.endAt)}</td>
                  <td className="px-4 py-4 font-semibold text-forest">{contest.entryCount || 0}</td>
                  <td className="px-4 py-4">{formatEuro(contest.prizeValue)}</td>
                  <td className="px-4 py-4 text-xs text-ink/60">{contest.currentDrawId ? `Tirage ${shortId(contest.currentDrawId)}` : "Non effectué"}<br />{contest.winnerEntryId ? `Gagnant ${shortId(contest.winnerEntryId)}` : "Aucun gagnant"}</td>
                  <td className="px-4 py-4"><div className="flex gap-2"><button className="btn-primary min-h-9 px-3 py-2" onClick={() => void onOpen(contest.id)}>Ouvrir</button>{["draft", "scheduled"].includes(contest.status) && <button className="btn-secondary min-h-9 px-3 py-2" onClick={() => onEdit(contest)}>Modifier</button>}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ContestForm({ form, editing, isSaving, onChange, onSubmit }: {
  form: ContestInput;
  editing: boolean;
  isSaving: boolean;
  onChange: (value: ContestInput) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const field = <K extends keyof ContestInput>(key: K, value: ContestInput[K]) => onChange({ ...form, [key]: value });
  return (
    <form className="admin-card grid gap-6" onSubmit={onSubmit}>
      <div><h2 className="font-display text-3xl text-forest">{editing ? "Modifier le concours" : "Nouveau concours"}</h2><p className="mt-2 text-sm text-ink/60">La création produit toujours un brouillon. L’ouverture utilise une action de statut séparée.</p></div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Titre"><input className="input-field" value={form.title} onChange={(e) => field("title", e.target.value)} required /></Field>
        <Field label="Slug"><input className="input-field" value={form.slug} onChange={(e) => field("slug", e.target.value)} required /></Field>
      </div>
      <Field label="Description"><textarea className="input-field min-h-28 resize-y" value={form.description} onChange={(e) => field("description", e.target.value)} required /></Field>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Début"><input className="input-field" type="datetime-local" value={form.startAt} onChange={(e) => field("startAt", e.target.value)} required /></Field>
        <Field label="Fin"><input className="input-field" type="datetime-local" value={form.endAt} onChange={(e) => field("endAt", e.target.value)} required /></Field>
        <Field label="Tirage prévu"><input className="input-field" type="datetime-local" value={form.drawAt} onChange={(e) => field("drawAt", e.target.value)} required /></Field>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Type de lot"><select className="input-field" value={form.prizeType} onChange={() => field("prizeType", "store_credit")}><option value="store_credit">Bon / crédit Verdanza</option></select></Field>
        <Field label="Valeur du lot (EUR)"><input className="input-field" type="number" min="0.01" step="0.01" value={form.prizeValue} onChange={(e) => field("prizeValue", Number(e.target.value))} required /></Field>
        <Field label="Expiration du gain (jours)"><input className="input-field" type="number" min="1" max="365" value={form.prizeExpirationDays} onChange={(e) => field("prizeExpirationDays", Number(e.target.value))} required /></Field>
      </div>
      <Field label="Conditions d’éligibilité"><textarea className="input-field min-h-24 resize-y" value={form.eligibilityConditions} onChange={(e) => field("eligibilityConditions", e.target.value)} required /></Field>
      <Field label="Lien vers le règlement (optionnel si texte ci-dessous)"><input className="input-field" type="url" value={form.rulesUrl || ""} onChange={(e) => field("rulesUrl", e.target.value)} /></Field>
      <Field label="Règlement complet"><textarea className="input-field min-h-40 resize-y" value={form.rulesText || ""} onChange={(e) => field("rulesText", e.target.value)} /></Field>
      <button className="btn-primary w-full sm:w-fit" disabled={isSaving}>{isSaving ? "Enregistrement..." : editing ? "Enregistrer les modifications" : "Créer le brouillon"}</button>
    </form>
  );
}

function ContestConfiguration({ detail, isSaving, onEdit, onStatus }: {
  detail: ContestAdminDetail;
  isSaving: boolean;
  onEdit: () => void;
  onStatus: (status: ContestStatus) => Promise<void>;
}) {
  const contest = detail.contest;
  const actions: ContestStatus[] = contest.status === "draft" ? ["scheduled", "active", "cancelled"] : contest.status === "scheduled" ? ["draft", "active", "cancelled"] : contest.status === "active" ? ["closed", "cancelled"] : contest.status === "closed" ? ["cancelled"] : [];
  return (
    <section className="admin-card">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-3"><h2 className="font-display text-4xl text-forest">{contest.title}</h2><StatusBadge status={contest.status} /></div><p className="mt-2 text-sm text-ink/60">#{contest.sequenceNumber} · {contest.id}</p></div>{["draft", "scheduled"].includes(contest.status) && <button className="btn-secondary min-h-10 px-4 py-2" onClick={onEdit}>Modifier</button>}</div>
      <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2 xl:grid-cols-4"><Info label="Début" value={formatDate(contest.startAt)} /><Info label="Fin" value={formatDate(contest.endAt)} /><Info label="Tirage prévu" value={formatDate(contest.drawAt)} /><Info label="Lot" value={`${formatEuro(contest.prizeValue)} · ${contest.prizeExpirationDays} jours`} /></dl>
      {!!actions.length && <div className="mt-6 flex flex-wrap gap-2">{actions.map((status) => <button key={status} type="button" className={status === "cancelled" ? "btn-secondary min-h-10 px-4 py-2 text-red-700" : "btn-primary min-h-10 px-4 py-2"} disabled={isSaving} onClick={() => void onStatus(status)}>{statusLabels[status]}</button>)}</div>}
    </section>
  );
}

function ParticipantsPanel({ detail, search, pageCount, onSearch, onApplySearch, onPage }: {
  detail: ContestAdminDetail;
  search: string;
  pageCount: number;
  onSearch: (value: string) => void;
  onApplySearch: () => void;
  onPage: (page: number) => void;
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-forest/10 bg-ivory">
      <div className="border-b border-forest/10 bg-cream/70 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="font-display text-3xl text-forest">Participants</h2><p className="text-sm text-ink/60">{detail.entryTotal} résultat(s), 50 par page.</p></div><div className="flex w-full gap-2 sm:w-auto"><input className="input-field sm:w-72" value={search} onChange={(e) => onSearch(e.target.value)} placeholder="ID, prénom ou e-mail" onKeyDown={(e) => { if (e.key === "Enter") onApplySearch(); }} /><button className="btn-secondary min-h-11 px-3" onClick={onApplySearch}><Search size={17} /><span className="sr-only">Rechercher</span></button></div></div></div>
      {!detail.entries.length ? <Empty title="Aucun participant" /> : <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-sm"><thead className="bg-cream text-xs uppercase tracking-[0.12em] text-forest/70"><tr>{["Identifiant", "Participant", "E-mail", "Date", "Statut", "Marketing"].map((item) => <th key={item} className="px-4 py-3 font-medium">{item}</th>)}</tr></thead><tbody>{detail.entries.map((entry) => <tr key={entry.id} className="border-t border-forest/10"><td className="px-4 py-3 font-mono text-xs text-forest">{entry.publicId}</td><td className="px-4 py-3">{entry.displayName}</td><td className="px-4 py-3">{entry.email}</td><td className="px-4 py-3 text-xs">{formatDate(entry.enteredAt)}</td><td className="px-4 py-3">{entry.status === "eligible" ? "Éligible" : "Invalidé"}</td><td className="px-4 py-3">{entry.marketingConsent ? "Oui" : "Non"}</td></tr>)}</tbody></table></div>}
      {pageCount > 1 && <div className="flex items-center justify-between border-t border-forest/10 p-4 text-sm"><button className="btn-secondary min-h-9 px-3 py-2" disabled={detail.page <= 1} onClick={() => onPage(detail.page - 1)}>Précédent</button><span>Page {detail.page} / {pageCount}</span><button className="btn-secondary min-h-9 px-3 py-2" disabled={detail.page >= pageCount} onClick={() => onPage(detail.page + 1)}>Suivant</button></div>}
    </section>
  );
}

function DrawPanel({ detail, isSaving, onDraw, onValidate, onInvalidate, onResendPrizeInvitation, onCancelPrize }: {
  detail: ContestAdminDetail;
  isSaving: boolean;
  onDraw: () => Promise<void>;
  onValidate: () => Promise<void>;
  onInvalidate: () => Promise<void>;
  onResendPrizeInvitation: () => Promise<void>;
  onCancelPrize: () => Promise<void>;
}) {
  const currentDraw = detail.draws.find((draw) => draw.id === detail.contest.currentDrawId);
  const prize = detail.prizes[0];
  return (
    <section className="grid gap-6 xl:grid-cols-2">
      <div className="admin-card"><div className="flex items-center justify-between"><div><h2 className="font-display text-3xl text-forest">Tirage sécurisé</h2><p className="mt-1 text-sm text-ink/60">{detail.entryTotal} participant(s) total.</p></div><Shuffle className="text-champagne" /></div>{detail.contest.status === "closed" && <button className="btn-primary mt-5" disabled={isSaving} onClick={() => void onDraw()}><Shuffle size={17} /> Lancer le tirage</button>}<div className="mt-5 grid gap-3">{detail.draws.map((draw) => <article key={draw.id} className="rounded-md border border-forest/10 bg-cream p-4 text-xs leading-5"><div className="flex justify-between gap-3"><strong className="text-forest">Tirage #{draw.drawNumber}</strong><span>{draw.winnerStatus}</span></div><p className="mt-2">Population : {draw.eligibleEntryCount} · gagnant {draw.winnerPublicId}</p><p className="mt-1 break-all font-mono text-[11px] text-ink/50">SHA-256 {draw.snapshotHash}</p><p className="mt-1 text-ink/50">{draw.algorithmVersion} · {formatDate(draw.drawnAt)}</p>{draw.invalidationReason && <p className="mt-2 text-red-700">Motif : {draw.invalidationReason}</p>}</article>)}</div></div>
      <div className="admin-card"><div className="flex items-center justify-between"><div><h2 className="font-display text-3xl text-forest">Gagnant & gain</h2><p className="mt-1 text-sm text-ink/60">Validation humaine obligatoire avant émission.</p></div><Gift className="text-champagne" /></div>{currentDraw?.winnerStatus === "pending" && <div className="mt-5 rounded-md border border-champagne/30 bg-cream p-4"><p className="font-semibold text-forest">{currentDraw.winnerPublicId}</p><div className="mt-4 flex flex-wrap gap-2"><button className="btn-primary min-h-10 px-4 py-2" disabled={isSaving} onClick={() => void onValidate()}><CheckCircle2 size={16} /> Valider</button><button className="btn-secondary min-h-10 px-4 py-2 text-red-700" disabled={isSaving} onClick={() => void onInvalidate()}><CircleSlash2 size={16} /> Invalider</button></div></div>}{prize ? <><dl className="mt-5 grid gap-3 text-sm"><Info label="Gagnant" value={`${prize.winnerDisplayName} · ${prize.winnerPublicId}`} /><Info label="Code" value={prize.code} /><Info label="Statut" value={prize.status} /><Info label="Invitation" value={prize.emailDelivery ? `${prize.emailDelivery.status} · tentative ${formatDate(prize.emailDelivery.attemptedAt)}` : "Non envoyée"} /><Info label="Expiration" value={formatDate(prize.expiresAt)} /><Info label="Commande" value={prize.orderId || "Non utilisé"} /></dl>{["issued", "claimed"].includes(prize.status) && <div className="mt-5 flex flex-wrap gap-2"><button className="btn-secondary min-h-10 px-4 py-2" disabled={isSaving} onClick={() => void onResendPrizeInvitation()}><RefreshCw size={16} /> Renvoyer l’invitation</button><button className="btn-secondary min-h-10 px-4 py-2 text-red-700" disabled={isSaving} onClick={() => void onCancelPrize()}>Annuler le gain</button></div>}</> : !currentDraw && <p className="mt-5 text-sm text-ink/55">Aucun gagnant sélectionné.</p>}</div>
    </section>
  );
}

function AuditPanel({ detail }: { detail: ContestAdminDetail }) {
  return <section className="admin-card"><h2 className="font-display text-3xl text-forest">Journal d’audit</h2><p className="mt-1 text-sm text-ink/60">Événements sensibles en lecture seule.</p><div className="mt-5 grid gap-2">{detail.audits.map((audit) => <div key={audit.id} className="grid gap-1 rounded-md border border-forest/10 px-4 py-3 text-xs sm:grid-cols-[180px_1fr_220px]"><span>{formatDate(audit.createdAt)}</span><strong className="text-forest">{audit.action}</strong><span className="break-all text-ink/55">{audit.actorType} · {audit.actorId}</span>{audit.reason && <span className="sm:col-span-3 text-red-700">Motif : {audit.reason}</span>}</div>)}{!detail.audits.length && <p className="text-sm text-ink/55">Aucun événement.</p>}</div></section>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="grid gap-2 text-sm font-semibold text-forest">{label}{children}</label>; }
function Info({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs uppercase tracking-[0.12em] text-forest/55">{label}</dt><dd className="mt-1 break-words font-semibold text-forest">{value}</dd></div>; }
function Empty({ title, description }: { title: string; description?: string }) { return <div className="p-10 text-center"><h3 className="font-display text-3xl text-forest">{title}</h3>{description && <p className="mt-2 text-sm text-ink/60">{description}</p>}</div>; }
function StatusBadge({ status }: { status: ContestStatus }) { const tone = status === "active" || status === "completed" ? "border-forest/20 bg-forest/10 text-forest" : status === "cancelled" ? "border-red-200 bg-red-50 text-red-700" : "border-champagne/30 bg-cream text-forest"; return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}>{statusLabels[status]}</span>; }
function formatEuro(value: number) { return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(value); }
function formatDate(value?: string) { return value ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "Non communiqué"; }
function localDateTime(date: Date) { const offset = date.getTimezoneOffset() * 60_000; return new Date(date.getTime() - offset).toISOString().slice(0, 16); }
function shortId(value: string) { return value.length > 14 ? `${value.slice(0, 7)}…${value.slice(-5)}` : value; }

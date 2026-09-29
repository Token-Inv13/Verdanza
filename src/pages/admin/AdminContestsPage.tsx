import { AdminConfirmDialog } from "../../components/admin/AdminConfirmDialog";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, CircleSlash2, Gift, Plus, RefreshCw, Search, Shuffle } from "lucide-react";
import {
  cancelAdminContestPrize,
  drawAdminContest,
  getAdminContestDetail,
  invalidateAdminContestWinner,
  listAdminContests,
  resendAdminContestPrizeInvitation,
  transitionAdminContest,
  validateAdminContestWinner,
  type ContestAdminDetail,
} from "../../services/contestsService";
import type { Contest, ContestStatus } from "../../types/contests";

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

export default function AdminContestsPage({ onPrepare }: { onPrepare: (contest?: Contest) => void }) {
  const [contests, setContests] = useState<Contest[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<ContestAdminDetail | null>(null);
  const [mode, setMode] = useState<"list" | "detail">("list");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [readError, setReadError] = useState(false);

  const [confirmation, setConfirmation] = useState<{ title: string; warning: string; run: (reason: string) => Promise<void>; requiresReason?: boolean; requiresDraw?: boolean } | null>(null);
  const [reason, setReason] = useState("");
  const [drawAcknowledgement, setDrawAcknowledgement] = useState("");

  const loadList = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const result = await listAdminContests();
      setContests(result.contests);
      setReadError(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Chargement impossible.");
      setReadError(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (contestId: string, nextPage = page, nextSearch = search) => {
    setIsLoading(true);
    setError("");
    setSelectedId(contestId);
    try {
      const result = await getAdminContestDetail({
        contestId,
        page: nextPage,
        pageSize: 50,
        search: nextSearch,
      });
      setDetail(result);
      setReadError(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Détail du concours indisponible.");
      setDetail(null);
      setReadError(true);
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

  function openCreate() { onPrepare(); }
  function openEdit(contest: Contest) { onPrepare(contest); }
  function confirmAction(value: NonNullable<typeof confirmation>) {
    setReason(""); setDrawAcknowledgement(""); setConfirmation(value);
  }

  async function changeStatus(status: ContestStatus) {
    if (!detail) return;
    if (["scheduled", "active"].includes(status)) { onPrepare(detail.contest); return; }
    const id = detail.contest.id;
    confirmAction({ title: `Passer le concours à ${statusLabels[status]}`, warning: "Le moteur concours vérifie la transition. Aucun tirage ni gain n'est déclenché par ce changement.", run: async () => runAction(async () => { await transitionAdminContest(id, status); setMessage(`Statut mis à jour : ${statusLabels[status]}.`); }) });
  }
  async function runDraw() {
    if (!detail) return;
    const id = detail.contest.id;
    confirmAction({ title: "Lancer le tirage", warning: `Le tirage sera enregistré parmi ${detail.entryTotal} participation(s). Saisissez TIRAGE pour confirmer cette action.`, requiresDraw: true, run: async () => runAction(async () => { const result = await drawAdminContest(id); setMessage(`Tirage enregistré. Gagnant : ${result.winnerPublicId}.`); }) });
  }
  async function validateWinner() {
    if (!detail) return;
    const id = detail.contest.id;
    confirmAction({ title: "Valider le gagnant et attribuer le gain", warning: "Cette action crée le bon unique protégé et peut envoyer l'invitation au gagnant. Elle reste séparée de l'activation Marketing.", run: async () => runAction(async () => { const result = await validateAdminContestWinner(id); const emailState = result.emailDelivery ? ` E-mail : ${result.emailDelivery.status}.` : ""; const claimLink = result.claimUrl ? ` Lien généré : ${result.claimUrl}` : ""; setMessage(`Gagnant validé, code ${result.prize.code}.${emailState}${claimLink}`); }) });
  }
  async function invalidateWinner() {
    if (!detail) return;
    const id = detail.contest.id;
    confirmAction({ title: "Invalider le gagnant", warning: "Un nouveau tirage pourra être lancé sans l'ancien gagnant. Le motif est obligatoire.", requiresReason: true, run: async (value) => runAction(async () => { await invalidateAdminContestWinner(id, value); setMessage("Gagnant invalidé. Un nouveau tirage peut être lancé sans l'ancien gagnant."); }) });
  }
  async function resendPrizeInvitation() {
    const prize = detail?.prizes[0]; if (!detail || !prize) return;
    const id = detail.contest.id;
    confirmAction({ title: "Renvoyer l'invitation", warning: "L'ancien lien personnel sera immédiatement invalidé. Cette action peut envoyer un email au gagnant.", run: async () => runAction(async () => { const result = await resendAdminContestPrizeInvitation(id, prize.id); const cause = result.emailDelivery.reason ? ` (${result.emailDelivery.reason})` : ""; setMessage(`Invitation renouvelée. E-mail : ${result.emailDelivery.status}${cause}. Lien : ${result.claimUrl}`); }) });
  }
  async function cancelPrize() {
    const prize = detail?.prizes[0]; if (!detail || !prize) return;
    const id = detail.contest.id;
    confirmAction({ title: "Annuler le gain", warning: "Le coupon protégé sera désactivé. Le motif est obligatoire.", requiresReason: true, run: async (value) => runAction(async () => { await cancelAdminContestPrize(id, prize.id, value); setMessage("Gain annulé et coupon désactivé."); }) });
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
      throw reason;
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
            <button className="btn-secondary min-h-10 px-4 py-2" type="button" onClick={() => { setMode("list"); void loadList(); }}>
              <ArrowLeft size={16} /> Liste
            </button>
          )}
          <button className="btn-primary min-h-10 px-4 py-2" type="button" onClick={openCreate}>
            <Plus size={16} /> Nouveau concours
          </button>
        </div>
      </header>

      {message && <div className="rounded-md border border-forest/15 bg-cream px-4 py-3 text-sm text-forest" role="status">{message}</div>}
      {error && <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{error} {readError && <button type="button" className="ml-2 font-semibold underline" onClick={() => void (mode === "list" ? loadList() : loadDetail(selectedId))}>Réessayer la lecture</button>}</div>}

      {mode === "list" && (
        <ContestList contests={contests} isLoading={isLoading} readError={readError} onOpen={openDetail} onEdit={openEdit} onRefresh={loadList} />
      )}
      {mode === "detail" && detail && !isLoading && !readError && (
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
      <AdminConfirmDialog open={Boolean(confirmation)} title={confirmation?.title || "Confirmer l'action concours"} warning={confirmation?.warning} summary={detail ? `${detail.contest.title} · ${statusLabels[detail.contest.status]} · ${formatDate(detail.contest.startAt)} → ${formatDate(detail.contest.endAt)} · lot ${formatEuro(detail.contest.prizeValue)}` : undefined}
        pending={isSaving} confirmLabel="Confirmer cette action" confirmDisabled={Boolean((confirmation?.requiresReason && reason.trim().length < 3) || (confirmation?.requiresDraw && drawAcknowledgement !== "TIRAGE"))} onCancel={() => setConfirmation(null)} onConfirm={async () => { if (!confirmation) return; await confirmation.run(reason.trim()); setConfirmation(null); }}>
        {confirmation?.requiresReason && <label className="text-sm">Motif obligatoire<textarea className="input-field mt-2" value={reason} onChange={(event) => setReason(event.target.value)} /></label>}
        {confirmation?.requiresDraw && <label className="text-sm">Saisir TIRAGE<input className="input-field mt-2" value={drawAcknowledgement} onChange={(event) => setDrawAcknowledgement(event.target.value)} /></label>}
      </AdminConfirmDialog>
    </section>
  );
}

function ContestList({ contests, isLoading, readError, onOpen, onEdit, onRefresh }: {
  contests: Contest[];
  isLoading: boolean;
  readError: boolean;
  onOpen: (id: string) => void;
  onEdit: (contest: Contest) => void;
  onRefresh: () => Promise<void>;
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-forest/10 bg-ivory">
      <div className="flex items-center justify-between border-b border-forest/10 bg-cream/70 p-4">
        <p className="text-sm text-ink/60">{readError || isLoading ? "—" : contests.length} concours</p>
        <button className="btn-secondary min-h-9 px-3 py-2" type="button" onClick={() => void onRefresh()}>
          <RefreshCw size={15} /> Rafraîchir
        </button>
      </div>
      {isLoading && <Empty title="Chargement..." />}
      {!isLoading && !readError && !contests.length && <Empty title="Aucun concours" description="Créez le premier concours Verdanza." />}
      {!isLoading && !readError && !!contests.length && (
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

function Info({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs uppercase tracking-[0.12em] text-forest/55">{label}</dt><dd className="mt-1 break-words font-semibold text-forest">{value}</dd></div>; }
function Empty({ title, description }: { title: string; description?: string }) { return <div className="p-10 text-center"><h3 className="font-display text-3xl text-forest">{title}</h3>{description && <p className="mt-2 text-sm text-ink/60">{description}</p>}</div>; }
function StatusBadge({ status }: { status: ContestStatus }) { const tone = status === "active" || status === "completed" ? "border-forest/20 bg-forest/10 text-forest" : status === "cancelled" ? "border-red-200 bg-red-50 text-red-700" : "border-champagne/30 bg-cream text-forest"; return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}>{statusLabels[status]}</span>; }
function formatEuro(value: number) { return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(value); }
function formatDate(value?: string) { return value ? new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "Non communiqué"; }
function shortId(value: string) { return value.length > 14 ? `${value.slice(0, 7)}…${value.slice(-5)}` : value; }

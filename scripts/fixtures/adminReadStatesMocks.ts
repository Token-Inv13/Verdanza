export const adminReadStates = {
  contestsFail: true, commentsFail: true, contestReads: 0, commentReads: 0,
  contestAvailable: false, detailReads: 0, mutationApplied: false,
  detailFailAfterMutation: false, holdListOnce: false,
  releaseList: null as (() => void) | null,
};
export async function getFirebaseIdToken() { return "fixture-admin-token"; }
export async function getCurrentFirebaseUser() { return { uid: "fixture-admin", displayName: "Admin fixture" }; }
let contestStatus: "draft" | "cancelled" = "draft";
const contest = () => ({
  id: "contest-fixture", sequenceNumber: 1, title: "Concours fixture", slug: "concours-fixture",
  description: "Concours de test local", prizeValue: 10, prizeType: "store_credit" as const,
  startAt: "2026-09-28T10:00:00.000Z", endAt: "2026-10-05T10:00:00.000Z", drawAt: "2026-10-06T10:00:00.000Z",
  status: contestStatus, eligibilityConditions: "Fixture", prizeExpirationDays: 30, entryCount: 0,
  createdBy: "fixture-admin", updatedBy: "fixture-admin",
});
export async function listAdminContests() {
  adminReadStates.contestReads++;
  if (adminReadStates.contestsFail) throw new Error("Concours indisponibles (fixture)");
  if (adminReadStates.holdListOnce) {
    adminReadStates.holdListOnce = false;
    return new Promise<{ contests: ReturnType<typeof contest>[] }>((resolve) => {
      adminReadStates.releaseList = () => resolve({ contests: [contest()] });
    });
  }
  return { contests: adminReadStates.contestAvailable ? [contest()] : [] };
}
export async function listAdminBlogComments() {
  adminReadStates.commentReads++;
  if (adminReadStates.commentsFail) throw new Error("Commentaires indisponibles (fixture)");
  return { comments: [], total: 0, page: 1 };
}
export async function getAdminContestDetail() {
  adminReadStates.detailReads++;
  if (adminReadStates.mutationApplied && adminReadStates.detailFailAfterMutation)
    throw new Error("Détail concours indisponible après mutation (fixture)");
  return { contest: contest(), entries: [], entryTotal: 0, page: 1, pageSize: 50, draws: [], prizes: [], audits: [] };
}
export async function cancelAdminContestPrize() { throw new Error("Mutation interdite dans la fixture"); }
export async function drawAdminContest() { throw new Error("Mutation interdite dans la fixture"); }
export async function invalidateAdminContestWinner() { throw new Error("Mutation interdite dans la fixture"); }
export async function resendAdminContestPrizeInvitation() { throw new Error("Mutation interdite dans la fixture"); }
export async function transitionAdminContest() {
  contestStatus = "cancelled";
  adminReadStates.mutationApplied = true;
  adminReadStates.detailFailAfterMutation = true;
  adminReadStates.holdListOnce = true;
}
export async function validateAdminContestWinner() { throw new Error("Mutation interdite dans la fixture"); }
export async function deleteAdminBlogComment() { throw new Error("Mutation interdite dans la fixture"); }
export async function moderateAdminBlogComment() { throw new Error("Mutation interdite dans la fixture"); }

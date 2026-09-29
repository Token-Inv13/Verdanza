export const adminReadStates = { contestsFail: true, commentsFail: true, contestReads: 0, commentReads: 0 };
export async function listAdminContests() {
  adminReadStates.contestReads++;
  if (adminReadStates.contestsFail) throw new Error("Concours indisponibles (fixture)");
  return { contests: [] };
}
export async function listAdminBlogComments() {
  adminReadStates.commentReads++;
  if (adminReadStates.commentsFail) throw new Error("Commentaires indisponibles (fixture)");
  return { comments: [], total: 0, page: 1 };
}
export async function getAdminContestDetail() { throw new Error("Détail inattendu dans la fixture"); }
export async function cancelAdminContestPrize() { throw new Error("Mutation interdite dans la fixture"); }
export async function drawAdminContest() { throw new Error("Mutation interdite dans la fixture"); }
export async function invalidateAdminContestWinner() { throw new Error("Mutation interdite dans la fixture"); }
export async function resendAdminContestPrizeInvitation() { throw new Error("Mutation interdite dans la fixture"); }
export async function transitionAdminContest() { throw new Error("Mutation interdite dans la fixture"); }
export async function validateAdminContestWinner() { throw new Error("Mutation interdite dans la fixture"); }
export async function deleteAdminBlogComment() { throw new Error("Mutation interdite dans la fixture"); }
export async function moderateAdminBlogComment() { throw new Error("Mutation interdite dans la fixture"); }

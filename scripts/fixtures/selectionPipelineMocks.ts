export async function getFirebaseIdToken() { return "local-fixture-token"; }
export const selectionFixtureReads = { catalogFailure: false, catalogRows: [] as Array<{ id: string; name: string; slug: string; category: string; price: number; stock: number; isActive: boolean }> };
export async function getFirestoreProducts() {
  if (selectionFixtureReads.catalogFailure) throw new Error("Lecture catalogue refusée (fixture)");
  return selectionFixtureReads.catalogRows;
}

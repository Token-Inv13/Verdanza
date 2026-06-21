import { FieldValue } from "firebase-admin/firestore";
import {
  assertValidEmail,
  getRequiredAdminDb,
  requireConfirmationFlag,
} from "./_firebaseAdminScript.js";

async function setDoc(
  reference: FirebaseFirestore.DocumentReference,
  data: FirebaseFirestore.DocumentData,
  options: FirebaseFirestore.SetOptions,
) {
  await reference.set(data, options);
}

async function main() {
  requireConfirmationFlag("seed:admin");

  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) {
    throw new Error("BOOTSTRAP_ADMIN_EMAIL est requis pour creer le premier admin.");
  }
  assertValidEmail(email);

  const { db, projectId } = getRequiredAdminDb();
  const adminRef = db.collection("adminUsers").doc(email);
  const snapshot = await adminRef.get();
  const existing = snapshot.data();
  const uid = process.env.BOOTSTRAP_ADMIN_UID?.trim() || existing?.uid || null;

  console.log(`Projet Firebase cible: ${projectId}`);
  console.log(`Admin cible: ${email}`);

  await setDoc(
    adminRef,
    {
      uid,
      email,
      role: "owner",
      isActive: true,
      createdAt: existing?.createdAt ?? FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  const verification = await adminRef.get();
  const data = verification.data();

  if (!verification.exists || data?.email !== email || data?.isActive !== true) {
    throw new Error("Verification admin echouee apres bootstrap.");
  }

  console.log(
    JSON.stringify(
      {
        documentId: adminRef.id,
        email,
        role: data.role,
        isActive: data.isActive,
        created: !snapshot.exists,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

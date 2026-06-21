import { getAuth } from "firebase-admin/auth";
import {
  assertValidEmail,
  getRequiredAdminDb,
  requireConfirmationFlag,
} from "./_firebaseAdminScript.js";

async function main() {
  requireConfirmationFlag("seed:admin-auth");

  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const temporaryPassword = process.env.BOOTSTRAP_ADMIN_TEMP_PASSWORD;
  if (!email) {
    throw new Error("BOOTSTRAP_ADMIN_EMAIL est requis pour bootstrap Firebase Auth.");
  }
  assertValidEmail(email);

  const { projectId } = getRequiredAdminDb();
  const auth = getAuth();
  console.log(`Projet Firebase cible: ${projectId}`);
  console.log(`Admin Auth cible: ${email}`);

  let created = false;
  let user = await auth.getUserByEmail(email).catch((error: unknown) => {
    const code = typeof error === "object" && error && "code" in error ? error.code : "";
    if (code === "auth/user-not-found") return null;
    throw error;
  });

  if (!user) {
    user = await auth.createUser({
      email,
      emailVerified: false,
      disabled: false,
      ...(temporaryPassword ? { password: temporaryPassword } : {}),
    });
    created = true;
  } else if (temporaryPassword) {
    user = await auth.updateUser(user.uid, {
      password: temporaryPassword,
      disabled: false,
    });
  }

  console.log(
    JSON.stringify(
      {
        uid: user.uid,
        email: user.email,
        created,
        passwordUpdated: Boolean(temporaryPassword),
        disabled: user.disabled,
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

import { FieldValue } from "firebase-admin/firestore";
import { aixRadiusDeliveryZone } from "../src/data/deliveryZones.js";
import { getRequiredAdminDb } from "./_firebaseAdminScript.js";

export const AIX_RADIUS_ZONE_PROJECT_ID = "verdanza-1f621";
export const AIX_RADIUS_ZONE_CONFIRMATION = "verdanza-aix-radius-zone-v1";

export function assertAixRadiusZoneTarget(projectId: string) {
  if (projectId !== AIX_RADIUS_ZONE_PROJECT_ID) {
    throw new Error(
      `Projet Firebase refusé: ${projectId || "(inconnu)"} au lieu de ${AIX_RADIUS_ZONE_PROJECT_ID}.`,
    );
  }
}

export function aixRadiusZonePayload(existingCreatedAt?: unknown) {
  return {
    ...aixRadiusDeliveryZone,
    isActive: false,
    isOpen: false,
    status: "disabled" as const,
    createdAt: existingCreatedAt ?? FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

async function main() {
  const shouldApply = process.argv.includes("--apply");
  const confirmation = process.argv
    .find((argument) => argument.startsWith("--confirm="))
    ?.slice("--confirm=".length);
  const { db, projectId } = getRequiredAdminDb();
  assertAixRadiusZoneTarget(projectId);

  const zoneRef = db.collection("deliveryZones").doc(aixRadiusDeliveryZone.id);
  const before = await zoneRef.get();
  console.log(
    JSON.stringify(
      {
        mode: shouldApply ? "apply" : "dry-run",
        projectId,
        documentPath: `deliveryZones/${aixRadiusDeliveryZone.id}`,
        operation: before.exists ? "update" : "create",
        isActive: false,
        status: "disabled",
      },
      null,
      2,
    ),
  );

  if (!shouldApply) return;
  if (confirmation !== AIX_RADIUS_ZONE_CONFIRMATION) {
    throw new Error(
      `Confirmation refusée. Utiliser --confirm=${AIX_RADIUS_ZONE_CONFIRMATION}.`,
    );
  }

  await zoneRef.set(aixRadiusZonePayload(before.data()?.createdAt), { merge: true });
  const after = await zoneRef.get();
  const data = after.data();
  if (
    !after.exists ||
    data?.id !== aixRadiusDeliveryZone.id ||
    data?.isActive !== false ||
    data?.isOpen !== false ||
    data?.status !== "disabled" ||
    data?.name !== aixRadiusDeliveryZone.name ||
    data?.fee !== aixRadiusDeliveryZone.fee ||
    data?.minimumOrder !== aixRadiusDeliveryZone.minimumOrder ||
    data?.estimatedDelayMinMinutes !== aixRadiusDeliveryZone.estimatedDelayMinMinutes ||
    data?.estimatedDelayMaxMinutes !== aixRadiusDeliveryZone.estimatedDelayMaxMinutes ||
    data?.validationMode !== "radius" ||
    data?.centerLabel !== aixRadiusDeliveryZone.centerLabel ||
    data?.centerLatitude !== aixRadiusDeliveryZone.centerLatitude ||
    data?.centerLongitude !== aixRadiusDeliveryZone.centerLongitude ||
    data?.radiusMeters !== 15_000 ||
    data?.addressValidationEnabled !== true ||
    data?.sortOrder !== 0
  ) {
    throw new Error("Vérification Firestore de la zone inactive échouée.");
  }
  console.log(
    JSON.stringify(
      {
        verified: true,
        documentPath: `deliveryZones/${aixRadiusDeliveryZone.id}`,
        isActive: data.isActive,
        isOpen: data.isOpen,
        status: data.status,
      },
      null,
      2,
    ),
  );
}

const isDirectExecution = process.argv[1]?.replace(/\\/g, "/").endsWith(
  "/scripts/upsertAixRadiusDeliveryZone.ts",
);
if (isDirectExecution) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

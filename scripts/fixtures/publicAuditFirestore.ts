import { getDocs as sdkGetDocs, type DocumentData, type Query } from "firebase/firestore";
export * from "firebase/firestore";

declare global {
  interface Window {
    __VERDANZA_AUDIT_SDK_QUERIES__?: Array<{ size: number; fromCache: boolean }>;
  }
}

// Observe the native SDK without changing its result or its network behaviour.
export async function getDocs<AppModelType, DbModelType extends DocumentData>(query: Query<AppModelType, DbModelType>) {
  const result = await sdkGetDocs(query);
  (window.__VERDANZA_AUDIT_SDK_QUERIES__ ||= []).push({ size: result.size, fromCache: result.metadata.fromCache });
  return result;
}

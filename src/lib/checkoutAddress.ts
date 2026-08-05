import type { Address } from "../types/index.js";

export function invalidateAddressVerification(
  address: Address,
  updates: Partial<Pick<Address, "line1" | "postalCode" | "city" | "country">>,
): Address {
  const unverifiedAddress = { ...address };
  delete unverifiedAddress.normalizedLabel;
  delete unverifiedAddress.houseNumber;
  delete unverifiedAddress.street;
  delete unverifiedAddress.latitude;
  delete unverifiedAddress.longitude;
  delete unverifiedAddress.verifiedAt;
  delete unverifiedAddress.verificationProvider;
  return { ...unverifiedAddress, ...updates };
}

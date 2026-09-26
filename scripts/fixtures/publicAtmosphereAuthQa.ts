// Only resolved by the isolated QA server. No SDK, token or real account.
export function useAuth() {
  return { user: { uid: "local-atmosphere-qa", email: "qa@example.invalid" },
    customerProfile: { orderCount: 0, totalSpent: 0, loyaltyPoints: 0 },
    isLoading: false, isAdmin: false, signOut: async () => undefined };
}

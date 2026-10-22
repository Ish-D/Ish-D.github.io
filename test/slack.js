/** Time limits in tests are for a quiet machine; a shared build runner gets more room. */
export const slack = process.env.CI ? 6 : 1;

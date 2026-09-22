/**
 * The published worked example (docs/money.md). Used by the unit tests and by
 * the database contract test, so the TypeScript preview and the SQL that
 * actually books the order are checked against the same numbers.
 */
export const WORKED_EXAMPLE = {
  lines: [
    // 4 inverters at $1,249.00, 2% discount (sand band)
    { qty: 4, unitPriceUsdCents: 124_900, discountBps: 200 },
    // 2 batteries at $1,890.50, 4.5% discount (red band)
    { qty: 2, unitPriceUsdCents: 189_050, discountBps: 450 },
  ],
  rates: { sdgPerUsdE6: 8_012_500_000, eurPerUsdE6: 918_400 },
  expected: {
    lines: [
      [499_600, 9_992, 489_608],
      [378_100, 17_015, 361_085],
    ],
    totalUsdCents: 850_693, // $8,506.93
    totalSdg: 68_161_777, // 68,161,777 SDG
    totalEurCents: 781_276, // €7,812.76
  },
} as const;

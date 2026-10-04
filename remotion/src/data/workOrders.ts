/* The four work orders of chain CH-GA-1201A-01, copied from the product.
   Descriptions are the work orders' own text - nothing is paraphrased. */
export const CHAIN_WOS = [
  { id: "WO-240003", date: "23 Feb 2025", tag: "MISALIGNMENT",
    text: "GA-1201A tripped on VSHH-1201 high vibration 7.4 mm/s" },
  { id: "WO-240013", date: "19 Mar 2025", tag: "VIBRATION",
    text: "Hairline crack in epoxy grout under baseplate edge" },
  { id: "WO-240004", date: "29 Mar 2025", tag: "MISALIGNMENT",
    text: "Bearing DE noisy with rising temperature TI-1201 trend" },
  { id: "WO-240007", date: "25 Aug 2025", tag: "MISALIGNMENT",
    text: "Abnormal noise from coupling area, guard vibration" },
] as const;

/** Synthetic source builders contain no household export data. */
export const registerHeaders = [
  "Account",
  "Flag",
  "Date",
  "Payee",
  "Category Group/Category",
  "Category Group",
  "Category",
  "Memo",
  "Outflow",
  "Inflow",
  "Cleared",
];
export const planHeaders = [
  "Month",
  "Category Group/Category",
  "Category Group",
  "Category",
  "Assigned",
  "Activity",
  "Available",
];
export function registerFields() {
  return [
    "Demo cash",
    "",
    "10/22/2026",
    "Example store",
    "Daily / Food",
    "Daily",
    "Food",
    "",
    "$12.34",
    "$0.00",
    "Cleared",
  ];
}
export function planFields() {
  return ["Oct 2026", "Daily / Food", "Daily", "Food", "$100.00", "-$12.34", "$87.66"];
}
export function csvText(headers: string[], rows: string[][], newline = "\n") {
  return (
    [headers, ...rows]
      .map((fields) => fields.map((field) => `"${field.replaceAll('"', '""')}"`).join(","))
      .join(newline) + newline
  );
}
export function csvBytes(headers: string[], rows: string[][]) {
  return new TextEncoder().encode(csvText(headers, rows));
}

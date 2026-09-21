export function formatEuro(value: number) {
  return `${value.toFixed(2).replace(".", ",")} EUR`;
}

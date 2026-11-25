/** Phần đầy của một thanh tiến độ k/N, trong [0, 1]. N ≤ 0 (chưa có gì để đếm) → 0, không chia cho 0. */
export function progressRatio(value: number, max: number): number {
  if (!(max > 0) || !(value > 0)) return 0;
  return Math.min(1, value / max);
}

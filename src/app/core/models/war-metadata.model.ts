/** Metadata for one captured war; the payload itself is fetched separately. */
export interface WarMetadata {
  readonly id: string;
  readonly label: string;
  readonly sourceLabel: string;
  readonly opponentName: string;
  readonly warDate: number;
  readonly isCurrent: boolean;
  readonly rawBytes: number;
  readonly compressedBytes: number;
  readonly uploadedBy: string | null;
  readonly uploadedAt: number | null;
}

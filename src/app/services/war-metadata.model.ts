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

export const WARS_COLLECTION = 'wars';
export const PAYLOAD_COLLECTION = 'payload';
export const PAYLOAD_DOC = 'snapshot';
export const STATIC_COLLECTION = 'static';
export const ADMINS_COLLECTION = 'admins';

/** A Firestore document caps at 1 MiB; refuse well before that so failures are legible. */
export const MAX_COMPRESSED_BYTES = 900_000;

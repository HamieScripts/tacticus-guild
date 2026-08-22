import { computed, inject, Injectable, signal } from '@angular/core';
import { collection, getDocs, orderBy, query, Timestamp } from 'firebase/firestore';
import { FirebaseService } from './firebase.service';
import { WARS_COLLECTION, type WarMetadata } from './war-metadata.model';

function toMillis(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === 'number') return value;
  return null;
}

/** Replaces the POC's dataset-manifest.json: the list of available wars. */
@Injectable({ providedIn: 'root' })
export class WarDatasetService {
  private readonly firebase = inject(FirebaseService);

  private readonly warsState = signal<readonly WarMetadata[]>([]);
  private readonly loadingState = signal(false);
  private readonly errorState = signal<string | null>(null);
  private loaded: Promise<void> | null = null;

  readonly wars = this.warsState.asReadonly();
  readonly isLoading = this.loadingState.asReadonly();
  readonly error = this.errorState.asReadonly();

  readonly currentWar = computed<WarMetadata | null>(() => {
    const wars = this.warsState();
    return wars.find((war) => war.isCurrent) ?? wars[0] ?? null;
  });

  /** Safe to call from several pages; the underlying fetch happens once. */
  load(): Promise<void> {
    this.loaded ??= this.fetch();
    return this.loaded;
  }

  async reload(): Promise<void> {
    this.loaded = this.fetch();
    return this.loaded;
  }

  byId(id: string | null | undefined): WarMetadata | undefined {
    if (!id) return undefined;
    return this.warsState().find((war) => war.id === id);
  }

  private async fetch(): Promise<void> {
    this.loadingState.set(true);
    this.errorState.set(null);

    try {
      const db = this.firebase.getFirestore();
      const snapshot = await getDocs(
        query(collection(db, WARS_COLLECTION), orderBy('warDate', 'desc')),
      );

      this.warsState.set(
        snapshot.docs.map((doc) => {
          const data = doc.data();
          return {
            id: doc.id,
            label: String(data['label'] ?? ''),
            sourceLabel: String(data['sourceLabel'] ?? ''),
            opponentName: String(data['opponentName'] ?? ''),
            warDate: toMillis(data['warDate']) ?? 0,
            isCurrent: Boolean(data['isCurrent']),
            rawBytes: Number(data['rawBytes'] ?? 0),
            compressedBytes: Number(data['compressedBytes'] ?? 0),
            uploadedBy: (data['uploadedBy'] as string | undefined) ?? null,
            uploadedAt: toMillis(data['uploadedAt']),
          } satisfies WarMetadata;
        }),
      );
    } catch (error) {
      this.loaded = null;
      this.errorState.set(error instanceof Error ? error.message : 'Failed to load wars.');
    } finally {
      this.loadingState.set(false);
    }
  }
}

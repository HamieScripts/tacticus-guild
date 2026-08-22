import { inject, Injectable, signal } from '@angular/core';
import { Bytes, doc, getDoc } from 'firebase/firestore';
import type { WarSnapshot } from '@core/models/war-snapshot.model';
import { buildSnapshot, type GuildSnapshot } from '@core/snapshot/build-snapshot';
import { gunzipJson } from '@core/util/gzip';
import { FirebaseService } from './firebase.service';
import { PAYLOAD_COLLECTION, PAYLOAD_DOC, WARS_COLLECTION } from './firestore-collections';

@Injectable({ providedIn: 'root' })
export class WarSnapshotService {
  private readonly firebase = inject(FirebaseService);

  private readonly cache = new Map<string, GuildSnapshot[]>();
  private readonly inFlight = new Map<string, Promise<GuildSnapshot[]>>();

  private readonly loadingState = signal(false);
  private readonly errorState = signal<string | null>(null);

  readonly isLoading = this.loadingState.asReadonly();
  readonly error = this.errorState.asReadonly();

  get(warId: string): Promise<GuildSnapshot[]> {
    const cached = this.cache.get(warId);
    if (cached) return Promise.resolve(cached);

    const pending = this.inFlight.get(warId);
    if (pending) return pending;

    const request = this.fetch(warId).finally(() => this.inFlight.delete(warId));
    this.inFlight.set(warId, request);
    return request;
  }

  private async fetch(warId: string): Promise<GuildSnapshot[]> {
    this.loadingState.set(true);
    this.errorState.set(null);

    try {
      const db = this.firebase.getFirestore();
      const payload = await getDoc(
        doc(db, WARS_COLLECTION, warId, PAYLOAD_COLLECTION, PAYLOAD_DOC),
      );

      if (!payload.exists()) {
        throw new Error(`No snapshot payload stored for war ${warId}.`);
      }

      const gzipField = payload.get('gzip') as Bytes | undefined;
      if (!(gzipField instanceof Bytes)) {
        throw new Error(`Snapshot payload for war ${warId} is missing its gzip bytes.`);
      }

      const raw = await gunzipJson<WarSnapshot>(gzipField.toUint8Array());
      const guilds = buildSnapshot(raw);
      this.cache.set(warId, guilds);
      return guilds;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load the war snapshot.';
      this.errorState.set(message);
      throw error;
    } finally {
      this.loadingState.set(false);
    }
  }
}


import { inject, Injectable, signal } from '@angular/core';
import { doc, getDoc } from 'firebase/firestore';
import { normalizeUnitId } from '@core/util/format';
import { FirebaseService } from './firebase.service';
import { STATIC_COLLECTION } from './firestore-collections';

const PORTRAIT_BASE_PATH = 'img';

@Injectable({ providedIn: 'root' })
export class PortraitService {
  private readonly firebase = inject(FirebaseService);

  private readonly portraitMap = signal<Readonly<Record<string, string>>>({});
  private readonly available = signal<ReadonlySet<string>>(new Set());
  private loaded: Promise<void> | null = null;

  readonly map = this.portraitMap.asReadonly();

  load(): Promise<void> {
    this.loaded ??= this.fetch();
    return this.loaded;
  }

  /** Returns null when a unit has no mapped portrait, so callers can fall back. */
  urlFor(unitId: string | null | undefined): string | null {
    const normalized = normalizeUnitId(unitId);
    if (!normalized) return null;

    const entries = this.portraitMap();
    const fileName = entries[unitId ?? ''] ?? entries[normalized];
    if (!fileName || fileName === 'unknown') return null;
    if (this.available().size > 0 && !this.available().has(fileName)) return null;

    return `${PORTRAIT_BASE_PATH}/${fileName}`;
  }

  urlsFor(unitIds: Iterable<string | null | undefined>): ReadonlyMap<string, string> {
    const resolved = new Map<string, string>();
    for (const unitId of unitIds) {
      if (!unitId || resolved.has(unitId)) continue;
      const url = this.urlFor(unitId);
      if (url) resolved.set(unitId, url);
    }
    return resolved;
  }

  private async fetch(): Promise<void> {
    const db = this.firebase.getFirestore();

    const [portraitDoc, manifestDoc] = await Promise.all([
      getDoc(doc(db, STATIC_COLLECTION, 'portraitMap')),
      getDoc(doc(db, STATIC_COLLECTION, 'imageManifest')),
    ]);

    if (portraitDoc.exists()) {
      this.portraitMap.set((portraitDoc.get('map') as Record<string, string>) ?? {});
    }

    if (manifestDoc.exists()) {
      this.available.set(new Set((manifestDoc.get('files') as string[]) ?? []));
    }
  }
}


// ============================================================
// Adapter Registry
// ------------------------------------------------------------
// Manages all registered Platform_Adapters and performs
// priority-based platform detection for the current page URL.
//
// Detection rule: adapters are evaluated in priority order
// (lowest `priority` number = highest precedence). The first
// adapter whose `matchesUrl()` returns true for the given URL
// becomes the active platform. Returns null when no registered
// adapter matches.
// ============================================================

import type { PlatformAdapter, AdapterRegistry as IAdapterRegistry } from '@/types';

export class AdapterRegistry implements IAdapterRegistry {
  private adapters: PlatformAdapter[] = [];
  private activePlatform: PlatformAdapter | null = null;

  /**
   * Register a new platform adapter. Adapters are kept sorted by
   * priority (ascending) so detection always evaluates highest
   * precedence first. Registering additional adapters never
   * mutates or reorders previously registered adapters relative
   * to one another — it only inserts the new adapter in its
   * correct priority slot.
   */
  register(adapter: PlatformAdapter): void {
    this.adapters.push(adapter);
    this.adapters.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Evaluate all registered adapters against the current URL in
   * priority order (lowest priority number first) and activate
   * the first one whose `matchesUrl()` returns true. Returns null
   * — and clears the active platform — when no adapter matches.
   */
  detectPlatform(url: string): PlatformAdapter | null {
    const match = this.adapters.find((adapter) => adapter.matchesUrl(url));
    this.activePlatform = match ?? null;
    return this.activePlatform;
  }

  /**
   * Return the adapter activated by the most recent call to
   * `detectPlatform()`, or null if none has matched yet.
   */
  getActivePlatform(): PlatformAdapter | null {
    return this.activePlatform;
  }

  /**
   * List the names of all registered adapters, in priority order.
   */
  getRegisteredPlatforms(): string[] {
    return this.adapters.map((adapter) => adapter.name);
  }
}

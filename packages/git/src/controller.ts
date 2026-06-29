/**
 * Glue between Glot Manager's save flow and an explicit "Publish to git" action.
 *
 * Saves fire `config.onChange(changedKeys)`; this controller accumulates those
 * keys into a dirty set but **does not publish**. Your `POST /publish` endpoint
 * calls {@link GitPublishController.handlePublish}, which reads the full
 * snapshot from the store and publishes the dirty keys as one commit/PR, then
 * clears the set. Correctness comes from the engine recomputing the real diff
 * against the live ref — the dirty set only scopes the work and powers a
 * "publish needed" badge.
 */

import type { TranslationStore } from '@glot-manager/core';
import { createGitTranslationStore, type GitTranslationStoreOptions } from './engine.ts';
import type { ProgressEvent, PublishResult, PublishTarget, TranslationDiff } from './types.ts';

/** Structural shape of Glot's `config.onChange` — kept local to avoid a server dependency. */
export type ChangeListener = (changedKeys: string[]) => void;

export interface WireGitPublishOptions extends GitTranslationStoreOptions {
  /** Where the full working-copy snapshot is read from on publish. */
  store: TranslationStore;
  /** Default target. Defaults to a direct commit to the store's branch. */
  defaultTarget?: Partial<PublishTarget>;
  /** Default commit message, or a builder from the diff. */
  defaultMessage?: string | ((diff: TranslationDiff) => string);
}

export interface HandlePublishInput {
  target?: Partial<PublishTarget>;
  message?: string;
  dryRun?: boolean;
  /**
   * Reconcile the **full** store snapshot, removing repo keys absent from it.
   * Ignores the dirty set (prune is whole-repo by definition). Default `false`.
   */
  prune?: boolean;
  skipCi?: boolean;
  retries?: number;
  onProgress?: (event: ProgressEvent) => void;
  signal?: AbortSignal;
}

export interface GitPublishController {
  /** Pass as Glot's `config.onChange`. Records changed keys; never publishes. */
  readonly onChange: ChangeListener;
  /** Drain the dirty set and publish. Clears the set on a successful (non-dry-run) apply. */
  handlePublish(input?: HandlePublishInput): Promise<PublishResult>;
  /** The keys changed since the last successful publish. */
  getDirtyKeys(): string[];
  /** `true` when there is unpublished work. */
  hasPendingChanges(): boolean;
  /** Forget the dirty set without publishing. */
  clearDirty(): void;
}

function defaultCommitMessage(diff: TranslationDiff): string {
  const { added, modified, removed } = diff.summary;
  const parts = [
    added ? `${added} added` : '',
    modified ? `${modified} modified` : '',
    removed ? `${removed} removed` : '',
  ].filter(Boolean);
  return `chore(i18n): update translations${parts.length ? ` (${parts.join(', ')})` : ''}`;
}

export function wireGitPublish(options: WireGitPublishOptions): GitPublishController {
  const store = createGitTranslationStore(options);
  const dirty = new Set<string>();

  const onChange: ChangeListener = (changedKeys) => {
    for (const key of changedKeys) dirty.add(key);
  };

  return {
    onChange,
    getDirtyKeys: () => [...dirty],
    hasPendingChanges: () => dirty.size > 0,
    clearDirty: () => dirty.clear(),

    async handlePublish(input: HandlePublishInput = {}): Promise<PublishResult> {
      // Snapshot the dirty set before any await, so keys saved while this publish
      // is in flight are not mistaken for "already reconciled" and cleared.
      const scoped = [...dirty];
      const entries = await options.store.list();

      const branch =
        input.target?.branch ??
        options.defaultTarget?.branch ??
        options.branch ??
        (await options.backend.defaultBranch());
      const base = input.target?.base ?? options.defaultTarget?.base;
      const title = input.target?.title ?? options.defaultTarget?.title;
      const body = input.target?.body ?? options.defaultTarget?.body;
      const target: PublishTarget = {
        mode: input.target?.mode ?? options.defaultTarget?.mode ?? 'commit',
        branch,
        ...(base !== undefined ? { base } : {}),
        ...(title !== undefined ? { title } : {}),
        ...(body !== undefined ? { body } : {}),
      };

      // A message builder lets publish derive the message from the diff it
      // already computes — no extra round-trip.
      const message: string | ((diff: TranslationDiff) => string) =
        input.message ?? options.defaultMessage ?? defaultCommitMessage;

      // Always scope to the dirty set unless pruning (prune reconciles the whole
      // snapshot). An empty dirty set → empty scope → the engine writes nothing
      // and returns a clean no-op, rather than republishing every key.
      const result = await store.publish({
        entries,
        ...(input.prune ? {} : { changedKeys: scoped }),
        target,
        message,
        ...(input.prune !== undefined ? { prune: input.prune } : {}),
        ...(input.skipCi !== undefined ? { skipCi: input.skipCi } : {}),
        ...(input.retries !== undefined ? { retries: input.retries } : {}),
        ...(input.dryRun !== undefined ? { dryRun: input.dryRun } : {}),
        ...(input.onProgress ? { onProgress: input.onProgress } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
      });

      // Drop only the keys we actually reconciled (those present in the snapshot
      // we published), so keys dirtied during the in-flight publish survive.
      // Never clear on a dry run.
      if (!result.dryRun && (result.applied || result.diff.isClean)) {
        if (input.prune) dirty.clear();
        else for (const key of scoped) dirty.delete(key);
      }
      return result;
    },
  };
}

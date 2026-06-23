import type {
  AutoTranslateRequest,
  AutoTranslateResponse,
  ConfigResponse,
  EditableEntry,
  ErrorResponse,
  GetEntryResponse,
  ListEntriesResponse,
  SaveEntryRequest,
  SaveEntryResponse,
  TranslationUsage,
  UsageResponse,
} from '@glot-manager/core';

/** Error thrown when a Glot Manager API request fails. Carries the server error code. */
export class GlotApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'GlotApiError';
    this.status = status;
    this.code = code;
  }
}

export interface GlotClientOptions {
  /** Base path the server handler is mounted under. Default `/api/glot`. */
  endpoint?: string;
  /** Custom fetch (inject auth headers, etc.). Defaults to global `fetch`. */
  fetcher?: typeof fetch;
}

/** Typed client for the Glot Manager server endpoints. */
export class GlotClient {
  private readonly endpoint: string;
  private readonly fetcher: typeof fetch;

  constructor(options: GlotClientOptions = {}) {
    this.endpoint = (options.endpoint ?? '/api/glot').replace(/\/+$/, '');
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  }

  private keyPath(key: string): string {
    return `/entries/${encodeURIComponent(key)}`;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetcher(`${this.endpoint}${path}`, {
      credentials: 'same-origin',
      ...init,
      headers: {
        'content-type': 'application/json',
        ...init?.headers,
      },
    });

    const text = await response.text();
    const data = text ? (JSON.parse(text) as unknown) : null;

    if (!response.ok) {
      const error = (data as ErrorResponse | null)?.error;
      throw new GlotApiError(
        error?.message ?? `Request failed with ${response.status}`,
        response.status,
        error?.code ?? 'unknown',
      );
    }
    return data as T;
  }

  getConfig(): Promise<ConfigResponse> {
    return this.request<ConfigResponse>('/config');
  }

  async listEntries(): Promise<EditableEntry[]> {
    const { entries } = await this.request<ListEntriesResponse>('/entries');
    return entries;
  }

  async getEntry(key: string): Promise<EditableEntry> {
    const { entry } = await this.request<GetEntryResponse>(this.keyPath(key));
    return entry;
  }

  async saveEntry(key: string, body: SaveEntryRequest): Promise<EditableEntry> {
    const { entry } = await this.request<SaveEntryResponse>(this.keyPath(key), {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    return entry;
  }

  autoTranslate(key: string, body: AutoTranslateRequest): Promise<AutoTranslateResponse> {
    return this.request<AutoTranslateResponse>(`${this.keyPath(key)}/translate`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async getUsages(key: string): Promise<TranslationUsage[]> {
    const { usages } = await this.request<UsageResponse>(`${this.keyPath(key)}/usages`);
    return usages;
  }
}

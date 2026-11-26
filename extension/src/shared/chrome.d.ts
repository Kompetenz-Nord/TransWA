declare namespace chrome {
  namespace runtime {
    interface MessageSender {
      id?: string;
      url?: string;
      origin?: string;
      tab?: { id?: number; url?: string };
    }
    const id: string;
    const lastError: { message?: string } | undefined;
    function getManifest(): { version: string; name: string };
    function sendMessage<T = unknown>(
      message: unknown,
      callback?: (response: T) => void
    ): Promise<T>;
    function openOptionsPage(): Promise<void>;
    const onMessage: {
      addListener(
        callback: (
          message: unknown,
          sender: MessageSender,
          sendResponse: (response?: unknown) => void
        ) => boolean | void
      ): void;
    };
    const onInstalled: {
      addListener(callback: (details: { reason: string }) => void): void;
    };
  }

  namespace storage {
    interface StorageArea {
      get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
      clear(): Promise<void>;
    }
    const local: StorageArea;
  }
}

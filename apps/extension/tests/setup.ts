import 'fake-indexeddb/auto';
import { vi, beforeEach } from 'vitest';

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

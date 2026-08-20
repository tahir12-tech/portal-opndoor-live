/* Autosave, which had no test at all.

   WHY THAT MATTERED. This hook is the reason a tenant can fill in a long form
   on a phone over several sittings. Everything it does is a defence against a
   specific way of losing somebody's work, and none of those defences were
   checked: not the debounce, not the flush when a tab is hidden, not putting a
   failed patch back so a retry carries it.

   The flush on hide is the one that matters most on a phone, which is exactly
   where a long form gets abandoned mid-sentence, and it is the hardest to
   notice by hand: it only misbehaves when you switch away, which is when you
   are not looking. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAutosave } from './useAutosave';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

/** Advance past the debounce and let the promise microtasks settle.

    NOT waitFor: it polls on real timers, which fake timers stop, so every
    assertion about status would sit there for five seconds and fail. Advancing
    inside act and then flushing the microtask queue is deterministic anyway. */
async function settle(ms = 800) {
  await act(async () => { vi.advanceTimersByTime(ms); });
  await act(async () => { await Promise.resolve(); });
}

describe('the debounce', () => {
  it('does not save on every keystroke', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave(save));

    act(() => { result.current.set('first_name', 'S'); });
    act(() => { result.current.set('first_name', 'Sa'); });
    act(() => { result.current.set('first_name', 'Sam'); });
    expect(save).not.toHaveBeenCalled();

    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ first_name: 'Sam' });
  });

  it('waits for the typing to stop, not for a fixed window', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave(save));

    act(() => { result.current.set('a', 1); });
    await act(async () => { vi.advanceTimersByTime(600); });   // not yet
    expect(save).not.toHaveBeenCalled();

    act(() => { result.current.set('a', 2); });                 // resets the clock
    await act(async () => { vi.advanceTimersByTime(600); });
    expect(save).not.toHaveBeenCalled();

    await settle(200);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('sends only the keys that changed', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave(save));
    act(() => { result.current.set('a', 1); result.current.set('b', 2); });
    await settle();
    expect(save).toHaveBeenCalledWith({ a: 1, b: 2 });

    act(() => { result.current.set('b', 3); });
    await settle();
    // Not { a: 1, b: 3 }: a field they have not touched must not be resent,
    // because the server upserts a patch and would overwrite a later edit.
    expect(save).toHaveBeenLastCalledWith({ b: 3 });
  });

  it('reports dirty, then saving, then saved', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave(save));
    expect(result.current.status).toBe('idle');
    act(() => { result.current.set('a', 1); });
    expect(result.current.status).toBe('dirty');
    await settle();
    expect(result.current.status).toBe('saved');
  });
});

describe('leaving the page', () => {
  it('forces a pending save when the tab is hidden', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave(save));

    act(() => { result.current.set('employer', 'Foo Ltd'); });
    expect(save).not.toHaveBeenCalled();          // still inside the debounce

    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(save).toHaveBeenCalledWith({ employer: 'Foo Ltd' });
  });

  it('forces a pending save on pagehide, which is what a phone fires', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave(save));

    act(() => { result.current.set('employer', 'Foo Ltd'); });
    await act(async () => { window.dispatchEvent(new Event('pagehide')); });
    expect(save).toHaveBeenCalledWith({ employer: 'Foo Ltd' });
  });

  it('does not fire a save when there is nothing pending', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useAutosave(save));
    await act(async () => { window.dispatchEvent(new Event('pagehide')); });
    expect(save).not.toHaveBeenCalled();
  });

  it('saves on unmount, so navigating away does not drop the last edit', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() => useAutosave(save));
    act(() => { result.current.set('a', 1); });
    await act(async () => { unmount(); });
    expect(save).toHaveBeenCalledWith({ a: 1 });
  });
});

describe('when a save fails', () => {
  it('says so rather than looking saved', async () => {
    const save = vi.fn().mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useAutosave(save));
    act(() => { result.current.set('a', 1); });
    await settle();
    expect(result.current.status).toBe('error');
  });

  it('puts the patch back, so the next edit carries it', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave(save));

    act(() => { result.current.set('a', 1); });
    await settle();
    expect(result.current.status).toBe('error');

    act(() => { result.current.set('b', 2); });
    await settle();
    // Both, not just b. A failed save must never quietly discard what was typed.
    expect(save).toHaveBeenLastCalledWith({ a: 1, b: 2 });
  });
});

describe('flush', () => {
  it('saves immediately instead of waiting out the debounce', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave(save));
    act(() => { result.current.set('a', 1); });
    await act(async () => { await result.current.flush(); });
    expect(save).toHaveBeenCalledWith({ a: 1 });
  });

  it('is a no-op with nothing pending, so a submit does not send an empty patch', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave(save));
    await act(async () => { await result.current.flush(); });
    expect(save).not.toHaveBeenCalled();
  });

  it('keeps an edit made DURING a save, rather than losing it to the clear', async () => {
    let release: () => void = () => {};
    const save = vi.fn().mockImplementation(() => new Promise<void>((r) => { release = r; }));
    const { result } = renderHook(() => useAutosave(save));

    act(() => { result.current.set('a', 1); });
    await settle();
    expect(save).toHaveBeenCalledWith({ a: 1 });

    act(() => { result.current.set('b', 2); });   // arrives mid-request
    await act(async () => { release(); await Promise.resolve(); });
    expect(result.current.status).toBe('dirty');

    await settle();
    expect(save).toHaveBeenLastCalledWith({ b: 2 });
  });
});

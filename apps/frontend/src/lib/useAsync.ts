import { useCallback, useEffect, useRef, useState } from 'react';

type State<T> =
  { status: 'loading' } | { status: 'success'; data: T } | { status: 'error'; error: unknown };

/** Small data-fetching hook with loading / error / success states + retry. */
export function useAsync<T>(
  fn: () => Promise<T>,
  deps: unknown[],
): State<T> & { reload: () => void } {
  const [state, setState] = useState<State<T>>({ status: 'loading' });
  const [nonce, setNonce] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    setState({ status: 'loading' });
    fn()
      .then((data) => mounted.current && setState({ status: 'success', data }))
      .catch((error) => mounted.current && setState({ status: 'error', error }));
    // `fn` is intentionally excluded — callers pass a fresh closure each render
    // and drive re-fetching through `deps`.
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}

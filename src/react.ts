import {
  useCallback,
  useDebugValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react'
import {
  affectedToPathList,
  createProxy as createProxyToCompare,
  isChanged,
} from 'proxy-compare'
import { snapshot, subscribe } from './vanilla.ts'
import type { Snapshot } from './vanilla.ts'

/**
 * React hook to display affected paths in React DevTools for debugging
 *
 * This internal hook collects the paths that were accessed during render
 * and displays them in React DevTools to help with debugging render optimizations.
 *
 * @param {object} state - The state object being tracked
 * @param {WeakMap<object, unknown>} affected - WeakMap of accessed properties
 * @private
 */
const useAffectedDebugValue = (
  state: object,
  affected: WeakMap<object, unknown>,
) => {
  const pathList = useRef<(string | number | symbol)[][]>(undefined)
  useEffect(() => {
    pathList.current = affectedToPathList(state, affected, true)
  })
  useDebugValue(pathList.current)
}
const condUseAffectedDebugValue = useAffectedDebugValue

// This is required only for performance.
// Ref: https://github.com/pmndrs/valtio/issues/519
const targetCache = new WeakMap()

type Options = {
  sync?: boolean
}

/**
 * useSnapshot
 *
 * Create a local snapshot that catches changes. This hook actually returns a wrapped snapshot in a proxy for
 * render optimization instead of a plain object compared to `snapshot()` method.
 * Rule of thumb: read from snapshots, mutate the source.
 * The component will only re-render when the parts of the state you access have changed, it is render-optimized.
 *
 * @example A
 * function Counter() {
 *   const snap = useSnapshot(state)
 *   return (
 *     <div>
 *       {snap.count}
 *       <button onClick={() => ++state.count}>+1</button>
 *     </div>
 *   )
 * }
 *
 * [Notes]
 * Every object inside your proxy also becomes a proxy (if you don't use "ref"), so you can also use them to create
 * the local snapshot as seen on example B.
 *
 * @example B
 * function ProfileName() {
 *   const snap = useSnapshot(state.profile)
 *   return (
 *     <div>
 *       {snap.name}
 *     </div>
 *   )
 * }
 *
 * Beware that you still can replace the child proxy with something else so it will break your snapshot. You can see
 * above what happens with the original proxy when you replace the child proxy.
 *
 * > console.log(state)
 * { profile: { name: "valtio" } }
 * > childState = state.profile
 * > console.log(childState)
 * { name: "valtio" }
 * > state.profile.name = "react"
 * > console.log(childState)
 * { name: "react" }
 * > state.profile = { name: "new name" }
 * > console.log(childState)
 * { name: "react" }
 * > console.log(state)
 * { profile: { name: "new name" } }
 *
 * `useSnapshot()` depends on the original reference of the child proxy so if you replace it with a new one, the
 * component that is subscribed to the old proxy won't receive new updates because it is still subscribed to
 * the old one.
 *
 * In this case we recommend the example C or D. On both examples you don't need to worry with re-render,
 * because it is render-optimized.
 *
 * @example C
 * const snap = useSnapshot(state)
 * return (
 *   <div>
 *     {snap.profile.name}
 *   </div>
 * )
 *
 * @example D
 * const { profile } = useSnapshot(state)
 * return (
 *   <div>
 *     {profile.name}
 *   </div>
 * )
 */
export function useSnapshot<T extends object>(
  proxyObject: T,
  options?: Options,
): Snapshot<T> {
  const notifyInSync = options?.sync
  // per-proxy & per-hook affected, it's not ideal but memo compatible
  const affected = useMemo(
    () => proxyObject && new WeakMap<object, unknown>(),
    [proxyObject],
  )
  const lastSnapshot = useRef<Snapshot<T>>(undefined)
  let inRender = true
  const currSnapshot = useSyncExternalStore(
    useCallback(
      (callback) => {
        const unsub = subscribe(proxyObject, callback, notifyInSync)
        callback() // Note: do we really need this?
        return unsub
      },
      [proxyObject, notifyInSync],
    ),
    () => {
      const nextSnapshot = snapshot(proxyObject)
      try {
        if (
          !inRender &&
          lastSnapshot.current &&
          !isChanged(
            lastSnapshot.current,
            nextSnapshot,
            affected,
            new WeakMap(),
          )
        ) {
          // not changed
          return lastSnapshot.current
        }
      } catch {
        // ignore if a promise or something is thrown
      }
      return nextSnapshot
    },
    () => snapshot(proxyObject),
  )
  inRender = false
  useLayoutEffect(() => {
    lastSnapshot.current = currSnapshot
  })
  if (process?.env?.NODE_ENV !== 'production') {
    condUseAffectedDebugValue(currSnapshot as object, affected)
  }
  const proxyCache = useMemo(() => new WeakMap(), []) // per-hook proxyCache
  return createProxyToCompare(currSnapshot, affected, proxyCache, targetCache)
}

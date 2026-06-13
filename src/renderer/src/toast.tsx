import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

export interface ToastApi {
  show: (msg: string, isError?: boolean) => void
  node: ReactNode
}

export const ToastContext = createContext<ToastApi>({ show: () => {}, node: null })

export function useToast(): ToastApi {
  return useContext(ToastContext)
}

export function useToastState(): ToastApi {
  const [toast, setToast] = useState<{ msg: string; error: boolean } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = useCallback((msg: string, isError = false) => {
    setToast({ msg, error: isError })
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(null), isError ? 6000 : 3000)
  }, [])

  const node = toast ? (
    <div className={`toast${toast.error ? ' error' : ''}`}>{toast.msg}</div>
  ) : null

  return { show, node }
}

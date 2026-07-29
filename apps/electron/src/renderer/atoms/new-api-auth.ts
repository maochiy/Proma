import { atom } from 'jotai'
import type { NewApiAuthState } from '../../types'

/** New API 全局登录状态 */
export const newApiAuthAtom = atom<NewApiAuthState>({
  authenticated: false,
})

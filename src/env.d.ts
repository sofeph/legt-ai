import type { LegtApi } from '../electron/api'

declare global {
  interface Window {
    legt: LegtApi
  }
}

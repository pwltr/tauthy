import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { toast } from 'react-hot-toast'
import { v4 as uuidv4 } from 'uuid'
import i18n from './i18n'

export const capitalize = (word: string) => {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

export const generateUUID = () => {
  return crypto?.randomUUID ? crypto.randomUUID() : uuidv4()
}

const base64ToBrowser = (buffer: ArrayBuffer | Uint8Array) => {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)

  return window.btoa(
    [].slice
      .call(bytes)
      .map((bin) => String.fromCharCode(bin))
      .join(''),
  )
}

const dataUrlToBase64 = (url: string) => {
  const separatorIndex = url.indexOf(',')
  if (separatorIndex === -1) throw new Error('Invalid data URL')

  const metadata = url.slice(5, separatorIndex)
  const data = url.slice(separatorIndex + 1)

  if (metadata.split(';').includes('base64')) return data

  return base64ToBrowser(new TextEncoder().encode(decodeURIComponent(data)))
}

export const imageToBase64 = async (url: string) => {
  // Vite inlines small SVG assets as data URLs. Fetching those URLs is treated
  // as a connection by WebView2 and blocked by the app's connect-src policy.
  if (url.startsWith('data:')) return dataUrlToBase64(url)

  const response = await fetch(url)
  return base64ToBrowser(await response.arrayBuffer())
}

export const downloadFile = (file: Blob, name: string) => {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(file)
  a.download = name
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

export const reorderList = <T>(list: T[], startIndex: number, endIndex: number): T[] => {
  const [removed] = list.splice(startIndex, 1)
  list.splice(endIndex, 0, removed)

  return list
}

export const copyToClipboard = async (text: string) => {
  await writeText(String(text))
  toast.success(i18n.t('toasts.copied'), {
    id: 'clipboard',
    duration: 1200,
  })
}

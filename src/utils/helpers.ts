import { clipboard } from '@tauri-apps/api'
import { toast } from 'react-hot-toast'
import { v4 as uuidv4 } from 'uuid'
import i18n from './i18n'

export const capitalize = (word: string) => {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

export const generateUUID = () => {
  return crypto?.randomUUID ? crypto.randomUUID() : uuidv4()
}

const base64ToBrowser = (buffer: ArrayBuffer) => {
  return window.btoa(
    [].slice
      .call(new Uint8Array(buffer))
      .map((bin) => String.fromCharCode(bin))
      .join(''),
  )
}

export const imageToBase64 = (url: string) => {
  return fetch(url)
    .then((response) => response.arrayBuffer())
    .then(base64ToBrowser)
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

export const copyToClipboard = (text: string) => {
  clipboard.writeText(String(text))
  toast.success(i18n.t('toasts.copied'), {
    id: 'clipboard',
    duration: 1200,
  })
}

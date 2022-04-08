import { v4 as uuidv4 } from 'uuid'

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

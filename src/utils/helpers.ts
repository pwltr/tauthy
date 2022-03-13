import { v4 as uuidv4 } from 'uuid'

export const capitalize = (word: string) => {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

export const generateUUID = () => {
  return crypto?.randomUUID ? crypto.randomUUID() : uuidv4()
}

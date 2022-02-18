export * from "./codes";
export * from "./storage";

export const capitalize = (word: string) => {
  return word.charAt(0).toUpperCase() + word.slice(1);
};

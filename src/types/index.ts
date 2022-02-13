export type VaultEntry = {
  uuid: string;
  name: string;
  secret: string;
  group?: string;
  icon?: string;
};

// Aegis
// export type VaultEntry = {
//   // type: "totp";
//   uuid: string;
//   name: string;
//   group: string;
//   // issuer: string;
//   // note: string;
//   icon: string;
//   // icon_mime: "image/svg+xml";
//   secret: string;
//   // info: {
//   //   algo: "SHA1";
//   //   digits: number;
//   //   period: number;
//   // };
// };

declare global {
  interface Crypto {
    randomUUID: () => string;
  }
}

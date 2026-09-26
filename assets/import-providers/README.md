# Import provider logos

Bundled assets used only to identify import sources. Logos and names remain
the trademarks of their respective owners; their inclusion implies no affiliation.
The chooser must not fetch logos over the network.

| Asset | Source | Upstream license / changes |
| --- | --- | --- |
| `andotp.svg` | [andOTP Android vector logo](https://github.com/andOTP/andOTP/blob/master/app/src/main/res/drawable/ic_launcher_foreground.xml), blob `52bfb4f168129b22740b3151d7383afd9556d1e0` | MIT; original path converted to SVG, launcher padding removed, official green background added. License in LICENSE-ANDOTP.txt. |
| `2fas.svg` | [2FAS Android logo_auth.xml](https://github.com/twofas/2fas-android/blob/main/core/designsystem/src/main/res/drawable/logo_auth.xml), blob `cc1dba0e6d204e1bb55c92fbd5776ff28321cb2b` | GPL-3.0; Android vector paths converted to SVG, centered in a square viewport. |
| `aegis.svg` | [Aegis 512px store icon](https://github.com/beemdevelopment/Aegis/blob/master/metadata/en-US/images/icon.png), blob `2f970100030a3b6176a5e342940f5c6e0adb1b02` | GPL-3.0; original high-resolution PNG embedded unchanged in SVG. Unlike the launcher asset, it has no outer launcher padding or shadow. |
| `ente.svg` | [Ente Auth Android default icon](https://github.com/ente/ente/blob/main/mobile/apps/auth/android/app/src/main/res/mipmap-xhdpi/icon_default.png), blob `8129b8f0f3f957f84f786d79c7a4b731db996ccb` | AGPL-3.0; original PNG embedded unchanged in an SVG wrapper. License text in LICENSE-ENTE.txt. |
| `authy.svg` | [Simple Icons v14 Authy logo](https://github.com/simple-icons/simple-icons/blob/14.0.0/icons/authy.svg) | [CC0-1.0](https://github.com/simple-icons/simple-icons/blob/14.0.0/LICENSE.md); original path colored red, decorative title removed. |
| `bitwarden.svg` | [Bitwarden Authenticator App Store listing](https://apps.apple.com/us/app/bitwarden-authenticator/id6497335175), version 2026.9.0, artwork retrieved 2026-09-26 | Official published 512px icon embedded unchanged as JPEG in SVG. Trademark identification only; the older repository PNG and flattened Icon Composer layers do not match the current rendered store artwork. |
| `proton.svg` | [Proton Authenticator vector logo](https://github.com/ProtonMail/WebClients/blob/main/packages/components/containers/account/authenticatorPromotion/assets/authenticator-logo.svg), blob `d92885b6eb107ba90c6a7d8b2bb779c8b64e4666` | GPL-3.0; original vector paths/gradients, with a square viewport adding consistent internal padding. |
| `tauthy.svg` | Project's canonical `assets/app-icons/icon-square.png` | GPL-3.0; bull silhouette traced into vector paths, launcher padding omitted and flat rounded-square background retained. Used only in the import chooser. |

The GPL-3.0 license text is provided in the repository's root LICENSE file.
The Tauthy option uses the derived vector above without CSS scaling. The generic authenticator
links option uses MUI's link icon instead of implying a particular provider.

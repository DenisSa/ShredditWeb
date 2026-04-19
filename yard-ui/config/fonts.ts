import { IBM_Plex_Mono as FontMono, Space_Grotesk as FontSans } from "next/font/google"

export const fontSans = FontSans({
  subsets: ["latin"],
  variable: "--font-sans",
})

export const fontMono = FontMono({
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  variable: "--font-mono",
})

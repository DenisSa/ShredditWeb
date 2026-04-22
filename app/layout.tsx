import "@/styles/globals.css";
import { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Providers } from "./providers";
import { fontMono, fontSans } from "@/config/fonts";
import { normalizeThemePreference, THEME_COOKIE_NAME } from "@/lib/server/shreddit-theme";

export const metadata: Metadata = {
	title: {
			default: "ShredditWeb",
			template: `%s | ShredditWeb`,
		},
	description: "A server-backed tool for previewing and shredding old Reddit comments and posts.",
	icons: {
		icon: "/favicon.ico",
	},
};

export const viewport: Viewport = {
	themeColor: [
		{ media: "(prefers-color-scheme: light)", color: "#eef2f5" },
		{ media: "(prefers-color-scheme: dark)", color: "#102033" },
	],
};

export default async function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const cookieStore = await cookies();
	const defaultTheme = normalizeThemePreference(cookieStore.get(THEME_COOKIE_NAME)?.value);

	return (
		<html lang="en" suppressHydrationWarning>
			<head />
			<body className={`${fontSans.variable} ${fontMono.variable} min-h-screen font-sans antialiased`}>
				<Providers
					themeProps={{
						attribute: "class",
						defaultTheme,
						enableSystem: false,
						themes: ["dark", "light"],
						storageKey: "shreddit.theme",
					}}
				>
					<div className="relative min-h-screen">
						<main className="mx-auto min-h-screen max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
							{children}
						</main>
					</div>
				</Providers>
			</body>
		</html>
	);
}

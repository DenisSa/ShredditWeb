import "@/styles/globals.css";
import { Metadata, Viewport } from "next";
import { Providers } from "./providers";
import { fontMono, fontSans } from "@/config/fonts";

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

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head />
			<body className={`${fontSans.variable} ${fontMono.variable} min-h-screen font-sans antialiased`}>
				<Providers themeProps={{ attribute: "class", defaultTheme: "light" }}>
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

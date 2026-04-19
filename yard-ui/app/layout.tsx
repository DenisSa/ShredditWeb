import "@/styles/globals.css";
import { Metadata, Viewport } from "next";
import { Providers } from "./providers";

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
		{ media: "(prefers-color-scheme: light)", color: "#f3ede0" },
		{ media: "(prefers-color-scheme: dark)", color: "#1f1713" },
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
			<body className="min-h-screen font-sans antialiased">
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

import "./globals.css";

export const metadata = {
  title: "Heylo Admin",
  description: "Private family video library administration",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}


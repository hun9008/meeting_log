import "./globals.css";

export const metadata = {
  title: "MEETING LOG",
  description: "회의록을 Google Sheets와 Jira 백로그로 등록합니다.",
  icons: {
    icon: "/meeting-icon.svg",
    apple: "/meeting-icon.svg"
  }
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}

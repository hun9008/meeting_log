# 회의록 등록 앱

Next.js로 만든 로컬 회의록 등록 앱입니다. 입력한 `다음 미팅까지의 계획`은 Jira 백로그로 항상 생성하고, Google Sheets 업데이트는 화면의 토글로 선택합니다.

## 실행

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:3000`을 엽니다.

Node 25에서는 Next 15 일부 버전에서 `localStorage.getItem is not a function` 오류가 날 수 있습니다. 이 프로젝트는 Node 22 LTS를 권장합니다.

```bash
nvm use
```

## 입력 규칙

- 필수: 날짜, 등록자, 다음 미팅까지의 계획
- 선택: 미팅 주제, 회의록
- Jira 변환: `# 제목` 아래의 `1. 항목`을 `[제목] 항목` 형태의 Jira Task로 생성
- Google Sheets: 토글이 켜져 있을 때만 `.env`에 지정한 스프레드시트의 첫 빈 행에 입력
- Sheets 인증이 필요한 상태에서 등록하면 Jira 생성은 먼저 시도되고, 이후 Google 인증 페이지로 이동합니다.

## Google Sheets

처음 Sheets 업데이트를 켠 상태로 등록하면 Google 인증 페이지로 이동합니다. 인증 토큰은 `.google_token.json`에 저장됩니다.

`.env`에 지정된 Google Sheets의 지정 탭 첫 빈 행에 아래 열을 입력합니다.

`날짜, 등록자, 미팅 주제, 회의록, Jira 변환 항목`

`.env`에 아래 값을 반드시 추가해야 합니다.

```bash
CLIENT_SECRET_FILE=client_secret_파일명.json
PASSWORD=접속_비밀번호
SECURITY_ALERT_EMAIL=younghune135@gmail.com
AUTH_MAX_FAILURES=5
AUTH_LOCK_MINUTES=60
GOOGLE_SPREADSHEET_ID=스프레드시트_ID
GOOGLE_SHEET_TAB=시트_탭_이름
NEXT_PUBLIC_APP_URL=http://localhost:3000
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
```

Google Sheets 대상을 바꾸려면 `.env`에서 `GOOGLE_SPREADSHEET_ID`와 `GOOGLE_SHEET_TAB`을 바꾸면 됩니다. 앱은 더 이상 Google Drive에서 이름으로 시트를 검색하지 않습니다.

Google Cloud Console의 OAuth 클라이언트 설정에는 아래 값을 등록해야 합니다.

- 승인된 JavaScript 원본: `http://localhost:3000`
- 승인된 리디렉션 URI: `http://localhost:3000/api/auth/google/callback`

현재 앱이 실제로 Google에 보내는 OAuth 값을 확인하려면 dev 서버 실행 중 아래 주소를 엽니다.

`http://localhost:3000/api/debug/google-oauth`

Jira 설정 상태는 아래 주소에서 확인할 수 있습니다.

`http://localhost:3000/api/debug/jira`

## Jira

현재 `.env`의 `JIRA_API`는 Atlassian API 토큰으로 처리됩니다. Jira 이슈 생성을 위해 아래 값이 필요합니다.

```bash
JIRA_BASE_URL=https://your-domain.atlassian.net
JIRA_EMAIL=your-email@example.com
JIRA_PROJECT_KEY=DI
JIRA_API=Atlassian_API_token
JIRA_BOARD_ID=1
JIRA_SPACE=DI Lab
JIRA_ASSIGN_ACTIVE_SPRINT=true
```

# AttendX - Smart QR Attendance System

AttendX is a complete front-end prototype for a college mini project. It is built with HTML, CSS and JavaScript, and it runs immediately in demo mode using browser `localStorage`.

## Page structure

- `index.html` - login selection and login forms only.
- `teacher.html` - teacher dashboard, student roster, QR sessions and reports.
- `student.html` - mobile-friendly student profile, attendance summary, QR scanning and personal history.
- `style.css` - shared responsive design system.
- `app.js` - shared JavaScript with page-specific initialization.
- `firebase-config.js` - placeholder configuration; Firebase integration is the next implementation phase.

Successful demo login redirects to the separate portal page. The current demo role is stored in `localStorage` and is not secure authentication.

## Included features

- Separate Teacher Login and Student Login flows
- Teacher dashboard with attendance statistics
- Student CRUD: add, edit, delete and search students
- Student directory filters by course and semester, with selectable initials-based profiles and attendance performance
- Subject CRUD: add, edit, delete, and select subjects when creating QR sessions
- QR session generator with configurable expiry countdown
- Downloadable QR code image
- Mobile-friendly student portal with QR scanner and manual session ID fallback
- Student portal icon navigation with separate scan, profile, live-session and attendance-record sections
- HTTPS local phone-test server for mobile camera access
- Student profile creation/update without photo upload
- Duplicate check-in prevention
- Automatic absent marking when a live session ends or expires
- Attendance records table with status filter and CSV export
- Logout from teacher and student portals
- Demo data reset control
- Firebase setup guidance and database model suggestion

## Demo login

This is a local-only demo login, not secure authentication.

- Teacher: `teacher@attendx.demo` / `teacher123`
- Student: use an existing roster roll number such as `BCA2401`, or enter a new roll number to create a local demo profile.

Student login by roll number is only for classroom demonstration. Do not use it for real attendance or private student data.

## Run the demo

Because `app.js` is an ES module, serve this folder with a local web server instead of opening `index.html` as a `file://` URL.

Quick options:

1. VS Code: install/use Live Server, then right-click `index.html` and choose Open with Live Server.
2. If Python is installed, run `python -m http.server 8000` inside this folder and open `http://localhost:8000`.
3. If Node.js is installed, run `node dev-server.js` and open `http://127.0.0.1:8000/`.

Internet access is needed for Google Fonts, Lucide icons, QR generation and the camera QR scanner library.

## Test on a phone

1. Connect the phone and computer to the same Wi-Fi network.
2. In PowerShell, run ` $env:HOST='0.0.0.0'; $env:PORT='8000'; node .\dev-server.js ` from this folder.
3. Find the computer's Wi-Fi IPv4 address with `ipconfig` (look under the connected Wi-Fi adapter).
4. On the phone, open `http://<computer-ip>:8000/` in its browser, replacing `<computer-ip>` with that address.
5. If Windows Firewall asks, allow Node.js on **Private networks only**. Do not expose this demo server to public networks or configure router port forwarding.

For phone camera scanning, use the HTTPS development server instead: run `powershell -ExecutionPolicy Bypass -File .\start-phone-demo.ps1` from this folder. It prints HTTP and HTTPS addresses and creates a local development certificate under your Windows user profile (not in the project folder). On Android, open the printed HTTP certificate link, download `attendx-dev-root.cer`, then go to **Settings → Security & privacy → More security settings → Install a certificate → CA certificate** (wording varies by phone) and install it. On iPhone, download the certificate in Safari, install the profile under **Settings → Profile Downloaded**, then enable it under **Settings → General → About → Certificate Trust Settings → Enable Full Trust**. Next, open the printed HTTPS address in the phone browser, allow camera permission for AttendX, and tap Start. Re-run the script if your Wi-Fi IP changes. Stop the server with Ctrl+C.

This development CA is only for a trusted local test network. Do not share its private key, use it for production, expose this demo server to public networks, or configure router port forwarding. If the phone still blocks the camera, confirm the browser says the HTTPS connection is secure and reset AttendX camera permission in the browser's site settings.

The demo saves data in each browser's own local storage. A phone will not share attendance or profile changes with the computer's browser unless Firebase or another shared backend is implemented.

## Demo flow

1. Open `index.html` through the local web server.
2. Choose Teacher Login or Student Login.
3. Teacher demo: sign in with the credentials above to open `teacher.html`; manage students and subjects, then select a subject when creating QR sessions.
4. Student demo: use a roll number to open `student.html`; complete profile details, then scan/paste a live session ID.
5. Attendance data remains local to this browser. It does not sync live between separate devices until Firebase is integrated.

## Important honesty and security notes

- This package is a demo prototype, not a production-secure attendance service.
- In demo mode, QR codes carry only the session ID. Session expiry is checked by the demo app, and attendance is stored only in the current browser.
- Do not use client-side-only validation to verify real attendance.
- A real deployment should use Firebase Authentication, role-based Firestore security rules, trusted validation of session expiry, and duplicate check-in prevention.
- The Firebase toggle is intentionally left off. `firebase-config.js` is a placeholder. Firebase Authentication and Firestore are not implemented in this build. Do not enable `USE_FIREBASE`; it intentionally throws an error until the Firebase SDK integration and restrictive rules have been implemented and tested.

## Firebase database model suggestion

- `users/{uid}`: `name`, `rollNumber`, `course`, `semester`, `role`
- `sessions/{sessionId}`: `subject`, `className`, `createdBy`, `createdAt`, `expiresAt`, `status`
- `sessions/{sessionId}/attendance/{uid}`: `studentUid`, `rollNumber`, `markedAt`, `status`

Recommended security: authenticated access only; only teachers can create/end sessions; students can create only their own attendance document; attendance documents must not be overwritten; validate that the session is live and unexpired using trusted logic or carefully designed rules. For production, consider a callable Cloud Function for check-in.

## Basic test cases

| Test case | Expected result |
| --- | --- |
| Teacher logs in with demo credentials | Teacher portal opens |
| Student logs in with a new roll number | Local student profile is created |
| Student updates and saves profile | Student details and initials update in the portal |
| Generate a QR session | QR code, session ID and countdown appear |
| Student marks present | Record is added and check-in count increases |
| Same student marks twice | Duplicate check-in is blocked |
| End a session | Unmarked students become Absent |
| Logout from either portal | User returns to login page |
| Export CSV | Attendance report downloads |

## Firebase attendance integration (Phase 3)

This build writes teacher-created QR sessions to Cloud Firestore `sessions/{sessionId}` and listens for session updates on both portals. Student check-ins are written to `sessions/{sessionId}/attendance/{studentAuthUid}` and teacher pages listen to each session's attendance subcollection for live updates.

Before testing, ensure:
- Firebase Authentication Email/Password is enabled.
- Each teacher profile is `users/{authUid}` with `role: "teacher"` and `active: true`.
- Each student profile is `users/{authUid}` with `role: "student"`, `active: true`, and a `rollNumber` (or `roll`) field.
- The Firestore Rules published in the project match `firestore.rules` in this folder.
- Serve the site using Live Server or HTTPS, not by opening `index.html` as a `file://` URL.

This phase syncs live sessions and present check-ins. Cloud absence finalization, teacher-side removal of a submitted check-in, student roster/subject management sync, and production QR anti-sharing protections are not yet implemented. Test with a separate teacher browser and student browser before relying on records.

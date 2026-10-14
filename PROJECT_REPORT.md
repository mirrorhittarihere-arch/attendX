# AttendX - Smart QR Attendance System

## Abstract

AttendX is a smart QR-based attendance management prototype for classrooms. The system helps a teacher create a time-limited QR session and lets students mark attendance through a scanner or manual session ID. The prototype stores demo data in the browser and provides separate teacher and student portals, student management, QR session check-in, attendance reports and CSV export.

## Problem Statement

Manual attendance is slow, error-prone and difficult to audit. Teachers often spend class time calling roll numbers, and maintaining paper-based records makes reporting and searching difficult. AttendX reduces this effort by digitizing roster management and attendance capture.

## Objectives

- Provide a clean dashboard for attendance overview.
- Maintain student records with add, edit, delete and search options.
- Generate time-limited QR sessions for classroom attendance.
- Allow student check-in through QR scanning or manual session ID.
- Prevent duplicate attendance for the same student in the same session.
- Automatically mark remaining students absent when a session closes.
- Export attendance records as a CSV report.

## Scope

The current project is a front-end demo built for academic demonstration. It uses local browser storage and sample data. The design can be extended to Firebase Authentication and Firestore for real multi-user deployment. Login in this build is for demo purposes only; teacher credentials are hard-coded and student access is based on roll number.

## Tools And Technologies

- HTML5 for page structure
- CSS3 for responsive interface design
- JavaScript ES modules for application logic
- QRCode.js for QR generation
- html5-qrcode for QR camera scanning
- Browser localStorage for demo persistence
- Firebase as the suggested future backend

## Modules

### 1. Dashboard

Displays total students, present count, absent count, sessions held, recent attendance and a weekly/monthly chart.

### 2. Student Management

Allows the admin to add, edit, delete and search students. Roll number duplication is blocked.

### 3. QR Session Management

Allows the teacher to create a session by entering subject, class and expiry duration. The app generates a QR code containing session details and starts a countdown.

### 4. Student Check-in

Students can scan the QR code with the camera scanner or enter the session ID manually. The app validates that the session is live and prevents duplicate check-ins.

### 5. Attendance Records

Stores Present and Absent records, supports search/filtering, and exports the report as CSV.

### 6. Settings

Explains Firebase setup steps and security requirements for a production version.

## Data Model

### Student

```text
id, name, roll, course, semester, email
```

### Session

```text
id, subject, className, createdAt, expiresAt, endedAt, status, checkins, absencesFinalized
```

### Attendance Record

```text
id, studentId, sessionId, subject, status, timestamp
```

## Test Cases

| ID | Scenario | Expected Result |
| --- | --- | --- |
| TC01 | Add student with unique roll number | Student is added to roster |
| TC02 | Add student with duplicate roll number | Warning message is shown |
| TC03 | Generate QR session | QR code and countdown are displayed |
| TC04 | Mark present using session ID | Present record is added |
| TC05 | Mark same student twice | Duplicate check-in is blocked |
| TC06 | End live session | Remaining students are marked Absent |
| TC07 | Search records by subject | Matching records are displayed |
| TC08 | Export CSV | CSV report is downloaded |
| TC09 | Reset demo data | Original sample data is restored |

## Limitations

- Demo data is stored only in the browser.
- The prototype does not include real authentication.
- QR expiry is validated on the client in demo mode.
- Camera scanning depends on browser permissions and localhost/HTTPS.

## Future Scope

- Firebase Authentication for teacher and student login.
- Firestore database for real-time cloud sync.
- Role-based security rules.
- Server-side attendance validation with Cloud Functions.
- Admin reports with date, subject and class filters.
- Student profile portal and attendance percentage view.

## Conclusion

AttendX demonstrates how QR codes can make classroom attendance faster, cleaner and easier to audit. The prototype demonstrates the local front-end workflow. Firebase cloud persistence and production-grade authentication remain future work.

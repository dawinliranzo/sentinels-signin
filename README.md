# Sentinels Sign-In App

A professional, full-featured visitor and employee sign-in management system built by **SentinelsIT**.

## Product Name: **Sentinels Sign-In**

## Brand Colors
- **Primary**: `#0D7377` (Deep Teal) — Trust, professionalism, modern
- **Accent**: `#FF6B35` (Warm Orange) — Action, energy, CTAs
- **Secondary**: `#14FFEC` (Bright Cyan) — Highlights, success states
- **Dark**: `#0F172A` (Slate 900) — Text, headers, sidebar
- **Light**: `#F1F5F9` (Slate 100) — Backgrounds

## Features (Matches/Exceeds SignInApp)

| Feature | Status | Description |
|---------|--------|-------------|
| **Kiosk Sign-In** | ✅ Ready | Tablet-based self-service check-in with branded welcome screen |
| **Kiosk Sign-Out** | ✅ Ready | Badge number or name-based check-out |
| **Contactless QR Sign-In** | ✅ Ready | Pre-registered visitors scan QR code on their phone |
| **Host Notifications** | ✅ Ready | Email + SMS alerts when visitors arrive |
| **Pre-Registration** | ✅ Ready | Invite visitors ahead with QR codes and custom fields |
| **Custom Visitor Types** | ✅ Ready | Guest, Contractor, Delivery, Interview, etc. |
| **Admin Dashboard** | ✅ Ready | Real-time stats, recent visits, quick actions |
| **Visit Management** | ✅ Ready | Full visit log with search, filter, export to CSV |
| **Host Management** | ✅ Ready | Add/edit hosts with notification preferences |
| **Badge Numbers** | ✅ Ready | Auto-generated unique badge numbers |
| **Multi-tenant** | ✅ Ready | Each organization has isolated data |
| **Deliveries** | 🔄 Stub | Package management with signature capture |
| **Evacuation/Roll Call** | 🔄 Stub | Emergency evacuation with real-time roll call |
| **Events** | 🔄 Stub | Event attendance tracking with QR check-in |
| **Document Signing** | 🔄 Stub | NDA, waiver, and policy digital signing |
| **SSO Integration** | 🔄 Stub | Azure AD / Google Workspace sync |
| **Badge Printing** | 🔄 Future | Thermal printer integration (Brother QL, Zebra) |
| **Photo Capture** | 🔄 Future | Camera integration for visitor photos |
| **Mobile Companion App** | 🔄 Future | iOS/Android app for employees |
| **Access Control** | 🔄 Future | Door access integration (Kisi, Salto, etc.) |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript-ready + Zustand |
| Backend | Node.js + Express |
| Database | PostgreSQL |
| Auth | JWT |
| Notifications | SendGrid (email) + Twilio (SMS) |
| QR Codes | qrcode.react |
| Charts | Recharts (ready for analytics) |

## Quick Start

### 1. Database Setup
```bash
# Create PostgreSQL database
createdb sentinels_signin

# Run migrations
psql sentinels_signin < backend/migrations/001_initial_schema.sql
```

### 2. Backend Setup
```bash
cd backend
cp .env.example .env
# Edit .env with your credentials
npm install
npm run dev
```

### 3. Frontend Setup
```bash
cd frontend
npm install
npm start
```

### 4. Deploy
- **Frontend**: Vercel (vercel.com)
- **Backend**: Railway (railway.app) or Render (render.com)
- **Database**: Railway PostgreSQL or Supabase

## Kiosk Mode Setup

1. Open `/kiosk` in your tablet browser
2. For iPad: Settings → Accessibility → Guided Access → enable
3. For Android: Use a kiosk app or pin the browser
4. Tap top-right corner 5 times to exit

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Create organization + admin |
| POST | `/api/auth/login` | Admin login |
| GET | `/api/dashboard/stats` | Dashboard statistics |
| GET | `/api/visits` | Visit history with filters |
| GET | `/api/visits/active` | Currently on-site |
| POST | `/api/visits/check-in` | New visitor check-in |
| POST | `/api/visits/:id/check-out` | Check out visitor |
| GET | `/api/hosts` | List hosts |
| POST | `/api/hosts` | Add host |
| GET | `/api/pre-registered` | List pre-registered |
| POST | `/api/pre-registered` | Create pre-registration |
| GET | `/api/pre-registered/validate-qr/:token` | Validate QR code |

## Next Steps for Production

1. **Add email/SMS credentials** in `.env`
2. **Set up SSL/HTTPS** for production
3. **Configure CORS** for your domain
4. **Add rate limiting** per-organization
5. **Set up backups** for PostgreSQL
6. **Add monitoring** (Sentry, LogRocket)
7. **Implement photo capture** using getUserMedia API
8. **Add badge printing** with Brother QL SDK
9. **Build native mobile app** with React Native or Flutter

## Built by SentinelsIT

© 2026 Sentinels Technology Services. All rights reserved.

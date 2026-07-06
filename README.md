# Cab Backend

NestJS + Prisma (PostgreSQL) + Redis backend for ride-hailing driver allocation.

## Setup

**Prerequisites:** Node.js 20+, Docker.

1. Start Postgres and Redis (from the repo root, one level above `backend/`):
   ```bash
   docker compose up -d
   ```
2. Navigate to the backend directory:
   ```bash
   cd backend
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Create `backend/.env` (or `.env` inside the `backend` directory):

   ```env
   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/template1

   REDIS_HOST=localhost
   REDIS_PORT=6379
   REDIS_USER=default
   REDIS_PASSWORD=mypassword

   PORT=3000
   ALLOCATION_TIMEOUT_MS=15000
   ```

5. Apply migrations:
   ```bash
   npx prisma migrate deploy
   ```
6. (Optional) seed sample drivers/riders:
   ```bash
   npm run db:seed
   ```
7. Run the server:
   ```bash
   npm run start:dev
   ```

API is served at `http://localhost:3000`.

## Frontend Setup (Prototype)

> [!NOTE]
> The frontend application is a prototype designed purely for testing and visualizing the real-time ride-hailing driver allocation flow.

To run the frontend:

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the development server:
   ```bash
   npm run dev
   ```

The frontend will run at `http://localhost:5173`. Make sure the backend server is running on `http://localhost:3000` (which is configured in `frontend/.env` via the `VITE_API_URL` environment variable).

## Routes

### Drivers — `/api/drivers`

| Method | Path                        | Body                                              | Description                                  |
| ------ | --------------------------- | ------------------------------------------------- | -------------------------------------------- |
| POST   | `/api/drivers`              | `{ name }`                                        | Create a driver (starts `OFFLINE`)           |
| GET    | `/api/drivers`              | —                                                 | List all drivers with their current location |
| PATCH  | `/api/drivers/:id/status`   | `{ status }` (`AVAILABLE` \| `BUSY` \| `OFFLINE`) | Update driver status                         |
| POST   | `/api/drivers/:id/location` | `{ lat, lng }`                                    | Update driver's live location (Redis geo)    |

### Rides — `/api/rides`

| Method | Path                    | Body                                  | Description                                                 |
| ------ | ----------------------- | ------------------------------------- | ----------------------------------------------------------- |
| POST   | `/api/rides`            | `{ riderName, pickupLat, pickupLng }` | Request a ride; finds and notifies nearby available drivers |
| GET    | `/api/rides/:id`        | —                                     | Get ride details (state, assigned driver)                   |
| POST   | `/api/rides/:id/accept` | `{ driverId }`                        | Driver accepts the ride; first successful acceptance wins   |

## Testing

The project contains unit and end-to-end (E2E) tests.

### Running E2E Tests
To run the end-to-end tests, make sure the Postgres and Redis Docker containers are running (`docker compose up -d`), then run:
```bash
npm run test:e2e
```
> [!IMPORTANT]
> The E2E tests automatically clear the database tables and Redis keys before each test case to ensure test isolation.



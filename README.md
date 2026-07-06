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

## Architecture & Flow Diagrams

### Ride Acceptance: Concurrency, Idempotency, and Redis Locking Flow

The following ASCII diagram illustrates the flow when two drivers concurrently try to accept the same ride request. It highlights the role of the Redis distributed lock (`SET NX PX`), idempotency check (handling retries), and transactional state transitions in preventing double-allocation:

```
                  Driver A (accepts Ride 123)            Driver B (accepts Ride 123)
                              |                                      |
                              v                                      v
                      [ POST .../accept ]                    [ POST .../accept ]
                              |                                      |
                              +-------------------+------------------+
                                                  |
                                                  v
                                   +-----------------------------+
                                   |  Acquire Redis Mutex Lock   |
                                   |  Key: `ride:lock:123`       |
                                   |  Using SET NX PX            |
                                   +--------------+--------------+
                                                  |
                            +---------------------+---------------------+
                            | (Lock acquired by Driver A first)         | (Driver B fails to acquire lock,
                            |                                           |  spins/retries up to 10 times)
                            v                                           v
                  +-----------------------------------+        +-----------------------------------+
                  |          [ DRIVER A ]             |        |          [ DRIVER B ]             |
                  |  Fetch Ride 123 & Driver A records|        |           Spinning...             |
                  +-----------------+-----------------+        +-----------------+-----------------+
                                    |                                            |
                                    v                                            |
                         /---------------------\                                 |
                        / Is assignedDriverId   \    Yes (Idempotent call)       |
                       <  equal to Driver A ID?  >-------------------+           |
                        \                       /                    |           |
                         \---------------------/                     v           |
                                    | No                      [ Return Success ] |
                                    v                         [ (Already Yours) ]|
                         /---------------------\                                 |
                        /  Is ride ASSIGNED or  \    Yes                         |
                       <   assignedDriverId set  >-------------------+           |
                        \  to someone else?     /                    |           |
                         \---------------------/                     v           |
                                    | No                      [ Return 409 ]     |
                                    v                         [ Conflict Error ] |
                         /---------------------\                                 |
                        / Is Driver A status    \    No                          |
                       <  equal to AVAILABLE?    >-------------------+           |
                        \                       /                    |           |
                         \---------------------/                     v           |
                                    | Yes                     [ Return 400 ]     |
                                    v                         [ Bad Request ]    |
                         /---------------------\                                 |
                        / Is Driver A in active \    No                          |
                       <  equal to batch & not   >-------------------+           |
                        \  expired?             /                    |           |
                         \---------------------/                     v           |
                                    | Yes                     [ Return 400 ]     |
                                    v                         [ Bad Request ]    |
                  +-----------------------------------+                          |
                  |      Apply Updates Atomically     |                          |
                  | 1. Ride State -> ASSIGNED         |                          |
                  | 2. assignedDriverId -> Driver A   |                          |
                  | 3. Driver A Status -> BUSY        |                          |
                  | 4. Remove Driver A from Redis geo |                          |
                  +-----------------+-----------------+                          |
                                    |                                            |
                                    v                                            |
                         +--------------------+                                  |
                         | Release Redis Lock |                                  |
                         | Delete: `lock:123` |                                  |
                         +----------+---------+                                  |
                                    |                                            |
                                    v                                            |
                       [ Return Assignment Success ]                             |
                                                                                 |
                                                                                 v
                                                               (Driver B acquires lock after A releases it)
                                                                                 |
                                                                                 v
                                                                       +-------------------+
                                                                       |   [ DRIVER B ]    |
                                                                       | Fetch Ride & B DB |
                                                                       +---------+---------+
                                                                                 |
                                                                                 v
                                                                      /---------------------\
                                                                     /  Is ride ASSIGNED or  \   Yes
                                                                    <   assignedDriverId set  >------> [ Return 409 Conflict ]
                                                                     \  to someone else?     /         [ (Assigned to A) ]
                                                                      \---------------------/
```

import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from './../src/lib/prisma.service.js';
import { RedisService } from './../src/lib/redis.service.js';

describe('AppController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
    redis = moduleFixture.get<RedisService>(RedisService);
  });

  beforeEach(async () => {
    // Clear database and Redis before each test case for complete isolation
    await prisma.rideAttempt.deleteMany();
    await prisma.ride.deleteMany();
    await prisma.driver.deleteMany();
    await redis.del('drivers:locations');
  });

  afterAll(async () => {
    await app.close();
  });

  it('/api/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect((res) => {
        expect(res.body.status).toBe('healthy');
        expect(res.body.database).toBe('up');
        expect(res.body.redis).toBe('up');
      });
  });

  it('should support driver creation, location updating, and listing', async () => {
    // 1. Create a driver
    const driverRes = await request(app.getHttpServer())
      .post('/api/drivers')
      .send({ name: 'John Doe' })
      .expect(201);

    const driverId = driverRes.body.id;
    expect(driverId).toBeDefined();

    // 2. Set status to AVAILABLE
    await request(app.getHttpServer())
      .patch(`/api/drivers/${driverId}/status`)
      .send({ status: 'AVAILABLE' })
      .expect(200);

    // 3. Update driver location in Redis
    await request(app.getHttpServer())
      .post(`/api/drivers/${driverId}/location`)
      .send({ lat: 12.9716, lng: 77.5946 })
      .expect(201);

    // 4. Verify in List
    const listRes = await request(app.getHttpServer())
      .get('/api/drivers')
      .expect(200);

    expect(listRes.body.length).toBe(1);
    expect(listRes.body[0].name).toBe('John Doe');
    expect(listRes.body[0].location.lat).toBeCloseTo(12.9716, 4);
    expect(listRes.body[0].location.lng).toBeCloseTo(77.5946, 4);
  });

  it('should request a ride and perform geo matching to notify nearest drivers', async () => {
    // 1. Register 3 drivers (2 available close by, 1 offline)
    const d1 = await prisma.driver.create({ data: { name: 'Driver 1', status: 'AVAILABLE' } });
    const d2 = await prisma.driver.create({ data: { name: 'Driver 2', status: 'AVAILABLE' } });
    const d3 = await prisma.driver.create({ data: { name: 'Driver 3', status: 'OFFLINE' } });

    // Store locations in Redis (lat, lng)
    await redis.geoadd('drivers:locations', 77.5946, 12.9716, d1.id);
    await redis.geoadd('drivers:locations', 77.5948, 12.9718, d2.id);
    await redis.geoadd('drivers:locations', 77.5950, 12.9720, d3.id);

    // 2. Request a ride (rider at 12.9715, 77.5945)
    const rideRes = await request(app.getHttpServer())
      .post('/api/rides')
      .send({ riderName: 'Rider A', pickupLat: 12.9715, pickupLng: 77.5945 })
      .expect(201);

    expect(rideRes.body.ride.state).toBe('SEARCHING');
    // Driver 3 should NOT be notified because their status is OFFLINE in DB
    expect(rideRes.body.notifiedDrivers.length).toBe(2);
    expect(rideRes.body.notifiedDrivers).toContain(d1.id);
    expect(rideRes.body.notifiedDrivers).toContain(d2.id);
    expect(rideRes.body.notifiedDrivers).not.toContain(d3.id);
  });

  it('should concurrently assign a ride to exactly one driver and handle idempotency', async () => {
    // 1. Register 2 available drivers
    const d1 = await prisma.driver.create({ data: { name: 'D1', status: 'AVAILABLE' } });
    const d2 = await prisma.driver.create({ data: { name: 'D2', status: 'AVAILABLE' } });

    await redis.geoadd('drivers:locations', 77.5946, 12.9716, d1.id);
    await redis.geoadd('drivers:locations', 77.5948, 12.9718, d2.id);

    // 2. Request ride
    const rideRes = await request(app.getHttpServer())
      .post('/api/rides')
      .send({ riderName: 'Rider A', pickupLat: 12.9715, pickupLng: 77.5945 })
      .expect(201);

    const rideId = rideRes.body.ride.id;

    // 3. Concurrently accept using Promise.all
    const acceptPromises = [
      request(app.getHttpServer()).post(`/api/rides/${rideId}/accept`).send({ driverId: d1.id }),
      request(app.getHttpServer()).post(`/api/rides/${rideId}/accept`).send({ driverId: d2.id }),
    ];

    const results = await Promise.all(acceptPromises);
    const statuses = results.map((r) => r.status);

    // Verify exactly one succeeds (201 Created) and the other fails with 409 Conflict
    expect(statuses).toContain(201);
    expect(statuses).toContain(409);

    const successResult = results.find((r) => r.status === 201);
    const conflictResult = results.find((r) => r.status === 409);

    expect(successResult?.body.success).toBe(true);
    expect(conflictResult?.body.message).toContain('already assigned');


    // Wait, let's find the winner driver ID from DB directly to be absolutely sure
    const rideDb = await prisma.ride.findUnique({ where: { id: rideId } });
    const winnerId = rideDb?.assignedDriverId;
    expect(winnerId).toBeDefined();

    await request(app.getHttpServer())
      .post(`/api/rides/${rideId}/accept`)
      .send({ driverId: winnerId })
      .expect(201)
      .expect((res) => {
        expect(res.body.success).toBe(true);
      });

    // 5. Already assigned rejection: A driver trying to accept an already assigned ride gets 409 Conflict
    const d3 = await prisma.driver.create({ data: { name: 'D3', status: 'AVAILABLE' } });
    await request(app.getHttpServer())
      .post(`/api/rides/${rideId}/accept`)
      .send({ driverId: d3.id })
      .expect(409);

    // 6. Unnotified driver rejection: A driver who was not notified for a searching ride gets 400 Bad Request
    const activeRideRes = await request(app.getHttpServer())
      .post('/api/rides')
      .send({ riderName: 'Rider B', pickupLat: 12.9715, pickupLng: 77.5945 })
      .expect(201);
    const activeRideId = activeRideRes.body.ride.id;

    await request(app.getHttpServer())
      .post(`/api/rides/${activeRideId}/accept`)
      .send({ driverId: d3.id })
      .expect(400);
  });

  it('should timeout and retry with next batch of drivers and ultimately timeout', async () => {
    process.env.ALLOCATION_TIMEOUT_MS = '200';

    const d1 = await prisma.driver.create({ data: { name: 'D1', status: 'AVAILABLE' } });
    const d2 = await prisma.driver.create({ data: { name: 'D2', status: 'AVAILABLE' } });
    const d3 = await prisma.driver.create({ data: { name: 'D3', status: 'AVAILABLE' } });

    await redis.geoadd('drivers:locations', 77.5946, 12.9716, d1.id);
    await redis.geoadd('drivers:locations', 77.5948, 12.9718, d2.id);
    await redis.geoadd('drivers:locations', 77.5945, 13.0815, d3.id);

    const rideRes = await request(app.getHttpServer())
      .post('/api/rides')
      .send({ riderName: 'Rider Timeout', pickupLat: 12.9715, pickupLng: 77.5945 })
      .expect(201);

    const rideId = rideRes.body.ride.id;
    expect(rideRes.body.notifiedDrivers.length).toBe(2);

    await new Promise((resolve) => setTimeout(resolve, 300));

    const attempts = await prisma.rideAttempt.findMany({
      where: { rideId },
      orderBy: { batch: 'asc' },
    });

    expect(attempts.length).toBe(2);
    expect(attempts[1].batch).toBe(2);
    expect(attempts[1].driverIds as string[]).toContain(d3.id);

    await new Promise((resolve) => setTimeout(resolve, 300));

    const finalRide = await prisma.ride.findUnique({ where: { id: rideId } });
    expect(finalRide?.state).toBe('TIMEOUT');

    delete process.env.ALLOCATION_TIMEOUT_MS;
  });

  it('should prevent a single driver from accepting two different rides concurrently', async () => {
    // 1. Register 1 available driver
    const d1 = await prisma.driver.create({ data: { name: 'Solo Driver', status: 'AVAILABLE' } });
    await redis.geoadd('drivers:locations', 77.5946, 12.9716, d1.id);

    // 2. Request 2 different rides at the same pickup location so the driver is notified for both
    const rideARes = await request(app.getHttpServer())
      .post('/api/rides')
      .send({ riderName: 'Rider A', pickupLat: 12.9716, pickupLng: 77.5946 })
      .expect(201);

    const rideBRes = await request(app.getHttpServer())
      .post('/api/rides')
      .send({ riderName: 'Rider B', pickupLat: 12.9716, pickupLng: 77.5946 })
      .expect(201);

    const rideAId = rideARes.body.ride.id;
    const rideBId = rideBRes.body.ride.id;

    // 3. Simultaneously try to accept Ride A and Ride B as the same driver d1
    const acceptPromises = [
      request(app.getHttpServer()).post(`/api/rides/${rideAId}/accept`).send({ driverId: d1.id }),
      request(app.getHttpServer()).post(`/api/rides/${rideBId}/accept`).send({ driverId: d1.id }),
    ];

    const results = await Promise.all(acceptPromises);
    const statuses = results.map((r) => r.status);

    // One should succeed (201) and the other must fail (400 - bad request because driver status changes to BUSY)
    expect(statuses).toContain(201);
    expect(statuses).toContain(400);

    const successRes = results.find((r) => r.status === 201);
    const failRes = results.find((r) => r.status === 400);

    expect(successRes?.body.success).toBe(true);
    expect(failRes?.body.message).toContain('Driver is not available');

    // Verify DB states: one ride assigned, one ride still searching
    const dbRideA = await prisma.ride.findUnique({ where: { id: rideAId } });
    const dbRideB = await prisma.ride.findUnique({ where: { id: rideBId } });

    const assignedCount = [dbRideA?.state, dbRideB?.state].filter((s) => s === 'ASSIGNED').length;
    expect(assignedCount).toBe(1);
  });

  it('should support idempotent duplicate requests by the same driver concurrently', async () => {
    const d1 = await prisma.driver.create({ data: { name: 'Double Tap Driver', status: 'AVAILABLE' } });
    await redis.geoadd('drivers:locations', 77.5946, 12.9716, d1.id);

    const rideRes = await request(app.getHttpServer())
      .post('/api/rides')
      .send({ riderName: 'Rider C', pickupLat: 12.9716, pickupLng: 77.5946 })
      .expect(201);

    const rideId = rideRes.body.ride.id;

    // Send 3 concurrent duplicate acceptance requests
    const acceptPromises = [
      request(app.getHttpServer()).post(`/api/rides/${rideId}/accept`).send({ driverId: d1.id }),
      request(app.getHttpServer()).post(`/api/rides/${rideId}/accept`).send({ driverId: d1.id }),
      request(app.getHttpServer()).post(`/api/rides/${rideId}/accept`).send({ driverId: d1.id }),
    ];

    const results = await Promise.all(acceptPromises);
    const statuses = results.map((r) => r.status);

    // All should succeed (201) due to database serialization + idempotency check
    expect(statuses).toEqual([201, 201, 201]);
    results.forEach((r) => {
      expect(r.body.success).toBe(true);
    });

    const finalRide = await prisma.ride.findUnique({ where: { id: rideId } });
    expect(finalRide?.assignedDriverId).toBe(d1.id);
  });

  it('should prevent an old expired batch driver from accepting while an active batch driver accepts concurrently', async () => {
    process.env.ALLOCATION_TIMEOUT_MS = '200';

    const d1 = await prisma.driver.create({ data: { name: 'Batch 1 Driver', status: 'AVAILABLE' } });
    const d2 = await prisma.driver.create({ data: { name: 'Batch 2 Driver', status: 'AVAILABLE' } });

    // Place d1 close, d2 far
    await redis.geoadd('drivers:locations', 77.5946, 12.9716, d1.id);
    await redis.geoadd('drivers:locations', 77.5945, 13.0815, d2.id);

    const rideRes = await request(app.getHttpServer())
      .post('/api/rides')
      .send({ riderName: 'Rider D', pickupLat: 12.9715, pickupLng: 77.5945 })
      .expect(201);

    const rideId = rideRes.body.ride.id;

    // Wait for batch 1 to expire and batch 2 to spawn
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Now d1 (expired batch) and d2 (active batch) try to accept concurrently
    const acceptPromises = [
      request(app.getHttpServer()).post(`/api/rides/${rideId}/accept`).send({ driverId: d1.id }),
      request(app.getHttpServer()).post(`/api/rides/${rideId}/accept`).send({ driverId: d2.id }),
    ];

    const results = await Promise.all(acceptPromises);

    // d2 (active batch) should succeed (201), d1 (expired) should fail (400)
    expect(results[0].status).toBe(400);
    expect(results[0].body.message).toContain('late or invalid');
    
    expect(results[1].status).toBe(201);
    expect(results[1].body.success).toBe(true);

    delete process.env.ALLOCATION_TIMEOUT_MS;
  });
});

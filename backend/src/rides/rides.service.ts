import { Injectable, NotFoundException, ConflictException, BadRequestException, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../lib/prisma.service.js';
import { RedisService } from '../lib/redis.service.js';
import { RideState, DriverStatus, Ride } from '../generated/prisma/client.js';

@Injectable()
export class RidesService implements OnModuleDestroy {
  private activeTimeouts: NodeJS.Timeout[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  onModuleDestroy() {
    for (const timeout of this.activeTimeouts) {
      clearTimeout(timeout);
    }
    this.activeTimeouts = [];
  }

  async createRide(riderName: string, pickupLat: number, pickupLng: number) {
    // 1. Persist the ride in PostgreSQL (initial state: REQUESTED)
    const ride = await this.prisma.ride.create({
      data: {
        riderName,
        pickupLat,
        pickupLng,
        state: RideState.REQUESTED,
      },
    });

    // 2. Perform Geo Search in Redis to find closest drivers
    // Find up to 50 drivers within 10 km, sorted by distance
    const nearbyDriverIds = (await this.redis.geosearch(
      'drivers:locations',
      'FROMLONLAT',
      pickupLng,
      pickupLat,
      'BYRADIUS',
      10, // 10 kilometers
      'km',
      'ASC',
      'COUNT',
      50,
    )) as string[];

    let selectedDrivers: string[] = [];

    if (nearbyDriverIds.length > 0) {
      // 3. Query PostgreSQL to filter for AVAILABLE drivers
      const availableDrivers = await this.prisma.driver.findMany({
        where: {
          id: { in: nearbyDriverIds },
          status: DriverStatus.AVAILABLE,
        },
        select: { id: true },
      });

      const availableDriverSet = new Set(availableDrivers.map((d) => d.id));

      // Filter and keep the ASC distance order
      const sortedAvailableDrivers = nearbyDriverIds.filter((id) =>
        availableDriverSet.has(id),
      );

      // Select top 5 nearest available drivers
      selectedDrivers = sortedAvailableDrivers.slice(0, 5);
    }

    // 4. Update ride state to SEARCHING
    const updatedRide = await this.prisma.ride.update({
      where: { id: ride.id },
      data: { state: RideState.SEARCHING },
    });

    // 5. Store notification batch in RideAttempt
    const timeoutDurationMs = Number(process.env.ALLOCATION_TIMEOUT_MS) || 15 * 1000;
    const attempt = await this.prisma.rideAttempt.create({
      data: {
        rideId: ride.id,
        batch: 1,
        driverIds: selectedDrivers,
        timeoutAt: new Date(Date.now() + timeoutDurationMs),
      },
    });

    console.log(
      `[Ride Allocation] Notified drivers for Ride ${ride.id} (Batch 1):`,
      selectedDrivers,
    );

    // Schedule the allocation timeout check
    const timeoutId = setTimeout(async () => {
      this.activeTimeouts = this.activeTimeouts.filter((t) => t !== timeoutId);
      try {
        await this.checkAndRetryAllocation(ride.id);
      } catch (err) {
        console.error(`Error in checkAndRetryAllocation for Ride ${ride.id}:`, err);
      }
    }, timeoutDurationMs);
    this.activeTimeouts.push(timeoutId);

    return {
      ride: updatedRide,
      notifiedDrivers: selectedDrivers,
      attemptId: attempt.id,
    };
  }

  async checkAndRetryAllocation(rideId: string) {
    // Fetch the ride
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride || ride.state !== RideState.SEARCHING) {
      // Ride has already been ASSIGNED, TIMEOUT, or is in another final state.
      return;
    }

    // Get all previously notified driver IDs for this ride across all attempts
    const previousAttempts = await this.prisma.rideAttempt.findMany({
      where: { rideId },
    });

    const notifiedDriverIds = new Set<string>();
    let maxBatch = 0;
    for (const attempt of previousAttempts) {
      if (attempt.batch > maxBatch) {
        maxBatch = attempt.batch;
      }
      const driverIds = attempt.driverIds as string[];
      for (const id of driverIds) {
        notifiedDriverIds.add(id);
      }
    }

    // Find the next batch of closest drivers (extending radius slightly to 15km)
    const nearbyDriverIds = (await this.redis.geosearch(
      'drivers:locations',
      'FROMLONLAT',
      ride.pickupLng,
      ride.pickupLat,
      'BYRADIUS',
      15, // 15 km
      'km',
      'ASC',
      'COUNT',
      50,
    )) as string[];

    let nextDrivers: string[] = [];

    if (nearbyDriverIds.length > 0) {
      const unnotifiedIds = nearbyDriverIds.filter((id) => !notifiedDriverIds.has(id));
      if (unnotifiedIds.length > 0) {
        const availableDrivers = await this.prisma.driver.findMany({
          where: {
            id: { in: unnotifiedIds },
            status: DriverStatus.AVAILABLE,
          },
          select: { id: true },
        });

        const availableDriverSet = new Set(availableDrivers.map((d) => d.id));
        const sortedAvailable = unnotifiedIds.filter((id) =>
          availableDriverSet.has(id),
        );
        nextDrivers = sortedAvailable.slice(0, 5); // top 5 for the new batch
      }
    }

    if (nextDrivers.length === 0) {
      // No more available drivers found. Mark ride as TIMEOUT.
      await this.prisma.ride.update({
        where: { id: rideId },
        data: { state: RideState.TIMEOUT },
      });
      console.log(`[Ride Allocation] Ride ${rideId} timed out. No available drivers.`);
      return;
    }

    // Create new attempt
    const nextBatch = maxBatch + 1;
    const timeoutDurationMs = Number(process.env.ALLOCATION_TIMEOUT_MS) || 15 * 1000;
    await this.prisma.rideAttempt.create({
      data: {
        rideId,
        batch: nextBatch,
        driverIds: nextDrivers,
        timeoutAt: new Date(Date.now() + timeoutDurationMs),
      },
    });

    console.log(
      `[Ride Allocation] Batch ${maxBatch} timed out. Dispatching Batch ${nextBatch} to drivers:`,
      nextDrivers,
    );

    // Schedule the next timeout check
    const timeoutId = setTimeout(async () => {
      this.activeTimeouts = this.activeTimeouts.filter((t) => t !== timeoutId);
      try {
        await this.checkAndRetryAllocation(rideId);
      } catch (err) {
        console.error(`Error in checkAndRetryAllocation for Ride ${rideId}:`, err);
      }
    }, timeoutDurationMs);
    this.activeTimeouts.push(timeoutId);
  }

  async acceptRide(rideId: string, driverId: string) {
    const lockKey = `ride:lock:${rideId}`;
    let lockAcquired = false;

    // Acquire Redis distributed lock with spin-lock retry logic
    for (let i = 0; i < 10; i++) {
      const res = await (this.redis.set as any)(lockKey, 'locked', 'NX', 'PX', 5000);
      if (res === 'OK') {
        lockAcquired = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    if (!lockAcquired) {
      throw new ConflictException('Could not acquire transaction lock, please try again');
    }

    try {
      // 1. Fetch and validate Ride
      const ride = await this.prisma.ride.findUnique({
        where: { id: rideId },
      });

      if (!ride) {
        throw new NotFoundException(`Ride with ID ${rideId} not found`);
      }

      // Idempotency: check if already assigned to this driver
      if (ride.assignedDriverId === driverId) {
        return {
          success: true,
          message: 'Ride assigned to you',
          ride,
        };
      }

      // Check if ride is already assigned to someone else
      if (ride.state === RideState.ASSIGNED || ride.assignedDriverId) {
        throw new ConflictException('Ride already assigned to another driver');
      }

      // Check if ride has timed out or is in incorrect state
      if (ride.state !== RideState.SEARCHING) {
        throw new BadRequestException(`Ride is not in a searchable state (current: ${ride.state})`);
      }

      // 2. Fetch and validate Driver
      const driver = await this.prisma.driver.findUnique({
        where: { id: driverId },
      });

      if (!driver) {
        throw new NotFoundException(`Driver with ID ${driverId} not found`);
      }

      if (driver.status !== DriverStatus.AVAILABLE) {
        throw new BadRequestException(`Driver is not available (current: ${driver.status})`);
      }

      // 3. Fetch latest attempt to validate timeout and active batch membership
      const latestAttempt = await this.prisma.rideAttempt.findFirst({
        where: { rideId },
        orderBy: { batch: 'desc' },
      });

      if (!latestAttempt) {
        throw new BadRequestException('No ride allocation attempts found for this ride');
      }

      const notifiedDrivers = latestAttempt.driverIds as string[];
      const isDriverInBatch = notifiedDrivers.includes(driverId);
      const isAttemptExpired = new Date() > latestAttempt.timeoutAt;

      // Reject late acceptance requests
      if (!isDriverInBatch || isAttemptExpired) {
        throw new BadRequestException('Acceptance request is late or invalid for the current batch');
      }

      // 4. Assign the ride atomically
      const updatedRide = await this.prisma.ride.update({
        where: { id: rideId },
        data: {
          state: RideState.ASSIGNED,
          assignedDriverId: driverId,
        },
      });

      await this.prisma.driver.update({
        where: { id: driverId },
        data: {
          status: DriverStatus.BUSY,
        },
      });

      // Remove from active coordinates cache
      await this.redis.zrem('drivers:locations', driverId);

      console.log(`[Ride Assignment] Ride ${rideId} successfully assigned to Driver ${driverId}`);

      return {
        success: true,
        message: 'Ride assigned to you',
        ride: updatedRide,
      };
    } finally {
      // Release distributed lock
      await this.redis.del(lockKey);
    }
  }

  async getRide(id: string) {
    const ride = await this.prisma.ride.findUnique({
      where: { id },
      include: { assignedDriver: true },
    });
    if (!ride) {
      throw new NotFoundException(`Ride with ID ${id} not found`);
    }
    return ride;
  }

  async getAvailableDrivers(rideId: string) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) {
      throw new NotFoundException(`Ride with ID ${rideId} not found`);
    }

    const latestAttempt = await this.prisma.rideAttempt.findFirst({
      where: { rideId },
      orderBy: { batch: 'desc' },
    });

    if (!latestAttempt) {
      return [];
    }

    const driverIds = latestAttempt.driverIds as string[];
    if (driverIds.length === 0) {
      return [];
    }

    const drivers = await this.prisma.driver.findMany({
      where: { id: { in: driverIds } },
    });

    const withLocation = await Promise.all(
      drivers.map(async (driver) => {
        const pos = await this.redis.geopos('drivers:locations', driver.id);
        const location =
          pos && pos[0] ? { lng: parseFloat(pos[0][0]), lat: parseFloat(pos[0][1]) } : null;
        const distanceKm = location
          ? haversineKm(ride.pickupLat, ride.pickupLng, location.lat, location.lng)
          : null;
        return {
          id: driver.id,
          name: driver.name,
          status: driver.status,
          location,
          distanceKm,
        };
      }),
    );

    // Preserve the original nearest-first ordering from the allocation batch
    const orderIndex = new Map(driverIds.map((id, index) => [id, index]));
    withLocation.sort((a, b) => (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0));

    return withLocation;
  }
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

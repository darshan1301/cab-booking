import 'dotenv/config';
import { PrismaClient, DriverStatus } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { Redis } from 'ioredis';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL as string });
const prisma = new PrismaClient({ adapter });

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT) || 6379,
  username: process.env.REDIS_USER || 'default',
  password: process.env.REDIS_PASSWORD || 'mypassword',
  lazyConnect: true,
});

const DRIVERS_GEO_KEY = 'drivers:locations';

// Reference point: MG Road, Bangalore. Every driver/rider position below is
// expressed as a distance + bearing from this hub so the resulting spread is
// easy to reason about against the app's search radii (10km initial, 15km retry).
const HUB = { lat: 12.9716, lng: 77.5946 };

// Great-circle destination point given a start coordinate, distance and bearing.
function offset(distanceKm: number, bearingDeg: number, from = HUB) {
  const R = 6371;
  const bearing = (bearingDeg * Math.PI) / 180;
  const lat1 = (from.lat * Math.PI) / 180;
  const lng1 = (from.lng * Math.PI) / 180;
  const d = distanceKm / R;

  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearing));
  const lng2 =
    lng1 + Math.atan2(Math.sin(bearing) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));

  return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI, distanceKm };
}

interface DriverSeed {
  name: string;
  status: DriverStatus;
  distanceKm: number;
  bearingDeg: number;
  bucket: string;
}

// 20 drivers spread across four distance bands relative to the hub:
//  - near      (0-8km):   inside the 10km first-search radius
//  - mid       (8-10km):  still inside the first-search radius, but further out
//  - far       (10-15km): only reachable after the retry batch expands to 15km
//  - very-far  (15km+):   outside every search radius, should never be matched
// A few AVAILABLE drivers are mixed with BUSY/OFFLINE ones in the near/mid/far
// bands so the status filter in RidesService actually gets exercised.
const DRIVERS: DriverSeed[] = [
  { name: 'Rahul Sharma', status: DriverStatus.AVAILABLE, distanceKm: 1.2, bearingDeg: 10, bucket: 'near' },
  { name: 'Priya Singh', status: DriverStatus.AVAILABLE, distanceKm: 2.5, bearingDeg: 60, bucket: 'near' },
  { name: 'Amit Patel', status: DriverStatus.AVAILABLE, distanceKm: 3.0, bearingDeg: 120, bucket: 'near' },
  { name: 'Sneha Reddy', status: DriverStatus.AVAILABLE, distanceKm: 4.1, bearingDeg: 200, bucket: 'near' },
  { name: 'Vikram Nair', status: DriverStatus.BUSY, distanceKm: 5.0, bearingDeg: 250, bucket: 'near' },
  { name: 'Anjali Gupta', status: DriverStatus.AVAILABLE, distanceKm: 6.2, bearingDeg: 300, bucket: 'near' },
  { name: 'Karan Mehta', status: DriverStatus.OFFLINE, distanceKm: 7.0, bearingDeg: 340, bucket: 'near' },
  { name: 'Divya Iyer', status: DriverStatus.AVAILABLE, distanceKm: 7.8, bearingDeg: 30, bucket: 'near' },

  { name: 'Arjun Rao', status: DriverStatus.AVAILABLE, distanceKm: 8.5, bearingDeg: 80, bucket: 'mid' },
  { name: 'Neha Verma', status: DriverStatus.AVAILABLE, distanceKm: 9.0, bearingDeg: 150, bucket: 'mid' },
  { name: 'Rohan Kapoor', status: DriverStatus.BUSY, distanceKm: 9.3, bearingDeg: 210, bucket: 'mid' },
  { name: 'Pooja Joshi', status: DriverStatus.AVAILABLE, distanceKm: 9.6, bearingDeg: 270, bucket: 'mid' },
  { name: 'Sanjay Kumar', status: DriverStatus.AVAILABLE, distanceKm: 9.9, bearingDeg: 320, bucket: 'mid' },

  { name: 'Meera Pillai', status: DriverStatus.AVAILABLE, distanceKm: 11.0, bearingDeg: 45, bucket: 'far' },
  { name: 'Aditya Malhotra', status: DriverStatus.AVAILABLE, distanceKm: 12.5, bearingDeg: 135, bucket: 'far' },
  { name: 'Kavya Menon', status: DriverStatus.OFFLINE, distanceKm: 13.8, bearingDeg: 225, bucket: 'far' },
  { name: 'Suresh Yadav', status: DriverStatus.AVAILABLE, distanceKm: 14.9, bearingDeg: 315, bucket: 'far' },

  { name: 'Ritu Bhatt', status: DriverStatus.AVAILABLE, distanceKm: 18.0, bearingDeg: 90, bucket: 'very-far' },
  { name: 'Manish Chawla', status: DriverStatus.AVAILABLE, distanceKm: 22.0, bearingDeg: 180, bucket: 'very-far' },
  { name: 'Ishita Desai', status: DriverStatus.AVAILABLE, distanceKm: 27.0, bearingDeg: 270, bucket: 'very-far' },
];

// There's no dedicated Rider model in the schema (a "rider" only exists as the
// riderName + pickup fields on a Ride, populated once POST /api/rides runs the
// live matching pipeline - geosearch, RideAttempt batching, timeout scheduling).
// Seeding raw Ride rows here would bypass that pipeline and leave dead REQUESTED
// rows that never get processed. Instead these 5 profiles are exported as ready
// -to-use test data: fire them at POST /api/rides (or the frontend's Rider tab)
// to exercise different distance scenarios against the seeded drivers above.
interface RiderSeed {
  riderName: string;
  distanceKm: number;
  bearingDeg: number;
  scenario: string;
}

const RIDERS: RiderSeed[] = [
  { riderName: 'Alice Fernandes', distanceKm: 0, bearingDeg: 0, scenario: 'At the hub - dense pool of near drivers' },
  { riderName: 'Bob Thomas', distanceKm: 4, bearingDeg: 200, scenario: 'Near the Sneha/Anjali cluster' },
  { riderName: "Carla D'Souza", distanceKm: 8, bearingDeg: 90, scenario: 'Edge of first radius - likely needs the mid band' },
  { riderName: 'David Nunes', distanceKm: 12, bearingDeg: 135, scenario: 'Only reachable after retry expands to 15km' },
  { riderName: 'Emma Coutinho', distanceKm: 60, bearingDeg: 0, scenario: 'Far outside every driver - should time out' },
];

async function main() {
  await redis.connect();

  console.log('Resetting existing ride/driver data...');
  await prisma.rideAttempt.deleteMany();
  await prisma.ride.deleteMany();
  await prisma.driver.deleteMany();
  await redis.del(DRIVERS_GEO_KEY);

  console.log(`Seeding ${DRIVERS.length} drivers...`);
  const createdDrivers: Array<DriverSeed & { id: string; lat: number; lng: number }> = [];

  for (const d of DRIVERS) {
    const { lat, lng } = offset(d.distanceKm, d.bearingDeg);
    const driver = await prisma.driver.create({
      data: { name: d.name, status: d.status },
    });
    // Only AVAILABLE drivers matter for matching, but we track every driver's
    // coordinates in Redis (mirrors DriversService.updateLocation behavior) so
    // toggling status via the API/UI produces realistic results later too.
    await redis.geoadd(DRIVERS_GEO_KEY, lng, lat, driver.id);
    createdDrivers.push({ ...d, id: driver.id, lat, lng });
  }

  console.log('\nDrivers seeded:');
  console.table(
    createdDrivers.map((d) => ({
      name: d.name,
      id: d.id,
      status: d.status,
      bucket: d.bucket,
      distanceKm: d.distanceKm,
      lat: d.lat.toFixed(5),
      lng: d.lng.toFixed(5),
    })),
  );

  console.log('\nRiders (not persisted - use these to POST /api/rides):');
  console.table(
    RIDERS.map((r) => {
      const { lat, lng } = offset(r.distanceKm, r.bearingDeg);
      return {
        riderName: r.riderName,
        pickupLat: lat.toFixed(5),
        pickupLng: lng.toFixed(5),
        distanceFromHubKm: r.distanceKm,
        scenario: r.scenario,
      };
    }),
  );

  console.log('\nExample:');
  const example = offset(RIDERS[0].distanceKm, RIDERS[0].bearingDeg);
  console.log(
    `curl -X POST http://localhost:3000/api/rides -H "Content-Type: application/json" -d '{"riderName":"${
      RIDERS[0].riderName
    }","pickupLat":${example.lat.toFixed(5)},"pickupLng":${example.lng.toFixed(5)}}'`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await redis.quit();
  });

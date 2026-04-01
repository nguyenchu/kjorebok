export type TripStatus = "ACTIVE" | "COMPLETED";

export interface GpsPoint {
  lat: number;
  lng: number;
  speed: number; // m/s
  heading: number; // degrees
  accuracy: number; // meters
  timestamp: string; // ISO 8601
}

export interface Trip {
  id: string;
  vehicleId: string | null;
  userId: string;
  status: TripStatus;
  startedAt: string;
  endedAt: string | null;
  distanceMeters: number;
  startAddress: string | null;
  endAddress: string | null;
  route: GpsPoint[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateTripDto {
  startPoint: GpsPoint;
  startAddress?: string | null;
}

export interface AddRoutePointDto {
  point: GpsPoint;
}

export interface AddRouteBatchDto {
  points: GpsPoint[];
}

export interface CompleteTripDto {
  endPoint: GpsPoint;
  endAddress?: string | null;
}

export type TripSummary = Omit<Trip, "route">;

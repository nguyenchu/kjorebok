export type TripStatus = "active" | "completed";

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
  vehicleId: string;
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
  vehicleId: string;
  startPoint: GpsPoint;
}

export interface AddRoutePointDto {
  point: GpsPoint;
}

export interface CompleteTripDto {
  endPoint: GpsPoint;
}

export type TripSummary = Omit<Trip, "route">;

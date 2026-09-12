import type { Place } from "./place";
import type { Vehicle } from "./vehicle";

export type TripStatus = "ACTIVE" | "COMPLETED";
export type TripPurpose = "PRIVATE" | "WORK";
export type TripMode = "WALK" | "CYCLE" | "EBIKE" | "CAR" | "OTHER";

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
  userId: string;
  status: TripStatus;
  startedAt: string;
  endedAt: string | null;
  distanceMeters: number;
  startAddress: string | null;
  endAddress: string | null;
  startPlace: Place | null;
  endPlace: Place | null;
  purpose: TripPurpose;
  /** Fritekst formål, påkrevd dokumentasjon for yrkeskjøring. */
  purposeNote: string | null;
  /** Oppdragsgiver eller hvem som ble besøkt. */
  client: string | null;
  mode: TripMode;
  vehicle: Vehicle | null;
  odometerStart: number | null;
  odometerEnd: number | null;
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

export interface UpdateTripDto {
  purpose?: TripPurpose;
  purposeNote?: string | null;
  client?: string | null;
  mode?: TripMode;
  vehicleId?: string | null;
  odometerStart?: number | null;
  odometerEnd?: number | null;
}

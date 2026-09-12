export type VehicleType = "PRIVATE" | "COMPANY" | "WORK";

export interface Vehicle {
  id: string;
  label: string;
  registration: string;
  type: VehicleType;
  isDefault: boolean;
}

export interface CreateVehicleDto {
  label: string;
  registration: string;
  type?: VehicleType;
  isDefault?: boolean;
}

export interface UpdateVehicleDto {
  label?: string;
  registration?: string;
  type?: VehicleType;
  isDefault?: boolean;
}

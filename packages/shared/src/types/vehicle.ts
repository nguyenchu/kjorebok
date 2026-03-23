export interface Vehicle {
  id: string;
  userId: string;
  name: string;
  licensePlate: string;
  createdAt: string;
}

export interface CreateVehicleDto {
  name: string;
  licensePlate: string;
}
